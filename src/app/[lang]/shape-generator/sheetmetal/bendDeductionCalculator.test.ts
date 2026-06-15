import { describe, it, expect } from 'vitest';
import {
  computeBend,
  computeFlatLength,
  estimateAirBendRadius,
  compensateForSpringback,
  summarize,
  K_FACTOR_TABLE,
  SPRINGBACK_DEG,
  BEND_TYPE_K_MULTIPLIER,
  checkMinBendRadius,
  minBendRadiusMm,
  type MaterialName,
} from './bendDeductionCalculator';
import {
  getKFactor,
  type SheetMetalMaterial,
} from '../features/sheetMetalTables';
import { aliasSheetMetalMaterialId } from '@/lib/migrations/sheetMetalMaterialId';

describe('K_FACTOR_TABLE', () => {
  it('mild steel ≈ 0.44', () => {
    expect(K_FACTOR_TABLE['mild-steel']).toBeCloseTo(0.44, 3);
  });
});

describe('computeBend', () => {
  it('90° bend OSSB = R + t', () => {
    const r = computeBend({ insideRadiusMm: 2, thicknessMm: 1, angleDeg: 90, kFactorOverride: 0.44 });
    expect(r.outsideSetbackMm).toBeCloseTo(3, 3); // (2+1)·tan(45) = 3
  });

  it('45° bend OSSB smaller than 90°', () => {
    const r90 = computeBend({ insideRadiusMm: 2, thicknessMm: 1, angleDeg: 90 });
    const r45 = computeBend({ insideRadiusMm: 2, thicknessMm: 1, angleDeg: 45 });
    expect(r45.outsideSetbackMm).toBeLessThan(r90.outsideSetbackMm);
  });

  it('bend allowance = α·(R + K·t)', () => {
    const r = computeBend({ insideRadiusMm: 2, thicknessMm: 1, angleDeg: 90, kFactorOverride: 0.5 });
    const expected = (Math.PI / 2) * (2 + 0.5 * 1);
    expect(r.bendAllowanceMm).toBeCloseTo(expected, 5);
  });

  it('bend deduction = 2·OSSB − BA', () => {
    const r = computeBend({ insideRadiusMm: 2, thicknessMm: 1, angleDeg: 90, kFactorOverride: 0.5 });
    expect(r.bendDeductionMm).toBeCloseTo(2 * r.outsideSetbackMm - r.bendAllowanceMm, 5);
  });

  it('K-factor lookup by material', () => {
    const r = computeBend({ insideRadiusMm: 2, thicknessMm: 1, angleDeg: 90, material: 'mild-steel' });
    expect(r.kFactor).toBe(0.44);
  });

  it('K-factor adjusted for r/t < 1', () => {
    const r = computeBend({ insideRadiusMm: 0.5, thicknessMm: 1, angleDeg: 90, material: 'mild-steel' });
    expect(r.kFactor).toBeLessThan(0.44);
  });

  it('K-factor adjusted for r/t > 3', () => {
    const r = computeBend({ insideRadiusMm: 5, thicknessMm: 1, angleDeg: 90, material: 'mild-steel' });
    expect(r.kFactor).toBeGreaterThan(0.44);
  });

  it('r/t ratio reported', () => {
    const r = computeBend({ insideRadiusMm: 3, thicknessMm: 1.5, angleDeg: 90 });
    expect(r.rTRatio).toBeCloseTo(2, 5);
  });

  it('kFactorOverride respected', () => {
    const r = computeBend({ insideRadiusMm: 1, thicknessMm: 1, angleDeg: 90, material: 'mild-steel', kFactorOverride: 0.45 });
    expect(r.kFactor).toBe(0.45);
  });
});

describe('computeFlatLength', () => {
  it('single segment no bend → length unchanged', () => {
    const flat = computeFlatLength([{ segmentLengthMm: 50 }]);
    expect(flat).toBe(50);
  });

  it('two segments with one bend → subtracts BD', () => {
    const flat = computeFlatLength([
      { segmentLengthMm: 50, bend: { insideRadiusMm: 2, thicknessMm: 1, angleDeg: 90, kFactorOverride: 0.44 } },
      { segmentLengthMm: 50 },
    ]);
    expect(flat).toBeLessThan(100);
  });

  it('larger angle subtracts more', () => {
    const a = computeFlatLength([
      { segmentLengthMm: 50, bend: { insideRadiusMm: 2, thicknessMm: 1, angleDeg: 45 } },
      { segmentLengthMm: 50 },
    ]);
    const b = computeFlatLength([
      { segmentLengthMm: 50, bend: { insideRadiusMm: 2, thicknessMm: 1, angleDeg: 90 } },
      { segmentLengthMm: 50 },
    ]);
    expect(b).toBeLessThan(a);
  });
});

describe('estimateAirBendRadius', () => {
  it('steel ≈ 0.16·V', () => {
    expect(estimateAirBendRadius(10, 'mild-steel')).toBeCloseTo(1.6, 3);
  });

  it('aluminum ≈ 0.20·V', () => {
    expect(estimateAirBendRadius(10, 'aluminum-6061')).toBeCloseTo(2.0, 3);
  });
});

describe('compensateForSpringback', () => {
  it('adds springback to target', () => {
    expect(compensateForSpringback(90, 'mild-steel')).toBeCloseTo(91.5, 3);
  });

  it('stainless requires more compensation than mild', () => {
    const stainless = compensateForSpringback(90, 'stainless-304');
    const mild = compensateForSpringback(90, 'mild-steel');
    expect(stainless).toBeGreaterThan(mild);
  });
});

describe('SPRINGBACK_DEG', () => {
  it('stainless > aluminum', () => {
    expect(SPRINGBACK_DEG['stainless-304']).toBeGreaterThan(SPRINGBACK_DEG['aluminum-5052']);
  });
});

describe('summarize', () => {
  it('reports BD/BA/K/rt', () => {
    const r = computeBend({ insideRadiusMm: 2, thicknessMm: 1, angleDeg: 90 });
    const s = summarize(r);
    expect(s.bendDeductionMm).toBe(r.bendDeductionMm);
    expect(s.kFactor).toBe(r.kFactor);
  });
});

// ─── K-factor drift regression (Phase 2 Track B Week 1) ─────────────────────
//
// Before consolidation this module owned its own K-table that drifted up to
// 0.07 from Schema A at R/T = 1.0, blowing the ±0.1mm unfold tolerance on a
// 5-bend hat section. After consolidation, `computeBend` delegates to
// `getKFactor` (Schema A canonical) via the material id alias. These tests
// pin that delegation: K from `computeBend` must equal K from a direct
// Schema A call to within 1e-9 across the full R/T grid.

describe('K-factor drift — Schema C → Schema A delegation', () => {
  const schemaCToA: Array<[MaterialName, SheetMetalMaterial]> = [
    ['mild-steel', 'mildSteel'],
    ['stainless-304', 'stainless304'],
    ['aluminum-5052', 'aluminum5052'],
    ['aluminum-6061', 'aluminum6061'],
    ['copper', 'copper'],
    ['brass', 'brass'],
  ];
  const rtSamples = [0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 10.0];

  for (const [schemaC, schemaA] of schemaCToA) {
    it(`alias resolves ${schemaC} → ${schemaA}`, () => {
      expect(aliasSheetMetalMaterialId(schemaC)).toBe(schemaA);
    });

    it(`computeBend(${schemaC}) K === getKFactor(${schemaA}) across R/T grid (drift < 1e-9)`, () => {
      for (const rt of rtSamples) {
        const thicknessMm = 1.0;
        const insideRadiusMm = rt * thicknessMm;
        const viaComputeBend = computeBend({
          insideRadiusMm,
          thicknessMm,
          angleDeg: 90,
          material: schemaC,
        }).kFactor;
        const viaSchemaA = getKFactor(schemaA, insideRadiusMm, thicknessMm);
        expect(Math.abs(viaComputeBend - viaSchemaA)).toBeLessThan(1e-9);
      }
    });
  }

  it('K_FACTOR_TABLE display snapshot agrees with Schema A at R/T = 2.0', () => {
    for (const [schemaC, schemaA] of schemaCToA) {
      const snapshot = K_FACTOR_TABLE[schemaC];
      const canonical = getKFactor(schemaA, 2, 1);
      expect(Math.abs(snapshot - canonical)).toBeLessThan(1e-9);
    }
  });
});

describe('minimum bend radius DFM check', () => {
  it('mild steel: R_min = 1.0·t — flags a too-tight radius, passes an adequate one', () => {
    expect(minBendRadiusMm('mild-steel', 2)).toBeCloseTo(2, 6);
    const tight = checkMinBendRadius(1, 2, 'mild-steel'); // R=1 < R_min=2
    expect(tight.ok).toBe(false);
    expect(tight.marginMm).toBeCloseTo(-1, 6);
    const ok = checkMinBendRadius(3, 2, 'mild-steel'); // R=3 > R_min=2
    expect(ok.ok).toBe(true);
    expect(ok.marginMm).toBeCloseTo(1, 6);
  });

  it('exactly at R_min passes (margin 0)', () => {
    const r = checkMinBendRadius(2, 2, 'mild-steel');
    expect(r.ok).toBe(true);
    expect(r.marginMm).toBeCloseTo(0, 9);
  });

  it('stainless needs a larger radius (1.5·t); brass bends tighter (0.5·t)', () => {
    expect(minBendRadiusMm('stainless-304', 2)).toBeCloseTo(3, 6);
    expect(minBendRadiusMm('brass', 2)).toBeCloseTo(1, 6);
    // a radius fine for brass can be too tight for stainless at the same t.
    expect(checkMinBendRadius(1.2, 2, 'brass').ok).toBe(true);
    expect(checkMinBendRadius(1.2, 2, 'stainless-304').ok).toBe(false);
  });
});

describe('bend-type K-factor correction (coining / bottom-bend)', () => {
  const base = { insideRadiusMm: 2, thicknessMm: 1, angleDeg: 90, material: 'mild-steel' as MaterialName };

  it('air-bend is the unchanged baseline (== no bendType)', () => {
    const air = computeBend({ ...base, bendType: 'air-bend' });
    const def = computeBend(base);
    expect(air.kFactor).toBeCloseTo(def.kFactor, 12);
    expect(air.bendDeductionMm).toBeCloseTo(def.bendDeductionMm, 12);
  });

  it('coining lowers K below bottom-bend below air-bend', () => {
    const air = computeBend({ ...base, bendType: 'air-bend' }).kFactor;
    const bottom = computeBend({ ...base, bendType: 'bottom-bend' }).kFactor;
    const coined = computeBend({ ...base, bendType: 'coined' }).kFactor;
    expect(coined).toBeLessThan(bottom);
    expect(bottom).toBeLessThan(air);
    // exact multipliers off the baseline
    expect(coined).toBeCloseTo(air * BEND_TYPE_K_MULTIPLIER.coined, 12);
    expect(bottom).toBeCloseTo(air * BEND_TYPE_K_MULTIPLIER['bottom-bend'], 12);
  });

  it('coining yields a LARGER bend deduction (tighter, shorter blank)', () => {
    // Lower K → smaller bend allowance → BD = 2·OSSB − BA is larger.
    const air = computeBend({ ...base, bendType: 'air-bend' }).bendDeductionMm;
    const coined = computeBend({ ...base, bendType: 'coined' }).bendDeductionMm;
    expect(coined).toBeGreaterThan(air);
  });

  it('an explicit K override ignores the bend-type correction', () => {
    const a = computeBend({ ...base, kFactorOverride: 0.4, bendType: 'air-bend' });
    const c = computeBend({ ...base, kFactorOverride: 0.4, bendType: 'coined' });
    expect(a.kFactor).toBe(0.4);
    expect(c.kFactor).toBe(0.4); // override wins; bend-type does not touch it
  });
});
