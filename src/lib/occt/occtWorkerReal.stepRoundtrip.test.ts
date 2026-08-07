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
import { createWasmBridge } from './wasmBridge';
import type { WorkerLike } from './wasmWorkerStub';
import { executeOcctPlan } from './planExecutor';
import type { OcctPlan } from './featurePlan';
import type { HoleFeature } from '@/lib/cad/holeProfile';

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
  readonly nextHandle: number;
  readonly edgeTopos: Map<number, Map<string, unknown>>;
  readonly faceTopos: Map<number, Array<{ name: string; face: unknown }>>;
  readonly ops: {
    buildFromExtrude: (feature: unknown) => OpResult;
    buildFromRevolve: (feature: unknown) => OpResult;
    buildPrismAt: (loop: Array<{ x: number; y: number }>, z0: number, heightMm: number) => OpResult;
    buildConeAt: (
      center: { x: number; y: number }, z0: number, heightMm: number, radius0: number, radius1: number,
    ) => OpResult;
    buildThreadHelixCutter: (opts: {
      center: { x: number; y: number }; z0: number; innerRadius: number; outerRadius: number;
      pitch: number; lengthMm: number; direction?: 'right_hand' | 'left_hand';
      threadKind?: 'external' | 'internal';
    }) => OpResult;
    booleanOp: (op: string, a: number, b: number) => OpResult;
    filletOrChamfer: (
      op: string, h: number, edgeIds: string[], dim: number, perEdgeDims?: number[],
    ) => OpResult;
    variableFilletWithRecovery: (
      h: number, edges: Array<{ edgeId: string; radius: number }>,
    ) => OpResult;
    lawFilletWithRecovery: (
      h: number, edges: Array<{ edgeId: string; startRadius: number; endRadius: number }>,
      options?: { continuity: 'G1' | 'G2'; angularTolerance?: number },
    ) => OpResult;
    exportSTEP: (h: number) => OpResult;
    importSTEP: (s: string) => OpResult;
    alloc: (s: unknown) => number;
    freeHandle: (h: number) => boolean;
    shapeMetrics: (s: unknown) => {
      volume: number;
      area: number;
      bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
    };
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

function spawnRealWorkerLike(module: unknown): WorkerLike {
  const listeners = new Set<(ev: { data: unknown }) => void>();
  const sandbox = { onmessage: null } as unknown as Sandbox;
  sandbox.self = sandbox;
  sandbox.postMessage = (message: unknown) => {
    queueMicrotask(() => listeners.forEach((listener) => listener({ data: message })));
  };
  sandbox.importScripts = () => { /* kernel injected below */ };
  const runner = new Function('self', 'importScripts', 'Module', WORKER_SOURCE) as (
    s: Sandbox, importScripts: ((url: string) => void) | undefined, Module: unknown,
  ) => void;
  runner(sandbox, sandbox.importScripts, undefined);
  const introspect = sandbox.__OCCT_REAL_INTROSPECT__;
  if (!introspect) throw new Error('worker did not install __OCCT_REAL_INTROSPECT__');
  introspect.setOcct(module);
  return {
    postMessage(message: unknown): void {
      const request = message as { reqId: number; op: string };
      if (request.op === 'init') {
        sandbox.postMessage({ reqId: request.reqId, ok: true, warnings: [] });
        return;
      }
      sandbox.onmessage?.({ data: message });
    },
    addEventListener(event, listener): void { if (event === 'message') listeners.add(listener); },
    removeEventListener(event, listener): void { if (event === 'message') listeners.delete(listener); },
    terminate(): void { listeners.clear(); },
  };
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

  it('rounds one persistent extrude edge without widening to every edge', () => {
    const w = spawnWorker(oc);
    const built = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      depth: 10,
    });
    const rounded = w.ops.filletOrChamfer('fillet', built.handle as number, ['e.vert.0'], 1);
    expect(rounded.ok, rounded.error).toBe(true);
    const metrics = w.ops.shapeMetrics(w.handles.get(rounded.handle as number));
    expect(metrics.volume).toBeGreaterThan(990);
    expect(metrics.volume).toBeLessThan(1000);
  }, 60_000);

  it('builds positioned blind-hole and countersink tools with exact Z extents', () => {
    const w = spawnWorker(oc);
    const circle = Array.from({ length: 64 }, (_, index) => {
      const angle = 2 * Math.PI * index / 64;
      return { x: 5 + 3 * Math.cos(angle), y: 7 + 3 * Math.sin(angle) };
    });
    const prism = w.ops.buildPrismAt(circle, 12, 8);
    expect(prism.ok, prism.error).toBe(true);
    expect(prism.warnings).toContain('analytic circular prism promoted to OCCT cylinder');
    const prismShape = w.handles.get(prism.handle as number);
    const prismMetrics = w.ops.shapeMetrics(prismShape);
    expect(prismMetrics.bbox.min.z).toBeCloseTo(12, 5);
    expect(prismMetrics.bbox.max.z).toBeCloseTo(20, 5);
    expect(prismMetrics.volume).toBeCloseTo(Math.PI * 3 * 3 * 8, 6);

    const nonCircular = circle.map((point, index) => index === 0 ? { x: point.x + 0.01, y: point.y } : point);
    const fallbackPrism = w.ops.buildPrismAt(nonCircular, 12, 8);
    expect(fallbackPrism.ok, fallbackPrism.error).toBe(true);
    expect(fallbackPrism.warnings).not.toContain('analytic circular prism promoted to OCCT cylinder');

    const cone = w.ops.buildConeAt({ x: 5, y: 7 }, 16, 4, 3, 6);
    expect(cone.ok, cone.error).toBe(true);
    const coneMetrics = w.ops.shapeMetrics(w.handles.get(cone.handle as number));
    expect(coneMetrics.bbox.min.z).toBeCloseTo(16, 5);
    expect(coneMetrics.bbox.max.z).toBeCloseTo(20, 5);
    expect(coneMetrics.volume).toBeCloseTo(Math.PI * 4 * (3 * 3 + 3 * 6 + 6 * 6) / 3, 6);
  }, 60_000);

  it('executes browser feature plans for through, blind, counterbore, and countersink holes then exports STEP', async () => {
    const circleArea = (radius: number): number => Math.PI * radius * radius;
    const cases: Array<{ name: string; feature: HoleFeature; expectedVolume: number }> = [
      {
        name: 'through',
        feature: { kind: 'hole', center: { x: 20, y: 20 }, holeType: 'drilled', diameter: 6, depth: 5, terminationMode: 'through' },
        expectedVolume: 32000 - circleArea(3) * 20,
      },
      {
        name: 'blind',
        feature: { kind: 'hole', center: { x: 20, y: 20 }, holeType: 'drilled', diameter: 6, depth: 8, terminationMode: 'blind' },
        expectedVolume: 32000 - (
          circleArea(3) * (8 - 3 / Math.tan(59 * Math.PI / 180)) +
          Math.PI * 3 * 3 * (3 / Math.tan(59 * Math.PI / 180)) / 3
        ),
      },
      {
        name: 'counterbore',
        feature: {
          kind: 'hole', center: { x: 20, y: 20 }, holeType: 'counterbore', diameter: 6, depth: 20,
          counterboreDiameter: 10, counterboreDepth: 4,
        },
        expectedVolume: 32000 - (circleArea(3) * 20 + (circleArea(5) - circleArea(3)) * 4.01),
      },
      {
        name: 'countersink',
        feature: {
          kind: 'hole', center: { x: 20, y: 20 }, holeType: 'countersink', diameter: 6, depth: 20,
          countersinkAngleDegrees: 90, countersinkDepth: 3,
        },
        expectedVolume: 32000 - (circleArea(3) * 17 + Math.PI * 3 * (3 * 3 + 3 * 6 + 6 * 6) / 3),
      },
    ];

    for (const testCase of cases) {
      const bridge = createWasmBridge({ workerFactory: () => spawnRealWorkerLike(oc) });
      const plan: OcctPlan = {
        commands: [
          {
            op: 'extrude', resultId: 'base',
            feature: {
              kind: 'extrude',
              loop: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }],
              depth: 20, direction: 'one_sided', mode: 'add',
            },
          },
          { op: 'hole', resultId: testCase.name, target: 'base', feature: testCase.feature },
        ],
        finalResultId: testCase.name,
        unsupported: [],
        embeddedChildNodes: [],
      };
      const executed = await executeOcctPlan(plan, bridge);
      expect(executed.ok, `${testCase.name}: ${executed.error}`).toBe(true);
      if (testCase.name === 'blind') expect(executed.warnings).toContain('blind drill tip: 118 degrees');
      expect(executed.finalShape?.volume, testCase.name).toBeCloseTo(testCase.expectedVolume, 0);
      const step = await bridge.exportSTEP(executed.finalShape!);
      expect(step).toContain('ISO-10303-21');
      expect(step).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
      bridge.release(executed.finalShape!);
      bridge.dispose();
    }
  }, 120_000);

  it('cuts and exports an exact BREP thread through the browser Worker bridge', async () => {
    const bridge = createWasmBridge({ workerFactory: () => spawnRealWorkerLike(oc) });
    expect(bridge.buildThreadHelixCutter).toBeTypeOf('function');
    const circle = Array.from({ length: 48 }, (_, i) => {
      const angle = 2 * Math.PI * i / 48;
      return { x: 4 * Math.cos(angle), y: 4 * Math.sin(angle) };
    });
    const rod = await bridge.buildPrismAt!(circle, 0, 3);
    const cutter = await bridge.buildThreadHelixCutter!({
      center: { x: 0, y: 0 }, z0: 0.5, innerRadius: 3.3, outerRadius: 4.3,
      pitch: 1.25, lengthMm: 1.25, direction: 'left_hand',
    });
    expect(cutter.ok, cutter.error).toBe(true);
    expect(cutter.warnings).toContain('exact OCCT cylindrical helix sweep');
    const threaded = await bridge.boolean.subtract(rod.shape!, cutter.shape!);
    expect(threaded.ok, threaded.error).toBe(true);
    expect(threaded.shape!.volume).toBeLessThan(rod.shape!.volume!);
    const step = await bridge.exportSTEP(threaded.shape!);
    expect(step).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    bridge.release(rod.shape!);
    bridge.release(cutter.shape!);
    bridge.release(threaded.shape!);
    bridge.dispose();
  }, 60_000);

  it('builds a valid inside-out BREP cutter for an internal thread', () => {
    const w = spawnWorker(oc);
    const cutter = w.ops.buildThreadHelixCutter({
      center: { x: 0, y: 0 }, z0: 0.5, innerRadius: 3.39, outerRadius: 4,
      pitch: 1.25, lengthMm: 1.25, direction: 'right_hand', threadKind: 'internal',
    });
    expect(cutter.ok, cutter.error).toBe(true);
    const metrics = w.ops.shapeMetrics(w.handles.get(cutter.handle as number));
    expect(metrics.volume).toBeGreaterThan(0);
    expect(metrics.bbox.max.x).toBeGreaterThan(3.9);
  }, 60_000);

  it('keeps untouched edge names for a fillet-to-chamfer chain', () => {
    const w = spawnWorker(oc);
    const built = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }],
      depth: 6,
    });
    const fillet = w.ops.filletOrChamfer('fillet', built.handle as number, ['e.vert.0', 'e.vert.1'], 1);
    expect(fillet.ok, fillet.error).toBe(true);
    const chamfer = w.ops.filletOrChamfer('chamfer', fillet.handle as number, ['e.vert.2', 'e.vert.3'], 1);
    expect(chamfer.ok, chamfer.error).toBe(true);
    expect(w.ops.shapeMetrics(w.handles.get(chamfer.handle as number)).volume).toBeGreaterThan(0);
  }, 60_000);

  it('keeps distinct provenance for merged and split multi-edge contours', () => {
    const w = spawnWorker(oc);
    const box = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 16 }, { x: 0, y: 16 }], depth: 10,
    });
    const verticals = ['e.vert.0', 'e.vert.1', 'e.vert.2', 'e.vert.3'];
    const fillet = w.ops.filletOrChamfer('fillet', box.handle as number, verticals, 1);
    expect(fillet.ok, fillet.error).toBe(true);
    const filletFaces = w.faceTopos.get(fillet.handle as number)?.map((entry) => entry.name) ?? [];
    for (const edge of verticals) expect(filletFaces).toContain(`fillet/face(${edge})`);

    const chamfer = w.ops.filletOrChamfer('chamfer', box.handle as number, verticals, 0.8);
    expect(chamfer.ok, chamfer.error).toBe(true);
    const chamferFaces = w.faceTopos.get(chamfer.handle as number)?.map((entry) => entry.name) ?? [];
    for (const edge of verticals) {
      expect(chamferFaces.some((name) => name.startsWith(`chamfer/face(${edge})`))).toBe(true);
    }

    const variable = w.ops.filletOrChamfer('fillet', box.handle as number, verticals, NaN, [0.5, 0.75, 1, 1.25]);
    expect(variable.ok, variable.error).toBe(true);
    const variableFaces = w.faceTopos.get(variable.handle as number)?.map((entry) => entry.name) ?? [];
    for (const edge of verticals) expect(variableFaces).toContain(`fillet/face(${edge})`);
    expect(w.ops.shapeMetrics(w.handles.get(variable.handle as number)).volume).toBeGreaterThan(0);

    const nextHandleBeforeRecovery = w.nextHandle;
    const recovered = w.ops.variableFilletWithRecovery(box.handle as number, [
      { edgeId: 'e.vert.0', radius: 12 },
      { edgeId: 'e.vert.1', radius: 9 },
      { edgeId: 'e.vert.2', radius: 6 },
      { edgeId: 'e.vert.3', radius: 3 },
    ]);
    expect(recovered.ok, recovered.error).toBe(true);
    expect(recovered.warnings.join(' ')).toMatch(/uniformly scaling all radii/);
    expect(recovered.warnings.join(' ')).toMatch(/requested ratios preserved/);
    expect(w.nextHandle).toBe(nextHandleBeforeRecovery + 1);

    const unknown = w.ops.variableFilletWithRecovery(box.handle as number, [
      { edgeId: 'e.missing', radius: 2 },
    ]);
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain('unknown selected edge');
    expect(unknown.error).not.toContain('0.75x');
  }, 60_000);

  it('applies a continuous linear start-to-end radius law on one edge', () => {
    const w = spawnWorker(oc);
    const box = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 16 }, { x: 0, y: 16 }], depth: 12,
    });
    const constantSmall = w.ops.filletOrChamfer('fillet', box.handle as number, ['e.vert.0'], 1);
    const constantLarge = w.ops.filletOrChamfer('fillet', box.handle as number, ['e.vert.0'], 3);
    const law = w.ops.lawFilletWithRecovery(box.handle as number, [
      { edgeId: 'e.vert.0', startRadius: 1, endRadius: 3 },
    ]);
    expect(constantSmall.ok, constantSmall.error).toBe(true);
    expect(constantLarge.ok, constantLarge.error).toBe(true);
    expect(law.ok, law.error).toBe(true);
    expect(law.warnings.join(' ')).toContain('linear start-to-end radius law applied');
    const smallVolume = w.ops.shapeMetrics(w.handles.get(constantSmall.handle as number)).volume;
    const largeVolume = w.ops.shapeMetrics(w.handles.get(constantLarge.handle as number)).volume;
    const lawVolume = w.ops.shapeMetrics(w.handles.get(law.handle as number)).volume;
    expect(lawVolume).toBeLessThan(smallVolume);
    expect(lawVolume).toBeGreaterThan(largeVolume);
    expect(w.faceTopos.get(law.handle as number)?.map((entry) => entry.name))
      .toContain('fillet/face(e.vert.0)');

    const g2 = w.ops.lawFilletWithRecovery(box.handle as number, [
      { edgeId: 'e.vert.1', startRadius: 0.75, endRadius: 2.25 },
    ], { continuity: 'G2', angularTolerance: 1e-4 });
    expect(g2.ok, g2.error).toBe(true);
    expect(g2.warnings.join(' ')).toContain('G2 continuity');

    const invalidTolerance = w.ops.lawFilletWithRecovery(box.handle as number, [
      { edgeId: 'e.vert.1', startRadius: 0.75, endRadius: 2.25 },
    ], { continuity: 'G2', angularTolerance: 0 });
    expect(invalidTolerance.ok).toBe(false);
    expect(invalidTolerance.error).toContain('continuity settings');
  }, 60_000);

  it('names generated round boundaries for Boolean-to-fillet-to-chamfer chains', () => {
    const w = spawnWorker(oc);
    const base = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], depth: 8,
    });
    const hole = w.ops.buildFromExtrude({
      loop: [{ x: 7, y: 7 }, { x: 13, y: 7 }, { x: 13, y: 13 }, { x: 7, y: 13 }], depth: 12,
    });
    const cut = w.ops.booleanOp('booleanSubtract', base.handle as number, hole.handle as number);
    const seamNames = [...(w.edgeTopos.get(cut.handle as number)?.keys() ?? [])];
    const seam = seamNames.find((name) => name === 'cut/seam(a/f.cap.top&b/f.side.0)');
    expect(seam).toBeDefined();
    const fillet = w.ops.filletOrChamfer('fillet', cut.handle as number, [seam as string], 0.6);
    expect(fillet.ok, fillet.error).toBe(true);
    expect(w.faceTopos.get(fillet.handle as number)?.map((entry) => entry.name))
      .toContain(`fillet/face(${seam})`);
    const generatedNames = [...(w.edgeTopos.get(fillet.handle as number)?.keys() ?? [])];
    const generatedEdges = generatedNames.filter((name) =>
      name.startsWith('fillet/edge(') && name.includes(`fillet/face(${seam})`),
    );
    expect(generatedEdges.length, `generated fillet boundary missing; names=${generatedNames.join(',')}`)
      .toBeGreaterThan(0);
    const attempts = generatedEdges.map((edge) => ({
      edge,
      result: w.ops.filletOrChamfer('chamfer', fillet.handle as number, [edge], 0.02),
    }));
    const successful = attempts.find((attempt) => attempt.result.ok);
    expect(
      successful,
      `all generated boundaries rejected by OCCT: ${attempts.map((a) => `${a.edge}: ${a.result.error}`).join('; ')}`,
    ).toBeDefined();
    const chamfer = successful!.result;
    expect(w.ops.shapeMetrics(w.handles.get(chamfer.handle as number)).volume).toBeGreaterThan(0);
    const persistentRoundFace = `fillet/face(${seam})`;
    const chamferFaces = w.faceTopos.get(chamfer.handle as number)?.map((entry) => entry.name) ?? [];
    expect(chamferFaces).toContain(persistentRoundFace);
    const generatedChamferFace = chamferFaces.find((name) =>
      name.startsWith(`chamfer/face(${successful!.edge})/contour.`),
    );
    expect(generatedChamferFace, `kernel contour face missing; names=${chamferFaces.join(',')}`).toBeDefined();
    const resizedChamfer = w.ops.filletOrChamfer(
      'chamfer', fillet.handle as number, [successful!.edge], 0.01,
    );
    expect(resizedChamfer.ok, resizedChamfer.error).toBe(true);
    expect(w.faceTopos.get(resizedChamfer.handle as number)?.map((entry) => entry.name))
      .toContain(generatedChamferFace);
    const secondTool = w.ops.buildFromExtrude({
      loop: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }], depth: 12,
    });
    const secondCut = w.ops.booleanOp(
      'booleanSubtract', chamfer.handle as number, secondTool.handle as number,
    );
    expect(secondCut.ok, secondCut.error).toBe(true);
    const finalFaces = w.faceTopos.get(secondCut.handle as number)?.map((entry) => entry.name) ?? [];
    expect(finalFaces).toContain(`a/${persistentRoundFace}`);
    expect(finalFaces).toContain(`a/${generatedChamferFace}`);
  }, 60_000);

  it('inherits surviving Boolean operand edges under a/ and b/ namespaces', () => {
    const w = spawnWorker(oc);
    const base = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], depth: 6,
    });
    const tool = w.ops.buildFromExtrude({
      loop: [{ x: 7, y: 7 }, { x: 13, y: 7 }, { x: 13, y: 13 }, { x: 7, y: 13 }], depth: 8,
    });
    const cut = w.ops.booleanOp('booleanSubtract', base.handle as number, tool.handle as number);
    expect(cut.ok, cut.error).toBe(true);
    const fillet = w.ops.filletOrChamfer('fillet', cut.handle as number, ['a/e.vert.0'], 1);
    expect(fillet.ok, fillet.error).toBe(true);
  }, 60_000);

  it('names a Boolean seam from OCCT face history and rounds that exact seam', () => {
    const w = spawnWorker(oc);
    const base = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], depth: 6,
    });
    const tool = w.ops.buildFromExtrude({
      loop: [{ x: 7, y: 7 }, { x: 13, y: 7 }, { x: 13, y: 13 }, { x: 7, y: 13 }], depth: 8,
    });
    const cut = w.ops.booleanOp('booleanSubtract', base.handle as number, tool.handle as number);
    expect(cut.ok, cut.error).toBe(true);
    const names = [...(w.edgeTopos.get(cut.handle as number)?.keys() ?? [])];
    const seam = names.find((name) => name === 'cut/seam(a/f.cap.top&b/f.side.0)');
    expect(seam, `kernel-history seam missing; names=${names.join(',')}`).toBeDefined();
    const rounded = w.ops.filletOrChamfer('fillet', cut.handle as number, [seam as string], 0.5);
    expect(rounded.ok, rounded.error).toBe(true);
    expect(w.ops.shapeMetrics(w.handles.get(rounded.handle as number)).volume).toBeGreaterThan(0);

    const resizedBase = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 22 }, { x: 0, y: 22 }], depth: 7,
    });
    const resizedTool = w.ops.buildFromExtrude({
      loop: [{ x: 8, y: 8 }, { x: 15, y: 8 }, { x: 15, y: 15 }, { x: 8, y: 15 }], depth: 10,
    });
    const resizedCut = w.ops.booleanOp(
      'booleanSubtract', resizedBase.handle as number, resizedTool.handle as number,
    );
    expect(resizedCut.ok, resizedCut.error).toBe(true);
    const resizedNames = [...(w.edgeTopos.get(resizedCut.handle as number)?.keys() ?? [])];
    expect(resizedNames).toContain(seam);
  }, 60_000);

  it('propagates named faces through Boolean-to-Boolean-to-fillet chains', () => {
    const w = spawnWorker(oc);
    const base = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 24 }, { x: 0, y: 24 }], depth: 8,
    });
    const firstTool = w.ops.buildFromExtrude({
      loop: [{ x: 5, y: 5 }, { x: 11, y: 5 }, { x: 11, y: 11 }, { x: 5, y: 11 }], depth: 12,
    });
    const firstCut = w.ops.booleanOp('booleanSubtract', base.handle as number, firstTool.handle as number);
    expect(firstCut.ok, firstCut.error).toBe(true);
    expect(w.faceTopos.get(firstCut.handle as number)?.map((entry) => entry.name))
      .toContain('a/f.cap.top');

    const secondTool = w.ops.buildFromExtrude({
      loop: [{ x: 18, y: 7 }, { x: 25, y: 7 }, { x: 25, y: 15 }, { x: 18, y: 15 }], depth: 12,
    });
    const secondCut = w.ops.booleanOp(
      'booleanSubtract', firstCut.handle as number, secondTool.handle as number,
    );
    expect(secondCut.ok, secondCut.error).toBe(true);
    const names = [...(w.edgeTopos.get(secondCut.handle as number)?.keys() ?? [])];
    const seam = names.find((name) => name === 'cut/seam(a/a/f.cap.top&b/f.side.0)');
    expect(seam, `chained kernel-history seam missing; names=${names.join(',')}`).toBeDefined();
    const rounded = w.ops.filletOrChamfer('fillet', secondCut.handle as number, [seam as string], 0.4);
    expect(rounded.ok, rounded.error).toBe(true);
    expect(w.ops.shapeMetrics(w.handles.get(rounded.handle as number)).volume).toBeGreaterThan(0);
  }, 60_000);

  it('selects a full-revolve latitude edge by persistent e.lat.* name', () => {
    const w = spawnWorker(oc);
    const revolved = w.ops.buildFromRevolve({
      loop: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 12 }, { x: 0, y: 12 }],
      angleDegrees: 360,
    });
    expect(revolved.ok, revolved.error).toBe(true);
    expect(w.faceTopos.get(revolved.handle as number)?.map((entry) => entry.name))
      .toContain('f.profile.1');
    const fillet = w.ops.filletOrChamfer('fillet', revolved.handle as number, ['e.lat.1'], 0.5);
    expect(fillet.ok, fillet.error).toBe(true);
  }, 60_000);

  it('builds a true partial revolve and resolves its partial latitude edge', () => {
    const w = spawnWorker(oc);
    const profile = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 12 }, { x: 0, y: 12 }];
    const full = w.ops.buildFromRevolve({ loop: profile, angleDegrees: 360 });
    const half = w.ops.buildFromRevolve({ loop: profile, angleDegrees: 180 });
    expect(full.ok, full.error).toBe(true);
    expect(half.ok, half.error).toBe(true);
    const halfFaces = w.faceTopos.get(half.handle as number)?.map((entry) => entry.name) ?? [];
    expect(halfFaces).toContain('f.profile.1');
    expect(halfFaces).toContain('f.cap.start');
    expect(halfFaces).toContain('f.cap.end');
    const fullVolume = w.ops.shapeMetrics(w.handles.get(full.handle as number)).volume;
    const halfVolume = w.ops.shapeMetrics(w.handles.get(half.handle as number)).volume;
    expect(halfVolume / fullVolume).toBeCloseTo(0.5, 6);
    const fillet = w.ops.filletOrChamfer('fillet', half.handle as number, ['e.lat.1'], 0.5);
    expect(fillet.ok, fillet.error).toBe(true);
  }, 60_000);

  it('keeps revolve face provenance through Boolean-to-fillet', () => {
    const w = spawnWorker(oc);
    const revolved = w.ops.buildFromRevolve({
      loop: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 14 }, { x: 0, y: 14 }],
      angleDegrees: 360,
    });
    const tool = w.ops.buildFromExtrude({
      loop: [{ x: 3, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 11 }, { x: 3, y: 11 }], depth: 10,
    });
    const cut = w.ops.booleanOp('booleanSubtract', revolved.handle as number, tool.handle as number);
    expect(cut.ok, cut.error).toBe(true);
    const names = [...(w.edgeTopos.get(cut.handle as number)?.keys() ?? [])];
    const seam = names.find((name) => name.startsWith('cut/seam(') && name.includes('a/f.profile.'));
    expect(seam, `revolve-history seam missing; names=${names.join(',')}`).toBeDefined();
    const rounded = w.ops.filletOrChamfer('fillet', cut.handle as number, [seam as string], 0.3);
    expect(rounded.ok, rounded.error).toBe(true);
    expect(w.ops.shapeMetrics(w.handles.get(rounded.handle as number)).volume).toBeGreaterThan(0);
  }, 60_000);

  it('assigns deterministic e.import.* names to imported STEP edges', () => {
    const w = spawnWorker(oc);
    const built = w.ops.buildFromExtrude({
      loop: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }], depth: 8,
    });
    const exported = w.ops.exportSTEP(built.handle as number);
    const imported = w.ops.importSTEP(exported.step as string);
    expect(imported.ok, imported.error).toBe(true);
    const fillet = w.ops.filletOrChamfer('fillet', imported.handle as number, ['e.import.0'], 0.5);
    expect(fillet.ok, fillet.error).toBe(true);
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
