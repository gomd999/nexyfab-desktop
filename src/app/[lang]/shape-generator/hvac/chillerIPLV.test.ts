import { describe, it, expect } from 'vitest';
import {
  compute, copToKwPerTon, kwPerTonToCop, annualEnergyRatio, summarize,
  type ChillerIPLVInput,
} from './chillerIPLV';

const copBase: ChillerIPLVInput = {
  unit: 'COP', full100: 5.5, part75: 6.2, part50: 6.8, part25: 5.0,
};

describe('compute', () => {
  it('IPLV between worst and best COP point', () => {
    const r = compute(copBase);
    expect(r.iplv).toBeGreaterThan(5.0);
    expect(r.iplv).toBeLessThan(6.8);
  });

  it('part-load weighting favours 50% point', () => {
    // Boosting the 50% point (weight 0.45) moves IPLV more than boosting 25%.
    const boost50 = compute({ ...copBase, part50: 8 });
    const boost25 = compute({ ...copBase, part25: 8 });
    expect(boost50.iplv).toBeGreaterThan(boost25.iplv);
  });

  it('cop points reported', () => {
    const r = compute(copBase);
    expect(r.copPoints[0]).toBeCloseTo(5.5, 5);
  });

  it('IPLV better than full-load when part-load COP higher', () => {
    expect(compute(copBase).betterThanFullLoad).toBe(true);
  });

  it('kW/ton input converted + IPLV in kW/ton', () => {
    const r = compute({ unit: 'kW-per-ton', full100: 0.64, part75: 0.57, part50: 0.52, part25: 0.70 });
    expect(r.unit).toBe('kW-per-ton');
    expect(r.iplv).toBeGreaterThan(0.4);
    expect(r.iplv).toBeLessThan(0.8);
  });

  it('non-positive efficiency → warning', () => {
    expect(compute({ ...copBase, part50: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('conversions', () => {
  it('COP ↔ kW/ton round-trip', () => {
    const kw = copToKwPerTon(5.5);
    expect(kwPerTonToCop(kw)).toBeCloseTo(5.5, 6);
  });

  it('higher COP → lower kW/ton', () => {
    expect(copToKwPerTon(6)).toBeLessThan(copToKwPerTon(4));
  });
});

describe('annualEnergyRatio', () => {
  it('< 1 when IPLV more efficient than full load', () => {
    const r = compute(copBase);
    expect(annualEnergyRatio(r)).toBeLessThan(1);
  });
});

describe('summarize', () => {
  it('reports iplv + unit', () => {
    const r = compute(copBase);
    const s = summarize(r);
    expect(s.iplv).toBe(r.iplv);
    expect(s.unit).toBe('COP');
  });
});
