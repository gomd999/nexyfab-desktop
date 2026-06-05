/**
 * clutchBrake — annular disk clutch/brake friction torque, verified: the uniform-
 * pressure and uniform-wear torque formulas; that uniform-pressure torque exceeds
 * uniform-wear for the same force; the surface-count multiplier; the max contact
 * pressure (at ri); and the transmitted power T·ω.
 */
import { describe, it, expect } from 'vitest';
import { uniformPressureTorque, uniformWearTorque, maxPressureUniformWear, clutchPower } from './clutchBrake';

const mu = 0.3, F = 2000, ro = 0.1, ri = 0.05;

describe('clutchBrake — disk clutch torque (verified)', () => {
  it('the uniform-pressure and uniform-wear torque formulas', () => {
    expect(uniformPressureTorque(mu, F, ro, ri)).toBeCloseTo((2 / 3) * mu * F * (ro ** 3 - ri ** 3) / (ro ** 2 - ri ** 2), 6);
    expect(uniformWearTorque(mu, F, ro, ri)).toBeCloseTo(0.5 * mu * F * (ro + ri), 9);
  });

  it('uniform-pressure torque exceeds uniform-wear for the same force', () => {
    expect(uniformPressureTorque(mu, F, ro, ri)).toBeGreaterThan(uniformWearTorque(mu, F, ro, ri));
  });

  it('the surface count multiplies the torque', () => {
    expect(uniformWearTorque(mu, F, ro, ri, 4)).toBeCloseTo(4 * uniformWearTorque(mu, F, ro, ri), 6);
    expect(uniformPressureTorque(mu, F, ro, ri, 2)).toBeCloseTo(2 * uniformPressureTorque(mu, F, ro, ri), 6);
  });

  it('the maximum contact pressure (uniform wear) is at the inner radius', () => {
    expect(maxPressureUniformWear(F, ro, ri)).toBeCloseTo(F / (2 * Math.PI * ri * (ro - ri)), 3);
    // a smaller inner radius raises the peak pressure.
    expect(maxPressureUniformWear(F, ro, 0.03)).toBeGreaterThan(maxPressureUniformWear(F, ro, ri));
  });

  it('the dissipated power is T·ω', () => {
    expect(clutchPower(uniformWearTorque(mu, F, ro, ri), 100)).toBeCloseTo(45 * 100, 6);
    // more friction or force ⇒ more torque ⇒ more power.
    expect(uniformWearTorque(0.4, F, ro, ri)).toBeGreaterThan(uniformWearTorque(0.3, F, ro, ri));
  });
});
