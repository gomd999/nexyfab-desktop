/**
 * rcCircuit — first-order RC/RL transients, verified: the 63.2% charge / 36.8% discharge
 * at one time constant; the 0/V_steady end conditions; the inductor steady current V/R;
 * and the capacitor energy ½CV².
 */
import { describe, it, expect } from 'vitest';
import { rcTimeConstant, rlTimeConstant, capacitorCharging, capacitorDischarging, inductorCurrent, capacitorEnergy } from './rcCircuit';

describe('rcCircuit — first-order transients (verified)', () => {
  const R = 1000, C = 1e-6, V = 5;
  const tau = rcTimeConstant(R, C);

  it('charges to 63.2% at t=τ and to V at long time', () => {
    expect(tau).toBeCloseTo(1e-3, 12);
    expect(capacitorCharging(V, 0, tau)).toBeCloseTo(0, 12);
    expect(capacitorCharging(V, tau, tau)).toBeCloseTo(V * (1 - 1 / Math.E), 9); // 0.632·V
    expect(capacitorCharging(V, 1000 * tau, tau)).toBeCloseTo(V, 6);
  });

  it('discharges to 36.8% at t=τ from V₀', () => {
    expect(capacitorDischarging(V, 0, tau)).toBeCloseTo(V, 12);
    expect(capacitorDischarging(V, tau, tau)).toBeCloseTo(V / Math.E, 9);        // 0.368·V
    // charge + discharge are complementary
    expect(capacitorCharging(V, tau, tau) + capacitorDischarging(V, tau, tau)).toBeCloseTo(V, 9);
  });

  it('drives the inductor to a steady current V/R', () => {
    const tauL = rlTimeConstant(0.5, R);
    expect(tauL).toBeCloseTo(0.5 / R, 12);
    expect(inductorCurrent(V, R, 0, tauL)).toBeCloseTo(0, 12);
    expect(inductorCurrent(V, R, 1000 * tauL, tauL)).toBeCloseTo(V / R, 9);       // 5 mA
  });

  it('stores capacitor energy ½CV²', () => {
    expect(capacitorEnergy(C, V)).toBeCloseTo(0.5 * C * V * V, 15);
    expect(capacitorEnergy(C, 2 * V)).toBeCloseTo(4 * capacitorEnergy(C, V), 15); // ∝ V²
  });
});
