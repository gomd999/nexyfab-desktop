import { describe, it, expect } from 'vitest';
import { estimateCost, type CostInput } from './costModel';

const base: CostInput = {
  volume_mm3: 30_000,
  surface_area_mm2: 12_000,
  bbox_mm: { w: 60, h: 40, d: 20 },
  material: 'aluminum',
  process: 'cnc',
  quantity: 10,
};

describe('estimateCost', () => {
  it('returns a positive range with min < max and total = perPart×qty', () => {
    const e = estimateCost(base);
    expect(e.perPart.min).toBeGreaterThan(0);
    expect(e.perPart.max).toBeGreaterThan(e.perPart.min);
    expect(e.total.min).toBeGreaterThanOrEqual(e.perPart.min * base.quantity * 0.95);
    expect(e.currency).toBe('KRW');
  });

  it('bigger part costs more (CNC)', () => {
    const small = estimateCost(base);
    const big = estimateCost({ ...base, volume_mm3: 300_000, surface_area_mm2: 60_000, bbox_mm: { w: 120, h: 90, d: 60 } });
    expect(big.perPart.max).toBeGreaterThan(small.perPart.max);
  });

  it('titanium CNC costs more than aluminum (harder + pricier)', () => {
    const al = estimateCost({ ...base, material: 'aluminum' });
    const ti = estimateCost({ ...base, material: 'titanium' });
    expect(ti.perPart.min).toBeGreaterThan(al.perPart.min);
  });

  it('injection per-part drops as quantity rises (mold amortized)', () => {
    const low = estimateCost({ ...base, process: 'injection', material: 'abs_white', quantity: 10 });
    const high = estimateCost({ ...base, process: 'injection', material: 'abs_white', quantity: 10_000 });
    expect(high.perPart.min).toBeLessThan(low.perPart.min);
  });

  it('CN region is cheaper than KR', () => {
    const kr = estimateCost({ ...base, region: 'kr' });
    const cn = estimateCost({ ...base, region: 'cn' });
    expect(cn.perPart.min).toBeLessThan(kr.perPart.min);
  });

  it('uncalibrated → low confidence; calibrationFactor scales the estimate', () => {
    const raw = estimateCost(base);
    expect(raw.confidence).toBe('low');
    expect(raw.calibrated).toBe(false);
    const cal = estimateCost({ ...base, calibrationFactor: 2 });
    expect(cal.calibrated).toBe(true);
    expect(cal.perPart.min).toBeGreaterThan(raw.perPart.min);
  });
});
