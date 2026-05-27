import { describe, it, expect } from 'vitest';
import { estimate, nestCostPerPart, summarize, type PrintBuildCostInput } from './printBuildCost';

const base: PrintBuildCostInput = {
  process: 'FDM', partVolumeMm3: 50000, buildHeightMm: 80, layerHeightMm: 0.2,
  machineRatePerHour: 6, materialPricePerKg: 30,
};

describe('estimate', () => {
  it('layers = height / layerHeight', () => {
    expect(estimate(base).layers).toBeCloseTo(80 / 0.2, 3);
  });

  it('build time positive', () => {
    expect(estimate(base).buildTimeHours).toBeGreaterThan(0);
  });

  it('material mass includes support', () => {
    const noSup = estimate({ ...base, supportFractionOverride: 0 });
    const sup = estimate({ ...base, supportFractionOverride: 0.5 });
    expect(sup.materialMassG).toBeGreaterThan(noSup.materialMassG);
  });

  it('SLS has no support vs FDM', () => {
    const fdm = estimate({ ...base, process: 'FDM' });
    const sls = estimate({ ...base, process: 'SLS' });
    // SLS support fraction 0 → less material for same volume
    expect(sls.materialMassG / 0.95).toBeCloseTo(50000 * 1e-3, 1);
    expect(fdm.materialMassG).toBeGreaterThan(0);
  });

  it('thinner layers → more layers → more time', () => {
    const coarse = estimate({ ...base, layerHeightMm: 0.4 });
    const fine = estimate({ ...base, layerHeightMm: 0.1 });
    expect(fine.buildTimeHours).toBeGreaterThan(coarse.buildTimeHours);
  });

  it('total = sum of components', () => {
    const r = estimate({ ...base, setupCost: 50, batchQuantity: 10 });
    expect(r.totalCostPerPart).toBeCloseTo(r.machineCost + r.materialCost + r.postProcessCost + r.setupCostPerPart, 5);
  });

  it('DMLS far more expensive than FDM', () => {
    const fdm = estimate({ ...base, process: 'FDM' });
    const dmls = estimate({ ...base, process: 'DMLS' });
    expect(dmls.totalCostPerPart).toBeGreaterThan(fdm.totalCostPerPart);
  });

  it('unknown process → warning', () => {
    expect(estimate({ ...base, process: 'XYZ' as never }).warnings.length).toBeGreaterThan(0);
  });

  it('zero layer height → warning', () => {
    expect(estimate({ ...base, layerHeightMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('nestCostPerPart', () => {
  it('nesting lowers per-part cost', () => {
    const single = estimate(base).totalCostPerPart;
    const nested = nestCostPerPart(base, 8);
    expect(nested).toBeLessThan(single);
  });

  it('zero nest → Infinity', () => {
    expect(nestCostPerPart(base, 0)).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('reports total + time', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.totalCostPerPart).toBe(r.totalCostPerPart);
    expect(s.buildTimeHours).toBe(r.buildTimeHours);
  });
});
