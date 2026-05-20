import { describe, it, expect } from 'vitest';
import { size, combinationRatio, summarize, type VrfPipingInput } from './vrfRefrigerantPiping';

const base: VrfPipingInput = {
  capacityKW: 14, actualLengthM: 40, indoorAboveOutdoorM: 10,
};

describe('size', () => {
  it('equivalent length = actual + fittings', () => {
    const r = size({ ...base, fittingsEquivLengthM: 12 });
    expect(r.equivalentLengthM).toBeCloseTo(40 + 12, 5);
  });

  it('selects line sizes from capacity band', () => {
    const r = size(base);
    expect(r.liquidLineMm).toBeGreaterThan(0);
    expect(r.gasLineMm).toBeGreaterThan(r.liquidLineMm);
  });

  it('bigger capacity → bigger gas line', () => {
    const small = size({ ...base, capacityKW: 5 });
    const big = size({ ...base, capacityKW: 45 });
    expect(big.gasLineMm).toBeGreaterThan(small.gasLineMm);
  });

  it('longer run → lower correction', () => {
    const short = size({ ...base, actualLengthM: 10 });
    const long = size({ ...base, actualLengthM: 120 });
    expect(long.capacityCorrection).toBeLessThan(short.capacityCorrection);
  });

  it('height difference reduces capacity', () => {
    const flat = size({ ...base, indoorAboveOutdoorM: 0 });
    const tall = size({ ...base, indoorAboveOutdoorM: 40 });
    expect(tall.capacityCorrection).toBeLessThan(flat.capacityCorrection);
  });

  it('corrected capacity = capacity × correction', () => {
    const r = size(base);
    expect(r.correctedCapacityKW).toBeCloseTo(14 * r.capacityCorrection, 5);
  });

  it('beyond max length → warning + not within limits', () => {
    const r = size({ ...base, actualLengthM: 200, maxEquivLengthM: 150 });
    expect(r.withinLimits).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('correction floored at 0.5', () => {
    const r = size({ ...base, actualLengthM: 10000, indoorAboveOutdoorM: 1000 });
    expect(r.capacityCorrection).toBeGreaterThanOrEqual(0.5);
  });

  it('zero capacity → warning', () => {
    expect(size({ ...base, capacityKW: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('combinationRatio', () => {
  it('Σ indoor / outdoor', () => {
    expect(combinationRatio(56, 50)).toBeCloseTo(1.12, 4);
  });

  it('zero outdoor → Infinity', () => {
    expect(combinationRatio(56, 0)).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('reports lines + corrected capacity', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.gasLineMm).toBe(r.gasLineMm);
    expect(s.correctedCapacityKW).toBe(r.correctedCapacityKW);
  });
});
