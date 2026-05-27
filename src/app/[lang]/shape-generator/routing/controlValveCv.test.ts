import { describe, it, expect } from 'vitest';
import { size, flowAtTravel, summarize, type ControlValveInput } from './controlValveCv';

const base: ControlValveInput = {
  flowM3H: 40, specificGravity: 1, inletPressureBar: 6, outletPressureBar: 4,
  ratedKv: 50, characteristic: 'equal-percentage', rangeability: 50,
};

describe('size', () => {
  it('pressure drop = inlet − outlet', () => {
    expect(size(base).pressureDropBar).toBeCloseTo(2, 6);
  });

  it('required Kv = Q·√(SG/ΔP)', () => {
    const r = size(base);
    expect(r.requiredKv).toBeCloseTo(40 * Math.sqrt(1 / 2), 4);
  });

  it('Cv = 1.156·Kv', () => {
    const r = size(base);
    expect(r.requiredCv).toBeCloseTo(r.requiredKv * 1.156, 5);
  });

  it('higher flow → higher Kv', () => {
    const lo = size({ ...base, flowM3H: 20 });
    const hi = size({ ...base, flowM3H: 60 });
    expect(hi.requiredKv).toBeGreaterThan(lo.requiredKv);
  });

  it('valve opening within 0..1', () => {
    const r = size(base);
    expect(r.valveOpeningFraction).toBeGreaterThan(0);
    expect(r.valveOpeningFraction).toBeLessThanOrEqual(1);
  });

  it('oversized valve (tiny opening) → warning', () => {
    const r = size({ ...base, ratedKv: 5000 });
    expect(r.withinControllableRange).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('choked flow flagged with high ΔP + vapour pressure', () => {
    const r = size({ ...base, inletPressureBar: 10, outletPressureBar: 1, vapourPressureBar: 0.5 });
    expect(typeof r.choked).toBe('boolean');
  });

  it('inlet ≤ outlet → warning', () => {
    expect(size({ ...base, inletPressureBar: 3, outletPressureBar: 5 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('flowAtTravel', () => {
  it('linear: flow = travel', () => {
    expect(flowAtTravel(0.5, 'linear')).toBeCloseTo(0.5, 6);
  });

  it('equal-percentage rises steeply near full open', () => {
    const lo = flowAtTravel(0.3, 'equal-percentage', 50);
    const hi = flowAtTravel(0.9, 'equal-percentage', 50);
    expect(hi).toBeGreaterThan(lo * 2);
  });

  it('quick-open: flow = √travel', () => {
    expect(flowAtTravel(0.25, 'quick-open')).toBeCloseTo(0.5, 6);
  });

  it('full open → flow 1', () => {
    expect(flowAtTravel(1, 'equal-percentage', 50)).toBeCloseTo(1, 6);
  });
});

describe('summarize', () => {
  it('reports Cv + opening', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.requiredCv).toBe(r.requiredCv);
    expect(s.valveOpeningFraction).toBe(r.valveOpeningFraction);
  });
});
