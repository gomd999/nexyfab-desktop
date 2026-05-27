import { describe, it, expect } from 'vitest';
import {
  computeBend,
  computeFlatLength,
  estimateAirBendRadius,
  compensateForSpringback,
  summarize,
  K_FACTOR_TABLE,
  SPRINGBACK_DEG,
} from './bendDeductionCalculator';

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
