import { describe, it, expect } from 'vitest';
import { compute, maxSingleDrawHeight, summarize, type DeepDrawInput } from './deepDraw';

// d=50, h=30 → D=√(2500+6000)=√8500≈92.2, DR≈1.84 (single-draw feasible @ LDR 2.0)
const base: DeepDrawInput = {
  cupDiameterMm: 50, cupHeightMm: 30, thicknessMm: 1.0, ultimateTensileMPa: 350,
};

describe('compute', () => {
  it('blank diameter D = √(d²+4dh)', () => {
    expect(compute(base).blankDiameterMm).toBeCloseTo(Math.sqrt(2500 + 4 * 50 * 30), 4);
  });

  it('draw ratio = D/d', () => {
    const r = compute(base);
    expect(r.drawRatio).toBeCloseTo(r.blankDiameterMm / 50, 5);
  });

  it('feasible single draw when DR ≤ LDR', () => {
    expect(compute(base).feasibleSingleDraw).toBe(true);
    expect(compute(base).redrawStages).toBe(1);
  });

  it('tall cup → infeasible single draw, multiple stages', () => {
    const r = compute({ ...base, cupHeightMm: 150 });
    expect(r.feasibleSingleDraw).toBe(false);
    expect(r.redrawStages).toBeGreaterThan(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('draw force = π·d·t·UTS·(D/d − C)', () => {
    const r = compute(base);
    const expected = Math.PI * 50 * 1.0 * 350 * (r.drawRatio - 0.65);
    expect(r.drawForceN).toBeCloseTo(expected, 3);
  });

  it('blank-holder force positive', () => {
    expect(compute(base).blankHolderForceN).toBeGreaterThan(0);
  });

  it('thicker blank → higher draw force', () => {
    const thin = compute({ ...base, thicknessMm: 0.5 });
    const thick = compute({ ...base, thicknessMm: 2.0 });
    expect(thick.drawForceN).toBeGreaterThan(thin.drawForceN);
  });

  it('custom LDR changes feasibility', () => {
    expect(compute({ ...base, limitingDrawRatio: 1.5 }).feasibleSingleDraw).toBe(false);
  });

  it('zero thickness → warning', () => {
    expect(compute({ ...base, thicknessMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('maxSingleDrawHeight', () => {
  it('h = (D²−d²)/(4d) at D=LDR·d', () => {
    const d = 50, LDR = 2.0;
    const D = LDR * d;
    expect(maxSingleDrawHeight(d, LDR)).toBeCloseTo((D * D - d * d) / (4 * d), 5);
  });
});

describe('summarize', () => {
  it('reports blank + ratio + stages', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.blankDiameterMm).toBe(r.blankDiameterMm);
    expect(s.redrawStages).toBe(r.redrawStages);
  });
});
