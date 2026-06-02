/**
 * e2e/occt/wasm-real.spec.ts — Phase 5 launch step 11 (Agent — Playwright scaffold).
 *
 * GATE — conditional on NEXYFAB_OCCT_REAL=1
 * -----------------------------------------
 * The whole describe block runs ONLY when `NEXYFAB_OCCT_REAL=1` is set in the
 * Playwright runner env. Default CI runs skip it because:
 *   - The 65 MB WASM blob is not in every deploy yet (Phase 5 launch staged).
 *   - The `dev` webServer doesn't auto-copy `opencascade.wasm` to `public/`.
 *   - Real OCCT instantiation pulls ~200 MB Emscripten heap — wasted CI minutes
 *     when the binary isn't shipped to that branch.
 *
 * The spec also guards a SECOND time at runtime by hitting `/api/occt/diagnostic`
 * — if the route reports `mode != 'wasm'`, the test marks itself skipped with a
 * clear reason rather than hanging on a 4xx WASM fetch.
 *
 * RUN LOCALLY
 * -----------
 *   1. `npm run occt:copy`            # copies opencascade.wasm into public/occt-worker/
 *   2. `npm run dev`                  # starts Next.js on :3000 (Playwright will reuse)
 *   3. `npm run test:e2e:occt`        # or test:occt:smoke for just the unit-box smoke
 *
 * RUN IN CI
 * ---------
 * Set the workflow env `NEXYFAB_OCCT_REAL=1` on the job step that runs e2e.
 * The OCCT WASM is large (65 MB); only enable on the nightly job or on a tag
 * push to keep PR latency bounded.
 *
 * @see scripts/copy-occt.js, src/app/api/occt/diagnostic/route.ts
 * @see src/lib/occt/wasmReal.placeholder.test.ts (vitest-side mirror)
 */

import { test, expect } from '@playwright/test';

/** Env gate — set NEXYFAB_OCCT_REAL=1 to flip the suite on. */
const REAL_OCCT_ENABLED = process.env.NEXYFAB_OCCT_REAL === '1';

test.describe('OCCT real WASM — Phase 5 launch acceptance', () => {
  test.skip(!REAL_OCCT_ENABLED,
    'NEXYFAB_OCCT_REAL=1 required — real OCCT WASM is not on the critical e2e path.');

  // Slow tests: WASM init alone can take 10-30s on cold load. Bump per-test.
  test.setTimeout(120_000);

  test('opencascade.js loads and builds unit box', async ({ page, request }) => {
    // 1) Diagnostic gate. If the server-side check says mode != 'wasm', the
    //    WASM binary isn't shipped here — skip with a clear reason instead of
    //    chasing a 404 in the browser.
    const diag = await request.get('/api/occt/diagnostic');
    expect(diag.status(), 'diagnostic endpoint must respond 200').toBe(200);
    const diagBody = await diag.json() as {
      ok: boolean;
      mode: 'wasm' | 'wasm-stub' | 'stub';
      wasm: { exists: boolean; sizeBytes: number };
    };
    test.skip(diagBody.mode !== 'wasm',
      `diagnostic reports mode=${diagBody.mode}; expected 'wasm'. ` +
      `Run \`npm run occt:copy\` to stage opencascade.wasm into public/occt-worker/.`);
    expect(diagBody.wasm.sizeBytes, 'opencascade.wasm must be ≥ 1 MB').toBeGreaterThan(1_000_000);

    // 2) Navigate to ANY page that serves a same-origin context — landing is
    //    cheapest. We're not exercising UI, just borrowing a browsing context
    //    for `page.evaluate` so the dynamic import resolves through the dev
    //    server (not a `data:` URL, which would fail cross-origin to /occt-worker/).
    await page.goto('/');

    // 3) Boot the OCCT Module() factory inside the page, mirroring the worker
    //    bootstrap in `occt-worker/occt-worker-real.js`. We use a <script>
    //    injection rather than ES import because `opencascade.js` is a UMD/IIFE
    //    that exposes the factory on `self.Module`.
    const bootResult = await page.evaluate(async () => {
      // Pull the loader. It expects `self.Module` to receive the factory.
      const w = window as unknown as { Module?: unknown };
      if (typeof w.Module === 'function') {
        // Already loaded by a prior test in the same page context.
      } else {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = '/occt-worker/opencascade.js';
          s.async = true;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('Failed to load /occt-worker/opencascade.js'));
          document.head.appendChild(s);
        });
      }
      const Module = (window as unknown as { Module?: (cfg: unknown) => Promise<unknown> }).Module;
      if (typeof Module !== 'function') {
        return { ok: false, reason: 'self.Module is not a function after loader script ran' };
      }
      // Race against a 90s wall clock to give a useful error if WASM stalls.
      const occt = await Promise.race([
        Module({ locateFile: (p: string) => `/occt-worker/${p}` }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Module() timed out after 90s')), 90_000)),
      ]) as Record<string, unknown>;
      return {
        ok: true,
        hasMakePolygon: typeof occt.BRepBuilderAPI_MakePolygon_1 === 'function',
        hasMakeFace: typeof occt.BRepBuilderAPI_MakeFace_15 === 'function',
        hasMakePrism: typeof occt.BRepPrimAPI_MakePrism_1 === 'function',
        hasPnt: typeof occt.gp_Pnt_3 === 'function',
        hasVec: typeof occt.gp_Vec_4 === 'function',
      };
    });
    expect(bootResult.ok, `OCCT bootstrap failed: ${'reason' in bootResult ? bootResult.reason : 'n/a'}`).toBe(true);
    expect(bootResult.hasMakePolygon, 'OCCT module missing BRepBuilderAPI_MakePolygon_1').toBe(true);
    expect(bootResult.hasMakeFace, 'OCCT module missing BRepBuilderAPI_MakeFace_15').toBe(true);
    expect(bootResult.hasMakePrism, 'OCCT module missing BRepPrimAPI_MakePrism_1').toBe(true);
    expect(bootResult.hasPnt, 'OCCT module missing gp_Pnt_3').toBe(true);
    expect(bootResult.hasVec, 'OCCT module missing gp_Vec_4').toBe(true);

    // 4) Build a 1×1×10 unit box via the EXACT call path documented in
    //    `wasmReal.buildFromExtrude` so this test catches drift between the
    //    typed wrapper and the worker.
    //
    //    Return shape is unified `{ ok, shapeOk, reason }` so Playwright's
    //    `PageFunction` type-infers a single return type — mixing two object
    //    literals across branches breaks inference.
    const buildResult: { ok: boolean; shapeOk: boolean; reason: string } = await page.evaluate(async () => {
      // Re-resolve Module() — Emscripten caches the compiled WASM in the page
      // so the second call is fast even though we re-instantiate.
      const ModuleFactory = (window as unknown as {
        Module?: (cfg: unknown) => Promise<Record<string, new (...args: unknown[]) => unknown>>;
      }).Module;
      if (typeof ModuleFactory !== 'function') {
        return { ok: false, shapeOk: false, reason: 'Module factory missing' };
      }
      const m = await ModuleFactory({ locateFile: (p: string) => `/occt-worker/${p}` });
      const polygon = new m.BRepBuilderAPI_MakePolygon_1() as { Add_1: (p: unknown) => void; Close: () => void; Wire: () => unknown; delete: () => void };
      const pts = [
        new m.gp_Pnt_3(0, 0, 0) as { delete: () => void },
        new m.gp_Pnt_3(1, 0, 0) as { delete: () => void },
        new m.gp_Pnt_3(1, 1, 0) as { delete: () => void },
        new m.gp_Pnt_3(0, 1, 0) as { delete: () => void },
      ];
      try {
        for (const p of pts) polygon.Add_1(p);
        polygon.Close();
        const wire = polygon.Wire() as { delete: () => void };
        const faceBuilder = new m.BRepBuilderAPI_MakeFace_15(wire, true) as { Face: () => unknown; delete: () => void };
        const face = faceBuilder.Face() as { delete: () => void };
        const vec = new m.gp_Vec_4(0, 0, 10) as { delete: () => void };
        const prismBuilder = new m.BRepPrimAPI_MakePrism_1(face, vec, false, true) as { Shape: () => unknown; delete: () => void };
        const shape = prismBuilder.Shape();
        const shapeOk = shape != null;
        // Best-effort dispose — we don't fail the test on dispose errors,
        // we just want the heap freed before the next test.
        try { prismBuilder.delete(); } catch { /* noop */ }
        try { vec.delete(); } catch { /* noop */ }
        try { face.delete(); } catch { /* noop */ }
        try { faceBuilder.delete(); } catch { /* noop */ }
        try { wire.delete(); } catch { /* noop */ }
        return { ok: true, shapeOk, reason: '' };
      } finally {
        try { polygon.delete(); } catch { /* noop */ }
        for (const p of pts) { try { p.delete(); } catch { /* noop */ } }
      }
    });
    expect(buildResult.ok, `build failed: ${buildResult.reason || 'n/a'}`).toBe(true);
    expect(buildResult.shapeOk, 'Prism Shape() must return non-null handle').toBe(true);
  });

  test('STEP roundtrip via real OCCT', async ({ page, request }) => {
    // Diagnostic gate (same pattern as smoke test above).
    const diag = await request.get('/api/occt/diagnostic');
    const body = await diag.json() as { mode: string };
    test.skip(body.mode !== 'wasm', `mode=${body.mode}; STEP roundtrip requires real OCCT.`);

    await page.goto('/');

    const stepResult: { ok: boolean; hasWriter: boolean; hasReader: boolean; reason: string } = await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        if (typeof (window as unknown as { Module?: unknown }).Module === 'function') {
          resolve();
          return;
        }
        const s = document.createElement('script');
        s.src = '/occt-worker/opencascade.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('loader script failed'));
        document.head.appendChild(s);
      });
      const Factory = (window as unknown as { Module?: (cfg: unknown) => Promise<Record<string, unknown>> }).Module;
      if (typeof Factory !== 'function') {
        return { ok: false, hasWriter: false, hasReader: false, reason: 'no Module factory' };
      }
      const m = await Factory({ locateFile: (p: string) => `/occt-worker/${p}` });
      // Sanity-check that the STEP symbols exist. Real exportSTEP/importSTEP
      // round-trips live in the worker (occt-worker-real.js); this spec only
      // verifies the symbols are bound so the worker can call them.
      const hasWriter = typeof m.STEPControl_Writer_1 === 'function';
      const hasReader = typeof m.STEPControl_Reader_1 === 'function';
      return { ok: true, hasWriter, hasReader, reason: '' };
    });
    expect(stepResult.ok, `STEP probe must succeed: ${stepResult.reason || 'n/a'}`).toBe(true);
    expect(stepResult.hasWriter, 'STEPControl_Writer_1 must be bound').toBe(true);
    expect(stepResult.hasReader, 'STEPControl_Reader_1 must be bound').toBe(true);
  });

  test('cylinder revolve via real OCCT', async ({ page, request }) => {
    const diag = await request.get('/api/occt/diagnostic');
    const body = await diag.json() as { mode: string };
    test.skip(body.mode !== 'wasm', `mode=${body.mode}; cylinder revolve requires real OCCT.`);

    await page.goto('/');

    const cylinderResult: { ok: boolean; shapeOk: boolean; reason: string } = await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        if (typeof (window as unknown as { Module?: unknown }).Module === 'function') {
          resolve();
          return;
        }
        const s = document.createElement('script');
        s.src = '/occt-worker/opencascade.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('loader script failed'));
        document.head.appendChild(s);
      });
      const Factory = (window as unknown as {
        Module?: (cfg: unknown) => Promise<Record<string, new (...args: unknown[]) => { Shape?: () => unknown; delete?: () => void }>>;
      }).Module;
      if (typeof Factory !== 'function') {
        return { ok: false, shapeOk: false, reason: 'no Module factory' };
      }
      const m = await Factory({ locateFile: (p: string) => `/occt-worker/${p}` });
      // BRepPrimAPI_MakeCylinder is the simplest revolve-equivalent.
      if (typeof m.BRepPrimAPI_MakeCylinder_2 !== 'function') {
        return { ok: false, shapeOk: false, reason: 'BRepPrimAPI_MakeCylinder_2 not bound' };
      }
      const cylBuilder = new m.BRepPrimAPI_MakeCylinder_2(5, 10) as unknown as { Shape: () => unknown; delete: () => void };
      try {
        const shape = cylBuilder.Shape();
        return { ok: true, shapeOk: shape != null, reason: '' };
      } finally {
        try { cylBuilder.delete(); } catch { /* noop */ }
      }
    });
    expect(cylinderResult.ok, `cylinder build failed: ${cylinderResult.reason || 'n/a'}`).toBe(true);
    expect(cylinderResult.shapeOk, 'Cylinder Shape() must return non-null handle').toBe(true);
  });
});
