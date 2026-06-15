/**
 * wave1CompatMatrixGated.test.ts — OCCT WASM-gated half of the Wave 1
 * 20-fixture matrix.
 *
 * Activates the 7 fixtures that need OCCT WASM (F11-F15 fillet/chamfer,
 * F18 revolve, F20 circular-pattern) by calling each fixture's
 * `gatedBuild()` after a one-time `ensureOcctReady()`. Volume drift is
 * measured against:
 *   - the analytic `predictedVolumeMm3` when provided, OR
 *   - the OCCT B-rep exact volume via replicad's `measureVolume()` when
 *     predicted is null (the fillet/chamfer "every edge of cube" cases
 *     where the closed-form is too noisy to be a useful gate).
 *
 * Skipped unless `RUN_OCCT_FEASIBILITY=1` (matches the sibling guarded
 * tests: `occtEngine.extrude.test.ts`, `pipeline.occt.*.test.ts`). The
 * default-CI gate (`wave1CompatMatrix.test.ts`) keeps skipping these
 * fixtures via their `wasmGated: true` flag.
 *
 * Run:
 *   RUN_OCCT_FEASIBILITY=1 npx vitest run src/test/m1/wave1CompatMatrixGated.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  WAVE_1_FIXTURES,
  geometryVolumeMm3,
} from './wave1CompatFixtures';
import {
  ensureOcctReady,
  getShape,
  resetShapeRegistry,
} from '@/app/[lang]/shape-generator/features/occtEngine';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1' || process.env.RUN_OCCT_FEASIBILITY === 'true';
const describeMaybe = ENABLED ? describe : describe.skip;

/** Resolve a registered OCCT handle to its exact B-rep volume via
 *  replicad's `measureVolume()`. Returns null when the handle has no
 *  shape (build failed) or the `measureVolume` symbol is unavailable. */
async function brepVolumeMm3(handle: string | null): Promise<number | null> {
  if (!handle) return null;
  const shape = getShape(handle);
  if (!shape) return null;
  try {
    const replicad = (await import('replicad')) as unknown as {
      measureVolume?: (s: unknown) => number;
    };
    if (typeof replicad.measureVolume !== 'function') return null;
    const v = replicad.measureVolume(shape);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

describeMaybe('Wave 1 compat matrix — OCCT WASM-gated fixture gate', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 60_000);

  const gated = WAVE_1_FIXTURES.filter((f) => f.wasmGated && typeof f.gatedBuild === 'function');

  it('all WASM-gated fixtures expose a gatedBuild (no orphan stubs)', () => {
    const gatedAll = WAVE_1_FIXTURES.filter((f) => f.wasmGated);
    // Currently all 7 WASM-gated fixtures (F11-F15, F18, F20) have a builder.
    // If a future fixture lands wasmGated WITHOUT a builder it'll show up
    // here so we don't silently lose coverage.
    const missing = gatedAll.filter((f) => typeof f.gatedBuild !== 'function');
    expect(
      missing.map((f) => f.id),
      `gated fixtures missing gatedBuild: ${missing.map((f) => f.id).join(', ')}`,
    ).toEqual([]);
    expect(gated.length).toBe(7);
  });

  for (const f of gated) {
    it(`${f.id} ${f.name} — gated build produces a non-empty mesh`, () => {
      resetShapeRegistry();
      const { geometry } = f.gatedBuild!();
      const pos = geometry.getAttribute('position');
      expect(pos, `${f.id}: gatedBuild returned no position attribute`).toBeTruthy();
      expect(pos!.count, `${f.id}: gatedBuild mesh has zero vertices`).toBeGreaterThan(0);
    });

    it(`${f.id} ${f.name} — mesh volume matches OCCT/predicted within ±${f.tolerancePct}%`, async () => {
      resetShapeRegistry();
      const { geometry, handle } = f.gatedBuild!();
      const meshVol = geometryVolumeMm3(geometry);

      // Prefer the analytic predicted volume when given; otherwise fall
      // back to the OCCT B-rep exact volume so we still have a regression
      // check on the cases where the closed-form would be noisy.
      let expected = f.predictedVolumeMm3;
      let source: 'predicted' | 'brep' = 'predicted';
      if (expected === null) {
        expected = await brepVolumeMm3(handle);
        source = 'brep';
        expect(
          expected,
          `${f.id}: no predictedVolumeMm3 and OCCT brepVolume unavailable (handle=${handle})`,
        ).not.toBeNull();
      }

      const driftPct = (Math.abs(meshVol - expected!) / expected!) * 100;
      expect(
        driftPct,
        `${f.id} ${f.name}: source=${source} expected=${expected!.toFixed(1)}mm³ `
        + `mesh=${meshVol.toFixed(1)}mm³ drift=${driftPct.toFixed(2)}%`,
      ).toBeLessThanOrEqual(f.tolerancePct);
    });
  }
});
