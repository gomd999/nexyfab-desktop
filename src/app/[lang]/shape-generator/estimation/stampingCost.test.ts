import { describe, it, expect } from 'vitest';
import { estimate, partsPerHour, summarize, type StampingCostInput } from './stampingCost';

const base: StampingCostInput = {
  perimeterMm: 300, thicknessMm: 2, shearStrengthMpa: 350,
  partAreaMm2: 4000, partMassG: 63, stripPitchMm: 80, stripWidthMm: 70,
  materialPricePerKg: 1.2, strokesPerMin: 60, pressRatePerMin: 1.5,
};

describe('estimate', () => {
  it('blanking force = L·t·τ', () => {
    expect(estimate(base).blankingForceN).toBeCloseTo(300 * 2 * 350, 3);
  });

  it('required tonnage from force × safety', () => {
    const r = estimate(base);
    expect(r.requiredPressTonnes).toBeCloseTo((300 * 2 * 350 * 1.2) / 9806.65, 4);
  });

  it('strip utilisation = partArea / strip cell', () => {
    const r = estimate(base);
    expect(r.stripUtilisation).toBeCloseTo(4000 / (80 * 70), 5);
  });

  it('material cost rises as utilisation falls', () => {
    const tight = estimate({ ...base, stripPitchMm: 65, stripWidthMm: 62 });
    const loose = estimate({ ...base, stripPitchMm: 120, stripWidthMm: 100 });
    expect(loose.materialCost).toBeGreaterThan(tight.materialCost);
  });

  it('press cost = rate / strokes', () => {
    expect(estimate(base).pressCost).toBeCloseTo(1.5 / 60, 6);
  });

  it('die cost amortised', () => {
    const r = estimate({ ...base, diePrice: 40000, dieLifeStrokes: 200000 });
    expect(r.dieCostPerPart).toBeCloseTo(0.2, 6);
  });

  it('press capability flagged', () => {
    const ok = estimate({ ...base, pressCapacityTonnes: 100 });
    const no = estimate({ ...base, pressCapacityTonnes: 10 });
    expect(ok.pressCapable).toBe(true);
    expect(no.pressCapable).toBe(false);
    expect(no.warnings.length).toBeGreaterThan(0);
  });

  it('thicker material → more force', () => {
    expect(estimate({ ...base, thicknessMm: 4 }).blankingForceN)
      .toBeGreaterThan(estimate({ ...base, thicknessMm: 1 }).blankingForceN);
  });

  it('zero strokes → warning', () => {
    expect(estimate({ ...base, strokesPerMin: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('partsPerHour', () => {
  it('strokes × 60', () => {
    expect(partsPerHour(60)).toBe(3600);
  });
});

describe('summarize', () => {
  it('reports total + tonnage', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalCostPerPart).toBe(r.totalCostPerPart);
    expect(s.requiredPressTonnes).toBe(r.requiredPressTonnes);
  });
});
