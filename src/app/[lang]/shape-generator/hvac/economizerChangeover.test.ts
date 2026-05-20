import { describe, it, expect } from 'vitest';
import {
  evaluate,
  mixedAirTempC,
  summarize,
  type EconomizerInput,
} from './economizerChangeover';

const dryBulbBase: EconomizerInput = {
  outdoorDryBulbC: 12,
  returnDryBulbC: 24,
  supplySetpointC: 14,
  changeoverMode: 'dry-bulb',
};

describe('evaluate (dry-bulb)', () => {
  it('cool OA below limit → enabled', () => {
    const r = evaluate({ ...dryBulbBase, outdoorDryBulbC: 12, dryBulbLimitC: 18 });
    expect(r.economizerEnabled).toBe(true);
  });

  it('warm OA above limit → disabled', () => {
    const r = evaluate({ ...dryBulbBase, outdoorDryBulbC: 25, dryBulbLimitC: 18 });
    expect(r.economizerEnabled).toBe(false);
    expect(r.outdoorAirFraction).toBeCloseTo(0.15, 6); // min OA
  });

  it('OA between setpoint and return → blends, no mech cooling', () => {
    const r = evaluate({ ...dryBulbBase, outdoorDryBulbC: 12, returnDryBulbC: 24, supplySetpointC: 14 });
    expect(r.mechanicalCoolingNeeded).toBe(false);
    expect(r.outdoorAirFraction).toBeGreaterThan(0.15);
    expect(r.outdoorAirFraction).toBeLessThanOrEqual(1);
  });

  it('OA warmer than setpoint but below return → 100% OA, still mech', () => {
    const r = evaluate({ ...dryBulbBase, outdoorDryBulbC: 16, returnDryBulbC: 24, supplySetpointC: 14, dryBulbLimitC: 18 });
    expect(r.outdoorAirFraction).toBeCloseTo(1, 6);
    expect(r.mechanicalCoolingNeeded).toBe(true);
  });

  it('blend OA fraction hits setpoint', () => {
    const r = evaluate({ ...dryBulbBase, outdoorDryBulbC: 10, returnDryBulbC: 26, supplySetpointC: 14 });
    const tmix = mixedAirTempC(10, 26, r.outdoorAirFraction);
    expect(tmix).toBeCloseTo(14, 1);
  });
});

describe('evaluate (enthalpy)', () => {
  it('OA enthalpy < return → enabled', () => {
    const r = evaluate({
      outdoorDryBulbC: 18, returnDryBulbC: 24, supplySetpointC: 14,
      changeoverMode: 'enthalpy', outdoorEnthalpyKJkg: 35, returnEnthalpyKJkg: 48,
    });
    expect(r.economizerEnabled).toBe(true);
  });

  it('OA enthalpy ≥ return → disabled', () => {
    const r = evaluate({
      outdoorDryBulbC: 30, returnDryBulbC: 24, supplySetpointC: 14,
      changeoverMode: 'enthalpy', outdoorEnthalpyKJkg: 60, returnEnthalpyKJkg: 48,
    });
    expect(r.economizerEnabled).toBe(false);
  });

  it('missing enthalpy → warning + disabled', () => {
    const r = evaluate({ ...dryBulbBase, changeoverMode: 'enthalpy' });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.economizerEnabled).toBe(false);
  });
});

describe('mixedAirTempC', () => {
  it('100% OA → outdoor temp', () => {
    expect(mixedAirTempC(10, 24, 1)).toBeCloseTo(10, 6);
  });

  it('0% OA → return temp', () => {
    expect(mixedAirTempC(10, 24, 0)).toBeCloseTo(24, 6);
  });

  it('50/50 blend', () => {
    expect(mixedAirTempC(10, 24, 0.5)).toBeCloseTo(17, 6);
  });
});

describe('summarize', () => {
  it('reports enabled + OA fraction + mech', () => {
    const r = evaluate(dryBulbBase);
    const s = summarize(r);
    expect(s.economizerEnabled).toBe(r.economizerEnabled);
    expect(s.mechanicalCoolingNeeded).toBe(r.mechanicalCoolingNeeded);
  });
});
