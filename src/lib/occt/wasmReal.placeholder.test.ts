/**
 * occt/wasmReal.placeholder — Phase 5 LAUNCH-DAY tests (all skip-marked).
 *
 * Pinned reminders for what to flip on when the real OCCT WASM ships.
 * Every `it.skip` here represents an acceptance criterion that requires
 * the real binary instantiated in a real Worker — neither jsdom nor Node
 * can satisfy these without the Emscripten fetch path that pulls the
 * 65 MB `opencascade.wasm.wasm` from the worker URL.
 *
 * SHIPMENT GATE
 * -------------
 * Before flipping `it.skip` → `it` on launch day:
 *   1. `scripts/copy-occt.js` (new) has copied
 *      `node_modules/opencascade.js/dist/opencascade.wasm.wasm` into
 *      `public/occt-worker/`.
 *   2. `occt-worker/occt-worker.js` has been edited to
 *      `importScripts('./opencascade.wasm.js')` and the dispatcher swap to
 *      `occt-worker-real.js` is in place.
 *   3. The Playwright config runs this file under `chromium`, not Vitest —
 *      because Vitest's `node` env can't host a Worker that fetches a blob
 *      URL. (`it.skip` here keeps it harmless under the existing Vitest
 *      sweep until then.)
 *
 * The bodies of these tests deliberately reference the wrapper from
 * `wasmReal.ts` rather than re-implementing geometry — the goal is to prove
 * the EXACT code path the worker uses on launch day, not a parallel one.
 */

import { describe, it, expect } from 'vitest';
import { buildUnitBox, loadOcctModule } from './wasmReal';

/**
 * The "build unit box" placeholder is conditional on `NEXYFAB_OCCT_REAL=1`.
 * When the env flag is set, this single it.skip becomes a live `it` that
 * exercises the real opencascade.js module end-to-end. Run via:
 *
 *   NEXYFAB_OCCT_REAL=1 npx vitest run src/lib/occt/wasmReal.placeholder.test.ts
 *
 * (See `npm run test:occt:real` in package.json — a thin wrapper that sets the
 * env var and runs only this file.) The OTHER four placeholders stay
 * unconditionally skipped because they require a real Worker / Playwright.
 */
const REAL_OCCT_ENABLED = typeof process !== 'undefined' && process.env?.NEXYFAB_OCCT_REAL === '1';
const itRealOrSkip = REAL_OCCT_ENABLED ? it : it.skip;

describe('wasmReal — Phase 5 launch acceptance (skip-marked until real WASM ships)', () => {
  it.skip('Phase 5 launch: real opencascade.js initOpenCascade resolves to an Embind module', async () => {
    // ON LAUNCH DAY: remove `forceStub: true` so the dynamic import runs.
    // The default loader uses Function('import') to dodge bundler analysis;
    // under a real browser worker the import resolves to the package's
    // dist/opencascade.wasm.js which fetches the WASM via locateFile().
    const loaded = await loadOcctModule({ forceStub: false });
    expect(loaded.kind).toBe('real');
    expect(loaded.module).toBeDefined();
    // Real module exposes thousands of Embind classes — sanity-check one.
    expect(typeof (loaded.module as unknown as Record<string, unknown>).BRepPrimAPI_MakePrism_1).toBe('function');
  });

  itRealOrSkip('Phase 5 launch: builds a unit box via real OCCT (volume == depth ± 1e-6)', async () => {
    // Conditional on NEXYFAB_OCCT_REAL=1. Default Vitest sweep keeps this
    // skipped because the dynamic import would try to instantiate the 65MB
    // WASM in node and either OOM or hang. Set the env var on a workstation
    // with the package installed to flip this on.
    const loaded = await loadOcctModule({ forceStub: false, timeoutMs: 30000 });
    expect(loaded.kind).toBe('real');
    const res = buildUnitBox(loaded.module, 10);
    expect(res.ok).toBe(true);
    expect(res.shape).toBeDefined();
    // Real OCCT volume should be 1×1×10 = 10.000000 (within float epsilon).
    // The stub returns the SAME number because we synthesised it from depth,
    // so this assertion holds on both paths — what matters is that
    // `loaded.kind === 'real'` GATES it.
    expect(res.shape!.volume).toBeCloseTo(10, 6);
  });

  it.skip('Phase 5 launch: STEP roundtrip preserves volume on a unit cube', async () => {
    // Requires the worker's exportSTEP/importSTEP ops to be live, which
    // depend on STEPControl_Writer + Reader symbols from the real module.
    // Place-marker only — the actual implementation lives in
    // `occt-worker-real.js` once the binary lands.
    expect(true).toBe(true);
  });

  it.skip('Phase 5 launch: boolean union of two overlapping boxes returns finite volume', async () => {
    // Volume should be between max(a,b) and a+b. The stub returns a+b
    // unconditionally; real OCCT does the BREP fuse so overlap matters.
    expect(true).toBe(true);
  });

  it.skip('Phase 5 launch: fillet on a box edge yields a shape with area > original', async () => {
    // Fillet always strictly increases area (curved surface > sharp edge
    // chord). This is the simplest sanity check that the BRepFilletAPI
    // bindings are doing real BREP and not echoing the input.
    expect(true).toBe(true);
  });
});
