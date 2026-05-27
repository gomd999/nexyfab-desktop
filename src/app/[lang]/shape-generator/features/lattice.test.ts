import { describe, it, expect } from 'vitest';
import {
  gyroidField,
  schwarzPField,
  schwarzDField,
  diamondField,
  thicknessToOffset,
  estimateDensity,
  estimateEffectiveStiffness,
  checkManufacturability,
  OCTET_CELL,
  BCC_CELL,
  FCC_CELL,
  type LatticeParams,
} from './lattice';

describe('TPMS fields', () => {
  it('gyroid is zero at origin', () => {
    expect(gyroidField(0, 0, 0, 1)).toBeCloseTo(0, 6);
  });

  it('schwarz-p sums cosines', () => {
    expect(schwarzPField(0, 0, 0, 1)).toBeCloseTo(3, 6); // cos(0) * 3
  });

  it('schwarz-d is bounded', () => {
    const v = schwarzDField(0.25, 0.25, 0.25, 1);
    expect(Math.abs(v)).toBeLessThan(2);
  });

  it('diamond field defined', () => {
    expect(diamondField(0, 0, 0, 1)).toBeCloseTo(1, 6);
  });

  it('field is periodic in cellSize', () => {
    const v1 = gyroidField(0.3, 0.5, 0.7, 1);
    const v2 = gyroidField(0.3 + 1, 0.5 + 1, 0.7 + 1, 1);
    expect(v2).toBeCloseTo(v1, 4);
  });
});

describe('thicknessToOffset', () => {
  it('zero thickness → zero offset', () => {
    expect(thicknessToOffset(0, 10)).toBe(0);
  });

  it('grows with thickness', () => {
    const o1 = thicknessToOffset(0.5, 10);
    const o2 = thicknessToOffset(1.5, 10);
    expect(o2).toBeGreaterThan(o1);
  });
});

describe('estimateDensity', () => {
  const params: LatticeParams = {
    cellSizeMm: 5,
    thicknessMm: 1,
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
  };

  it('material fraction between 0 and 1', () => {
    const r = estimateDensity('gyroid', params, 8);
    expect(r.materialFraction).toBeGreaterThanOrEqual(0);
    expect(r.materialFraction).toBeLessThanOrEqual(1);
  });

  it('bboxVolume = 1000 mm³ for 10×10×10', () => {
    const r = estimateDensity('gyroid', params, 8);
    expect(r.bboxVolumeMm3).toBe(1000);
  });

  it('thicker walls → more material', () => {
    const thin = estimateDensity('gyroid', { ...params, thicknessMm: 0.5 }, 8);
    const thick = estimateDensity('gyroid', { ...params, thicknessMm: 2 }, 8);
    expect(thick.materialFraction).toBeGreaterThan(thin.materialFraction);
  });

  it('mass scales linearly with material volume', () => {
    const r = estimateDensity('gyroid', params, 8);
    expect(r.massGrams).toBeCloseTo((r.materialVolumeMm3 / 1000) * 2.7, 5);
  });
});

describe('estimateEffectiveStiffness', () => {
  const density = { materialFraction: 0.4, massGrams: 100, bboxVolumeMm3: 1000, materialVolumeMm3: 400 };

  it('octet has exponent 1 (stretch-dominated)', () => {
    const r = estimateEffectiveStiffness('octet', density, 70000);
    expect(r.exponent).toBe(1);
    expect(r.relativeModulus).toBeCloseTo(0.4, 6);
  });

  it('BCC has exponent 2 (bending-dominated)', () => {
    const r = estimateEffectiveStiffness('bcc', density, 70000);
    expect(r.exponent).toBe(2);
    expect(r.relativeModulus).toBeCloseTo(0.16, 4);
  });

  it('effective modulus is fraction × solid modulus^exp', () => {
    const r = estimateEffectiveStiffness('gyroid', density, 70000);
    expect(r.effectiveModulusMPa).toBeCloseTo(70000 * Math.pow(0.4, 1.7), 1);
  });
});

describe('checkManufacturability', () => {
  const baseParams: LatticeParams = {
    cellSizeMm: 5,
    thicknessMm: 1,
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
  };

  it('FDM needs thick walls', () => {
    const r = checkManufacturability('gyroid', { ...baseParams, thicknessMm: 0.5 }, 'FDM');
    expect(r.manufacturable).toBe(false);
    expect(r.issues[0]).toMatch(/Thickness/);
  });

  it('SLA accepts thin walls', () => {
    const r = checkManufacturability('gyroid', { ...baseParams, thicknessMm: 0.5 }, 'SLA');
    expect(r.manufacturable).toBe(true);
  });

  it('SLS small cell fails powder removal', () => {
    const r = checkManufacturability('gyroid', { ...baseParams, cellSizeMm: 1 }, 'SLS');
    expect(r.manufacturable).toBe(false);
  });

  it('FDM with octet suggests BCC/gyroid', () => {
    const r = checkManufacturability('octet', baseParams, 'FDM');
    expect(r.suggestions.some(s => /BCC|gyroid/i.test(s))).toBe(true);
  });
});

describe('strut cell catalogs', () => {
  it('octet has 14 nodes', () => {
    expect(OCTET_CELL.nodes).toHaveLength(14);
  });

  it('BCC has 9 nodes (8 corners + center)', () => {
    expect(BCC_CELL.nodes).toHaveLength(9);
  });

  it('FCC has 14 nodes (8 corners + 6 face centers)', () => {
    expect(FCC_CELL.nodes).toHaveLength(14);
  });

  it('all struts reference valid node indices', () => {
    for (const cell of [OCTET_CELL, BCC_CELL, FCC_CELL]) {
      for (const [a, b] of cell.struts) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(cell.nodes.length);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(cell.nodes.length);
      }
    }
  });
});
