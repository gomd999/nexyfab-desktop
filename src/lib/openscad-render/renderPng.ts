/**
 * Render an OpenSCAD source to a PNG snapshot via the OpenSCAD CLI.
 *
 * Used by the agent's `view_render` tool so the multimodal vision model
 * can critique the geometry. The CLI accepts:
 *
 *   openscad in.scad -o out.png \
 *     --imgsize=800,600 \
 *     --camera=cx,cy,cz,rx,ry,rz,d  ← look-at + euler + distance
 *     --colorscheme=Tomorrow
 *
 * We produce up to N camera angles by spawning the CLI N times into the
 * same temp dir. Default N=3 (iso, front, right) covers most assemblies.
 *
 * Memory note: 800×600 PNGs are ~50–200KB each. Three views = ~500KB
 * payload, well within Anthropic / OpenAI vision request limits (10MB).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENSCAD_MAX_SCAD_BYTES } from './constants';

export interface CameraView {
  /** Short label shown to the vision model (e.g. "Isometric"). */
  label: string;
  /** OpenSCAD --camera flag: cx,cy,cz, rx,ry,rz, dist  (target + Euler + distance). */
  camera: string;
}

export const DEFAULT_VIEWS: CameraView[] = [
  // Isometric: standard 3/4 view from upper-front-right.
  { label: 'Isometric',  camera: '0,0,0,55,0,25,140' },
  { label: 'Front',      camera: '0,0,0,90,0,0,140' },
  { label: 'Right side', camera: '0,0,0,90,0,90,140' },
];

export interface PngRenderOk {
  ok: true;
  views: { label: string; bytes: Buffer }[];
}
export interface PngRenderErr {
  ok: false;
  code: 'ENOENT' | 'TIMEOUT' | 'EXIT' | 'TOO_LARGE' | 'MISSING_OUTPUT';
  message: string;
  stderr?: string;
}

function openScadExecutable(): string {
  const fromEnv = process.env.OPENSCAD_BIN?.trim();
  if (fromEnv) return fromEnv;
  return process.platform === 'win32' ? 'openscad.com' : 'openscad';
}

export async function renderScadToPng(opts: {
  scadSource: string;
  views?: CameraView[];
  imgWidth?: number;
  imgHeight?: number;
  timeoutMs?: number;
  colorScheme?: string;
}): Promise<PngRenderOk | PngRenderErr> {
  const views = opts.views ?? DEFAULT_VIEWS;
  const w = opts.imgWidth ?? 800;
  const h = opts.imgHeight ?? 600;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const colorScheme = opts.colorScheme ?? 'Tomorrow';

  if (Buffer.byteLength(opts.scadSource, 'utf8') > OPENSCAD_MAX_SCAD_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: `OpenSCAD source exceeds ${OPENSCAD_MAX_SCAD_BYTES} bytes` };
  }

  const id = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `nf-openscad-png-${id}`);
  const scadPath = join(workDir, 'model.scad');
  const bin = openScadExecutable();

  await mkdir(workDir, { recursive: true });
  await writeFile(scadPath, opts.scadSource, 'utf8');

  try {
    const out: { label: string; bytes: Buffer }[] = [];
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      const outPath = join(workDir, `view_${i}.png`);
      const args = [
        scadPath, '-o', outPath,
        `--imgsize=${w},${h}`,
        `--camera=${v.camera}`,
        `--colorscheme=${colorScheme}`,
      ];
      try {
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
        const bytes = await readFile(outPath);
        if (bytes.length === 0) throw makeErr('MISSING_OUTPUT', `view ${i} produced empty PNG`);
        out.push({ label: v.label, bytes });
      } catch (e) {
        // Bubble first failure — partial render is worse than none.
        if (isPngErr(e)) return e;
        throw e;
      }
    }
    return { ok: true, views: out };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
  }
}

function makeErr(code: PngRenderErr['code'], message: string, stderr?: string | Buffer): PngRenderErr {
  const stderrStr = stderr == null ? undefined : typeof stderr === 'string' ? stderr : stderr.toString();
  return { ok: false, code, message, stderr: stderrStr };
}

function isPngErr(x: unknown): x is PngRenderErr {
  return !!x && typeof x === 'object' && (x as PngRenderErr).ok === false && typeof (x as PngRenderErr).code === 'string';
}
