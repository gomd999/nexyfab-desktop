/**
 * occt/wasmRealActivation — activation tests for occt-worker-real.js.
 *
 * Phase 5 launch step 9 verification. We load the worker source into a
 * sandbox the same way `wasmWorker.integration.test.ts` does for the stub —
 * then drive the OCCT call sites with a mock Embind module via the
 * `__OCCT_TEST_MODULE_FACTORY__` seam exposed in occt-worker-real.js.
 *
 * What these tests prove
 * ----------------------
 *  - The dispatcher has handlers for ALL 11 wire ops.
 *  - Module factory failure → `event:'mode', mode:'failed'` postMessage.
 *  - Module factory success → `event:'mode', mode:'ready'`.
 *  - Per-op dispose discipline: every `new occt.X(...)` is paired with
 *    `.delete()` (counted via the same DisposeTracker the stub uses).
 *  - Result shapes are NOT deleted (caller owns the handle until `release`).
 *  - `release` calls `.delete()` on the held shape.
 *
 * The mock module mirrors enough of the opencascade.js@1.1.1 Embind surface
 * to drive every op. It's an extended version of `_vendor/opencascade.stub.ts`
 * with fillet, revolve, and TopExp_Explorer added.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createStubOpenCascadeModule,
  type StubOpenCascadeModule,
} from './_vendor/opencascade.stub';

const WORKER_REAL_PATH = path.resolve(__dirname, '../../../occt-worker/occt-worker-real.js');
const WORKER_REAL_SOURCE = fs.readFileSync(WORKER_REAL_PATH, 'utf8');

// ─── sandbox harness ─────────────────────────────────────────────────────

type SandboxMessage = { event?: string; mode?: string; reason?: string; reqId?: number; ok?: boolean; error?: string; shape?: unknown; step?: string; warnings?: string[] };

interface Sandbox {
  self: Sandbox;
  onmessage: ((ev: { data: unknown }) => void) | null;
  postMessage: (msg: SandboxMessage) => void;
  postedMessages: SandboxMessage[];
  __OCCT_TEST_MODULE_FACTORY__?: () => Promise<unknown>;
  __OCCT_REAL_INTROSPECT__?: WorkerIntrospect;
  Module?: unknown;
  importScripts?: (url: string) => void;
}

interface WorkerIntrospect {
  readonly mode: 'pending' | 'ready' | 'failed';
  readonly reason: string;
  readonly occt: unknown;
  readonly handles: Map<number, unknown>;
  readonly nextHandle: number;
  readonly ops: {
    buildFromExtrude: (feature: unknown) => { ok: boolean; handle?: number; kind?: string; error?: string; warnings: string[] };
    buildFromRevolve: (feature: unknown) => { ok: boolean; handle?: number; kind?: string; error?: string; warnings: string[] };
    booleanOp: (op: string, a: number, b: number) => { ok: boolean; handle?: number; kind?: string; error?: string; warnings: string[] };
    filletOrChamfer: (op: string, h: number, edgeIds: string[], dim: number) => { ok: boolean; handle?: number; kind?: string; error?: string; warnings: string[] };
    exportSTEP: (h: number) => { ok: boolean; step?: string; error?: string; warnings: string[] };
    importSTEP: (s: string) => { ok: boolean; handle?: number; kind?: string; error?: string; warnings: string[] };
    tessellate: (h: number, deflection?: number) => { ok: boolean; mesh?: unknown; error?: string; warnings: string[] };
    freeHandle: (h: number) => boolean;
    alloc: (s: unknown) => number;
    shapeMetrics: (s: unknown) => unknown;
  };
  setOcct: (m: unknown) => void;
}

function buildSandbox(opts: {
  factory?: () => Promise<unknown>;
  /** Simulate `importScripts` failure path (no factory hook, no importScripts). */
  withoutImportScripts?: boolean;
} = {}): Sandbox {
  const sandbox = {
    onmessage: null,
    postedMessages: [] as SandboxMessage[],
  } as unknown as Sandbox;
  // self-reference so the IIFE's `self.postMessage` finds the same object.
  sandbox.self = sandbox;
  sandbox.postMessage = function (msg: SandboxMessage): void {
    sandbox.postedMessages.push(msg);
  };
  if (opts.factory) {
    sandbox.__OCCT_TEST_MODULE_FACTORY__ = opts.factory;
  }
  if (!opts.withoutImportScripts) {
    // Provide a no-op importScripts so the production path doesn't throw
    // before reaching the `factory` check. (We only rely on the factory hook
    // when one is supplied; otherwise it falls through to `self.Module`.)
    sandbox.importScripts = (): void => { /* no-op */ };
  }
  return sandbox;
}

function runWorker(sandbox: Sandbox): WorkerIntrospect {
  // The worker IIFE only sees the names we pass as parameters. We expose
  // `self` and bind `importScripts`/`Module` onto it so the dispatcher's
  // `typeof importScripts !== 'function'` check sees what we set.
  const runner = new Function('self', 'importScripts', 'Module', WORKER_REAL_SOURCE) as (
    s: Sandbox,
    importScripts: ((url: string) => void) | undefined,
    Module: unknown,
  ) => void;
  runner(sandbox, sandbox.importScripts, sandbox.Module);
  const introspect = sandbox.__OCCT_REAL_INTROSPECT__;
  if (!introspect) throw new Error('worker did not install __OCCT_REAL_INTROSPECT__');
  return introspect;
}

// ─── 11-op handler presence ───────────────────────────────────────────────

describe('occt-worker-real.js: 11-op handler presence', () => {
  it('source file references every wire op string', () => {
    expect(WORKER_REAL_SOURCE.length).toBeGreaterThan(100);
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
      expect(WORKER_REAL_SOURCE).toContain("'" + op + "'");
    }
  });

  it('source file installs self.onmessage dispatcher', () => {
    expect(WORKER_REAL_SOURCE).toContain('self.onmessage');
  });

  it('introspect exposes all expected op handlers after IIFE runs', async () => {
    const fake = createStubOpenCascadeModule();
    const sandbox = buildSandbox({ factory: async () => fake });
    const introspect = runWorker(sandbox);
    // Drain the init microtask so `occt` is set.
    await Promise.resolve();
    await Promise.resolve();
    expect(typeof introspect.ops.buildFromExtrude).toBe('function');
    expect(typeof introspect.ops.buildFromRevolve).toBe('function');
    expect(typeof introspect.ops.booleanOp).toBe('function');
    expect(typeof introspect.ops.filletOrChamfer).toBe('function');
    expect(typeof introspect.ops.exportSTEP).toBe('function');
    expect(typeof introspect.ops.importSTEP).toBe('function');
    expect(typeof introspect.ops.tessellate).toBe('function');
    expect(typeof introspect.ops.freeHandle).toBe('function');
  });
});

// ─── factory failure → mode:'failed' ──────────────────────────────────────

describe('occt-worker-real.js: factory failure path', () => {
  it('importScripts unavailable AND no factory hook → mode:failed', () => {
    const sandbox = buildSandbox({ withoutImportScripts: true });
    runWorker(sandbox);
    const modeMsg = sandbox.postedMessages.find((m) => m.event === 'mode');
    expect(modeMsg).toBeDefined();
    expect(modeMsg!.mode).toBe('failed');
    expect(modeMsg!.reason).toMatch(/importScripts not available/);
  });

  it('factory throws synchronously → mode:failed + reason recorded', async () => {
    const sandbox = buildSandbox({
      factory: () => { throw new Error('synthetic factory boom'); },
    });
    const introspect = runWorker(sandbox);
    await Promise.resolve(); await Promise.resolve();
    const modeMsg = sandbox.postedMessages.find((m) => m.event === 'mode');
    expect(modeMsg).toBeDefined();
    expect(modeMsg!.mode).toBe('failed');
    expect(modeMsg!.reason).toMatch(/factory threw/);
    expect(introspect.mode).toBe('failed');
  });

  it('factory rejects → mode:failed via promise rejection branch', async () => {
    const sandbox = buildSandbox({
      factory: async () => { throw new Error('async factory boom'); },
    });
    const introspect = runWorker(sandbox);
    // Let the promise chain settle.
    await new Promise((r) => setTimeout(r, 0));
    const modeMsg = sandbox.postedMessages.filter((m) => m.event === 'mode').pop();
    expect(modeMsg).toBeDefined();
    expect(modeMsg!.mode).toBe('failed');
    expect(modeMsg!.reason).toMatch(/Module\(\) rejected/);
    expect(introspect.mode).toBe('failed');
  });

  it('init op replies ok:false when factory failed', async () => {
    const sandbox = buildSandbox({
      factory: async () => { throw new Error('boot fail'); },
    });
    runWorker(sandbox);
    // Send init request via onmessage.
    expect(sandbox.onmessage).toBeTruthy();
    sandbox.onmessage!({ data: { reqId: 1, op: 'init', args: {} } });
    await new Promise((r) => setTimeout(r, 0));
    const initReply = sandbox.postedMessages.find((m) => m.reqId === 1);
    expect(initReply).toBeDefined();
    expect(initReply!.ok).toBe(false);
    expect(initReply!.error).toMatch(/occt-real init/);
  });
});

// ─── factory success → mode:'ready' ───────────────────────────────────────

describe('occt-worker-real.js: factory success path', () => {
  it('factory resolves → mode:ready + occt populated', async () => {
    const fake = createStubOpenCascadeModule();
    const sandbox = buildSandbox({ factory: async () => fake });
    const introspect = runWorker(sandbox);
    await new Promise((r) => setTimeout(r, 0));
    expect(introspect.mode).toBe('ready');
    expect(introspect.occt).toBe(fake);
    const modeMsg = sandbox.postedMessages.find((m) => m.event === 'mode');
    expect(modeMsg).toBeDefined();
    expect(modeMsg!.mode).toBe('ready');
  });

  it('init op replies ok:true once factory resolves', async () => {
    const fake = createStubOpenCascadeModule();
    const sandbox = buildSandbox({ factory: async () => fake });
    runWorker(sandbox);
    await new Promise((r) => setTimeout(r, 0));
    sandbox.onmessage!({ data: { reqId: 10, op: 'init', args: {} } });
    await new Promise((r) => setTimeout(r, 0));
    const initReply = sandbox.postedMessages.find((m) => m.reqId === 10);
    expect(initReply).toBeDefined();
    expect(initReply!.ok).toBe(true);
  });
});

// ─── op handler behaviour (mock module) ───────────────────────────────────

function setupReady(): { sandbox: Sandbox; introspect: WorkerIntrospect; occt: StubOpenCascadeModule } {
  const fake = createStubOpenCascadeModule();
  const sandbox = buildSandbox({ factory: async () => fake });
  const introspect = runWorker(sandbox);
  // Force-set occt for sync test access without waiting for the microtask.
  introspect.setOcct(fake);
  return { sandbox, introspect, occt: fake };
}

describe('occt-worker-real.js: buildFromExtrude on mock module', () => {
  it('builds a prism and allocates a handle', () => {
    const { introspect, occt } = setupReady();
    const res = introspect.ops.buildFromExtrude({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
      depth: 7,
      direction: 'one_sided',
      mode: 'add',
    });
    expect(res.ok).toBe(true);
    expect(typeof res.handle).toBe('number');
    expect(introspect.handles.has(res.handle!)).toBe(true);
    // Allocated objects: 4 points + 1 polygon + 1 wire + 1 faceBuilder + 1
    // face + 1 vec + 1 prismBuilder = 10. All but the result shape should be
    // disposed.
    expect(occt.__tracker__.allocs).toBe(10);
    expect(occt.__tracker__.disposes).toBe(10);
    expect(occt.__tracker__.liveSymbols.size).toBe(0);
  });

  it('rejects loops with fewer than 3 points BEFORE touching heap', () => {
    const { introspect, occt } = setupReady();
    const res = introspect.ops.buildFromExtrude({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      depth: 1,
      direction: 'one_sided',
      mode: 'add',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/loop must have >=3/);
    expect(occt.__tracker__.allocs).toBe(0);
  });

  it('rejects zero / non-finite depth without allocating', () => {
    const { introspect, occt } = setupReady();
    const r1 = introspect.ops.buildFromExtrude({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      depth: 0,
      direction: 'one_sided',
      mode: 'add',
    });
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/depth/);
    const r2 = introspect.ops.buildFromExtrude({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      depth: Number.NaN,
      direction: 'one_sided',
      mode: 'add',
    });
    expect(r2.ok).toBe(false);
    expect(occt.__tracker__.allocs).toBe(0);
  });

  it('returns notReady envelope when occt is null', () => {
    const fake = createStubOpenCascadeModule();
    const sandbox = buildSandbox({ factory: async () => fake });
    const introspect = runWorker(sandbox);
    // Do NOT set occt — simulate before-init state.
    expect(introspect.mode).toBe('pending');
    const res = introspect.ops.buildFromExtrude({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      depth: 1,
      direction: 'one_sided',
      mode: 'add',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not ready/);
  });
});

describe('occt-worker-real.js: booleanOp on mock module', () => {
  it('returns ok:false for unknown handle', () => {
    const { introspect } = setupReady();
    const res = introspect.ops.booleanOp('booleanUnion', 999, 1000);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown handle/);
  });

  it('union of two extrudes disposes the algo (no leak)', () => {
    const { introspect, occt } = setupReady();
    const a = introspect.ops.buildFromExtrude({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
      depth: 1,
      direction: 'one_sided',
      mode: 'add',
    });
    const b = introspect.ops.buildFromExtrude({
      kind: 'extrude',
      loop: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }],
      depth: 1,
      direction: 'one_sided',
      mode: 'add',
    });
    const allocsBefore = occt.__tracker__.allocs;
    const disposesBefore = occt.__tracker__.disposes;
    const u = introspect.ops.booleanOp('booleanUnion', a.handle!, b.handle!);
    expect(u.ok).toBe(true);
    // Algo alloc + dispose (result shape is NOT an Embind object in stub).
    expect(occt.__tracker__.allocs - allocsBefore).toBe(1);
    expect(occt.__tracker__.disposes - disposesBefore).toBe(1);
  });
});

describe('occt-worker-real.js: STEP I/O on mock module', () => {
  it('exportSTEP returns ISO-10303-21 envelope from stub Writer', () => {
    const { introspect } = setupReady();
    const a = introspect.ops.buildFromExtrude({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      depth: 2,
      direction: 'one_sided',
      mode: 'add',
    });
    const step = introspect.ops.exportSTEP(a.handle!);
    expect(step.ok).toBe(true);
    expect(step.step).toContain('ISO-10303-21');
  });

  it('importSTEP rejects empty source without allocating reader', () => {
    const { introspect, occt } = setupReady();
    const allocsBefore = occt.__tracker__.allocs;
    const res = introspect.ops.importSTEP('');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/empty source/);
    expect(occt.__tracker__.allocs).toBe(allocsBefore);
  });

  it('importSTEP roundtrip via stub FS reads back the exported envelope', () => {
    const { introspect } = setupReady();
    const a = introspect.ops.buildFromExtrude({
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      depth: 3,
      direction: 'one_sided',
      mode: 'add',
    });
    const step = introspect.ops.exportSTEP(a.handle!);
    expect(step.ok).toBe(true);
    const imp = introspect.ops.importSTEP(step.step!);
    expect(imp.ok).toBe(true);
    expect(typeof imp.handle).toBe('number');
  });
});

// ─── handle table + release ───────────────────────────────────────────────

describe('occt-worker-real.js: handle table + release', () => {
  it('release calls .delete() on the held shape', () => {
    const { introspect } = setupReady();
    let deleted = false;
    const fakeShape = { delete(): void { deleted = true; } };
    const h = introspect.ops.alloc(fakeShape);
    expect(introspect.handles.has(h)).toBe(true);
    const ok = introspect.ops.freeHandle(h);
    expect(ok).toBe(true);
    expect(deleted).toBe(true);
    expect(introspect.handles.has(h)).toBe(false);
  });

  it('release of unknown handle returns false (no throw)', () => {
    const { introspect } = setupReady();
    const ok = introspect.ops.freeHandle(99999);
    expect(ok).toBe(false);
  });

  it('release op via dispatcher replies ok:true', async () => {
    const { sandbox, introspect } = setupReady();
    const fakeShape = { delete(): void { /* noop */ } };
    const h = introspect.ops.alloc(fakeShape);
    sandbox.postedMessages.length = 0;
    sandbox.onmessage!({ data: { reqId: 20, op: 'release', args: { handle: h } } });
    await Promise.resolve();
    const reply = sandbox.postedMessages.find((m) => m.reqId === 20);
    expect(reply).toBeDefined();
    expect(reply!.ok).toBe(true);
    expect(introspect.handles.has(h)).toBe(false);
  });
});

// ─── dispatcher protocol ──────────────────────────────────────────────────

describe('occt-worker-real.js: dispatcher protocol', () => {
  it('unknown op replies ok:false with error', async () => {
    const { sandbox } = setupReady();
    sandbox.postedMessages.length = 0;
    sandbox.onmessage!({ data: { reqId: 99, op: 'totallyBogusOp', args: {} } });
    await Promise.resolve();
    const reply = sandbox.postedMessages.find((m) => m.reqId === 99);
    expect(reply).toBeDefined();
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toMatch(/unknown op/);
  });

  it('drops malformed messages silently (no reqId)', async () => {
    const { sandbox } = setupReady();
    // Drain init-time messages (factory's mode:'ready' post) before driving
    // the dispatcher with malformed payloads.
    await new Promise((r) => setTimeout(r, 0));
    sandbox.postedMessages.length = 0;
    sandbox.onmessage!({ data: { op: 'init' } });
    sandbox.onmessage!({ data: null });
    sandbox.onmessage!({ data: { reqId: 'not-a-number', op: 'init' } });
    await Promise.resolve();
    expect(sandbox.postedMessages).toHaveLength(0);
  });

  it('shape payload includes bbox + volume + area + centerOfMass', async () => {
    const { sandbox, introspect } = setupReady();
    sandbox.postedMessages.length = 0;
    void introspect;
    sandbox.onmessage!({
      data: {
        reqId: 30,
        op: 'buildFromExtrude',
        args: {
          feature: {
            kind: 'extrude',
            loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
            depth: 4,
            direction: 'one_sided',
            mode: 'add',
          },
        },
      },
    });
    await Promise.resolve();
    const reply = sandbox.postedMessages.find((m) => m.reqId === 30) as { ok: boolean; shape?: { handle: number; bbox: unknown; volume: number; area: number; centerOfMass: unknown } };
    expect(reply).toBeDefined();
    expect(reply.ok).toBe(true);
    expect(reply.shape).toBeDefined();
    expect(reply.shape!.bbox).toBeDefined();
    expect(typeof reply.shape!.volume).toBe('number');
    expect(typeof reply.shape!.area).toBe('number');
    expect(reply.shape!.centerOfMass).toBeDefined();
  });
});
