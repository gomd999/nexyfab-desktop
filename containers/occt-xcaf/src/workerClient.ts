import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, lstat, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SHA256 = /^[a-f0-9]{64}$/;
const STEP_HEADER = 'ISO-10303-21';
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_NATIVE_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_NATIVE_BINARY_BYTES = 512 * 1024 * 1024;
// Keep the worker ceiling aligned with the canonical consumer's nested-value
// budget. The native executable may inspect more, but this commercial boundary
// must not emit a PASS receipt the canonical adapter cannot consume.
const MAX_NATIVE_PRODUCTS = 128;
const MAX_TOPOLOGY_COUNT = 2_000_000;
const MAX_NATIVE_TEXT_BYTES = 8_192;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 500_000;

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
  const information = await stat(file).catch(() => null);
  if (!information?.isFile() || information.size < 1 || information.size > MAX_NATIVE_BINARY_BYTES) {
    throw new XcafWorkerError('NATIVE_UNAVAILABLE', 'native XCAF binary is unavailable or outside the binary size bound', 503);
  }
  const digest = createHash('sha256');
  let total = 0;
  try {
    for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > MAX_NATIVE_BINARY_BYTES) throw new Error('native_binary_size_changed');
      digest.update(bytes);
    }
  } catch {
    throw new XcafWorkerError('NATIVE_UNAVAILABLE', 'native XCAF binary could not be hashed safely', 503);
  }
  if (total !== information.size) throw new XcafWorkerError('NATIVE_UNAVAILABLE', 'native XCAF binary changed while hashing', 503);
  return digest.digest('hex');
}

async function nativeInvocationSha256(command: NativeCommand, executableSha256: string): Promise<string> {
  const argumentsBound: Array<{ kind: 'FILE'; sha256: string } | { kind: 'LITERAL'; value: string }> = [];
  for (const argument of command.args ?? []) {
    const information = await stat(argument).catch(() => null);
    if (information?.isFile()) argumentsBound.push({ kind: 'FILE', sha256: await nativeSha256(argument) });
    else argumentsBound.push({ kind: 'LITERAL', value: argument });
  }
  return createHash('sha256')
    .update('nexyfab.occt-xcaf.native-invocation.v1\n')
    .update(JSON.stringify({ executableSha256, arguments: argumentsBound }))
    .digest('hex');
}

function malformed(message: string): never {
  throw new XcafWorkerError('NATIVE_OUTPUT_STRUCTURE_INVALID', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedString(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > MAX_NATIVE_TEXT_BYTES) {
    return malformed(`${field} must be a non-empty bounded string${nullable ? ' or null' : ''}`);
  }
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return malformed(`${field} must be finite`);
  return value;
}

function boundedCount(value: unknown, field: string): number {
  const number = finiteNumber(value, field);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_TOPOLOGY_COUNT) {
    return malformed(`${field} is outside the topology count bound`);
  }
  return number;
}

function numericTuple(value: unknown, length: number, field: string): number[] {
  if (!Array.isArray(value) || value.length !== length) return malformed(`${field} must have ${length} values`);
  return value.map((item, index) => finiteNumber(item, `${field}[${index}]`));
}

function validateBoundedJson(root: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (++nodes > MAX_JSON_NODES) malformed('native output exceeds the JSON node bound');
    if (current.depth > MAX_JSON_DEPTH) malformed('native output exceeds the JSON depth bound');
    if (typeof current.value === 'number' && !Number.isFinite(current.value)) malformed('native output contains a non-finite number');
    if (typeof current.value === 'string' && Buffer.byteLength(current.value, 'utf8') > MAX_NATIVE_TEXT_BYTES) {
      malformed('native output contains an oversized string');
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_NATIVE_PRODUCTS) malformed('native output contains an oversized array');
      for (const value of current.value) pending.push({ value, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      const entries = Object.entries(current.value);
      if (entries.length > 128) malformed('native output object contains too many fields');
      for (const [key, value] of entries) {
        if (Buffer.byteLength(key, 'utf8') > 128) malformed('native output contains an oversized field name');
        pending.push({ value, depth: current.depth + 1 });
      }
    }
  }
}

function validateIdentity(result: Record<string, unknown>): void {
  const hasProgram = result.programIdentity !== undefined;
  const hasKernel = result.kernelIdentity !== undefined;
  if (!hasProgram || !hasKernel || !isRecord(result.programIdentity) || !isRecord(result.kernelIdentity)) {
    malformed('native identity fields must be supplied as a complete pair');
  }
  const program = result.programIdentity;
  const kernel = result.kernelIdentity;
  if (!exactKeys(program, ['name', 'version', 'buildIdentity']) || !exactKeys(kernel, ['name', 'version', 'buildIdentity'])) {
    malformed('native identity fields contain an unknown or missing key');
  }
  if (program.name !== 'occt-xcaf-inspect') malformed('native program identity is invalid');
  if (boundedString(program.version, 'programIdentity.version') !== '2') malformed('native program version is incompatible');
  boundedString(program.buildIdentity, 'programIdentity.buildIdentity');
  if (kernel.name !== 'OpenCASCADE') malformed('native kernel identity is invalid');
  boundedString(kernel.version, 'kernelIdentity.version');
  boundedString(kernel.buildIdentity, 'kernelIdentity.buildIdentity');
}

function validateShape(value: unknown, index: number): void {
  const keys = [
    'solidCount', 'shellCount', 'faceCount', 'edgeCount', 'nonManifoldEdgeCount',
    'brepValid', 'volumeMm3', 'surfaceAreaMm2', 'maxToleranceMm', 'bboxMm',
    'centroidMm', 'massPropertiesBasis', 'inertiaTensor', 'inertiaUnit',
  ] as const;
  if (!isRecord(value) || !exactKeys(value, keys)) malformed(`products[${index}].shape must match the complete native v2 schema`);
  boundedCount(value.solidCount, `products[${index}].shape.solidCount`);
  boundedCount(value.shellCount, `products[${index}].shape.shellCount`);
  boundedCount(value.faceCount, `products[${index}].shape.faceCount`);
  const edges = boundedCount(value.edgeCount, `products[${index}].shape.edgeCount`);
  finiteNumber(value.volumeMm3, `products[${index}].shape.volumeMm3`);
  if (value.bboxMm !== null) {
    const bounds = numericTuple(value.bboxMm, 6, `products[${index}].shape.bboxMm`);
    if (bounds[0] > bounds[3] || bounds[1] > bounds[4] || bounds[2] > bounds[5]) malformed('native bounding box is inverted');
  }

  if (typeof value.brepValid !== 'boolean') malformed('brepValid must be boolean');
  const nonManifoldEdges = boundedCount(value.nonManifoldEdgeCount, `products[${index}].shape.nonManifoldEdgeCount`);
  if (nonManifoldEdges > edges) malformed('non-manifold edge count exceeds edge count');
  const area = finiteNumber(value.surfaceAreaMm2, `products[${index}].shape.surfaceAreaMm2`);
  const tolerance = finiteNumber(value.maxToleranceMm, `products[${index}].shape.maxToleranceMm`);
  if (area < 0 || tolerance < 0) malformed('surface area and tolerance must be non-negative');
  const hasCentroid = value.centroidMm !== null;
  if (!hasCentroid) {
    if (value.massPropertiesBasis !== null || value.inertiaTensor !== null || value.inertiaUnit !== null) {
      malformed('empty mass properties must use a complete null tuple');
    }
  } else {
    numericTuple(value.centroidMm, 3, `products[${index}].shape.centroidMm`);
    if (value.massPropertiesBasis !== 'volume' && value.massPropertiesBasis !== 'surface') malformed('mass properties basis is invalid');
    numericTuple(value.inertiaTensor, 9, `products[${index}].shape.inertiaTensor`);
    const expectedUnit = value.massPropertiesBasis === 'volume' ? 'mm5' : 'mm4';
    if (value.inertiaUnit !== expectedUnit) malformed('inertia unit does not match its basis');
  }
}

function validateProduct(value: unknown, index: number, paths: Set<string>): void {
  const keys = ['entry', 'role', 'occurrencePath', 'referredEntry', 'name', 'partNumber', 'partNumberStatus', 'label', 'transformScope', 'transform', 'color', 'shape'] as const;
  if (!isRecord(value) || !exactKeys(value, keys)) malformed(`products[${index}] must match the complete native v2 schema`);
  boundedString(value.entry, `products[${index}].entry`);
  boundedString(value.label, `products[${index}].label`);
  if (!['assembly', 'product', 'assembly_occurrence', 'occurrence'].includes(String(value.role))) malformed('native product role is invalid');
  boundedString(value.name, `products[${index}].name`, true);
  boundedString(value.partNumber, `products[${index}].partNumber`, true);
  const occurrencePath = boundedString(value.occurrencePath, `products[${index}].occurrencePath`)!;
  if (paths.has(occurrencePath)) malformed('native occurrence paths must be unique');
  paths.add(occurrencePath);
  boundedString(value.referredEntry, `products[${index}].referredEntry`, true);
  if (value.partNumberStatus !== 'NOT_EXPOSED_BY_BINDING') malformed('native part-number status is invalid');
  if (value.partNumber !== null) malformed('native part number must remain null while the binding does not expose it');
  if (value.transformScope !== 'local_to_parent') malformed('native transform scope is invalid');
  if (!isRecord(value.transform) || !exactKeys(value.transform, ['matrix3x3', 'translationMm'])) malformed('native transform must match the complete schema');
  numericTuple(value.transform.matrix3x3, 9, `products[${index}].transform.matrix3x3`);
  numericTuple(value.transform.translationMm, 3, `products[${index}].transform.translationMm`);
  if (value.color !== null) {
    const color = numericTuple(value.color, 3, `products[${index}].color`);
    if (color.some(channel => channel < 0 || channel > 1)) malformed('native color is outside the normalized range');
  }
  validateShape(value.shape, index);
}

function parseNative(stdout: string, inputDigest: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(stdout.trim()); } catch { throw new XcafWorkerError('NATIVE_OUTPUT_MALFORMED', 'native output is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new XcafWorkerError('NATIVE_OUTPUT_MALFORMED', 'native output must be a JSON object');
  validateBoundedJson(value);
  const result = value as Record<string, unknown>;
  if (!exactKeys(result, ['schema', 'status', 'inputSha256', 'unit', 'programIdentity', 'kernelIdentity', 'productIdentitySource', 'products'])) {
    malformed('native output must match the complete native v2 schema');
  }
  if (result.schema !== 'nexyfab.occt-xcaf.inspect.v1' || result.status !== 'PASS_NATIVE') {
    throw new XcafWorkerError('NATIVE_OUTPUT_NOT_PASS', 'native output did not provide a PASS_NATIVE receipt');
  }
  if (result.inputSha256 !== inputDigest) throw new XcafWorkerError('NATIVE_OUTPUT_HASH_MISMATCH', 'native output is not bound to this input');
  if (result.unit !== 'MM' || result.productIdentitySource !== 'STEPCAFControl_Reader+XCAFDoc_ShapeTool') {
    malformed('native output does not prove the configured XCAF millimetre boundary');
  }
  if (!Array.isArray(result.products) || result.products.length < 1 || result.products.length > MAX_NATIVE_PRODUCTS) {
    malformed('native output contains an invalid XCAF product count');
  }
  validateIdentity(result);
  const occurrencePaths = new Set<string>();
  result.products.forEach((product, index) => validateProduct(product, index, occurrencePaths));
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
  if (typeof options.nativeCommand.file !== 'string' || options.nativeCommand.file.length < 1
    || options.nativeCommand.file.length > 4096 || options.nativeCommand.file.includes('\0')) throw new Error('nativeCommand_file_invalid');
  if (options.nativeCommand.args !== undefined && (!Array.isArray(options.nativeCommand.args)
    || options.nativeCommand.args.length > 32
    || options.nativeCommand.args.some(argument => typeof argument !== 'string' || argument.length > 4096 || argument.includes('\0')))) {
    throw new Error('nativeCommand_args_invalid');
  }

  return {
    async capabilities() {
      const executable = await access(options.nativeCommand.file, constants.X_OK).then(() => true).catch(() => false);
      const available = executable && await probeNative(options.nativeCommand);
      return {
        schema: 'nexyfab.occt-xcaf.capabilities.v1',
        status: available ? 'READY' : 'HOLD',
        inspectionStatus: 'NOT_RUN' as const,
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
      const nativeInvocationDigest = await nativeInvocationSha256(options.nativeCommand, nativeDigest);
      const directory = await mkdtemp(path.join(os.tmpdir(), 'nexyfab-occt-xcaf-'));
      const temporary = path.join(directory, 'input.step');
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
        const native = await runNative(options.nativeCommand, temporary, digest, timeout);
        return {
          schema: 'nexyfab.occt-xcaf.inspect-result.v1',
          status: 'PASS_NATIVE' as const,
          inputSha256: digest,
          nativeBinarySha256: nativeDigest,
          nativeInvocationSha256: nativeInvocationDigest,
          native,
        };
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
