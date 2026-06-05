/**
 * frictionDrive — friction-wheel / traction drive, verified: the torque T=μNr; the
 * required-force inverse N=T/(μr); the rolling speed ratio ω₁/ω₂=r₂/r₁; and the power
 * identity P = F_t·v = T·ω.
 */
import { describe, it, expect } from 'vitest';
import { tangentialForce, transmittedTorque, surfaceVelocity, tractionPower, speedRatio, requiredNormalForce } from './frictionDrive';

describe('frictionDrive — traction drive (verified)', () => {
  const mu = 0.3, N = 500, r = 0.1;

  it('transmits torque T = μNr and inverts to the required normal force', () => {
    const T = transmittedTorque(mu, N, r);
    expect(T).toBeCloseTo(mu * N * r, 12);                 // 15 N·m
    expect(requiredNormalForce(T, mu, r)).toBeCloseTo(N, 9);
    expect(tangentialForce(mu, N)).toBeCloseTo(mu * N, 12);
  });

  it('equates power P = F_t·v and T·ω', () => {
    const omega = 50;
    const v = surfaceVelocity(omega, r);
    const T = transmittedTorque(mu, N, r);
    expect(tractionPower(tangentialForce(mu, N), v)).toBeCloseTo(T * omega, 9); // 750 W
  });

  it('sets the rolling speed ratio ω₁/ω₂ = r₂/r₁', () => {
    expect(speedRatio(0.1, 0.25)).toBeCloseTo(2.5, 12);
    // no-slip: equal surface speeds ω₁r₁ = ω₂r₂
    const r1 = 0.1, r2 = 0.25, omega1 = 50, omega2 = omega1 / speedRatio(r1, r2);
    expect(surfaceVelocity(omega1, r1)).toBeCloseTo(surfaceVelocity(omega2, r2), 9);
  });

  it('scales torque capacity with friction and normal force', () => {
    expect(transmittedTorque(2 * mu, N, r)).toBeCloseTo(2 * transmittedTorque(mu, N, r), 12);
    expect(transmittedTorque(mu, 2 * N, r)).toBeCloseTo(2 * transmittedTorque(mu, N, r), 12);
  });
});
