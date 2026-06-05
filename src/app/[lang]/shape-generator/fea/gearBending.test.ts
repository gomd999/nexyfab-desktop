/**
 * gearBending — Lewis gear-tooth bending, verified: the tangential load from torque
 * (2T/d) equals that from power (P/v); the pitch-line velocity v=πdn=ωr; the Lewis
 * stress W_t/(F·m·Y) and its decrease with module/face width; and the Barth velocity
 * derating and the resulting safety factor.
 */
import { describe, it, expect } from 'vitest';
import { tangentialLoadFromTorque, tangentialLoadFromPower, pitchLineVelocity, lewisBendingStress, barthVelocityFactor, safetyFactor } from './gearBending';

const T = 100, d = 0.1, n = 10;

describe('gearBending — Lewis tooth bending (verified)', () => {
  it('the tangential load from torque equals that from power', () => {
    const Wt = tangentialLoadFromTorque(T, d);
    expect(Wt).toBeCloseTo((2 * T) / d, 9);                 // 2000 N
    const omega = 2 * Math.PI * n, v = pitchLineVelocity(d, n), P = T * omega;
    expect(tangentialLoadFromPower(P, v)).toBeCloseTo(Wt, 6);
  });

  it('the pitch-line velocity is v = πdn = ωr', () => {
    const omega = 2 * Math.PI * n;
    expect(pitchLineVelocity(d, n)).toBeCloseTo(Math.PI * d * n, 9);
    expect(pitchLineVelocity(d, n)).toBeCloseTo(omega * (d / 2), 9);
  });

  it('the Lewis stress is W_t/(F·m·Y) and drops with module / face width', () => {
    const Wt = tangentialLoadFromTorque(T, d), F = 0.02, m = 0.005, Y = 0.35;
    expect(lewisBendingStress(Wt, F, m, Y)).toBeCloseTo(Wt / (F * m * Y), 3);
    expect(lewisBendingStress(Wt, F, 2 * m, Y)).toBeCloseTo(lewisBendingStress(Wt, F, m, Y) / 2, 3); // double module ⇒ half stress
    expect(lewisBendingStress(Wt, 2 * F, m, Y)).toBeLessThan(lewisBendingStress(Wt, F, m, Y));
  });

  it('the Barth factor derates with speed, lowering the safety factor', () => {
    const v = pitchLineVelocity(d, n);
    expect(barthVelocityFactor(v)).toBeCloseTo(6.1 / (6.1 + v), 9);
    expect(barthVelocityFactor(20)).toBeLessThan(barthVelocityFactor(v)); // faster ⇒ smaller Kv
    const sigma = lewisBendingStress(tangentialLoadFromTorque(T, d), 0.02, 0.005, 0.35);
    expect(safetyFactor(200e6, barthVelocityFactor(v), sigma)).toBeCloseTo((200e6 * barthVelocityFactor(v)) / sigma, 6);
    expect(safetyFactor(200e6, barthVelocityFactor(v), sigma)).toBeGreaterThan(1); // safe design
  });
});
