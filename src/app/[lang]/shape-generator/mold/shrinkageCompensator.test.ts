import { describe, it, expect } from 'vitest';
import {
  compensate,
  measuredShrinkage,
  typicalShrinkage,
  summarize,
  type ShrinkageInput,
} from './shrinkageCompensator';

const isoBase: ShrinkageInput = {
  nominalDimsMm: { x: 100, y: 100, z: 100 },
  shrinkageFraction: { x: 0.018, y: 0.018, z: 0.018 },
};

describe('compensate', () => {
  it('isotropic 1.8% → scale 1.018 each axis', () => {
    const r = compensate(isoBase);
    expect(r.scaleFactors.x).toBeCloseTo(1.018, 6);
    expect(r.scaleFactors.y).toBeCloseTo(1.018, 6);
    expect(r.scaleFactors.z).toBeCloseTo(1.018, 6);
  });

  it('cavity dim = nominal × scale', () => {
    const r = compensate(isoBase);
    expect(r.cavityDimsMm.x).toBeCloseTo(101.8, 4);
  });

  it('isotropic equivalent = scale (when uniform)', () => {
    const r = compensate(isoBase);
    expect(r.isotropicEquivalent).toBeCloseTo(1.018, 6);
  });

  it('isotropic case → near-zero anisotropy error', () => {
    const r = compensate(isoBase);
    expect(r.maxAnisotropyErrorMm).toBeCloseTo(0, 6);
  });

  it('anisotropic → nonzero anisotropy error', () => {
    const r = compensate({
      nominalDimsMm: { x: 100, y: 100, z: 100 },
      shrinkageFraction: { x: 0.02, y: 0.005, z: 0.005 },
    });
    expect(r.maxAnisotropyErrorMm).toBeGreaterThan(0);
  });

  it('negative shrinkage → warning', () => {
    const r = compensate({ ...isoBase, shrinkageFraction: { x: -0.01, y: 0.018, z: 0.018 } });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('shrinkage > 10% → warning (likely % vs fraction mistake)', () => {
    const r = compensate({ ...isoBase, shrinkageFraction: { x: 0.18, y: 0.18, z: 0.18 } });
    expect(r.warnings.some(w => w.includes('10'))).toBe(true);
  });

  it('larger shrink → larger cavity', () => {
    const low = compensate({ ...isoBase, shrinkageFraction: { x: 0.005, y: 0.005, z: 0.005 } });
    const high = compensate({ ...isoBase, shrinkageFraction: { x: 0.02, y: 0.02, z: 0.02 } });
    expect(high.cavityDimsMm.x).toBeGreaterThan(low.cavityDimsMm.x);
  });
});

describe('measuredShrinkage', () => {
  it('recovers shrinkage from cavity + molded dims', () => {
    const cavity = { x: 101.8, y: 101.8, z: 101.8 };
    const molded = { x: 100, y: 100, z: 100 };
    const s = measuredShrinkage(cavity, molded);
    expect(s.x).toBeCloseTo(0.018, 5);
  });

  it('round-trips with compensate', () => {
    const r = compensate(isoBase);
    const s = measuredShrinkage(r.cavityDimsMm, isoBase.nominalDimsMm);
    expect(s.x).toBeCloseTo(0.018, 5);
  });

  it('zero molded dim → zero (no divide by zero)', () => {
    const s = measuredShrinkage({ x: 100, y: 100, z: 100 }, { x: 0, y: 0, z: 0 });
    expect(s.x).toBe(0);
  });
});

describe('typicalShrinkage', () => {
  it('PP higher than ABS', () => {
    expect(typicalShrinkage('PP')).toBeGreaterThan(typicalShrinkage('ABS'));
  });

  it('GF-filled PA66 low', () => {
    expect(typicalShrinkage('PA66-GF')).toBeLessThan(typicalShrinkage('PA6'));
  });
});

describe('summarize', () => {
  it('reports scale factors', () => {
    const r = compensate(isoBase);
    const s = summarize(r);
    expect(s.scaleFactors).toEqual(r.scaleFactors);
  });
});
