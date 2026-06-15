/**
 * dcMotor — PM DC motor steady-state, verified: the stall (ω=0) and no-load (T=0)
 * endpoints; the linear torque–speed line agreeing with the circuit current; the circuit
 * balance V=IR+k_e·ω; and the peak mechanical power at half the no-load speed.
 */
import { describe, it, expect } from 'vitest';
import { backEMF, motorCurrent, motorTorque, stallTorque, noLoadSpeed, torqueAtSpeed, mechanicalPower } from './dcMotor';

describe('dcMotor — torque–speed (verified)', () => {
  const V = 24, R = 0.5, ke = 0.05, kt = 0.05;
  const Tstall = stallTorque(kt, V, R);
  const wnl = noLoadSpeed(V, ke);

  it('hits the stall and no-load endpoints', () => {
    expect(motorCurrent(V, ke, 0, R)).toBeCloseTo(V / R, 9);        // 48 A
    expect(motorTorque(kt, motorCurrent(V, ke, 0, R))).toBeCloseTo(Tstall, 9); // 2.4 N·m
    expect(wnl).toBeCloseTo(V / ke, 9);                             // 480 rad/s
    expect(torqueAtSpeed(Tstall, wnl, wnl)).toBeCloseTo(0, 9);      // no torque at no-load
  });

  it('matches the torque–speed line to the circuit current, balancing V=IR+k_e·ω', () => {
    const omega = 200;
    const I = motorCurrent(V, ke, omega, R);
    expect(I * R + backEMF(ke, omega)).toBeCloseTo(V, 9);           // Kirchhoff
    expect(motorTorque(kt, I)).toBeCloseTo(torqueAtSpeed(Tstall, omega, wnl), 9);
  });

  it('peaks mechanical power at half the no-load speed', () => {
    const Pmid = mechanicalPower(torqueAtSpeed(Tstall, wnl / 2, wnl), wnl / 2);
    expect(Pmid).toBeGreaterThan(mechanicalPower(torqueAtSpeed(Tstall, 0.3 * wnl, wnl), 0.3 * wnl));
    expect(Pmid).toBeGreaterThan(mechanicalPower(torqueAtSpeed(Tstall, 0.7 * wnl, wnl), 0.7 * wnl));
    expect(Pmid).toBeCloseTo((Tstall * wnl) / 4, 6);                // P_max = T_stall·ω_nl/4
  });
});
