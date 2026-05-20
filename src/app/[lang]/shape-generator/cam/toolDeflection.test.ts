import { describe, it, expect } from 'vitest';
import { compute, maxStickoutForTolerance, summarize, type ToolDeflectionInput } from './toolDeflection';

const base: ToolDeflectionInput = {
  toolDiameterMm: 10, stickoutMm: 30, cuttingForceN: 200, fluteCount: 4, material: 'carbide',
};

describe('compute', () => {
  it('effective diameter = 0.8·d for 4-flute', () => {
    expect(compute(base).effectiveDiameterMm).toBeCloseTo(8, 5);
  });

  it('deflection = F·L³/(3·E·I)', () => {
    const r = compute(base);
    const I = (Math.PI / 64) * Math.pow(8, 4);
    const expected = (200 * Math.pow(30, 3)) / (3 * 600_000 * I);
    expect(r.deflectionMm).toBeCloseTo(expected, 6);
  });

  it('longer stickout → much larger deflection (cubic)', () => {
    const short = compute({ ...base, stickoutMm: 20 });
    const long = compute({ ...base, stickoutMm: 40 });
    expect(long.deflectionMm).toBeGreaterThan(short.deflectionMm * 6);
  });

  it('carbide stiffer than HSS', () => {
    const carbide = compute({ ...base, material: 'carbide' });
    const hss = compute({ ...base, material: 'HSS' });
    expect(carbide.deflectionMm).toBeLessThan(hss.deflectionMm);
  });

  it('L/D = stickout / diameter', () => {
    expect(compute(base).slendernessLD).toBeCloseTo(3, 5);
  });

  it('high L/D → high chatter risk + warning', () => {
    const r = compute({ ...base, stickoutMm: 70 });
    expect(r.chatterRisk).toBe('high');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('low L/D → low chatter risk', () => {
    expect(compute({ ...base, stickoutMm: 20 }).chatterRisk).toBe('low');
  });

  it('larger tool → much stiffer (d⁴)', () => {
    const small = compute({ ...base, toolDiameterMm: 6 });
    const big = compute({ ...base, toolDiameterMm: 12 });
    expect(big.stiffnessNPerMm).toBeGreaterThan(small.stiffnessNPerMm);
  });

  it('zero stickout → warning', () => {
    expect(compute({ ...base, stickoutMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('maxStickoutForTolerance', () => {
  it('round-trips: deflection at returned stickout ≈ tolerance', () => {
    const tol = 0.01;
    const { stickoutMm, ...rest } = base;
    void stickoutMm;
    const L = maxStickoutForTolerance(rest, tol);
    const r = compute({ ...base, stickoutMm: L });
    expect(r.deflectionMm).toBeCloseTo(tol, 6);
  });
});

describe('summarize', () => {
  it('reports deflection + L/D + risk', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.deflectionMm).toBe(r.deflectionMm);
    expect(s.chatterRisk).toBe(r.chatterRisk);
  });
});
