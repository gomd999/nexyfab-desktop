import { describe, it, expect } from 'vitest';
import {
  bendAllowance,
  outsideSetback,
  bendDeduction,
  developFlatPattern,
  springbackFactor,
  overbendAngle,
  minimumFlangeLength,
  suggestVDie,
  suggestCornerRelief,
} from './sheetMetalFlatPattern';

describe('bendAllowance', () => {
  it('90° bend with R=2, K=0.33, t=1 ≈ 2.66 mm', () => {
    // (π/180)*90*(2 + 0.33*1) = (π/2)*2.33 ≈ 3.66
    expect(bendAllowance(90, 2, 0.33, 1)).toBeCloseTo(Math.PI / 2 * 2.33, 4);
  });

  it('larger K → larger arc length', () => {
    expect(bendAllowance(90, 2, 0.5, 1)).toBeGreaterThan(bendAllowance(90, 2, 0.3, 1));
  });

  it('zero angle → zero allowance', () => {
    expect(bendAllowance(0, 2, 0.33, 1)).toBe(0);
  });
});

describe('outsideSetback', () => {
  it('90° → (R+t)·tan(45°) = R+t', () => {
    expect(outsideSetback(90, 2, 1)).toBeCloseTo(3, 6);
  });

  it('grows with bend angle', () => {
    expect(outsideSetback(120, 2, 1)).toBeGreaterThan(outsideSetback(90, 2, 1));
  });
});

describe('bendDeduction', () => {
  it('= 2·OSSB - BA', () => {
    const r = 2, t = 1, ang = 90, k = 0.33;
    const expected = 2 * outsideSetback(ang, r, t) - bendAllowance(ang, r, k, t);
    expect(bendDeduction(ang, r, k, t)).toBeCloseTo(expected, 6);
  });
});

describe('developFlatPattern', () => {
  it('single 90° L-bend: flat = flange1 + BA + tailFlange', () => {
    const r = developFlatPattern([
      { precedingFlangeMm: 30, innerRadiusMm: 2, angleDeg: 90, kFactor: 0.33, thicknessMm: 1 },
    ], 40);
    const expectedBa = bendAllowance(90, 2, 0.33, 1);
    expect(r.flatLengthMm).toBeCloseTo(30 + expectedBa + 40, 4);
  });

  it('U-channel: 2 bends + 3 flanges', () => {
    const r = developFlatPattern([
      { precedingFlangeMm: 25, innerRadiusMm: 2, angleDeg: 90, kFactor: 0.33, thicknessMm: 1 },
      { precedingFlangeMm: 50, innerRadiusMm: 2, angleDeg: 90, kFactor: 0.33, thicknessMm: 1 },
    ], 25);
    const ba = bendAllowance(90, 2, 0.33, 1);
    expect(r.flatLengthMm).toBeCloseTo(25 + ba + 50 + ba + 25, 4);
    expect(r.bendDetails).toHaveLength(2);
  });

  it('no bends → flat = tail only', () => {
    const r = developFlatPattern([], 100);
    expect(r.flatLengthMm).toBe(100);
  });

  it('exposes per-bend mold-line length', () => {
    const r = developFlatPattern([
      { precedingFlangeMm: 20, innerRadiusMm: 3, angleDeg: 90, kFactor: 0.4, thicknessMm: 2 },
    ], 0);
    // mold-line = preceding + OSSB
    expect(r.bendDetails[0]!.moldLineLengthMm).toBeCloseTo(20 + outsideSetback(90, 3, 2), 5);
  });
});

describe('springbackFactor', () => {
  // Steel: σy=350, E=200000 MPa.
  const mildSteelInput = {
    targetAngleDeg: 90,
    yieldStrengthMpa: 350,
    elasticModulusMpa: 200000,
    thicknessMm: 2,
    innerRadiusMm: 4,
  };

  it('between 0.85 and 1.0', () => {
    const ks = springbackFactor(mildSteelInput);
    expect(ks).toBeGreaterThanOrEqual(0.85);
    expect(ks).toBeLessThanOrEqual(1.0);
  });

  it('higher R/t → more springback (lower factor)', () => {
    const small = springbackFactor({ ...mildSteelInput, innerRadiusMm: 2 });
    const large = springbackFactor({ ...mildSteelInput, innerRadiusMm: 20 });
    expect(large).toBeLessThanOrEqual(small);
  });
});

describe('overbendAngle', () => {
  it('overbend > target', () => {
    const input = {
      targetAngleDeg: 90,
      yieldStrengthMpa: 1000,
      elasticModulusMpa: 200000,
      thicknessMm: 2,
      innerRadiusMm: 8,
    };
    expect(overbendAngle(input)).toBeGreaterThan(90);
  });

  it('reduces to target when no springback (K=1)', () => {
    // r ≈ 0 + σy/E ≈ 0 → K should be 1.
    const input = {
      targetAngleDeg: 90,
      yieldStrengthMpa: 0,
      elasticModulusMpa: 200000,
      thicknessMm: 2,
      innerRadiusMm: 4,
    };
    expect(overbendAngle(input)).toBeCloseTo(90, 6);
  });
});

describe('die helpers', () => {
  it('min flange = V/2 + r + t', () => {
    expect(minimumFlangeLength(8, 1, 1)).toBe(6);
  });

  it('suggestVDie scales with thickness ~8t', () => {
    expect(suggestVDie(2)).toBeGreaterThanOrEqual(16 - 1);
    expect(suggestVDie(2)).toBeLessThanOrEqual(16 + 1);
  });

  it('suggestVDie floors at 6 for thin material', () => {
    expect(suggestVDie(0.1)).toBe(6);
  });
});

describe('suggestCornerRelief', () => {
  it('width ≥ 1.5×t and depth ≥ r+t', () => {
    const r = suggestCornerRelief(2, 3);
    expect(r.widthMm).toBeGreaterThanOrEqual(3);
    expect(r.depthMm).toBeGreaterThanOrEqual(5);
    expect(r.intersectsBend).toBe(true);
  });

  it('clamps to 1.5mm minimum width for thin sheet', () => {
    const r = suggestCornerRelief(0.5, 1);
    expect(r.widthMm).toBeGreaterThanOrEqual(1.5);
  });
});
