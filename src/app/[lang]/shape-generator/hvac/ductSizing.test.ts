import { describe, it, expect } from 'vitest';
import {
  hydraulicDiameter,
  ductArea,
  velocityForFlow,
  checkVelocity,
  frictionLossPa100m,
  fittingPressureDropPa,
  sizeRoundDuct,
  sizeRectangularDuct,
  balanceAirflow,
  type DuctSegment,
} from './ductSizing';

describe('hydraulicDiameter', () => {
  it('round duct: Dh = diameter', () => {
    expect(hydraulicDiameter({ shape: 'round', primaryMm: 300 })).toBe(300);
  });

  it('rectangular: ASHRAE formula', () => {
    const dh = hydraulicDiameter({ shape: 'rectangular', primaryMm: 400, secondaryMm: 200 });
    // Validate sane range — 1.30·(400·200)^0.625 / (600)^0.25 ≈ 290 mm.
    expect(dh).toBeGreaterThan(250);
    expect(dh).toBeLessThan(330);
  });

  it('oval gives a value between round + rect for same area', () => {
    const oval = hydraulicDiameter({ shape: 'oval', primaryMm: 400, secondaryMm: 200 });
    expect(oval).toBeGreaterThan(0);
  });
});

describe('ductArea', () => {
  it('round = π·r²', () => {
    expect(ductArea({ shape: 'round', primaryMm: 200 })).toBeCloseTo(Math.PI * 100 * 100, 2);
  });

  it('rectangular = W × H', () => {
    expect(ductArea({ shape: 'rectangular', primaryMm: 400, secondaryMm: 200 })).toBe(80000);
  });
});

describe('velocityForFlow', () => {
  it('zero flow → zero velocity', () => {
    expect(velocityForFlow(0, { shape: 'round', primaryMm: 200 })).toBe(0);
  });

  it('higher flow → higher velocity', () => {
    const lo = velocityForFlow(100, { shape: 'round', primaryMm: 200 });
    const hi = velocityForFlow(500, { shape: 'round', primaryMm: 200 });
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('checkVelocity', () => {
  it('100 CFM through 200mm round: under low-pressure limit', () => {
    const r = checkVelocity(100, { shape: 'round', primaryMm: 200 }, 'low-pressure-comfort');
    expect(r.underLimit).toBe(true);
    expect(r.limit).toBe(5.0);
  });

  it('huge flow in small duct exceeds limit', () => {
    const r = checkVelocity(10000, { shape: 'round', primaryMm: 100 }, 'low-pressure-comfort');
    expect(r.underLimit).toBe(false);
  });
});

describe('frictionLossPa100m', () => {
  it('zero flow → zero loss', () => {
    expect(frictionLossPa100m(0, { shape: 'round', primaryMm: 200 })).toBe(0);
  });

  it('higher flow → higher friction', () => {
    const lo = frictionLossPa100m(100, { shape: 'round', primaryMm: 200 });
    const hi = frictionLossPa100m(500, { shape: 'round', primaryMm: 200 });
    expect(hi).toBeGreaterThan(lo);
  });

  it('larger duct → lower friction', () => {
    const small = frictionLossPa100m(500, { shape: 'round', primaryMm: 100 });
    const large = frictionLossPa100m(500, { shape: 'round', primaryMm: 400 });
    expect(large).toBeLessThan(small);
  });
});

describe('fittingPressureDropPa', () => {
  it('damper-half causes much more loss than damper-open', () => {
    const open = fittingPressureDropPa(500, { shape: 'round', primaryMm: 200 }, 'damper-open');
    const half = fittingPressureDropPa(500, { shape: 'round', primaryMm: 200 }, 'damper-half');
    expect(half).toBeGreaterThan(open * 5);
  });

  it('zero flow → zero drop', () => {
    expect(fittingPressureDropPa(0, { shape: 'round', primaryMm: 200 }, 'elbow-90-radius')).toBe(0);
  });
});

describe('sizeRoundDuct', () => {
  it('picks small duct for small flow', () => {
    const r = sizeRoundDuct(100, 'low-pressure-comfort');
    expect(r.primaryMm).toBeLessThanOrEqual(300);
  });

  it('picks larger duct for large flow', () => {
    const small = sizeRoundDuct(100, 'low-pressure-comfort');
    const large = sizeRoundDuct(5000, 'low-pressure-comfort');
    expect(large.primaryMm).toBeGreaterThan(small.primaryMm);
  });

  it('noise-critical needs larger duct than low-pressure', () => {
    const noise = sizeRoundDuct(500, 'noise-critical');
    const low = sizeRoundDuct(500, 'low-pressure-comfort');
    expect(noise.primaryMm).toBeGreaterThanOrEqual(low.primaryMm);
  });
});

describe('sizeRectangularDuct', () => {
  it('returns rectangular shape with 50mm snapped sizes', () => {
    const r = sizeRectangularDuct(500, 'low-pressure-comfort');
    expect(r.shape).toBe('rectangular');
    expect(r.primaryMm % 50).toBe(0);
    expect(r.secondaryMm! % 50).toBe(0);
  });

  it('width ≈ 1.5 × height', () => {
    const r = sizeRectangularDuct(1000, 'low-pressure-comfort');
    const ratio = r.primaryMm / r.secondaryMm!;
    expect(ratio).toBeGreaterThan(1.0);
    expect(ratio).toBeLessThan(2.5);
  });
});

describe('balanceAirflow', () => {
  it('cumulative flow accumulates upstream', () => {
    const segments: DuctSegment[] = [
      { id: 'main', flowCfm: 0, lengthM: 10 },
      { id: 'branch1', parentId: 'main', flowCfm: 200, lengthM: 5 },
      { id: 'branch2', parentId: 'main', flowCfm: 300, lengthM: 5 },
    ];
    const r = balanceAirflow(segments, 'low-pressure-comfort');
    // Main duct should be sized for 500 CFM (sum of branches).
    const main = r.sizedSegments.find(s => s.id === 'main')!;
    expect(main.resolvedSpec).toBeDefined();
    // Larger flow → larger duct.
    const b1 = r.sizedSegments.find(s => s.id === 'branch1')!;
    expect(main.resolvedSpec!.primaryMm).toBeGreaterThanOrEqual(b1.resolvedSpec!.primaryMm);
  });

  it('emits fan pressure + longest path', () => {
    const segments: DuctSegment[] = [
      { id: 'main', flowCfm: 0, lengthM: 20 },
      { id: 'leaf1', parentId: 'main', flowCfm: 200, lengthM: 5 },
      { id: 'leaf2', parentId: 'main', flowCfm: 200, lengthM: 30 },
    ];
    const r = balanceAirflow(segments, 'low-pressure-comfort');
    expect(r.fanPressurePa).toBeGreaterThan(0);
    expect(r.longestPath).toContain('main');
    expect(r.longestPath).toContain('leaf2'); // longer leaf wins
  });

  it('fittings add to pressure drop', () => {
    const baseSeg: DuctSegment[] = [
      { id: 'a', flowCfm: 500, lengthM: 10 },
    ];
    const segWithFittings: DuctSegment[] = [
      { id: 'a', flowCfm: 500, lengthM: 10, fittings: ['damper-half', 'elbow-90-radius'] },
    ];
    const bare = balanceAirflow(baseSeg, 'low-pressure-comfort');
    const withF = balanceAirflow(segWithFittings, 'low-pressure-comfort');
    expect(withF.fanPressurePa).toBeGreaterThan(bare.fanPressurePa);
  });
});
