import { describe, it, expect } from 'vitest';
import {
  size,
  awsMinFillet,
  safetyFactor,
  summarize,
  type FilletWeldInput,
} from './filletThroatSizer';

const base: FilletWeldInput = {
  weldLengthMm: 100,
  appliedLoadN: 50000,
  allowableShearMpa: 95,
  thinnerPlateMm: 10,
  thickerPlateMm: 12,
};

describe('size', () => {
  it('throat = 0.707 × leg', () => {
    const r = size({ ...base, legSizeMm: 8 });
    expect(r.throatMm).toBeCloseTo(0.707 * 8, 5);
  });

  it('solves min leg from load when leg omitted', () => {
    const r = size(base);
    expect(r.legSizeMm).toBeGreaterThan(0);
    expect(r.minLegForLoadMm).toBeGreaterThan(0);
  });

  it('capacity = throat × length × allowable', () => {
    const r = size({ ...base, legSizeMm: 8 });
    expect(r.capacityN).toBeCloseTo(0.707 * 8 * 100 * 95, 2);
  });

  it('given leg computes shear stress + pass', () => {
    const r = size({ ...base, legSizeMm: 8 });
    expect(r.shearStressMpa).not.toBeNull();
    expect(r.passed).toBe(true);
  });

  it('undersized leg fails', () => {
    const r = size({ ...base, legSizeMm: 3 });
    expect(r.passed).toBe(false);
  });

  it('transverse stronger than longitudinal', () => {
    const trans = size({ ...base, legSizeMm: 8, loadType: 'transverse' });
    const long = size({ ...base, legSizeMm: 8, loadType: 'longitudinal' });
    expect(trans.capacityN).toBeGreaterThan(long.capacityN);
  });

  it('AWS min leg from thicker plate', () => {
    const r = size(base);
    expect(r.awsMinLegMm).toBe(5); // 12 mm plate → 5 mm
  });

  it('leg above max → warning', () => {
    const r = size({ ...base, legSizeMm: 20 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero length → warning', () => {
    const r = size({ ...base, weldLengthMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('longer weld → smaller required leg', () => {
    const short = size({ ...base, weldLengthMm: 50 });
    const long = size({ ...base, weldLengthMm: 200 });
    expect(long.minLegForLoadMm).toBeLessThan(short.minLegForLoadMm);
  });
});

describe('awsMinFillet', () => {
  it('thin plate → 3 mm', () => {
    expect(awsMinFillet(5)).toBe(3);
  });

  it('thick plate → 8 mm', () => {
    expect(awsMinFillet(25)).toBe(8);
  });

  it('monotonic with thickness', () => {
    expect(awsMinFillet(25)).toBeGreaterThanOrEqual(awsMinFillet(5));
  });
});

describe('safetyFactor', () => {
  it('capacity / applied', () => {
    const r = size({ ...base, legSizeMm: 8 });
    expect(safetyFactor(r, r.capacityN / 2)).toBeCloseTo(2, 4);
  });

  it('zero load → Infinity', () => {
    expect(safetyFactor(size({ ...base, legSizeMm: 8 }), 0)).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('reports leg + throat + capacity', () => {
    const r = size({ ...base, legSizeMm: 8 });
    const s = summarize(r);
    expect(s.legSizeMm).toBe(r.legSizeMm);
    expect(s.throatMm).toBe(r.throatMm);
  });
});
