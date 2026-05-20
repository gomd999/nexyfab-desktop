import { describe, it, expect } from 'vitest';
import {
  estimate,
  sensitivity,
  listMaterials,
  summarize,
} from './coolingTimeEstimator';

describe('estimate', () => {
  it('PP @ 2mm gives ~5-15 sec', () => {
    const r = estimate({ material: 'PP', wallThicknessMm: 2 });
    expect(r.adjustedCoolingTimeSec).toBeGreaterThan(2);
    expect(r.adjustedCoolingTimeSec).toBeLessThan(30);
  });

  it('doubling wall ≈ 4× cooling', () => {
    const thin = estimate({ material: 'PC', wallThicknessMm: 2 });
    const thick = estimate({ material: 'PC', wallThicknessMm: 4 });
    expect(thick.adjustedCoolingTimeSec / thin.adjustedCoolingTimeSec).toBeCloseTo(4, 1);
  });

  it('cycle time > cooling time', () => {
    const r = estimate({ material: 'ABS', wallThicknessMm: 3 });
    expect(r.cycleTimeEstimateSec).toBeGreaterThan(r.adjustedCoolingTimeSec);
  });

  it('geometry factor multiplies cooling', () => {
    const slab = estimate({ material: 'PP', wallThicknessMm: 2, geometryFactor: 1.0 });
    const ribbed = estimate({ material: 'PP', wallThicknessMm: 2, geometryFactor: 1.25 });
    expect(ribbed.adjustedCoolingTimeSec).toBeCloseTo(slab.adjustedCoolingTimeSec * 1.25, 3);
  });

  it('zero thickness → warning', () => {
    const r = estimate({ material: 'PP', wallThicknessMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('eject ≤ mold temp → warning', () => {
    const r = estimate({ material: 'PP', wallThicknessMm: 2, ejectionTempC: 20, moldTempC: 40 });
    expect(r.warnings.some(w => w.toLowerCase().includes('eject'))).toBe(true);
  });

  it('unknown material falls back', () => {
    const r = estimate({ material: 'XYZ' as never, wallThicknessMm: 2 });
    expect(r.warnings.some(w => w.includes('Unknown'))).toBe(true);
    expect(r.materialUsed.className).toBe('PP');
  });

  it('PA66 cooling > PP for same wall (higher melt + eject delta)', () => {
    const pp = estimate({ material: 'PP', wallThicknessMm: 2 });
    const pa = estimate({ material: 'PA66', wallThicknessMm: 2 });
    expect(pa.adjustedCoolingTimeSec).toBeGreaterThan(0);
    expect(pp.adjustedCoolingTimeSec).toBeGreaterThan(0);
  });
});

describe('sensitivity', () => {
  it('positive delta → multiplier > 1', () => {
    const r = sensitivity({ material: 'PP', wallThicknessMm: 2 }, 0.5);
    expect(r.multiplier).toBeGreaterThan(1);
  });
});

describe('listMaterials', () => {
  it('returns all 10 classes', () => {
    expect(listMaterials()).toContain('PP');
    expect(listMaterials().length).toBeGreaterThanOrEqual(10);
  });
});

describe('summarize', () => {
  it('reports cooling + cycle + material', () => {
    const r = estimate({ material: 'ABS', wallThicknessMm: 2.5 });
    const s = summarize(r);
    expect(s.material).toBe('ABS');
    expect(s.cycleTimeEstimateSec).toBe(r.cycleTimeEstimateSec);
  });
});
