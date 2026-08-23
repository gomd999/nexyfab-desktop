import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CadComputeExecutor, ResolvedComputeInput } from '../../runtime/src/computeService';

const SHA256 = /^[a-f0-9]{64}$/;

export function validateContainerScadSource(source: string): string[] {
  const issues: string[] = [];
  if (!source.trim() || Buffer.byteLength(source, 'utf8') > 512 * 1024 || source.includes('\0')) issues.push('scad_size_or_encoding_invalid');
  let code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\r\n]*/g, '$1');
  const includeToken = /\b(include|use)\b\s*<([^>\r\n]+)>/gi;
  for (const match of code.matchAll(includeToken)) {
    if (!/^BOSL2\/[A-Za-z0-9_-]+\.scad$/.test(match[2]!.trim().replace(/\\/g, '/'))) issues.push('untrusted_include');
  }
  code = code.replace(includeToken, '');
  if (/\b(?:include|use|import|surface)\b/i.test(code)) issues.push('external_file_access_blocked');
  return [...new Set(issues)];
}

export type OpenScadRunner = (source: string, signal: AbortSignal) => Promise<Buffer>;

async function defaultRunner(source: string, signal: AbortSignal): Promise<Buffer> {
  const workDir = join(tmpdir(), `nexyfab-cf-openscad-${crypto.randomUUID()}`);
  const sourcePath = join(workDir, 'model.scad');
  const outputPath = join(workDir, 'output.stl');
  await mkdir(workDir, { recursive: true });
  try {
    await writeFile(sourcePath, source, 'utf8');
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.env.OPENSCAD_BIN?.trim() || '/usr/bin/openscad',
        [sourcePath, '-o', outputPath, '--export-format=binstl'],
        { cwd: workDir, windowsHide: true, maxBuffer: 4 * 1024 * 1024, signal },
        error => error ? reject(error) : resolve(),
      );
    });
    const bytes = await readFile(outputPath);
    if (bytes.length < 84 || bytes.length > 64 * 1024 * 1024) throw new Error(`openscad_output_size_invalid:${bytes.length}`);
    return bytes;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function createOpenScadExecutor(options: {
  workerIdentitySha256: string; producerBuildId: string; run?: OpenScadRunner;
}): CadComputeExecutor {
  if (!SHA256.test(options.workerIdentitySha256)) throw new Error('worker_identity_invalid');
  const run = options.run ?? defaultRunner;
  return {
    serviceId: 'openscad', workerIdentitySha256: options.workerIdentitySha256,
    kernelIdentitySha256: 'NOT_APPLICABLE', producerBuildId: options.producerBuildId,
    supports: message => message.kind === 'OPENSCAD_RENDER',
    async execute(_message, inputs: ResolvedComputeInput[], signal) {
      if (inputs.length !== 1) throw new Error('openscad_requires_one_scad_input');
      const source = inputs[0]!.bytes.toString('utf8');
      const issues = validateContainerScadSource(source);
      if (issues.length) throw new Error(`openscad_source_rejected:${issues.join(',')}`);
      return [{ filename: 'model.stl', mediaType: 'model/stl', format: 'stl', bytes: await run(source, signal) }];
    },
  };
}
