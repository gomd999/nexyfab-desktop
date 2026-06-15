/**
 * occt/wasmWorker.integration — exercises the *public* worker stub at
 * `occt-worker/occt-worker.js` through the bridge.
 *
 * Vitest runs under Node so `globalThis.Worker` is absent. We can't spawn the
 * file as a real Web Worker; instead we:
 *   1. Read the worker JS off disk.
 *   2. Evaluate it inside an isolated sandbox object (`{ self, postMessage,
 *      onmessage }`) using `new Function`. The IIFE inside the file installs
 *      `self.onmessage = …` on that sandbox.
 *   3. Wrap the sandbox in a `WorkerLike` adapter that the bridge can drive
 *      via `postMessage` / `addEventListener('message', …)`.
 *
 * This validates the EXACT bytes that will ship to the browser — not the
 * separate in-process `createWasmWorkerStub` (which has its own tests in
 * `wasmBridge.test.ts`). Every test below uses the same wire protocol the
 * real OCCT worker will speak in Phase 5; when the binary lands these tests
 * stay green because they assert on protocol, not on geometry.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createWasmBridge } from './wasmBridge';
import type { WorkerLike } from './wasmWorkerStub';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';

// ─── load + sandbox the worker source ─────────────────────────────────────

const WORKER_PATH = path.resolve(__dirname, '../../../occt-worker/occt-worker.js');
const WORKER_SOURCE = fs.readFileSync(WORKER_PATH, 'utf8');

/**
 * Build a `WorkerLike` whose message handling is driven by `occt-worker.js`
 * evaluated inside a fresh sandbox per worker instance. Each call returns an
 * independent worker with its own handle table — matches real-Worker
 * isolation semantics.
 */
function buildFileBackedWorker(): WorkerLike {
  type SandboxMessageEvent = { data: unknown };
  type SandboxOnMessage = (ev: SandboxMessageEvent) => void;

  interface Sandbox {
    onmessage: SandboxOnMessage | null;
    postMessage: (msg: unknown) => void;
  }

  // Listeners on the *bridge* side — fed by sandbox.postMessage.
  const bridgeListeners = new Set<(ev: { data: unknown }) => void>();
  const errorListeners = new Set<(ev: unknown) => void>();
  let terminated = false;

  const sandbox: Sandbox = {
    onmessage: null,
    postMessage(msg: unknown): void {
      if (terminated) return;
      // Mirror real Worker: replies arrive on a microtask, not synchronously.
      queueMicrotask(() => {
        for (const l of bridgeListeners) l({ data: msg });
      });
    },
  };

  // Evaluate the worker file with `self` bound to our sandbox. The IIFE
  // inside the file assigns `self.onmessage = function(e) { … }`.
  const runner = new Function('self', WORKER_SOURCE) as (s: Sandbox) => void;
  runner(sandbox);

  return {
    postMessage(msg: unknown): void {
      if (terminated) return;
      // Bridge → worker hop is also async (real Worker structured-clones).
      queueMicrotask(() => {
        if (sandbox.onmessage) sandbox.onmessage({ data: msg });
      });
    },
    addEventListener(event: 'message' | 'error', listener: (ev: { data: unknown }) => void): void {
      if (event === 'message') bridgeListeners.add(listener);
      else errorListeners.add(listener as (ev: unknown) => void);
    },
    removeEventListener(event: 'message' | 'error', listener: (ev: { data: unknown }) => void): void {
      if (event === 'message') bridgeListeners.delete(listener);
      else errorListeners.delete(listener as (ev: unknown) => void);
    },
    terminate(): void {
      terminated = true;
      bridgeListeners.clear();
      errorListeners.clear();
      sandbox.onmessage = null;
    },
  };
}

// ─── fixtures ─────────────────────────────────────────────────────────────

function rectExtrude(): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth: 7,
    direction: 'one_sided',
    mode: 'add',
  };
}

function diskRevolve(): RevolveFeature {
  return {
    kind: 'revolve',
    loop: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ],
    angleDegrees: 360,
    mode: 'add',
  };
}

// ─── sanity: the source file actually exists ──────────────────────────────

describe('occt-worker.js: source presence', () => {
  it('the public worker file exists on disk and contains the wire dispatcher', () => {
    expect(WORKER_SOURCE.length).toBeGreaterThan(100);
    expect(WORKER_SOURCE).toContain('self.onmessage');
    // All 11 ops MUST be present so the bridge never sees an "unknown op".
    for (const op of [
      'init',
      'buildFromExtrude',
      'buildFromRevolve',
      'booleanUnion',
      'booleanSubtract',
      'booleanIntersect',
      'fillet',
      'chamfer',
      'exportSTEP',
      'importSTEP',
      'tessellate',
      'release',
    ]) {
      expect(WORKER_SOURCE).toContain("'" + op + "'");
    }
  });
});

// ─── init handshake against the *file* ────────────────────────────────────

describe('occt-worker.js: init handshake', () => {
  it('responds to init so the bridge becomes ready', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    expect(bridge.ready).toBe(false);
    const r = await bridge.buildFromExtrude(rectExtrude());
    expect(bridge.ready).toBe(true);
    expect(r.ok).toBe(true);
    bridge.dispose();
  });
});

// ─── extrude / revolve ────────────────────────────────────────────────────

describe('occt-worker.js: build ops', () => {
  it('buildFromExtrude returns a solid with the loop×depth bbox', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const r = await bridge.buildFromExtrude(rectExtrude());
    expect(r.ok).toBe(true);
    expect(r.shape!.kind).toBe('solid');
    expect(r.shape!.id).toMatch(/^occt_\d+$/);
    expect(r.shape!.bbox).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 7 } });
    expect(r.warnings.some((w) => /stub/.test(w))).toBe(true);
    bridge.dispose();
  });

  it('buildFromExtrude respects direction=midplane', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const r = await bridge.buildFromExtrude({ ...rectExtrude(), direction: 'midplane' });
    expect(r.ok).toBe(true);
    expect(r.shape!.bbox).toEqual({ min: { x: 0, y: 0, z: -3.5 }, max: { x: 10, y: 5, z: 3.5 } });
    bridge.dispose();
  });

  it('buildFromExtrude rejects depth <= 0 with a structured error', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const r = await bridge.buildFromExtrude({ ...rectExtrude(), depth: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/depth/);
    bridge.dispose();
  });

  it('buildFromRevolve returns the canonical Y-axis envelope', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const r = await bridge.buildFromRevolve(diskRevolve());
    expect(r.ok).toBe(true);
    expect(r.shape!.bbox).toEqual({ min: { x: -4, y: 0, z: -4 }, max: { x: 4, y: 2, z: 4 } });
    bridge.dispose();
  });
});

// ─── boolean ops ──────────────────────────────────────────────────────────

describe('occt-worker.js: boolean ops', () => {
  it('union returns a fresh shape whose bbox unions inputs', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const b = (await bridge.buildFromExtrude({ ...rectExtrude(), depth: 12 })).shape!;
    const u = await bridge.boolean.union(a, b);
    expect(u.ok).toBe(true);
    expect(u.shape!.id).not.toBe(a.id);
    expect(u.shape!.id).not.toBe(b.id);
    expect(u.shape!.bbox).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 12 } });
    bridge.dispose();
  });

  it('intersect of disjoint shapes returns ok=false', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    // Shift B far away so its bbox cannot overlap A.
    const farLoop: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: 100, y: 100 },
        { x: 110, y: 100 },
        { x: 110, y: 105 },
        { x: 100, y: 105 },
      ],
      depth: 7,
      direction: 'one_sided',
      mode: 'add',
    };
    const b = (await bridge.buildFromExtrude(farLoop)).shape!;
    const inter = await bridge.boolean.intersect(a, b);
    expect(inter.ok).toBe(false);
    expect(inter.error).toMatch(/disjoint/);
    bridge.dispose();
  });

  it('subtract returns A bbox unchanged (stub policy)', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const s = await bridge.boolean.subtract(a, b);
    expect(s.ok).toBe(true);
    expect(s.shape!.bbox).toEqual(a.bbox);
    bridge.dispose();
  });
});

// ─── fillet / chamfer ─────────────────────────────────────────────────────

describe('occt-worker.js: fillet / chamfer', () => {
  it('fillet pass-through preserves bbox but assigns a fresh id', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const f = await bridge.fillet(a, ['e1', 'e2'], 1.5);
    expect(f.ok).toBe(true);
    expect(f.shape!.id).not.toBe(a.id);
    expect(f.shape!.bbox).toEqual(a.bbox);
    bridge.dispose();
  });

  it('chamfer rejects non-positive distance', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const c = await bridge.chamfer(a, ['e1'], 0);
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/distance/);
    bridge.dispose();
  });
});

// ─── STEP I/O ─────────────────────────────────────────────────────────────

describe('occt-worker.js: STEP I/O', () => {
  it('exportSTEP returns an ISO-10303-21 envelope', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const step = await bridge.exportSTEP(a);
    expect(step).toContain('ISO-10303-21');
    expect(step).toContain('END-ISO-10303-21');
    bridge.dispose();
  });

  it('importSTEP recognises the stub envelope', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const step = await bridge.exportSTEP(a);
    const imported = await bridge.importSTEP(step);
    expect(imported.ok).toBe(true);
    expect(imported.shape!.kind).toBe('solid');
    bridge.dispose();
  });

  it('importSTEP rejects garbage input', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const r = await bridge.importSTEP('not a step file at all');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ISO-10303-21/);
    bridge.dispose();
  });
});

describe('occt-worker.js: tessellate', () => {
  it('returns viewer buffers (box mesh) for a built shape', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!; // 10×5×7 envelope
    const r = await bridge.tessellate(a);
    expect(r.ok).toBe(true);
    expect(r.mesh!.triangleCount).toBe(12);
    expect(r.mesh!.edgeCount).toBe(12);
    expect(r.mesh!.positions).toHaveLength(12 * 9);
    expect(r.mesh!.normals).toHaveLength(12 * 9);
    expect(r.mesh!.bounds.size).toEqual([10, 5, 7]);
    bridge.dispose();
  });

  it('rejects an unknown shape id before it reaches the worker', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    await bridge.buildFromExtrude(rectExtrude()); // ensure worker is ready
    await expect(bridge.tessellate({ id: 'occt_999', kind: 'solid' })).rejects.toThrow(/unknown shape id/);
    bridge.dispose();
  });
});

// ─── release / handle table ───────────────────────────────────────────────

describe('occt-worker.js: handle lifecycle', () => {
  it('release lets the bridge drop the handle; reuse throws', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    bridge.release(a);
    await expect(bridge.fillet(a, ['e1'], 1.0)).rejects.toThrow(/unknown shape id/);
    bridge.dispose();
  });

  it('liveShapeCount tracks the bridge-side view of net live handles', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    expect(bridge.liveShapeCount).toBe(0);
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    expect(bridge.liveShapeCount).toBe(2);
    bridge.release(a);
    bridge.release(b);
    expect(bridge.liveShapeCount).toBe(0);
    bridge.dispose();
  });
});

// ─── unknown op surfacing ─────────────────────────────────────────────────

describe('occt-worker.js: protocol robustness', () => {
  it('unknown op surfaces as ok=false through the wire', async () => {
    // We have to bypass the bridge (which only sends known ops) to test this.
    const worker = buildFileBackedWorker();
    const responses: unknown[] = [];
    worker.addEventListener('message', (e) => responses.push(e.data));
    worker.postMessage({ reqId: 42, op: 'totallyBogusOp', args: {} });
    // Allow microtasks to drain.
    await new Promise((r) => setTimeout(r, 0));
    expect(responses).toHaveLength(1);
    const resp = responses[0] as { reqId: number; ok: boolean; error?: string };
    expect(resp.reqId).toBe(42);
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/unknown op/);
    worker.terminate();
  });
});

// W2 — the ceiling ops (buildPlanarFace / thicken / surfaceTrim) over the EXACT
// shipped occt-worker.js stub bytes. Real geometry is the occt-worker-real.js
// browser path (e2e); here we verify the wire protocol + stub dispatch.
describe('occt-worker.js: W2 ceiling ops', () => {
  const SQ = (a: number, b: number) => [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];

  it('buildPlanarFace → face; thicken → solid', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const face = await bridge.buildPlanarFace!(SQ(0, 10), 0);
    expect(face.ok).toBe(true);
    expect(face.shape!.kind).toBe('face');
    const solid = await bridge.thicken!(face.shape!, 2);
    expect(solid.ok).toBe(true);
    expect(solid.shape!.kind).toBe('solid');
  });

  it('thicken rejects a non-positive thickness through the wire', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const face = (await bridge.buildPlanarFace!(SQ(0, 10), 0)).shape!;
    const bad = await bridge.thicken!(face, -1);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/positive finite/);
  });

  it('surfaceTrim → compound for overlapping shapes; disjoint reports no intersection', async () => {
    const bridge = createWasmBridge({ workerFactory: buildFileBackedWorker });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const sec = await bridge.surfaceTrim!(a, b);
    expect(sec.ok).toBe(true);
    expect(sec.shape!.kind).toBe('compound');

    const far1 = (await bridge.buildPlanarFace!(SQ(0, 1), 0)).shape!;
    const far2 = (await bridge.buildPlanarFace!(SQ(100, 101), 50)).shape!;
    const none = await bridge.surfaceTrim!(far1, far2);
    expect(none.ok).toBe(false);
    expect(none.error).toMatch(/do not intersect|disjoint/);
  });
});
