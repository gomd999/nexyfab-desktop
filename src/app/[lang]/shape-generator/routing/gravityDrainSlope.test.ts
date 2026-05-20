import { describe, it, expect } from 'vitest';
import { compute, slopeForFlow, fullBoreFlow, summarize, type GravityDrainInput } from './gravityDrainSlope';

const base: GravityDrainInput = { diameterMm: 200, slope: 0.01, manningN: 0.013 };

describe('compute', () => {
  it('flow positive', () => {
    expect(compute(base).flowM3S).toBeGreaterThan(0);
  });

  it('steeper slope → more flow + velocity', () => {
    const flat = compute({ ...base, slope: 0.005 });
    const steep = compute({ ...base, slope: 0.04 });
    expect(steep.flowM3S).toBeGreaterThan(flat.flowM3S);
    expect(steep.velocityMS).toBeGreaterThan(flat.velocityMS);
  });

  it('larger diameter → more flow', () => {
    const small = compute({ ...base, diameterMm: 100 });
    const big = compute({ ...base, diameterMm: 400 });
    expect(big.flowM3S).toBeGreaterThan(small.flowM3S);
  });

  it('rougher pipe (higher n) → less flow', () => {
    const smooth = compute({ ...base, manningN: 0.009 });
    const rough = compute({ ...base, manningN: 0.025 });
    expect(rough.flowM3S).toBeLessThan(smooth.flowM3S);
  });

  it('self-cleansing flag at ≥ 0.6 m/s', () => {
    const r = compute({ ...base, slope: 0.02 });
    expect(r.selfCleansing).toBe(r.velocityMS >= 0.6);
  });

  it('low velocity → siltation warning', () => {
    const r = compute({ ...base, diameterMm: 600, slope: 0.0005 });
    if (!r.selfCleansing) expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('L/s = m³/s × 1000', () => {
    const r = compute(base);
    expect(r.flowLPerS).toBeCloseTo(r.flowM3S * 1000, 6);
  });

  it('zero slope → warning', () => {
    expect(compute({ ...base, slope: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('slopeForFlow', () => {
  it('round-trips with compute (full bore)', () => {
    const Q = fullBoreFlow(200, 0.01, 0.013);
    const s = slopeForFlow(200, Q, 0.013, 1);
    expect(s).toBeCloseTo(0.01, 4);
  });

  it('higher target flow → steeper slope', () => {
    expect(slopeForFlow(200, 0.05, 0.013)).toBeGreaterThan(slopeForFlow(200, 0.02, 0.013));
  });
});

describe('fullBoreFlow', () => {
  it('positive capacity', () => {
    expect(fullBoreFlow(300, 0.01)).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports flow + velocity', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.flowLPerS).toBe(r.flowLPerS);
    expect(s.velocityMS).toBe(r.velocityMS);
  });
});
