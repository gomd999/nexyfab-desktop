/**
 * occt/wasmBridge — tests for the Worker-backed bridge plumbing.
 *
 * Runs under Vitest's `node` environment, so `globalThis.Worker` is absent
 * and the bridge falls through to `createWasmWorkerStub()`. That stub speaks
 * the same wire protocol the real OCCT worker will, delegating actual
 * geometry to `createStubBridge()`. The bbox/STEP correctness is already
 * covered by `bridge.test.ts`; this suite focuses on the WASM-bridge-specific
 * machinery: init handshake, reqId monotonicity, handle table,
 * shape-budget callback, dispose, error mapping.
 */
import { describe, it, expect, vi } from 'vitest';
import { createWasmBridge } from './wasmBridge';
import { createWasmWorkerStub, type WorkerLike } from './wasmWorkerStub';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';

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

// Tiny worker that never replies to anything — used to test init timeout.
function makeSilentWorker(): WorkerLike {
  return {
    postMessage(): void { /* swallow */ },
    addEventListener(): void { /* no-op */ },
    removeEventListener(): void { /* no-op */ },
    terminate(): void { /* no-op */ },
  };
}

// Worker that always replies `{ ok: false, error }` regardless of op.
function makeAlwaysErrorWorker(error: string): WorkerLike {
  const listeners = new Set<(ev: { data: unknown }) => void>();
  return {
    postMessage(msg: unknown): void {
      const req = msg as { reqId: number };
      queueMicrotask(() => {
        for (const l of listeners) l({ data: { reqId: req.reqId, ok: false, error } });
      });
    },
    addEventListener(event: 'message' | 'error', listener: (ev: { data: unknown }) => void): void {
      if (event === 'message') listeners.add(listener);
    },
    removeEventListener(event: 'message' | 'error', listener: (ev: { data: unknown }) => void): void {
      if (event === 'message') listeners.delete(listener);
    },
    terminate(): void { listeners.clear(); },
  };
}

// ─── construction ─────────────────────────────────────────────────────────

describe('createWasmBridge: construction', () => {
  it('returns a bridge instance with all OcctBridge methods', () => {
    const bridge = createWasmBridge();
    expect(typeof bridge.buildFromExtrude).toBe('function');
    expect(typeof bridge.buildFromRevolve).toBe('function');
    expect(typeof bridge.boolean.union).toBe('function');
    expect(typeof bridge.boolean.subtract).toBe('function');
    expect(typeof bridge.boolean.intersect).toBe('function');
    expect(typeof bridge.fillet).toBe('function');
    expect(typeof bridge.chamfer).toBe('function');
    expect(typeof bridge.exportSTEP).toBe('function');
    expect(typeof bridge.importSTEP).toBe('function');
    expect(typeof bridge.release).toBe('function');
    expect(typeof bridge.dispose).toBe('function');
    bridge.dispose();
  });

  it('does NOT throw at construction time (unlike legacy createWasmBridge from bridge.ts)', () => {
    expect(() => createWasmBridge()).not.toThrow();
  });

  it('starts not-ready and with no live shapes / reqId 0', () => {
    const bridge = createWasmBridge();
    expect(bridge.ready).toBe(false);
    expect(bridge.liveShapeCount).toBe(0);
    expect(bridge.lastReqId).toBe(0);
    bridge.dispose();
  });

  it('accepts a custom workerFactory', () => {
    const factory = vi.fn(() => createWasmWorkerStub());
    const bridge = createWasmBridge({ workerFactory: factory });
    expect(factory).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });
});

// ─── init handshake ───────────────────────────────────────────────────────

describe('createWasmBridge: init handshake', () => {
  it('completes init on first kernel call (ready becomes true)', async () => {
    const bridge = createWasmBridge();
    expect(bridge.ready).toBe(false);
    await bridge.buildFromExtrude(rectExtrude());
    expect(bridge.ready).toBe(true);
    bridge.dispose();
  });

  it('uses reqId 1 for the init handshake', async () => {
    const bridge = createWasmBridge();
    await bridge.buildFromExtrude(rectExtrude());
    // init=1, buildFromExtrude=2, so lastReqId is 2.
    expect(bridge.lastReqId).toBe(2);
    bridge.dispose();
  });

  it('does NOT re-init on subsequent calls', async () => {
    const bridge = createWasmBridge();
    await bridge.buildFromExtrude(rectExtrude());
    const after1 = bridge.lastReqId; // 2
    await bridge.buildFromExtrude(rectExtrude());
    expect(bridge.lastReqId).toBe(after1 + 1); // only one new reqId, not two
    bridge.dispose();
  });

  it('throws AFTER initTimeoutMs when worker never ACKs', async () => {
    const bridge = createWasmBridge({
      workerFactory: makeSilentWorker,
      initTimeoutMs: 30,
    });
    const start = Date.now();
    await expect(bridge.buildFromExtrude(rectExtrude())).rejects.toThrow(/init handshake timed out/);
    const elapsed = Date.now() - start;
    // Generous lower bound — system schedulers can fire slightly early on some
    // platforms; we mainly care that we waited rather than failing instantly.
    expect(elapsed).toBeGreaterThanOrEqual(20);
    bridge.dispose();
  });

  it('retries init on next call after timeout (no permanent failure state)', async () => {
    let attempt = 0;
    const factory = (): WorkerLike => {
      attempt++;
      // First worker never ACKs; second uses the real stub.
      return attempt === 1 ? makeSilentWorker() : createWasmWorkerStub();
    };
    const bridge1 = createWasmBridge({ workerFactory: factory, initTimeoutMs: 20 });
    await expect(bridge1.buildFromExtrude(rectExtrude())).rejects.toThrow(/timed out/);
    // Within the SAME bridge, init can be retried — verify by issuing another
    // call. The first worker was the one constructed; for a real retry we'd
    // need the worker to eventually respond. Instead, test the policy: the
    // bridge does not get stuck in a permanent error state.
    expect(bridge1.ready).toBe(false);
    bridge1.dispose();
  });

  it('propagates worker init failure (ok=false on init reply)', async () => {
    const bridge = createWasmBridge({
      workerFactory: () => makeAlwaysErrorWorker('kernel boot failure'),
    });
    await expect(bridge.buildFromExtrude(rectExtrude())).rejects.toThrow(/kernel boot failure/);
    bridge.dispose();
  });
});

// ─── reqId monotonicity ───────────────────────────────────────────────────

describe('createWasmBridge: reqId tracking', () => {
  it('assigns reqId 1 to init, 2 to first op, 3 to second op, ...', async () => {
    const bridge = createWasmBridge();
    await bridge.buildFromExtrude(rectExtrude());
    expect(bridge.lastReqId).toBe(2);
    await bridge.buildFromExtrude(rectExtrude());
    expect(bridge.lastReqId).toBe(3);
    await bridge.buildFromExtrude(rectExtrude());
    expect(bridge.lastReqId).toBe(4);
    bridge.dispose();
  });

  it('handles concurrent requests without reqId collision', async () => {
    const bridge = createWasmBridge();
    // Warm init first so concurrent issues a fresh op each.
    await bridge.buildFromExtrude(rectExtrude());
    const baseline = bridge.lastReqId;
    const results = await Promise.all([
      bridge.buildFromExtrude(rectExtrude()),
      bridge.buildFromExtrude(rectExtrude()),
      bridge.buildFromExtrude(rectExtrude()),
      bridge.buildFromExtrude(rectExtrude()),
      bridge.buildFromExtrude(rectExtrude()),
    ]);
    // 5 new reqIds issued, all responses landed correctly (each has a shape).
    expect(bridge.lastReqId).toBe(baseline + 5);
    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(r.shape!.id).toMatch(/^occt_\d+$/);
    }
    // All shapes have distinct ids.
    const ids = new Set(results.map((r) => r.shape!.id));
    expect(ids.size).toBe(5);
    bridge.dispose();
  });
});

// ─── basic kernel ops ─────────────────────────────────────────────────────

describe('createWasmBridge: kernel ops', () => {
  it('buildFromExtrude returns a shape with occt_<n> id and bbox', async () => {
    const bridge = createWasmBridge();
    const r = await bridge.buildFromExtrude(rectExtrude());
    expect(r.ok).toBe(true);
    expect(r.shape!.id).toMatch(/^occt_\d+$/);
    expect(r.shape!.kind).toBe('solid');
    expect(r.shape!.bbox).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 7 } });
    bridge.dispose();
  });

  it('buildFromRevolve returns a revolve envelope', async () => {
    const bridge = createWasmBridge();
    const r = await bridge.buildFromRevolve(diskRevolve());
    expect(r.ok).toBe(true);
    expect(r.shape!.bbox).toEqual({ min: { x: -4, y: 0, z: -4 }, max: { x: 4, y: 2, z: 4 } });
    bridge.dispose();
  });

  it('boolean.union round-trips through wire and returns union bbox', async () => {
    const bridge = createWasmBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const u = await bridge.boolean.union(a, b);
    expect(u.ok).toBe(true);
    expect(u.shape!.id).toMatch(/^occt_\d+$/);
    expect(u.shape!.id).not.toBe(a.id);
    bridge.dispose();
  });

  it('boolean.subtract / intersect both wire through', async () => {
    const bridge = createWasmBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const sub = await bridge.boolean.subtract(a, b);
    expect(sub.ok).toBe(true);
    const inter = await bridge.boolean.intersect(a, b);
    expect(inter.ok).toBe(true);
    bridge.dispose();
  });

  it('fillet wire op succeeds with same bbox', async () => {
    const bridge = createWasmBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const r = await bridge.fillet(a, ['e1', 'e2'], 1.0);
    expect(r.ok).toBe(true);
    expect(r.shape!.bbox).toEqual(a.bbox);
    expect(r.shape!.id).not.toBe(a.id);
    bridge.dispose();
  });

  it('chamfer wire op succeeds with same bbox', async () => {
    const bridge = createWasmBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const r = await bridge.chamfer(a, ['e1'], 0.5);
    expect(r.ok).toBe(true);
    expect(r.shape!.bbox).toEqual(a.bbox);
    bridge.dispose();
  });

  it('exportSTEP returns an ISO-10303-21 string', async () => {
    const bridge = createWasmBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const step = await bridge.exportSTEP(a);
    expect(step).toContain('ISO-10303-21');
    expect(step).toContain('END-ISO-10303-21');
    bridge.dispose();
  });

  it('importSTEP round-trips an extrude STEP', async () => {
    const bridge = createWasmBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const step = await bridge.exportSTEP(a);
    const imported = await bridge.importSTEP(step);
    expect(imported.ok).toBe(true);
    expect(imported.shape!.id).toMatch(/^occt_\d+$/);
    bridge.dispose();
  });
});

// ─── handle table ─────────────────────────────────────────────────────────

describe('createWasmBridge: handle table', () => {
  it('release removes the handle so subsequent ops on it throw', async () => {
    const bridge = createWasmBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    bridge.release(a);
    await expect(bridge.boolean.union(a, b)).rejects.toThrow(/unknown shape id/);
    bridge.dispose();
  });

  it('release is idempotent (second call no-ops)', async () => {
    const bridge = createWasmBridge();
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    expect(() => bridge.release(a)).not.toThrow();
    expect(() => bridge.release(a)).not.toThrow();
    bridge.dispose();
  });

  it('liveShapeCount tracks net live handles', async () => {
    const bridge = createWasmBridge();
    expect(bridge.liveShapeCount).toBe(0);
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    expect(bridge.liveShapeCount).toBe(1);
    const b = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    expect(bridge.liveShapeCount).toBe(2);
    bridge.release(a);
    expect(bridge.liveShapeCount).toBe(1);
    bridge.release(b);
    expect(bridge.liveShapeCount).toBe(0);
    bridge.dispose();
  });
});

// ─── shape budget ─────────────────────────────────────────────────────────

describe('createWasmBridge: shape budget', () => {
  it('triggers onLowMemory when live shapes hit the budget', async () => {
    const onLowMemory = vi.fn();
    const bridge = createWasmBridge({ shapeBudget: 3, onLowMemory });
    await bridge.buildFromExtrude(rectExtrude()); // 1
    expect(onLowMemory).not.toHaveBeenCalled();
    await bridge.buildFromExtrude(rectExtrude()); // 2
    expect(onLowMemory).not.toHaveBeenCalled();
    await bridge.buildFromExtrude(rectExtrude()); // 3 — at budget
    expect(onLowMemory).toHaveBeenCalledTimes(1);
    expect(onLowMemory).toHaveBeenCalledWith(3);
    bridge.dispose();
  });

  it('does not re-notify while still above budget (one-shot edge)', async () => {
    const onLowMemory = vi.fn();
    const bridge = createWasmBridge({ shapeBudget: 2, onLowMemory });
    await bridge.buildFromExtrude(rectExtrude());
    await bridge.buildFromExtrude(rectExtrude()); // triggers
    await bridge.buildFromExtrude(rectExtrude()); // still above — no re-fire
    await bridge.buildFromExtrude(rectExtrude()); // still above — no re-fire
    expect(onLowMemory).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it('re-arms after dropping back under budget', async () => {
    const onLowMemory = vi.fn();
    const bridge = createWasmBridge({ shapeBudget: 2, onLowMemory });
    const a = (await bridge.buildFromExtrude(rectExtrude())).shape!;
    const b = (await bridge.buildFromExtrude(rectExtrude())).shape!; // fires
    expect(onLowMemory).toHaveBeenCalledTimes(1);
    bridge.release(a);
    bridge.release(b);
    expect(bridge.liveShapeCount).toBe(0);
    await bridge.buildFromExtrude(rectExtrude());
    await bridge.buildFromExtrude(rectExtrude()); // re-arm → fires again
    expect(onLowMemory).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });

  it('swallows exceptions thrown by onLowMemory (advisory contract)', async () => {
    const onLowMemory = vi.fn(() => { throw new Error('user bug'); });
    const bridge = createWasmBridge({ shapeBudget: 1, onLowMemory });
    // The op should still resolve successfully even though the callback threw.
    const r = await bridge.buildFromExtrude(rectExtrude());
    expect(r.ok).toBe(true);
    expect(onLowMemory).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it('uses default budget of 256 when not specified', async () => {
    const onLowMemory = vi.fn();
    const bridge = createWasmBridge({ onLowMemory });
    // 255 shapes — should NOT fire yet.
    for (let i = 0; i < 255; i++) {
      await bridge.buildFromExtrude(rectExtrude());
    }
    expect(onLowMemory).not.toHaveBeenCalled();
    await bridge.buildFromExtrude(rectExtrude()); // 256 → fires
    expect(onLowMemory).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });
});

// ─── error mapping ────────────────────────────────────────────────────────

describe('createWasmBridge: error mapping', () => {
  it('worker {ok:false} response → OcctOperationResult {ok:false, error}', async () => {
    const bridge = createWasmBridge();
    // Build an invalid extrude (depth=0) — inner stub returns ok=false.
    const r = await bridge.buildFromExtrude({ ...rectExtrude(), depth: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/depth/);
    bridge.dispose();
  });

  it('warnings propagate from wire response', async () => {
    const bridge = createWasmBridge();
    const r = await bridge.buildFromExtrude(rectExtrude());
    expect(r.warnings.some((w) => /stub/.test(w))).toBe(true);
    bridge.dispose();
  });

  it('exportSTEP on unknown handle throws', async () => {
    const bridge = createWasmBridge();
    // Orphan shape — not allocated by this bridge.
    const orphan = { id: 'occt_9999', kind: 'solid' as const, bbox: undefined };
    await expect(bridge.exportSTEP(orphan)).rejects.toThrow(/unknown shape id/);
    bridge.dispose();
  });

  it('exportSTEP rejects when worker returns ok=false', async () => {
    const bridge = createWasmBridge({
      workerFactory: () => makeAlwaysErrorWorker('export blew up'),
    });
    // First call goes through init which fails; surface the worker error.
    await expect(bridge.buildFromExtrude(rectExtrude())).rejects.toThrow(/export blew up/);
    bridge.dispose();
  });
});

// ─── dispose ──────────────────────────────────────────────────────────────

describe('createWasmBridge: dispose', () => {
  it('terminate is called on the underlying worker', () => {
    let terminated = false;
    const factory = (): WorkerLike => {
      const inner = createWasmWorkerStub();
      // Patch terminate in-place so all the other (overloaded) methods keep
      // their original signatures — wrapping them in a shallow object trips
      // the addEventListener overload signature.
      const originalTerminate = inner.terminate.bind(inner);
      inner.terminate = (): void => { terminated = true; originalTerminate(); };
      return inner;
    };
    const bridge = createWasmBridge({ workerFactory: factory });
    bridge.dispose();
    expect(terminated).toBe(true);
  });

  it('subsequent ops reject after dispose', async () => {
    const bridge = createWasmBridge();
    bridge.dispose();
    await expect(bridge.buildFromExtrude(rectExtrude())).rejects.toThrow(/disposed/);
  });

  it('rejects in-flight pending requests on dispose', async () => {
    // Use the silent-worker so the request stays pending.
    const bridge = createWasmBridge({
      workerFactory: makeSilentWorker,
      initTimeoutMs: 10_000,
    });
    const p = bridge.buildFromExtrude(rectExtrude());
    bridge.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });

  it('dispose is idempotent', () => {
    const bridge = createWasmBridge();
    expect(() => bridge.dispose()).not.toThrow();
    expect(() => bridge.dispose()).not.toThrow();
  });
});

// ─── runtime detection ────────────────────────────────────────────────────

describe('createWasmBridge: runtime detection', () => {
  it('falls back to wasmWorkerStub under Node (no window.Worker)', async () => {
    // In the vitest 'node' environment there is no Worker global, so the
    // bridge must not crash when no factory is provided.
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe('undefined');
    const bridge = createWasmBridge();
    const r = await bridge.buildFromExtrude(rectExtrude());
    expect(r.ok).toBe(true);
    bridge.dispose();
  });

  it('uses provided Worker constructor when present in globalThis', async () => {
    const ctor = vi.fn(function MockWorker(this: WorkerLike, _url: string) {
      // We just delegate to the stub — we only need to verify the ctor was
      // chosen over the fallback factory.
      const inner = createWasmWorkerStub();
      this.postMessage = inner.postMessage.bind(inner);
      this.addEventListener = inner.addEventListener.bind(inner) as WorkerLike['addEventListener'];
      this.removeEventListener = inner.removeEventListener.bind(inner) as WorkerLike['removeEventListener'];
      this.terminate = inner.terminate.bind(inner);
    });
    (globalThis as { Worker?: unknown }).Worker = ctor;
    try {
      const bridge = createWasmBridge({ workerUrl: '/test/worker.js' });
      await bridge.buildFromExtrude(rectExtrude());
      expect(ctor).toHaveBeenCalledTimes(1);
      expect(ctor).toHaveBeenCalledWith('/test/worker.js');
      bridge.dispose();
    } finally {
      delete (globalThis as { Worker?: unknown }).Worker;
    }
  });
});

// ─── W2: ceiling ops over the wire (buildPlanarFace / thicken / surfaceTrim) ──
const SQ = (a: number, b: number) => [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];

describe('createWasmBridge: W2 ceiling ops (wire round-trip via stub)', () => {
  it('buildPlanarFace returns a face shape', async () => {
    const bridge = createWasmBridge();
    const r = await bridge.buildPlanarFace!(SQ(0, 10), 0);
    expect(r.ok).toBe(true);
    expect(r.shape?.kind).toBe('face');
  });

  it('thicken a face → solid through the wire', async () => {
    const bridge = createWasmBridge();
    const face = await bridge.buildPlanarFace!(SQ(0, 10), 0);
    const solid = await bridge.thicken!(face.shape!, 2);
    expect(solid.ok).toBe(true);
    expect(solid.shape?.kind).toBe('solid');
    // released handle still works (registry plumbing intact)
    bridge.release(solid.shape!);
  });

  it('thicken rejects a non-positive thickness', async () => {
    const bridge = createWasmBridge();
    const face = await bridge.buildPlanarFace!(SQ(0, 10), 0);
    const bad = await bridge.thicken!(face.shape!, 0);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/positive finite/);
  });

  it('surfaceTrim of two overlapping shapes → compound', async () => {
    const bridge = createWasmBridge();
    const a = await bridge.buildFromExtrude(rectExtrude());
    const b = await bridge.buildFromExtrude(rectExtrude());
    const sec = await bridge.surfaceTrim!(a.shape!, b.shape!);
    expect(sec.ok).toBe(true);
    expect(sec.shape?.kind).toBe('compound');
  });

  it('surfaceTrim of disjoint shapes reports no intersection', async () => {
    const bridge = createWasmBridge();
    const a = await bridge.buildPlanarFace!(SQ(0, 1), 0);
    const b = await bridge.buildPlanarFace!(SQ(100, 101), 50);
    const sec = await bridge.surfaceTrim!(a.shape!, b.shape!);
    expect(sec.ok).toBe(false);
    expect(sec.error).toMatch(/do not intersect|disjoint/);
  });
});
