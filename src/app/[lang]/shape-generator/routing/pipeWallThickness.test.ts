import { describe, it, expect } from 'vitest';
import {
  compute,
  mawpMpa,
  summarize,
  type PipeWallInput,
} from './pipeWallThickness';

const base: PipeWallInput = {
  designPressureMpa: 5,
  outerDiameterMm: 168.3, // 6" pipe
  allowableStressMpa: 138,
};

describe('compute', () => {
  it('pressure thickness = PD/(2(SEW+PY))', () => {
    const r = compute(base);
    const expected = (5 * 168.3) / (2 * (138 * 1 * 1 + 5 * 0.4));
    expect(r.pressureThicknessMm).toBeCloseTo(expected, 4);
  });

  it('min required = pressure + corrosion', () => {
    const r = compute(base);
    expect(r.minRequiredThicknessMm).toBeCloseTo(r.pressureThicknessMm + 1.5, 5);
  });

  it('order thickness ≥ min required (mill tolerance)', () => {
    const r = compute(base);
    expect(r.orderThicknessMm).toBeGreaterThan(r.minRequiredThicknessMm);
  });

  it('thin-wall valid for this case', () => {
    expect(compute(base).thinWallValid).toBe(true);
  });

  it('thin-wall invalid at very high pressure', () => {
    const r = compute({ ...base, designPressureMpa: 80 });
    expect(r.thinWallValid).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('higher pressure → thicker wall', () => {
    const lo = compute({ ...base, designPressureMpa: 2 });
    const hi = compute({ ...base, designPressureMpa: 8 });
    expect(hi.pressureThicknessMm).toBeGreaterThan(lo.pressureThicknessMm);
  });

  it('hoop stress function: Barlow σ=PD/2t', () => {
    const r = compute(base);
    expect(r.hoopStressAtNominalMpa(7)).toBeCloseTo((5 * 168.3) / (2 * 7), 4);
  });

  it('zero pressure → warning', () => {
    const r = compute({ ...base, designPressureMpa: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('lower allowable stress → thicker wall', () => {
    const strong = compute({ ...base, allowableStressMpa: 200 });
    const weak = compute({ ...base, allowableStressMpa: 100 });
    expect(weak.pressureThicknessMm).toBeGreaterThan(strong.pressureThicknessMm);
  });
});

describe('mawpMpa', () => {
  it('MAWP positive for adequate wall', () => {
    expect(mawpMpa(base, 11)).toBeGreaterThan(0);
  });

  it('thicker wall → higher MAWP', () => {
    expect(mawpMpa(base, 14)).toBeGreaterThan(mawpMpa(base, 8));
  });

  it('inverts compute roughly (order wall carries ≥ design P)', () => {
    const r = compute(base);
    const mawp = mawpMpa(base, r.orderThicknessMm);
    expect(mawp).toBeGreaterThanOrEqual(base.designPressureMpa - 0.5);
  });
});

describe('summarize', () => {
  it('reports thicknesses + validity', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.pressureThicknessMm).toBe(r.pressureThicknessMm);
    expect(s.thinWallValid).toBe(true);
  });
});
