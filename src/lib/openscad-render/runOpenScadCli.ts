import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENSCAD_DEFAULT_TIMEOUT_MS, OPENSCAD_MAX_SCAD_BYTES } from './constants';

export type OpenScadMeshFormat = 'stl' | 'off';

function openScadExecutable(): string {
  const fromEnv = process.env.OPENSCAD_BIN?.trim();
  if (fromEnv) return fromEnv;
  return process.platform === 'win32' ? 'openscad.com' : 'openscad';
}

/**
 * Runs OpenSCAD CLI in an isolated temp directory.
 * Set `OPENSCAD_USE_DOCKER=1` to run inside `docker run --network none` (image: `OPENSCAD_DOCKER_IMAGE` or openscad/openscad:latest).
 * Otherwise uses host `OPENSCAD_BIN` / default `openscad` / Windows `openscad.com`.
 */
export async function runOpenScadCli(opts: {
  scadSource: string;
  format: OpenScadMeshFormat;
  timeoutMs?: number;
}): Promise<
  | { ok: true; buffer: Buffer; stderr: string }
  | { ok: false; code: 'ENOENT' | 'TIMEOUT' | 'EXIT' | 'TOO_LARGE' | 'MISSING_OUTPUT'; message: string; stderr?: string }
> {
  const timeoutMs = opts.timeoutMs ?? OPENSCAD_DEFAULT_TIMEOUT_MS;
  const bytes = Buffer.byteLength(opts.scadSource, 'utf8');
  if (bytes > OPENSCAD_MAX_SCAD_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: `OpenSCAD source exceeds ${OPENSCAD_MAX_SCAD_BYTES} bytes` };
  }

  const id = randomBytes(12).toString('hex');
  const workDir = join(tmpdir(), `nf-openscad-${id}`);
  const scadPath = join(workDir, 'model.scad');
  const ext = opts.format === 'stl' ? 'stl' : 'off';
  const outPath = join(workDir, `out.${ext}`);
  const bin = openScadExecutable();

  await mkdir(workDir, { recursive: true });
  await writeFile(scadPath, opts.scadSource, 'utf8');

  const useDocker =
    process.env.OPENSCAD_USE_DOCKER === '1' || process.env.OPENSCAD_USE_DOCKER === 'true';
  const dockerImage =
    process.env.OPENSCAD_DOCKER_IMAGE?.trim() || 'openscad/openscad:latest';

  try {
    const { stderr } = useDocker
      ? await execFile(
          'docker',
          [
            'run',
            '--rm',
            '--network',
            'none',
            '-v',
            `${workDir}:/work`,
            '-w',
            '/work',
            dockerImage,
            'openscad',
            '/work/model.scad',
            '-o',
            `/work/out.${ext}`,
          ],
          {
            cwd: workDir,
            timeout: timeoutMs + 15_000,
            windowsHide: true,
            maxBuffer: 64 * 1024 * 1024,
            env: process.env,
          },
        )
      : await execFile(bin, [scadPath, '-o', outPath], {
          cwd: workDir,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 64 * 1024 * 1024,
          env: process.env,
        });
    const errStr = stderr == null ? '' : typeof stderr === 'string' ? stderr : stderr.toString();
    let buffer: Buffer;
    try {
      buffer = await readFile(outPath);
    } catch {
      return {
        ok: false,
        code: 'MISSING_OUTPUT',
        message: 'OpenSCAD finished but output file was not created',
        stderr: errStr.trim() || undefined,
      };
    }
    return { ok: true, buffer, stderr: errStr.trim() };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & {
      stderr?: string | Buffer;
      code?: string;
      status?: number;
      killed?: boolean;
    };
    if (err.code === 'ENOENT') {
      return {
        ok: false,
        code: 'ENOENT',
        message: useDocker
          ? 'Docker not found on PATH. Install Docker or unset OPENSCAD_USE_DOCKER.'
          : 'OpenSCAD executable not found. Set OPENSCAD_BIN to the openscad binary (e.g. C:\\Program Files\\OpenSCAD\\openscad.com), or set OPENSCAD_USE_DOCKER=1.',
      };
    }
    if (err.code === 'ETIMEDOUT' || err.killed === true) {
      const se = err.stderr == null ? undefined : typeof err.stderr === 'string' ? err.stderr : err.stderr.toString();
      return { ok: false, code: 'TIMEOUT', message: `OpenSCAD exceeded ${timeoutMs}ms`, stderr: se };
    }
    const se = err.stderr == null ? undefined : typeof err.stderr === 'string' ? err.stderr : err.stderr.toString();
    return {
      ok: false,
      code: 'EXIT',
      message: err.message || 'OpenSCAD process failed',
      stderr: se,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
