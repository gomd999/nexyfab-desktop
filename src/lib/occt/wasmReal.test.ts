/**
 * occt/wasmReal — Phase 5 spike tests.
 *
 * These tests exercise the `wasmReal.ts` wrapper using the mock module from
 * `_vendor/opencascade.stub.ts`. They do NOT instantiate the real ~65 MB WASM
 * (that's `wasmReal.placeholder.test.ts` — skip-marked until launch day).
 *
 * COVERAGE
 * --------
 *  - mock module loading via `loadOcctModule({ forceStub: true })`
 *  - loaderOverride seam — both success + failure paths
 *  - `buildFromExtrude` happy path on the stub
 *  - dispose discipline (allocs == disposes after build)
 *  - input validation (loop too short, depth NaN, ...)
 *  - bridge `wasm-stub` mode integration (detectOcctMode reports it,
 *    bridge.buildFromExtrude → wire stub fallback still works)
 *  - readiness-check script recognises `wasm-stub` as a non-blocking state
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildFromExtrude, buildUnitBox, loadOcctModule } from './wasmReal';
import {
  createStubOpenCascadeModule,
  type StubOpenCascadeModule,
} from './_vendor/opencascade.stub';
import {
  detectOcctMode,
  resetOcctModeCache,
  setOcctPackagePresenceOverride,
} from './runtimeMode';
import { createWasmBridge } from './wasmBridge';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

function rectExtrude(depth = 7): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

// ─── mock module loading ──────────────────────────────────────────────────

describe('wasmReal — loadOcctModule', () => {
  it('forceStub=true short-circuits to the stub regardless of real package', async () => {
    const loaded = await loadOcctModule({ forceStub: true });
    expect(loaded.kind).toBe('stub');
    expect(loaded.reason).toBe('forceStub=true');
    expect(loaded.module.__tracker__).toBeDefined();
  });

  it('falls back to stub when loaderOverride returns undefined', async () => {
    const loaded = await loadOcctModule({ loaderOverride: async () => undefined });
    expect(loaded.kind).toBe('stub');
    expect(loaded.reason).toContain('initOpenCascade not exported');
  });

  it('falls back to stub when loaderOverride throws', async () => {
    const loaded = await loadOcctModule({
      loaderOverride: async () => { throw new Error('package missing'); },
    });
    expect(loaded.kind).toBe('stub');
    expect(loaded.reason).toContain('package missing');
  });

  it('honours a real-shaped loaderOverride (kind=real)', async () => {
    const fake = createStubOpenCascadeModule();
    const loaded = await loadOcctModule({
      loaderOverride: async () => ({
        initOpenCascade: async () => fake,
      }),
    });
    expect(loaded.kind).toBe('real');
    expect(loaded.module).toBe(fake);
  });

  it('bounds init time via timeoutMs (loader hang → stub fallback)', async () => {
    const loaded = await loadOcctModule({
      timeoutMs: 50,
      loaderOverride: () => new Promise(() => { /* never resolves */ }),
    });
    expect(loaded.kind).toBe('stub');
    expect(loaded.reason).toMatch(/timed out|load failed/);
  });

  it('falls back to stub when initOpenCascade returns non-object', async () => {
    const loaded = await loadOcctModule({
      loaderOverride: async () => ({
        initOpenCascade: async () => null,
      }),
    });
    expect(loaded.kind).toBe('stub');
    expect(loaded.reason).toContain('non-object');
  });
});

// ─── buildFromExtrude ─────────────────────────────────────────────────────

describe('wasmReal — buildFromExtrude on stub module', () => {
  let occt: StubOpenCascadeModule;

  beforeEach(() => {
    occt = createStubOpenCascadeModule();
  });

  it('builds a prism shape from a rectangular loop', () => {
    const res = buildFromExtrude(occt, rectExtrude(7));
    expect(res.ok).toBe(true);
    expect(res.shape).toBeDefined();
    expect(res.shape?.tag).toBe('prism');
    expect(res.shape?.volume).toBe(7);
  });

  it('disposes every temp Embind object (allocs == disposes after build)', () => {
    buildFromExtrude(occt, rectExtrude(3));
    // The result shape itself is NOT in the dispose count — it's the caller's
    // job to release it. Everything else (polygon, points, wire, face,
    // faceBuilder, vec, prismBuilder) must be paired.
    // 4 points + 1 polygon + 1 wire + 1 faceBuilder + 1 face + 1 vec + 1 prismBuilder = 10
    expect(occt.__tracker__.allocs).toBe(10);
    expect(occt.__tracker__.disposes).toBe(10);
    expect(occt.__tracker__.liveSymbols.size).toBe(0);
  });

  it('rejects loops with fewer than 3 points', () => {
    const bad: ExtrudeFeature = {
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      depth: 1,
      direction: 'one_sided',
      mode: 'add',
    };
    const res = buildFromExtrude(occt, bad);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('loop must have >=3 points');
    // Validation runs BEFORE we touch the heap — no allocations.
    expect(occt.__tracker__.allocs).toBe(0);
  });

  it('rejects zero / non-finite depths', () => {
    const r1 = buildFromExtrude(occt, { ...rectExtrude(0) });
    expect(r1.ok).toBe(false);
    expect(r1.error).toContain('depth');

    const r2 = buildFromExtrude(occt, { ...rectExtrude(Number.NaN) });
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain('depth');
  });

  it('buildUnitBox returns volume == depth (1×1×depth synthesised bbox)', () => {
    const res = buildUnitBox(occt, 5);
    expect(res.ok).toBe(true);
    expect(res.shape?.volume).toBe(5);
    expect(res.shape?.bbox.max.z).toBe(5);
  });

  it('successive builds reuse the same module without leaking handles', () => {
    buildFromExtrude(occt, rectExtrude(1));
    buildFromExtrude(occt, rectExtrude(2));
    buildFromExtrude(occt, rectExtrude(3));
    // Three builds × 10 temp objects each.
    expect(occt.__tracker__.allocs).toBe(30);
    expect(occt.__tracker__.disposes).toBe(30);
  });
});

// ─── runtimeMode integration ──────────────────────────────────────────────

describe('runtimeMode — wasm-stub recognition', () => {
  beforeEach(() => {
    resetOcctModeCache();
  });
  afterEach(() => {
    resetOcctModeCache();
    setOcctPackagePresenceOverride(null);
  });

  it('reports "wasm-stub" when opencascade.js is installed in node_modules (no DOM)', async () => {
    setOcctPackagePresenceOverride(true);
    const mode = await detectOcctMode();
    expect(mode).toBe('wasm-stub');
  });

  it('reports "stub" when override forces no-package even with WASM file absent', async () => {
    setOcctPackagePresenceOverride(false);
    const mode = await detectOcctMode();
    expect(mode).toBe('stub');
  });
});

// ─── bridge wasm-stub mode integration ────────────────────────────────────

describe('createWasmBridge — wasm-stub fallback path', () => {
  it('falls through to the in-process stub bridge when no Worker global exists', async () => {
    // No real WASM, no real Worker — bridge must still build a shape via the
    // wasm-stub fallback (`createWasmWorkerStub` → `createStubBridge`).
    const bridge = createWasmBridge();
    try {
      const res = await bridge.buildFromExtrude(rectExtrude(4));
      expect(res.ok).toBe(true);
      expect(res.shape?.id).toMatch(/^occt_/);
      // Stub bridge synthesises bbox from loop × depth.
      expect(res.shape?.bbox?.max.z).toBe(4);
    } finally {
      bridge.dispose();
    }
  });

  it('exports STEP through the wasm-stub path', async () => {
    const bridge = createWasmBridge();
    try {
      const built = await bridge.buildFromExtrude(rectExtrude(2));
      expect(built.ok).toBe(true);
      const step = await bridge.exportSTEP(built.shape!);
      expect(typeof step).toBe('string');
      expect(step.length).toBeGreaterThan(0);
    } finally {
      bridge.dispose();
    }
  });
});

// ─── readiness check awareness ────────────────────────────────────────────

describe('check-occt-readiness — wasm-stub mode awareness', () => {
  it('treats missing WASM blob as auto→stub mode (which encompasses wasm-stub on dev)', async () => {
    // The script doesn't know about node_modules — it only looks at
    // `public/occt-worker/opencascade.wasm`. A dev machine with the package
    // installed but the blob NOT copied to public/ should be 'stub' from
    // the script's view, and 'wasm-stub' from runtimeMode's view. That's
    // the correct decoupling — script is about deployment, runtimeMode is
    // about what's loadable in-process.
    const { checkOcctReadiness } = await import('../../../scripts/check-occt-readiness.js') as {
      checkOcctReadiness: (opts: {
        mode: 'auto' | 'wasm' | 'stub';
        root?: string;
        fs?: { existsSync: (p: string) => boolean; statSync: (p: string) => { size: number } };
      }) => { mode: 'stub' | 'wasm'; warnings: string[]; errors: string[] };
    };
    const fakeFs = {
      existsSync: (p: string) => p.endsWith('occt-worker.js'),
      statSync: (_p: string) => ({ size: 0 }),
    };
    const result = checkOcctReadiness({ mode: 'auto', root: '/x', fs: fakeFs });
    expect(result.mode).toBe('stub');
    expect(result.errors).toHaveLength(0);
  });
});
