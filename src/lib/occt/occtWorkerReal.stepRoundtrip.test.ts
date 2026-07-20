/**
 * occtWorkerReal.stepRoundtrip — W3-D acceptance: the BROWSER worker's STEP
 * ops (`occt-worker/occt-worker-real.js`) executed against the REAL OCCT
 * kernel, in Node.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Wave 1 (W1-A) discovered that this opencascade.js build corrupts any path
 * handed to `STEPControl_Writer::Write` / `STEPControl_Reader::ReadFile` once
 * it reaches 11 characters (root cause + probes documented in
 * `wasmReal.placeholder.test.ts` "KNOWN KERNEL DEFECT" and in the worker's
 * STEP_FS_PATH_MAX comment). The production worker used '/tmp/out.step' (13)
 * and 'cadr_in.step' (12) — so browser real-kernel STEP I/O had NEVER worked.
 *
 * W3-D pinned both MEMFS paths under the 10-char limit behind a runtime
 * assert. This suite proves the repair BY EXECUTION: it loads the actual
 * worker source (the same bytes served to the browser, modulo the copy-occt
 * sync which is also asserted here), installs the real Embind module through
 * the worker's introspection seam, and drives the worker's own `exportSTEP` /
 * `importSTEP` handlers end-to-end:
 *
 *   buildFromExtrude → exportSTEP → importSTEP → volume/area match (rel 1e-9)
 *
 * plus the loud-failure guards: parse failure, 0 transfer roots, and a Write
 * that lands nowhere must all produce EXPLICIT errors — never a silent empty
 * shape or stale bytes.
 *
 * The harness (new Function('self', ...) over the worker IIFE + the
 * `__OCCT_REAL_INTROSPECT__` seam) is the same one `wasmRealActivation.test.ts`
 * uses with a mock module; here the module is the real kernel, so success is a
 * measured round-trip, not a simulation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Same band as wasmReal.placeholder.test.ts — measured error is ~1e-16. */
const REL_TOL = 1e-9;

const WORKER_SRC_PATH = path.resolve(__dirname, '../../../occt-worker/occt-worker-real.js');
const WORKER_PUBLIC_PATH = path.resolve(__dirname, '../../../public/occt-worker/occt-worker-real.js');
const WORKER_SOURCE = fs.readFileSync(WORKER_SRC_PATH, 'utf8');

// ─── real kernel loader (identical to wasmReal.placeholder.test.ts) ───────

const GLUE = 'opencascade.js/dist/opencascade.wasm.js';
const WASM_PATH = path.resolve(
  process.cwd(),
  'node_modules/opencascade.js/dist/opencascade.wasm.wasm',
);

type OC = any;

async function loadRealOcct(): Promise<OC> {
  const glue: any = await import(/* @vite-ignore */ GLUE);
  const factory = glue.default ?? glue;
  const wasmBinary = fs.readFileSync(WASM_PATH);
  return factory({ wasmBinary, locateFile: (p: string) => (p.endsWith('.wasm') ? WASM_PATH : p) });
}

const WASM_PRESENT = fs.existsSync(WASM_PATH);

// ─── worker harness (same pattern as wasmRealActivation.test.ts) ──────────

interface OpResult {
  ok: boolean;
  handle?: number;
  kind?: string;
  step?: string;
  error?: string;
  warnings: string[];
}

interface WorkerIntrospect {
  readonly mode: 'pending' | 'ready' | 'failed';
  readonly handles: Map<number, unknown>;
  readonly ops: {
    buildFromExtrude: (feature: unknown) => OpResult;
    exportSTEP: (h: number) => OpResult;
    importSTEP: (s: string) => OpResult;
    alloc: (s: unknown) => number;
    freeHandle: (h: number) => boolean;
    shapeMetrics: (s: unknown) => { volume: number; area: number };
  };
  setOcct: (m: unknown) => void;
}

interface Sandbox {
  self: Sandbox;
  onmessage: ((ev: { data: unknown }) => void) | null;
  postMessage: (msg: unknown) => void;
  importScripts?: (url: string) => void;
  __OCCT_REAL_INTROSPECT__?: WorkerIntrospect;
}

/** Run a fresh worker instance and hand it `module` as its OCCT kernel. */
function spawnWorker(module: unknown): WorkerIntrospect {
  const sandbox = { onmessage: null } as unknown as Sandbox;
  sandbox.self = sandbox;
  sandbox.postMessage = () => { /* mode events not needed here */ };
  sandbox.importScripts = () => { /* no-op: kernel is injected via setOcct */ };
  const runner = new Function('self', 'importScripts', 'Module', WORKER_SOURCE) as (
    s: Sandbox,
    importScripts: ((url: string) => void) | undefined,
    Module: unknown,
  ) => void;
  runner(sandbox, sandbox.importScripts, undefined);
  const introspect = sandbox.__OCCT_REAL_INTROSPECT__;
  if (!introspect) throw new Error('worker did not install __OCCT_REAL_INTROSPECT__');
  introspect.setOcct(module);
  return introspect;
}

// ─── suite ────────────────────────────────────────────────────────────────

describe('occt-worker-real.js STEP ops on the REAL kernel (W3-D)', () => {
  let oc: OC;

  beforeAll(async () => {
    expect(
      WASM_PRESENT,
      `real OCCT binary missing at ${WASM_PATH} — run \`npm ci\`. Refusing to pass vacuously.`,
    ).toBe(true);
    oc = await loadRealOcct();
  }, 120_000);

  it('round-trip: extrude → exportSTEP → importSTEP preserves volume and area', () => {
    const w = spawnWorker(oc);

    // 10×10 square extruded 10 → 1000 volume, 600 area.
    const built = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      depth: 10,
    });
    expect(built.ok, `buildFromExtrude failed: ${built.error}`).toBe(true);

    const exported = w.ops.exportSTEP(built.handle as number);
    expect(exported.ok, `exportSTEP failed: ${exported.error}`).toBe(true);
    const step = exported.step as string;
    expect(step.length).toBeGreaterThan(0);
    expect(step).toContain('ISO-10303-21');
    expect(step).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');

    const imported = w.ops.importSTEP(step);
    expect(imported.ok, `importSTEP failed: ${imported.error}`).toBe(true);
    const back = w.handles.get(imported.handle as number);
    expect(back).toBeDefined();

    const m = w.ops.shapeMetrics(back) as { volume: number; area: number };
    const relV = Math.abs((m.volume - 1000) / 1000);
    const relA = Math.abs((m.area - 600) / 600);
    expect(relV, `round-trip volume ${m.volume} vs 1000, rel ${relV.toExponential(3)}`).toBeLessThan(REL_TOL);
    expect(relA, `round-trip area ${m.area} vs 600, rel ${relA.toExponential(3)}`).toBeLessThan(REL_TOL);
  }, 60_000);

  it('importSTEP: unparseable source fails LOUDLY (no silent empty shape)', () => {
    const w = spawnWorker(oc);
    const res = w.ops.importSTEP('this is not a STEP file');
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.handle).toBeUndefined();
  });

  it('importSTEP: 0 transfer roots fails LOUDLY even when ReadFile reports success', () => {
    // Wrap the real module: the reader parses fine but transfers nothing —
    // the silent-failure mode of the corrupted-path defect. The guard must
    // convert it into an explicit error.
    const wrapped = Object.create(oc);
    wrapped.STEPControl_Reader_1 = function ZeroRootReader(this: unknown) {
      const real = new oc.STEPControl_Reader_1();
      return {
        ReadFile: (p: string) => real.ReadFile(p),
        TransferRoots: () => 0,
        OneShape: () => real.OneShape(),
        delete: () => real.delete(),
      };
    };
    const w = spawnWorker(wrapped);

    // A known-good STEP produced by the real kernel through the worker.
    const wReal = spawnWorker(oc);
    const built = wReal.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }],
      depth: 5,
    });
    const exported = wReal.ops.exportSTEP(built.handle as number);
    expect(exported.ok, `exportSTEP failed: ${exported.error}`).toBe(true);

    const res = w.ops.importSTEP(exported.step as string);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no transferable B-rep roots');
    expect(res.error).toContain('refusing to return an empty shape');
    expect(res.handle).toBeUndefined();
  }, 60_000);

  it('exportSTEP: a Write that lands nowhere fails LOUDLY (no stale/empty result)', () => {
    // Wrap the real module: Write is a no-op, simulating the corrupted-path
    // mode where the bytes land in a garbage MEMFS entry without throwing.
    const wrapped = Object.create(oc);
    wrapped.STEPControl_Writer_1 = function NowhereWriter(this: unknown) {
      return {
        Transfer: () => 0,
        Write: () => 0, // "succeeds", writes nothing at the requested path
        delete: () => { /* nothing to free */ },
      };
    };
    const w = spawnWorker(wrapped);
    const box = new oc.BRepPrimAPI_MakeBox_1(10, 10, 10).Shape();
    const h = w.ops.alloc(box);
    const res = w.ops.exportSTEP(h);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('STEP output missing');
    expect(res.step).toBeUndefined();
  });

  // ─── source hygiene: the 10-char constraint cannot silently regress ─────

  it('worker source pins both STEP MEMFS paths to <= 10 chars behind the assert', () => {
    const exportMatch = WORKER_SOURCE.match(/var STEP_EXPORT_PATH = '([^']+)'/);
    const importMatch = WORKER_SOURCE.match(/var STEP_IMPORT_PATH = '([^']+)'/);
    expect(exportMatch, 'STEP_EXPORT_PATH declaration missing').toBeTruthy();
    expect(importMatch, 'STEP_IMPORT_PATH declaration missing').toBeTruthy();
    const exportPath = (exportMatch as RegExpMatchArray)[1];
    const importPath = (importMatch as RegExpMatchArray)[1];

    // The kernel defect boundary (see wasmReal.placeholder.test.ts).
    expect(exportPath.length, `export path '${exportPath}' over the 10-char kernel limit`).toBeLessThanOrEqual(10);
    expect(importPath.length, `import path '${importPath}' over the 10-char kernel limit`).toBeLessThanOrEqual(10);
    // Reader needs a BARE relative name; writer path must not sit in a subdir
    // (a missing directory makes the write fail silently).
    expect(importPath.startsWith('/'), 'import path must stay relative').toBe(false);
    expect(exportPath.lastIndexOf('/'), 'export path must be root-level or relative').toBeLessThanOrEqual(0);

    // Both ops must go through the guarded constants, not fresh literals.
    expect(WORKER_SOURCE).toContain('var path = STEP_EXPORT_PATH;');
    expect(WORKER_SOURCE).toContain('var path = STEP_IMPORT_PATH;');
    expect(WORKER_SOURCE).toContain('assertStepPathMarshalSafe(path);');
  });

  it('served copy (public/occt-worker) is byte-identical to the source of truth', () => {
    // scripts/copy-occt.js syncs occt-worker/ → public/occt-worker/ at build
    // time; a drifted public copy would ship the OLD broken paths.
    const served = fs.readFileSync(WORKER_PUBLIC_PATH, 'utf8');
    expect(served, 'run `npm run occt:copy` — public/occt-worker/occt-worker-real.js drifted').toBe(WORKER_SOURCE);
  });
});
