import { describe, it, expect } from 'vitest';
import { compute, rateBreakdown, summarize, type MachineHourRateInput } from './machineHourRate';

const base: MachineHourRateInput = {
  capitalCost: 300000, lifeYears: 10, connectedKW: 30, energyPricePerKWh: 0.15,
  operatorRatePerHour: 35,
};

describe('compute', () => {
  it('annual hours from shifts/util', () => {
    const r = compute({ ...base, shiftsPerDay: 2, hoursPerShift: 8, daysPerYear: 240, utilisation: 0.75 });
    expect(r.annualProductiveHours).toBeCloseTo(2 * 8 * 240 * 0.75, 3);
  });

  it('capital rate positive', () => {
    expect(compute(base).capitalRatePerHour).toBeGreaterThan(0);
  });

  it('energy rate = kW·loadFactor·price', () => {
    const r = compute({ ...base, loadFactor: 0.5 });
    expect(r.energyRatePerHour).toBeCloseTo(30 * 0.5 * 0.15, 5);
  });

  it('labour rate includes burden', () => {
    const r = compute({ ...base, operatorRatePerHour: 40, operatorBurden: 0.5 });
    expect(r.labourRatePerHour).toBeCloseTo(40 * 1.5, 5);
  });

  it('higher utilisation → lower capital rate', () => {
    const lo = compute({ ...base, utilisation: 0.5 });
    const hi = compute({ ...base, utilisation: 0.95 });
    expect(hi.capitalRatePerHour).toBeLessThan(lo.capitalRatePerHour);
  });

  it('space cost added when given', () => {
    const none = compute(base);
    const withSpace = compute({ ...base, floorAreaM2: 20, spaceCostPerM2Yr: 200 });
    expect(withSpace.spaceRatePerHour).toBeGreaterThan(none.spaceRatePerHour);
  });

  it('total = sum of components', () => {
    const r = compute({ ...base, floorAreaM2: 20, spaceCostPerM2Yr: 200 });
    expect(r.totalRatePerHour).toBeCloseTo(
      r.capitalRatePerHour + r.energyRatePerHour + r.maintenanceRatePerHour + r.spaceRatePerHour + r.labourRatePerHour, 5);
  });

  it('zero capital → warning', () => {
    expect(compute({ ...base, capitalCost: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('rateBreakdown', () => {
  it('fractions sum to ~1', () => {
    const r = compute({ ...base, floorAreaM2: 20, spaceCostPerM2Yr: 200 });
    const b = rateBreakdown(r);
    expect(b.reduce((s, x) => s + x.fraction, 0)).toBeCloseTo(1, 5);
  });

  it('sorted descending', () => {
    const b = rateBreakdown(compute(base));
    for (let i = 1; i < b.length; i++) expect(b[i]!.fraction).toBeLessThanOrEqual(b[i - 1]!.fraction);
  });
});

describe('summarize', () => {
  it('reports total + capital', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.totalRatePerHour).toBe(r.totalRatePerHour);
  });
});
