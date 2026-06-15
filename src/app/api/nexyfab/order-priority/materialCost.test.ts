// @vitest-environment node
/**
 * Honesty fix: order-priority margin used a flat 200 KRW/cm³ for ALL materials
 * (gold == aluminium). Now material-aware, and flags "approximate" when the
 * material is unknown instead of presenting a fake-precise margin.
 */
import { describe, it, expect } from 'vitest';
import { materialCostKrwPerCm3 } from './materialCost';

describe('order-priority materialCostKrwPerCm3', () => {
  it('prices materials differently (titanium >> aluminium)', () => {
    const ti = materialCostKrwPerCm3('titanium');
    const al = materialCostKrwPerCm3('aluminum');
    expect(ti.known).toBe(true);
    expect(al.known).toBe(true);
    expect(ti.perCm3).toBeGreaterThan(al.perCm3 * 10); // ~1063 vs ~32
  });

  it('matches common aliases case-insensitively', () => {
    expect(materialCostKrwPerCm3('Aluminum 6061').known).toBe(true);
    expect(materialCostKrwPerCm3('Stainless Steel 304').known).toBe(true);
    expect(materialCostKrwPerCm3('ABS').known).toBe(true);
  });

  it('flags unknown material (so the margin is marked approximate)', () => {
    const u = materialCostKrwPerCm3(null);
    expect(u.known).toBe(false);
    expect(u.perCm3).toBeGreaterThan(0);
    expect(materialCostKrwPerCm3('unobtanium').known).toBe(false);
  });
});
