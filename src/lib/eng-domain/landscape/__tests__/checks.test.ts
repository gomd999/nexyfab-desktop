import { describe, it, expect } from 'vitest';
import {
  checkIrrigationCoverage,
  checkDrainageSlope,
  checkPlantingSpacing,
  checkGreenAreaRatio,
  checkSoilDepth,
  LANDSCAPE_CHECKS,
  SOIL_REPLACE_DEPTH_M,
  DRAINAGE_SLOPE_BAND_PCT,
} from '../checks';

describe('landscape gate-material — every result carries a basis', () => {
  it('all checks produce a non-empty basis; pass↔reason invariant holds', () => {
    const results = [
      checkIrrigationCoverage({ headCount: 10, coverageRadiusM: 3, targetAreaM2: 800 }),
      checkDrainageSlope({ measuredGradePct: 1.0, surfaceType: 'paving' }),
      checkPlantingSpacing({ plantCount: 100, areaM2: 400, category: '관목' }),
      checkGreenAreaRatio({ landscapedAreaM2: 120, siteAreaM2: 1000, zone: 'residential' }),
      checkSoilDepth({ category: '교목', providedDepthM: 1.2 }),
    ];
    for (const r of results) {
      expect(r.basis).toBeTruthy();
      expect(typeof r.basis).toBe('string');
      // failing results MUST carry a reason; passing ones MUST NOT
      if (r.pass) expect(r.reason).toBeUndefined();
      else expect(r.reason).toBeTruthy();
    }
    expect(Object.keys(LANDSCAPE_CHECKS)).toHaveLength(5);
  });
});

describe('1) irrigation coverage (geometric πr²·overlapFactor)', () => {
  it('hand-calc cross-check: r=3 m → per-head area = π·9 ≈ 28.2743 m²', () => {
    const r = checkIrrigationCoverage({ headCount: 1, coverageRadiusM: 3, targetAreaM2: 30 });
    expect(r.metrics.perHeadAreaM2).toBeCloseTo(Math.PI * 9, 4); // 28.2743...
    expect(r.metrics.perHeadAreaM2).toBeCloseTo(28.2743, 3);
  });

  it('PASS: 10 heads r=3 m over 300 m² target → ratio ≈ 0.9425 ≥ 0.9', () => {
    // 10 × π·9 = 282.743 m². target 300 → ratio 0.9424 ≥ 0.9 → PASS
    const r = checkIrrigationCoverage({ headCount: 10, coverageRadiusM: 3, targetAreaM2: 300 });
    expect(r.metrics.effectiveCoverageM2).toBeCloseTo(282.7433, 3);
    expect(r.metrics.coverageRatio).toBeCloseTo(0.9425, 3);
    expect(r.pass).toBe(true);
  });

  it('FAIL: same heads but 800 m² target → ratio 0.353 < 0.9', () => {
    const r = checkIrrigationCoverage({ headCount: 10, coverageRadiusM: 3, targetAreaM2: 800 });
    expect(r.pass).toBe(false);
    expect(r.metrics.coverageRatio).toBeCloseTo(0.3534, 3);
    expect(r.reason).toMatch(/커버리지/);
  });

  it('overlapFactor derates coverage (0.55 triangular)', () => {
    const r = checkIrrigationCoverage({ headCount: 10, coverageRadiusM: 3, targetAreaM2: 300, overlapFactor: 0.55 });
    expect(r.metrics.effectiveCoverageM2).toBeCloseTo(282.7433 * 0.55, 3);
    expect(r.pass).toBe(false);
  });

  it('throws on bad param (caller bug, not a gate verdict)', () => {
    expect(() => checkIrrigationCoverage({ headCount: 0, coverageRadiusM: 3, targetAreaM2: 300 })).toThrow();
    expect(() => checkIrrigationCoverage({ headCount: 5, coverageRadiusM: 3, targetAreaM2: 300, overlapFactor: 1.5 })).toThrow();
  });
});

describe('2) drainage slope (표면 배수 구배 대역)', () => {
  it('PASS: paving 1.0% within 0.5–2%', () => {
    const r = checkDrainageSlope({ measuredGradePct: 1.0, surfaceType: 'paving' });
    expect(r.pass).toBe(true);
    expect(r.metrics.minGradePct).toBe(0.5);
    expect(r.metrics.maxGradePct).toBe(2);
  });

  it('FAIL too flat: 0.2% < 0.5% paving min → 물고임', () => {
    const r = checkDrainageSlope({ measuredGradePct: 0.2, surfaceType: 'paving' });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/물고임/);
  });

  it('FAIL too steep: 6% > 5% lawn max → 세굴', () => {
    const r = checkDrainageSlope({ measuredGradePct: 6, surfaceType: 'lawn' });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/세굴|미끄럼/);
  });

  it('default surface = paving; override wins', () => {
    expect(checkDrainageSlope({ measuredGradePct: 1.0 }).metrics.maxGradePct).toBe(2);
    const r = checkDrainageSlope({ measuredGradePct: 3, minGradePctOverride: 0.5, maxGradePctOverride: 4 });
    expect(r.pass).toBe(true);
  });

  it('band table exposes lawn 2–5%', () => {
    expect(DRAINAGE_SLOPE_BAND_PCT.lawn).toEqual({ min: 2, max: 5 });
  });
});

describe('3) planting spacing (√(area/count) ≥ min)', () => {
  it('PASS: 100 관목 on 400 m² → spacing 2 m ≥ 1 m min', () => {
    const r = checkPlantingSpacing({ plantCount: 100, areaM2: 400, category: '관목' });
    expect(r.metrics.actualSpacingM).toBeCloseTo(2, 4); // √(400/100) = 2
    expect(r.metrics.maxPlantsFit).toBe(400); // ⌊400/1²⌋
    expect(r.pass).toBe(true);
  });

  it('FAIL: 교목 4.5 m min — 100 trees on 400 m² → spacing 2 m < 4.5 m (과밀)', () => {
    const r = checkPlantingSpacing({ plantCount: 100, areaM2: 400, category: '교목' });
    expect(r.pass).toBe(false);
    expect(r.metrics.minSpacingM).toBe(4.5);
    expect(r.metrics.maxPlantsFit).toBe(Math.floor(400 / (4.5 * 4.5))); // 19
    expect(r.reason).toMatch(/과밀/);
  });

  it('throws on unknown category', () => {
    // @ts-expect-error unknown category is a caller bug
    expect(() => checkPlantingSpacing({ plantCount: 10, areaM2: 100, category: 'xyz' })).toThrow();
  });
});

describe('4) green-area ratio (조경면적 비율)', () => {
  it('PASS: 120/1000 = 12% ≥ 10% residential', () => {
    const r = checkGreenAreaRatio({ landscapedAreaM2: 120, siteAreaM2: 1000, zone: 'residential' });
    expect(r.metrics.ratio).toBeCloseTo(0.12, 4);
    expect(r.pass).toBe(true);
  });

  it('FAIL: 40/1000 = 4% < 10% residential', () => {
    const r = checkGreenAreaRatio({ landscapedAreaM2: 40, siteAreaM2: 1000, zone: 'residential' });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/조경면적 비율/);
  });

  it('site < 200 m² is exempt (건축법 §27) → pass regardless of ratio', () => {
    const r = checkGreenAreaRatio({ landscapedAreaM2: 0, siteAreaM2: 150, zone: 'commercial' });
    expect(r.pass).toBe(true);
  });

  it('throws when landscaped area exceeds site area', () => {
    expect(() => checkGreenAreaRatio({ landscapedAreaM2: 1100, siteAreaM2: 1000 })).toThrow();
  });
});

describe('5) soil depth 객토 (표 3.1-1, mirrored from planting-base.mjs)', () => {
  it('table matches KDS 표 3.1-1 depths', () => {
    expect(SOIL_REPLACE_DEPTH_M).toEqual({ 교목: 1.0, 아교목: 0.7, 관목: 0.5, 지피초화류: 0.25 });
  });

  it('PASS: 교목 provided 1.2 m ≥ 1.0 m min', () => {
    const r = checkSoilDepth({ category: '교목', providedDepthM: 1.2 });
    expect(r.pass).toBe(true);
    expect(r.metrics.minDepthM).toBe(1.0);
    expect(r.metrics.marginM).toBeCloseTo(0.2, 4);
  });

  it('FAIL: 관목 provided 0.3 m < 0.5 m min', () => {
    const r = checkSoilDepth({ category: '관목', providedDepthM: 0.3 });
    expect(r.pass).toBe(false);
    expect(r.metrics.minDepthM).toBe(0.5);
    expect(r.reason).toMatch(/객토 깊이/);
  });

  it('throws on unknown category', () => {
    // @ts-expect-error unknown category is a caller bug
    expect(() => checkSoilDepth({ category: '넝쿨', providedDepthM: 0.5 })).toThrow();
  });
});
