import { describe, it, expect } from 'vitest';
import {
  balanceForces,
  suggestFix,
  checkCapacity,
  summarize,
  type EjectorPin,
  type EjectionRequirement,
} from './ejectorForceBalance';

function pin(id: string, x: number, y: number, dia: number = 5, len: number = 50): EjectorPin {
  return { id, position: { x, y }, diameterMm: dia, freeLengthMm: len, youngMpa: 200000 };
}

const req: EjectionRequirement = { releaseForceN: 500, partCentroid: { x: 0, y: 0 } };

describe('balanceForces', () => {
  it('empty pins → warning', () => {
    const r = balanceForces([], req);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('four-pin symmetric → balanced', () => {
    const pins = [pin('p1', -10, -10), pin('p2', 10, -10), pin('p3', 10, 10), pin('p4', -10, 10)];
    const r = balanceForces(pins, req);
    expect(r.imbalanceFraction).toBeLessThan(0.1);
  });

  it('two-pin asymmetric flags imbalance', () => {
    const pins = [pin('close', 1, 0), pin('far', 100, 0)];
    const r = balanceForces(pins, req);
    expect(r.imbalanceFraction).toBeGreaterThan(0.1);
  });

  it('mean load × N ≈ release force', () => {
    const pins = [pin('p1', -10, -10), pin('p2', 10, -10), pin('p3', 10, 10), pin('p4', -10, 10)];
    const r = balanceForces(pins, req);
    expect(r.meanLoadN * pins.length).toBeCloseTo(req.releaseForceN, 1);
  });

  it('thin pin buckles under high load', () => {
    const pins = [pin('thin', 0, 0, 1, 200)];
    const r = balanceForces(pins, { releaseForceN: 10000, partCentroid: { x: 0, y: 0 } });
    expect(r.bucklingPins.length).toBeGreaterThan(0);
  });

  it('utilisation < 1 for safe pin', () => {
    const pins = [pin('safe', 0, 0, 8, 30), pin('safe2', 10, 0, 8, 30)];
    const r = balanceForces(pins, { releaseForceN: 100, partCentroid: { x: 5, y: 0 } });
    expect(r.loads.every(l => l.utilisation < 1)).toBe(true);
  });
});

describe('suggestFix', () => {
  it('suggests increase diameter when buckling', () => {
    const pins = [pin('thin', 0, 0, 1, 200)];
    const r = balanceForces(pins, { releaseForceN: 10000, partCentroid: { x: 0, y: 0 } });
    expect(suggestFix(r, pins).some(s => s.action === 'increase-diameter')).toBe(true);
  });

  it('suggests add pin when <4', () => {
    const pins = [pin('p1', 0, 0), pin('p2', 10, 0)];
    const r = balanceForces(pins, req);
    expect(suggestFix(r, pins).some(s => s.action === 'add-pin')).toBe(true);
  });
});

describe('checkCapacity', () => {
  it('positive total capacity', () => {
    const pins = [pin('p1', 0, 0), pin('p2', 10, 0)];
    const r = checkCapacity(pins, req);
    expect(r.totalAvailableN).toBeGreaterThan(0);
  });

  it('ok flag when sufficient', () => {
    const pins = [pin('p1', 0, 0, 10, 20), pin('p2', 10, 0, 10, 20)];
    const r = checkCapacity(pins, { releaseForceN: 100, partCentroid: { x: 0, y: 0 } });
    expect(r.ok).toBe(true);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const pins = [pin('p1', -5, 0), pin('p2', 5, 0)];
    const r = balanceForces(pins, req);
    const s = summarize(r);
    expect(s.pinCount).toBe(2);
    expect(s.meanLoadN).toBeCloseTo(r.meanLoadN, 3);
  });
});
