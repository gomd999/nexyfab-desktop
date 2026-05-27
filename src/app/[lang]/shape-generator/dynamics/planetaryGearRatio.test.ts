import { describe, it, expect } from 'vitest';
import { compute, maxReduction, summarize, type PlanetaryInput } from './planetaryGearRatio';

// Sun 24, ring 72 → planet 24, R=S+2P ✓; (S+R)=96 divisible by 3,4,6.
const base: PlanetaryInput = { sunTeeth: 24, ringTeeth: 72, planetCount: 3, config: 'ring-fixed' };

describe('compute', () => {
  it('ring-fixed ratio = 1 + R/S', () => {
    expect(compute(base).ratio).toBeCloseTo(1 + 72 / 24, 5);
  });

  it('sun-fixed ratio = 1 + S/R', () => {
    expect(compute({ ...base, config: 'sun-fixed' }).ratio).toBeCloseTo(1 + 24 / 72, 5);
  });

  it('carrier-fixed (star) ratio = −R/S (reversing)', () => {
    expect(compute({ ...base, config: 'carrier-fixed' }).ratio).toBeCloseTo(-72 / 24, 5);
  });

  it('derived planet teeth = (R−S)/2', () => {
    expect(compute(base).derivedPlanetTeeth).toBeCloseTo(24, 5);
  });

  it('tooth constraint ok when R=S+2P', () => {
    expect(compute({ ...base, planetTeeth: 24 }).toothConstraintOk).toBe(true);
  });

  it('tooth constraint violated → warning', () => {
    const r = compute({ ...base, planetTeeth: 30 });
    expect(r.toothConstraintOk).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('assembly condition (S+R) % planets', () => {
    const ok = compute({ ...base, planetCount: 4 });   // 96 % 4 = 0
    const bad = compute({ ...base, planetCount: 5 });   // 96 % 5 ≠ 0
    expect(ok.assemblyOk).toBe(true);
    expect(bad.assemblyOk).toBe(false);
  });

  it('output speed = input / ratio', () => {
    const r = compute({ ...base, inputSpeedRpm: 1500 });
    expect(r.outputSpeedRpm).toBeCloseTo(1500 / r.ratio, 4);
  });

  it('output torque = input × |ratio|', () => {
    const r = compute({ ...base, inputTorqueNm: 10 });
    expect(r.outputTorqueNm).toBeCloseTo(10 * Math.abs(r.ratio), 4);
  });

  it('ring ≤ sun → warning', () => {
    expect(compute({ ...base, ringTeeth: 20 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('maxReduction', () => {
  it('= 1 + R/S', () => {
    expect(maxReduction(24, 72)).toBeCloseTo(4, 5);
  });
});

describe('summarize', () => {
  it('reports ratio + assembly', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.ratio).toBe(r.ratio);
    expect(s.assemblyOk).toBe(r.assemblyOk);
  });
});
