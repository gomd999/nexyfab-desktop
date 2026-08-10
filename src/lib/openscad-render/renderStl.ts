/**
 * renderStl — Phase 2.A.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Sibling to renderScadToPng: spawns the openscad CLI to produce an STL
 * mesh from SCAD source. The STL bytes are sent to the client for an
 * interactive Three.js viewer (StlViewer) instead of static PNGs.
 *
 * CLI call: `openscad model.scad -o model.stl --export-format=binstl`
 *
 * binstl (binary STL) is ~10× smaller than ASCII STL for the same mesh,
 * faster to parse client-side, and well-supported by Three.js's STLLoader.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENSCAD_MAX_SCAD_BYTES } from './constants';
import { resolveOpenScadExecutable } from './resolveOpenScadExecutable';
import { executeOpenScad } from './executeOpenScad';

export interface StlRenderOk {
  ok: true;
  /** Binary STL bytes. ~50–500KB typical for sketch+extrude output. */
  bytes: Buffer;
}

export interface StlRenderErr {
  ok: false;
  code: 'ENOENT' | 'TIMEOUT' | 'EXIT' | 'TOO_LARGE' | 'MISSING_OUTPUT';
  message: string;
  stderr?: string;
}

export async function renderScadToStl(opts: {
  scadSource: string;
  timeoutMs?: number;
}): Promise<StlRenderOk | StlRenderErr> {
  const timeoutMs = opts.timeoutMs ?? 30_000;

  if (Buffer.byteLength(opts.scadSource, 'utf8') > OPENSCAD_MAX_SCAD_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: `OpenSCAD source exceeds ${OPENSCAD_MAX_SCAD_BYTES} bytes` };
  }

  if (process.env.OPENSCAD_EXTERNAL_WORKER === '1') {
    const result = await executeOpenScad({
      scadSource: opts.scadSource,
      format: 'stl',
      timeoutMs,
      renderArgs: ['--export-format=binstl'],
    });
    return result.ok
      ? { ok: true, bytes: result.buffer }
      : { ok: false, code: result.code, message: result.message, ...(result.stderr ? { stderr: result.stderr } : {}) };
  }

  const id = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `nf-openscad-stl-${id}`);
  const scadPath = join(workDir, 'model.scad');
  const stlPath = join(workDir, 'model.stl');
  const bin = resolveOpenScadExecutable();

  await mkdir(workDir, { recursive: true });
  await writeFile(scadPath, opts.scadSource, 'utf8');

  try {
    const args = [scadPath, '-o', stlPath, '--export-format=binstl'];
    await new Promise<void>((resolve, reject) => {
      execFile(bin, args, {
        cwd: workDir, timeout: timeoutMs, windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: process.env,
      }, (err, _stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          if (e.code === 'ENOENT') return reject(makeErr('ENOENT', `openscad CLI not found (${bin})`, stderr));
          if (e.killed && e.signal) return reject(makeErr('TIMEOUT', `openscad timed out after ${timeoutMs}ms`, stderr));
          return reject(makeErr('EXIT', `openscad exited: ${e.message}`, stderr));
        }
        resolve();
      });
    });
    const bytes = await readFile(stlPath);
    if (bytes.length === 0) {
      return { ok: false, code: 'MISSING_OUTPUT', message: 'STL output was empty' };
    }
    return { ok: true, bytes };
  } catch (e) {
    if (isStlErr(e)) return e;
    return { ok: false, code: 'EXIT', message: e instanceof Error ? e.message : String(e) };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function makeErr(code: StlRenderErr['code'], message: string, stderr: string | undefined): StlRenderErr {
  return { ok: false, code, message, stderr: stderr || undefined };
}

function isStlErr(e: unknown): e is StlRenderErr {
  return typeof e === 'object' && e !== null && (e as { ok?: unknown }).ok === false;
}
