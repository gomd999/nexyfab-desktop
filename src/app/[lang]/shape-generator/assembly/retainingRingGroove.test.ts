import { describe, it, expect } from 'vitest';
import {
  size,
  safetyAt,
  grooveStressConcentration,
  summarize,
  type RetainingRingInput,
} from './retainingRingGroove';

const base: RetainingRingInput = {
  nominalDiameterMm: 40,
  ringType: 'external',
  ringThicknessMm: 1.75,
  housingYieldMpa: 350,
};

describe('size', () => {
  it('external groove diameter = d − 2t', () => {
    const r = size(base);
    expect(r.grooveDiameterMm).toBeCloseTo(40 - 2 * r.grooveDepthMm, 6);
  });

  it('internal groove diameter = d + 2t', () => {
    const r = size({ ...base, ringType: 'internal' });
    expect(r.grooveDiameterMm).toBeCloseTo(40 + 2 * r.grooveDepthMm, 6);
  });

  it('default groove depth ≈ 0.05·d', () => {
    const r = size(base);
    expect(r.grooveDepthMm).toBeCloseTo(2, 6);
  });

  it('groove width = ring thickness + clearance', () => {
    const r = size(base);
    expect(r.grooveWidthMm).toBeCloseTo(1.75 + 0.1, 6);
  });

  it('groove crush thrust positive', () => {
    const r = size(base);
    expect(r.grooveCrushThrustN).toBeGreaterThan(0);
  });

  it('higher yield → higher crush capacity', () => {
    const soft = size({ ...base, housingYieldMpa: 200 });
    const hard = size({ ...base, housingYieldMpa: 600 });
    expect(hard.grooveCrushThrustN).toBeGreaterThan(soft.grooveCrushThrustN);
  });

  it('ring rating governs when lower than crush', () => {
    const r = size({ ...base, ringRatedThrustN: 100 });
    expect(r.governingMode).toBe('ring-rating');
    expect(r.governingThrustN).toBe(100);
  });

  it('groove crush governs when ring rating high', () => {
    const r = size({ ...base, ringRatedThrustN: 1e9 });
    expect(r.governingMode).toBe('groove-crush');
  });

  it('higher safety factor → lower allowable', () => {
    const low = size({ ...base, safetyFactor: 1 });
    const high = size({ ...base, safetyFactor: 4 });
    expect(high.grooveCrushThrustN).toBeLessThan(low.grooveCrushThrustN);
  });

  it('zero diameter → warning', () => {
    const r = size({ ...base, nominalDiameterMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('safetyAt', () => {
  it('governing / applied', () => {
    const r = size(base);
    expect(safetyAt(r, r.governingThrustN / 3)).toBeCloseTo(3, 4);
  });

  it('zero applied → Infinity', () => {
    expect(safetyAt(size(base), 0)).toBe(Infinity);
  });
});

describe('grooveStressConcentration', () => {
  it('sharp root → high Kt', () => {
    const sharp = grooveStressConcentration(2, 0.05);
    const round = grooveStressConcentration(2, 0.5);
    expect(sharp).toBeGreaterThan(round);
  });

  it('zero root radius → Infinity', () => {
    expect(grooveStressConcentration(2, 0)).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('reports groove dims + thrust', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.grooveDiameterMm).toBe(r.grooveDiameterMm);
    expect(s.governingThrustN).toBe(r.governingThrustN);
  });
});
