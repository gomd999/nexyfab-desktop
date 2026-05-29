/**
 * wave1CompatMatrix.test.ts — Wave 1 GA 20-fixture code-side gate.
 *
 * Auto-runs the buildable fixtures (F01-F10 + F16/F17/F19) and asserts
 * each computed volume matches the predicted volume within its
 * documented tolerance. This is the **code-side** gate from
 * `docs/wave-1-compat-matrix.md` — the human viewer matrix
 * (5 viewers × 20 fixtures) is still a manual walkthrough per the
 * doc's §4.
 *
 * WASM-gated fixtures (F11-F15 fillet/chamfer + F18 revolve + F20
 * circular-pattern) skip with their `deferNote`.
 *
 * Pass criterion (matches spec doc §0): ≥ 70/100 cells. This file
 * covers the 13 buildable cells × 1 (our code) = 13 cells. Viewer
 * matrix covers the other 87.
 */

import { describe, it, expect } from 'vitest';
import {
  WAVE_1_FIXTURES,
  geometryVolumeMm3,
} from './wave1CompatFixtures';

describe('Wave 1 compat matrix — code-side fixture gate', () => {
  const buildable = WAVE_1_FIXTURES.filter((f) => !f.wasmGated);
  const wasmGated = WAVE_1_FIXTURES.filter((f) => f.wasmGated);

  it('catalog has exactly 20 fixtures (matches docs/wave-1-compat-matrix.md §2)', () => {
    expect(WAVE_1_FIXTURES.length).toBe(20);
  });

  it('every fixture has a unique id (F01..F20)', () => {
    const ids = WAVE_1_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(20);
    for (const id of ids) {
      expect(id).toMatch(/^F\d{2}$/);
    }
  });

  it('at least 13/20 fixtures are buildable in the default test env', () => {
    expect(buildable.length).toBeGreaterThanOrEqual(13);
  });

  it('WASM-gated fixtures all have a deferNote (no silent skips)', () => {
    for (const f of wasmGated) {
      expect(f.deferNote).toBeTruthy();
      expect(f.build()).toBeNull();
    }
  });

  // ─── Per-fixture volume assertion ───────────────────────────────────────
  for (const f of WAVE_1_FIXTURES) {
    if (f.wasmGated) {
      it.skip(`${f.id} ${f.name} — ${f.deferNote}`, () => { /* gated */ });
      continue;
    }
    if (f.predictedVolumeMm3 === null) {
      it.skip(`${f.id} ${f.name} — predicted volume TBD (in-app measurement)`, () => { /* TBD */ });
      continue;
    }

    it(`${f.id} ${f.name} — computed volume within ±${f.tolerancePct}% of predicted`, () => {
      const geo = f.build();
      expect(geo, `${f.id} build() returned null in non-WASM env`).not.toBeNull();
      const v = geometryVolumeMm3(geo!);
      const expected = f.predictedVolumeMm3!;
      const driftPct = (Math.abs(v - expected) / expected) * 100;
      expect(
        driftPct,
        `${f.id} ${f.name}: predicted=${expected.toFixed(1)}mm³ computed=${v.toFixed(1)}mm³ drift=${driftPct.toFixed(2)}%`,
      ).toBeLessThanOrEqual(f.tolerancePct);
    });
  }
});
