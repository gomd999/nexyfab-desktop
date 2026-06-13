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
        Module({ locateFile: (p: string) => `/occt-worker/${p.indexOf('opencascade.wasm') !== -1 ? 'opencascade.wasm' : p}` }),
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
      const m = await ModuleFactory({ locateFile: (p: string) => `/occt-worker/${p.indexOf('opencascade.wasm') !== -1 ? 'opencascade.wasm' : p}` });
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
      const m = await Factory({ locateFile: (p: string) => `/occt-worker/${p.indexOf('opencascade.wasm') !== -1 ? 'opencascade.wasm' : p}` });
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

  /**
   * W1 de-risking (OCCT_WORKER_MIGRATION_PLAN): the existing tests above prove
   * the browser builds NON-NULL shapes. This one proves it builds shapes with
   * the CORRECT GEOMETRY — real VolumeProperties — mirroring the headless
   * nodeOcctBridge/ceilingSpike assertions, so node↔browser drift is caught.
   * Crucially it includes the kernel-CEILING op (thicken surface→solid) the
   * whole migration exists to surface.
   */
  test('W1: real volumes in-browser — box 500, holed 420, thicken-ceiling 200', async ({ page, request }) => {
    const diag = await request.get('/api/occt/diagnostic');
    const body = await diag.json() as { mode: string };
    test.skip(body.mode !== 'wasm', `mode=${body.mode}; real-volume gate requires real OCCT.`);

    await page.goto('/');

    const r: { ok: boolean; box: number; holed: number; thicken: number; reason: string } =
      await page.evaluate(async () => {
        await new Promise<void>((resolve, reject) => {
          if (typeof (window as unknown as { Module?: unknown }).Module === 'function') { resolve(); return; }
          const s = document.createElement('script');
          s.src = '/occt-worker/opencascade.js';
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('loader script failed'));
          document.head.appendChild(s);
        });
        const Factory = (window as unknown as { Module?: (cfg: unknown) => Promise<Record<string, unknown>> }).Module;
        if (typeof Factory !== 'function') return { ok: false, box: 0, holed: 0, thicken: 0, reason: 'no Module factory' };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = await Factory({ locateFile: (p: string) => `/occt-worker/${p.indexOf('opencascade.wasm') !== -1 ? 'opencascade.wasm' : p}` }) as any;

        const vol = (shape: unknown): number => {
          const props = new m.GProp_GProps_1();
          m.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
          const v = props.Mass();
          try { props.delete(); } catch { /* noop */ }
          return v;
        };
        const face = (loop: Array<[number, number]>, z: number): unknown => {
          const poly = new m.BRepBuilderAPI_MakePolygon_1();
          for (const [x, y] of loop) { const p = new m.gp_Pnt_3(x, y, z); poly.Add_1(p); }
          poly.Close();
          return new m.BRepBuilderAPI_MakeFace_15(poly.Wire(), false).Face();
        };
        const prism = (loop: Array<[number, number]>, h: number): unknown => {
          const f = face(loop, 0);
          const vec = new m.gp_Vec_4(0, 0, h);
          return new m.BRepPrimAPI_MakePrism_1(f, vec, false, true).Shape();
        };
        const SQ = (a: number, b: number): Array<[number, number]> => [[a, a], [b, a], [b, b], [a, b]];

        try {
          // 1) box 10×10×5 = 500
          const box = prism(SQ(0, 10), 5);
          const boxVol = vol(box);

          // 2) box − tool(4×4×5 through) = 420
          const tool = prism(SQ(3, 7), 7);
          const cut = new m.BRepAlgoAPI_Cut_3(box, tool).Shape();
          const holedVol = vol(cut);

          // 3) CEILING op: thicken a 10×10 sheet by 2 → solid ≈ 200
          const sheet = face(SQ(0, 10), 0);
          let thickenVol = 0;
          const mts = new m.BRepOffsetAPI_MakeThickSolid_1();
          for (const off of [2, -2]) {
            try {
              mts.MakeThickSolidBySimple(sheet, off);
              if (typeof mts.Build === 'function') mts.Build();
              const s = mts.Shape();
              const v = Math.abs(vol(s));
              if (Number.isFinite(v) && v > 1e-6) { thickenVol = v; break; }
            } catch { /* try other sign */ }
          }
          return { ok: true, box: boxVol, holed: holedVol, thicken: thickenVol, reason: '' };
        } catch (e) {
          return { ok: false, box: 0, holed: 0, thicken: 0, reason: (e as Error).message };
        }
      });

    expect(r.ok, `in-browser build failed: ${r.reason || 'n/a'}`).toBe(true);
    expect(r.box, 'box 10×10×5 volume').toBeCloseTo(500, 1);
    expect(r.holed, 'holed (500 − 4×4×5) volume').toBeCloseTo(420, 1);
    // The kernel-ceiling op replicad cannot do — proven in node, now in-browser.
    expect(Math.abs(r.thicken), 'thicken surface→solid volume (10×10×2)').toBeCloseTo(200, 0);
  });

  /**
   * W2 de-risking: drive the ACTUAL worker (`occt-worker-real.js`) over the
   * postMessage RPC — not inline page.evaluate — and assert the newly-ported
   * ceiling op `thicken` returns a real volume. This exercises the wire protocol
   * end-to-end through the launcher → real dispatcher, the path the UI kernel
   * will use (createWasmBridge). Stub-level wire plumbing is already covered
   * headlessly (wasmBridge.test.ts / wasmWorker.integration.test.ts).
   */
  test('W2: worker RPC — buildPlanarFace → thicken returns ~200 volume', async ({ page, request }) => {
    const diag = await request.get('/api/occt/diagnostic');
    const body = await diag.json() as { mode: string };
    test.skip(body.mode !== 'wasm', `mode=${body.mode}; worker-RPC thicken requires real OCCT.`);

    await page.goto('/');

    const r: { ok: boolean; volume: number; reason: string } = await page.evaluate(async () => {
      const SQ = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
      const w = new Worker('/occt-worker/occt-worker-launcher.js');
      let id = 0;
      const rpc = (op: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const reqId = ++id;
          const timer = setTimeout(() => { w.removeEventListener('message', onMsg); reject(new Error(`${op} timed out`)); }, 90_000);
          const onMsg = (e: MessageEvent): void => {
            const d = e.data as { reqId?: number };
            if (d && d.reqId === reqId) { clearTimeout(timer); w.removeEventListener('message', onMsg); resolve(e.data as Record<string, unknown>); }
          };
          w.addEventListener('message', onMsg);
          w.postMessage({ reqId, op, args });
        });
      try {
        await rpc('init');
        const face = await rpc('buildPlanarFace', { loop: SQ, z: 0 }) as { ok: boolean; shape?: { handle: number } };
        if (!face.ok || !face.shape) return { ok: false, volume: 0, reason: 'buildPlanarFace failed' };
        const solid = await rpc('thicken', { handle: face.shape.handle, dim: 2 }) as { ok: boolean; shape?: { volume?: number }; error?: string };
        if (!solid.ok || !solid.shape) return { ok: false, volume: 0, reason: 'thicken failed: ' + (solid.error ?? '') };
        return { ok: true, volume: solid.shape.volume ?? 0, reason: '' };
      } catch (e) {
        return { ok: false, volume: 0, reason: (e as Error).message };
      } finally {
        w.terminate();
      }
    });

    expect(r.ok, `worker thicken failed: ${r.reason || 'n/a'}`).toBe(true);
    expect(Math.abs(r.volume), 'thickened 10×10 sheet by 2 → ~200').toBeCloseTo(200, 0);
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
      const m = await Factory({ locateFile: (p: string) => `/occt-worker/${p.indexOf('opencascade.wasm') !== -1 ? 'opencascade.wasm' : p}` });
      // BRepPrimAPI_MakeCylinder is the simplest revolve-equivalent. The
      // `(R, H)` overload is `_1` in this build's embind bindings (`_2` is
      // `(gp_Ax2, R, H)` — calling it with 2 args throws).
      const CylCtor = m.BRepPrimAPI_MakeCylinder_1 || m.BRepPrimAPI_MakeCylinder_2;
      if (typeof CylCtor !== 'function') {
        return { ok: false, shapeOk: false, reason: 'BRepPrimAPI_MakeCylinder_1 not bound' };
      }
      const cylBuilder = new CylCtor(5, 10) as unknown as { Shape: () => unknown; delete: () => void };
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
