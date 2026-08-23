import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, lstat, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SHA256 = /^[a-f0-9]{64}$/;
const STEP_HEADER = 'ISO-10303-21';
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_NATIVE_OUTPUT_BYTES = 4 * 1024 * 1024;

export type XcafRequest = {
  inputBytes?: Buffer;
  inputPath?: string;
  sha256?: string;
  timeoutMs?: number;
};

export type NativeCommand = {
  file: string;
  args?: string[];
};

export type XcafWorkerOptions = {
  nativeCommand: NativeCommand;
  inputRoot?: string;
  maxBytes?: number;
  defaultTimeoutMs?: number;
};

export class XcafWorkerError extends Error {
  constructor(readonly code: string, message = code, readonly httpStatus = 502) {
    super(message);
    this.name = 'XcafWorkerError';
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function ensureSha(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!SHA256.test(value)) throw new XcafWorkerError('SHA256_INVALID', 'sha256 must be lowercase hexadecimal SHA-256', 400);
  return value;
}

function ensureStep(value: Buffer): void {
  if (value.length < STEP_HEADER.length || value.subarray(0, STEP_HEADER.length).toString('ascii') !== STEP_HEADER) {
    throw new XcafWorkerError('STEP_INPUT_INVALID', 'input is not an ISO-10303-21 STEP file', 400);
  }
}

async function readBoundedFile(file: string, maximum: number): Promise<Buffer> {
  const information = await stat(file).catch(() => null);
  if (!information?.isFile() || information.size < 1 || information.size > maximum) {
    throw new XcafWorkerError('INPUT_SIZE_INVALID', 'input file is missing, empty, or too large', 400);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maximum) throw new XcafWorkerError('INPUT_SIZE_INVALID', 'input file exceeds the configured limit', 400);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

async function readSafePath(inputPath: string, root: string | undefined, maximum: number): Promise<Buffer> {
  if (!root) throw new XcafWorkerError('PATH_INPUT_UNSUPPORTED', 'path input requires an explicit OCCT_XCAF_INPUT_ROOT', 400);
  if (!inputPath || inputPath.includes('\0')) throw new XcafWorkerError('PATH_INVALID', 'input path is invalid', 400);
  const absoluteRoot = await realpath(root).catch(() => null);
  if (!absoluteRoot) throw new XcafWorkerError('INPUT_ROOT_UNAVAILABLE', 'configured input root is unavailable', 503);
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(absoluteRoot, inputPath);
  const lexicalBoundary = `${absoluteRoot}${path.sep}`;
  if (candidate !== absoluteRoot && !candidate.startsWith(lexicalBoundary)) {
    throw new XcafWorkerError('PATH_OUTSIDE_ROOT', 'input path is outside the configured root', 400);
  }
  const entry = await lstat(candidate).catch(() => null);
  if (!entry?.isFile() || entry.isSymbolicLink()) throw new XcafWorkerError('PATH_NOT_REGULAR_FILE', 'input path must be a regular non-symlink file', 400);
  const resolved = await realpath(candidate).catch(() => null);
  if (!resolved || (resolved !== absoluteRoot && !resolved.startsWith(lexicalBoundary))) {
    throw new XcafWorkerError('PATH_OUTSIDE_ROOT', 'resolved input path is outside the configured root', 400);
  }
  if (!['.step', '.stp'].includes(path.extname(candidate).toLowerCase())) {
    throw new XcafWorkerError('STEP_EXTENSION_INVALID', 'path input must have .step or .stp extension', 400);
  }
  return readBoundedFile(candidate, maximum);
}

async function nativeSha256(file: string): Promise<string> {
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) throw new XcafWorkerError('NATIVE_UNAVAILABLE', 'native XCAF binary is unavailable', 503);
  return sha256(bytes);
}

function parseNative(stdout: string, inputDigest: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(stdout.trim()); } catch { throw new XcafWorkerError('NATIVE_OUTPUT_MALFORMED', 'native output is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new XcafWorkerError('NATIVE_OUTPUT_MALFORMED', 'native output must be a JSON object');
  const result = value as Record<string, unknown>;
  if (result.schema !== 'nexyfab.occt-xcaf.inspect.v1' || result.status !== 'PASS_NATIVE') {
    throw new XcafWorkerError('NATIVE_OUTPUT_NOT_PASS', 'native output did not provide a PASS_NATIVE receipt');
  }
  if (result.inputSha256 !== inputDigest) throw new XcafWorkerError('NATIVE_OUTPUT_HASH_MISMATCH', 'native output is not bound to this input');
  if (!Array.isArray(result.products) || result.products.length < 1) throw new XcafWorkerError('NATIVE_OUTPUT_STRUCTURE_INVALID', 'native output contains no XCAF products');
  return result;
}

function runNative(command: NativeCommand, input: string, digest: string, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, [...(command.args ?? []), '--input', input, '--expected-sha256', digest], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_NATIVE_OUTPUT_BYTES) child.kill('SIGKILL');
      else stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => { if (stderr.length < 16_384) stderr += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(new XcafWorkerError('NATIVE_UNAVAILABLE', error.message, 503)); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) return reject(new XcafWorkerError('NATIVE_TIMEOUT', `native process exceeded ${timeoutMs}ms`, 504));
      if (outputBytes > MAX_NATIVE_OUTPUT_BYTES) return reject(new XcafWorkerError('NATIVE_OUTPUT_TOO_LARGE', 'native output exceeded the configured limit'));
      if (code !== 0) return reject(new XcafWorkerError('NATIVE_EXIT', `native process failed (${code ?? signal}): ${stderr.trim().slice(0, 500)}`));
      try { resolve(parseNative(stdout, digest)); } catch (error) { reject(error); }
    });
  });
}

function probeNative(command: NativeCommand, timeoutMs = 5_000): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(command.file, [...(command.args ?? []), '--version'], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(available);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (output.length + chunk.length > 256) {
        child.kill('SIGKILL');
        finish(false);
      } else output += chunk;
    });
    child.once('error', () => finish(false));
    child.once('close', code => finish(code === 0 && /^occt-xcaf-inspect\/\d+\s*$/.test(output)));
  });
}

export function createXcafWorker(options: XcafWorkerOptions) {
  const maximum = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const defaultTimeout = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > DEFAULT_MAX_BYTES) throw new Error('maxBytes_invalid');
  if (!Number.isSafeInteger(defaultTimeout) || defaultTimeout < 100 || defaultTimeout > 15 * 60_000) throw new Error('defaultTimeoutMs_invalid');

  return {
    async capabilities() {
      const executable = await access(options.nativeCommand.file, constants.X_OK).then(() => true).catch(() => false);
      const available = executable && await probeNative(options.nativeCommand);
      return {
        schema: 'nexyfab.occt-xcaf.capabilities.v1',
        status: available ? 'READY' : 'HOLD',
        nativeAvailable: available,
        productIdentity: available ? 'STEPCAFControl_Reader+XCAFDoc_ShapeTool' : 'NOT_RUN',
        maxInputBytes: maximum,
        reason: available ? undefined : 'NATIVE_UNAVAILABLE',
      };
    },
    async inspect(request: XcafRequest) {
      const expected = ensureSha(request.sha256);
      if ((request.inputBytes ? 1 : 0) + (request.inputPath ? 1 : 0) !== 1) {
        throw new XcafWorkerError('INPUT_REQUIRED', 'provide exactly one of inputBytes or inputPath', 400);
      }
      const bytes = request.inputBytes ?? await readSafePath(request.inputPath!, options.inputRoot, maximum);
      if (bytes.length < 1 || bytes.length > maximum) throw new XcafWorkerError('INPUT_SIZE_INVALID', 'input size is outside the configured bounds', 400);
      ensureStep(bytes);
      const digest = sha256(bytes);
      if (expected && expected !== digest) throw new XcafWorkerError('INPUT_SHA256_MISMATCH', 'input sha256 does not match bytes', 400);
      const timeout = request.timeoutMs ?? defaultTimeout;
      if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 15 * 60_000) throw new XcafWorkerError('TIMEOUT_INVALID', 'timeout is outside the configured bounds', 400);
      const nativeDigest = await nativeSha256(options.nativeCommand.file);
      const directory = await mkdtemp(path.join(os.tmpdir(), 'nexyfab-occt-xcaf-'));
      const temporary = path.join(directory, 'input.step');
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
        const native = await runNative(options.nativeCommand, temporary, digest, timeout);
        return {
          schema: 'nexyfab.occt-xcaf.inspect-result.v1',
          inputSha256: digest,
          nativeBinarySha256: nativeDigest,
          native,
        };
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
