/// <reference lib="webworker" />
/**
 * Client-side OpenSCAD render worker. Runs the official openscad-wasm build in
 * a Web Worker so SCAD → STL happens entirely in the browser — zero server
 * load, instant preview, and (the real reason) cheap enough to render many
 * times for an iterate-on-your-own-render agent loop.
 *
 * openscad-wasm can only run main() ONCE per instance, so we spin up a FRESH
 * instance per render — the compiled wasm module is cached by the engine, so
 * re-init is ~50ms. BOSL2 is unzipped once and written into each instance's FS
 * under /libraries (OPENSCADPATH) so `include <BOSL2/std.scad>` resolves.
 */
import { unzipSync } from 'fflate';

interface OpenSCADFS {
  mkdir(p: string): void;
  writeFile(p: string, d: Uint8Array | string): void;
  readFile(p: string, o: { encoding: 'binary' }): Uint8Array;
  unlink(p: string): void;
}
interface OpenSCADInstance { callMain(a: string[]): number; FS: OpenSCADFS }
type OpenSCADLoader = (opts: unknown) => Promise<OpenSCADInstance>;

let bosl2: Record<string, Uint8Array> | null = null;
async function getBosl2(): Promise<Record<string, Uint8Array>> {
  if (bosl2) return bosl2;
  const res = await fetch('/openscad/bosl2.zip');
  bosl2 = unzipSync(new Uint8Array(await res.arrayBuffer()));
  return bosl2;
}

let loader: OpenSCADLoader | null = null;
async function getLoader(): Promise<OpenSCADLoader> {
  if (loader) return loader;
  // The 2025.03 build's openscad.js is the full self-contained emscripten glue
  // (default export). Loaded at runtime from /public; webpackIgnore keeps the
  // bundler out. locateFile (set per-instance) points it at openscad.wasm.
  // @ts-expect-error — runtime public asset, no module type
  const mod = (await import(/* webpackIgnore: true */ '/openscad/openscad.js')) as { default: OpenSCADLoader };
  loader = mod.default;
  return loader;
}

async function renderWith(scad: string, args: string[]): Promise<{ ok: boolean; data?: Uint8Array; error?: string }> {
  const OpenSCAD = await getLoader();
  const files = await getBosl2();
  // Fresh instance per render — emscripten runs main() once; the compiled
  // module is cached so re-init is ~100ms.
  const inst = await OpenSCAD({
    noInitialRun: true,
    locateFile: (p: string) => '/openscad/' + p,
    preRun: [(m: { ENV: Record<string, string> }) => { try { m.ENV.OPENSCADPATH = '/libraries'; } catch { /* set on instance */ } }],
  });
  try { inst.FS.mkdir('/libraries'); } catch { /* exists */ }
  try { inst.FS.mkdir('/libraries/BOSL2'); } catch { /* exists */ }
  for (const [p, d] of Object.entries(files)) { try { inst.FS.writeFile('/libraries/' + p, d); } catch { /* skip */ } }
  inst.FS.writeFile('/in.scad', scad);
  let code = -1;
  try { code = inst.callMain(args); }
  catch { return { ok: false, error: 'render failed' }; }
  try {
    const data = inst.FS.readFile('/out.stl', { encoding: 'binary' });
    if (!data || data.length === 0) return { ok: false, error: `empty output (exit ${code})` };
    return { ok: true, data };
  } catch { return { ok: false, error: `no output (exit ${code})` }; }
}

async function render(scad: string): Promise<{ ok: boolean; data?: Uint8Array; error?: string }> {
  // Manifold backend is ~5–25× faster than CGAL. It needs watertight input,
  // so on failure fall back to the (slower, more tolerant) default backend.
  const r = await renderWith(scad, ['/in.scad', '-o', '/out.stl', '--backend=manifold', '--export-format=binstl']);
  if (r.ok) return r;
  return renderWith(scad, ['/in.scad', '-o', '/out.stl', '--export-format=binstl']);
}

self.onmessage = async (e: MessageEvent<{ id: number; scad: string }>) => {
  const { id, scad } = e.data;
  try {
    const r = await render(scad);
    if (r.ok && r.data) (self as unknown as Worker).postMessage({ id, ok: true, data: r.data }, [r.data.buffer]);
    else (self as unknown as Worker).postMessage({ id, ok: false, error: r.error });
  } catch (x) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(x).slice(0, 160) });
  }
};
