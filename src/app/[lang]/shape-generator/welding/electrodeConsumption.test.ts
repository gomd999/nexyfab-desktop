import { describe, it, expect } from 'vitest';
import {
  estimate, filletJointArea, depositionEfficiency, summarize,
  type ElectrodeConsumptionInput,
} from './electrodeConsumption';

const base: ElectrodeConsumptionInput = {
  jointAreaMm2: filletJointArea(8), // 32 mm²
  weldLengthMm: 1000,
  process: 'GMAW',
  depositionRateKgH: 4,
  fillerPricePerKg: 3,
  labourRatePerHour: 50,
};

describe('estimate', () => {
  it('weld volume = area × length', () => {
    expect(estimate(base).weldVolumeMm3).toBeCloseTo(32 * 1000, 3);
  });

  it('deposit mass = volume × density', () => {
    const r = estimate(base);
    expect(r.depositMassG).toBeCloseTo(32 * 1000 * 1e-3 * 7.85, 3);
  });

  it('filler mass > deposit mass (loss)', () => {
    const r = estimate(base);
    expect(r.fillerMassG).toBeGreaterThan(r.depositMassG);
  });

  it('SMAW wastes more filler than SAW', () => {
    const smaw = estimate({ ...base, process: 'SMAW' });
    const saw = estimate({ ...base, process: 'SAW' });
    expect(smaw.fillerMassG).toBeGreaterThan(saw.fillerMassG);
  });

  it('arc time = deposit / rate', () => {
    const r = estimate(base);
    const ratePerMin = 4 * 1000 / 60;
    expect(r.arcTimeMin).toBeCloseTo(r.depositMassG / ratePerMin, 4);
  });

  it('total time > arc time (operating factor)', () => {
    const r = estimate(base);
    expect(r.totalTimeMin).toBeGreaterThan(r.arcTimeMin);
  });

  it('total cost = filler + labour', () => {
    const r = estimate(base);
    expect(r.totalCost).toBeCloseTo(r.fillerCost + r.labourCost, 6);
  });

  it('higher deposition rate → shorter arc time', () => {
    const slow = estimate({ ...base, depositionRateKgH: 2 });
    const fast = estimate({ ...base, depositionRateKgH: 8 });
    expect(fast.arcTimeMin).toBeLessThan(slow.arcTimeMin);
  });

  it('unknown process → warning', () => {
    expect(estimate({ ...base, process: 'XYZ' as never }).warnings.length).toBeGreaterThan(0);
  });

  it('zero deposition rate → warning', () => {
    expect(estimate({ ...base, depositionRateKgH: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('filletJointArea', () => {
  it('½·leg²', () => {
    expect(filletJointArea(10)).toBe(50);
  });
});

describe('depositionEfficiency', () => {
  it('GMAW > SMAW', () => {
    expect(depositionEfficiency('GMAW')).toBeGreaterThan(depositionEfficiency('SMAW'));
  });
  it('SAW = 1.0', () => {
    expect(depositionEfficiency('SAW')).toBe(1.0);
  });
});

describe('summarize', () => {
  it('reports filler + cost', () => {
    const r = estimate(base);
    const s = summarize(r);
    expect(s.fillerMassG).toBe(r.fillerMassG);
    expect(s.totalCost).toBe(r.totalCost);
  });
});
