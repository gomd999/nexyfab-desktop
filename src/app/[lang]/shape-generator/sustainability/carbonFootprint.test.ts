import { describe, it, expect } from 'vitest';
import {
  computeCarbonFootprint, compareMaterials, carEquivalentKm, treesYearEquivalent,
  GRID_GWP_KR, GRID_GWP_GLOBAL, TRANSPORT_GWP,
} from './carbonFootprint';

describe('computeCarbonFootprint', () => {
  it('material kgCO2e = mass × GWP', () => {
    const r = computeCarbonFootprint({
      massKg: 1, material: 'aluminum-virgin', process: 'cnc-milling',
    });
    expect(r.material.kgCO2e).toBe(12.5);
  });

  it('manufacturing energy × grid factor', () => {
    const r = computeCarbonFootprint({
      massKg: 1, material: 'steel-mild', process: 'cnc-milling',
    });
    // 4.5 kWh × 0.42 kgCO2e/kWh = 1.89 kgCO2e
    expect(r.manufacturing.kgCO2e).toBeCloseTo(1.89, 2);
  });

  it('transport contributes when distance set', () => {
    const r = computeCarbonFootprint({
      massKg: 1, material: 'steel-mild', process: 'cnc-milling',
      transportKm: 1000, transportMode: 'truck',
    });
    expect(r.transport.kgCO2e).toBeGreaterThan(0);
  });

  it('no transport when distance unset', () => {
    const r = computeCarbonFootprint({
      massKg: 1, material: 'steel-mild', process: 'cnc-milling',
    });
    expect(r.transport.kgCO2e).toBe(0);
  });

  it('total = sum of three components', () => {
    const r = computeCarbonFootprint({
      massKg: 2, material: 'aluminum-recycled', process: 'cnc-milling',
      transportKm: 500, transportMode: 'truck',
    });
    const sum = r.material.kgCO2e + r.manufacturing.kgCO2e + r.transport.kgCO2e;
    expect(r.total).toBeCloseTo(sum, 6);
  });

  it('global grid factor differs from KR', () => {
    expect(GRID_GWP_GLOBAL).not.toBe(GRID_GWP_KR);
  });

  it('TRANSPORT_GWP includes truck/sea/air/rail', () => {
    expect(TRANSPORT_GWP.truck).toBeGreaterThan(0);
    expect(TRANSPORT_GWP.air).toBeGreaterThan(TRANSPORT_GWP.sea);
  });
});

describe('compareMaterials', () => {
  it('recycled aluminum has lower carbon than virgin', () => {
    const r = compareMaterials(
      { massKg: 1, material: 'aluminum-virgin',   process: 'cnc-milling' },
      { massKg: 1, material: 'aluminum-recycled', process: 'cnc-milling' },
    );
    expect(r.deltaKgCO2e).toBeGreaterThan(0);
    expect(r.pctReduction).toBeGreaterThan(50);
  });
});

describe('equivalence helpers', () => {
  it('carEquivalentKm scales with kgCO2e', () => {
    expect(carEquivalentKm(10)).toBeCloseTo(44, 0);
  });

  it('treesYearEquivalent is positive', () => {
    expect(treesYearEquivalent(20)).toBeGreaterThan(0);
  });
});
