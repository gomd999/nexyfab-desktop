import { describe, it, expect } from 'vitest';
import { size, heatLossWperM, summarize, type PipeInsulationInput } from './pipeInsulationThickness';

// Chilled water pipe: 7°C surface, 30°C ambient, dew point 20°C → condensation control.
const cond: PipeInsulationInput = {
  pipeOuterDiameterMm: 60, pipeSurfaceTempC: 7, ambientTempC: 30,
  conductivityWmK: 0.035, surfaceFilmCoeffWm2K: 9, goal: 'condensation', dewPointC: 20,
};

// Hot pipe heat-loss control.
const loss: PipeInsulationInput = {
  pipeOuterDiameterMm: 88.9, pipeSurfaceTempC: 120, ambientTempC: 25,
  conductivityWmK: 0.04, surfaceFilmCoeffWm2K: 10, goal: 'heat-loss', allowableLossWperM: 40,
};

describe('size (condensation)', () => {
  it('selects a thickness keeping surface ≥ dew point', () => {
    const r = size(cond);
    expect(r.selectedThicknessMm).not.toBeNull();
    expect(r.surfaceTempC).toBeGreaterThanOrEqual(20 - 0.5);
    expect(r.goalMet).toBe(true);
  });

  it('thicker insulation → less heat loss', () => {
    const thin = heatLossWperM(cond, 13);
    const thick = heatLossWperM(cond, 75);
    expect(thick).toBeLessThan(thin);
  });
});

describe('size (heat-loss)', () => {
  it('selects a thickness meeting allowable loss', () => {
    const r = size(loss);
    expect(r.selectedThicknessMm).not.toBeNull();
    expect(r.heatLossWperM).toBeLessThanOrEqual(40 + 1e-6);
  });

  it('tighter allowable → thicker insulation', () => {
    const lenient = size({ ...loss, allowableLossWperM: 80 });
    const strict = size({ ...loss, allowableLossWperM: 25 });
    expect(strict.selectedThicknessMm!).toBeGreaterThanOrEqual(lenient.selectedThicknessMm!);
  });

  it('unreachable target → null + warning', () => {
    const r = size({ ...loss, allowableLossWperM: 1, candidateThicknessesMm: [13, 25] });
    expect(r.selectedThicknessMm).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('bare loss reported', () => {
    expect(size(loss).bareLossWperM).toBeGreaterThan(0);
  });

  it('lower conductivity → less loss', () => {
    const hi = heatLossWperM({ ...loss, conductivityWmK: 0.08 }, 50);
    const lo = heatLossWperM({ ...loss, conductivityWmK: 0.02 }, 50);
    expect(lo).toBeLessThan(hi);
  });
});

describe('summarize', () => {
  it('reports thickness + loss', () => {
    const r = size(cond);
    const s = summarize(r);
    expect(s.selectedThicknessMm).toBe(r.selectedThicknessMm);
    expect(s.goalMet).toBe(r.goalMet);
  });
});
