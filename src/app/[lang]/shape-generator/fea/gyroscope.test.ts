/**
 * gyroscope — steady gyroscopic precession, verified: Ω=τ/(Iω)=τ/L; the inverse-spin
 * trend (Ω ∝ 1/ω); the spin angular momentum L=Iω; and the gravity-torque precession of
 * a top.
 */
import { describe, it, expect } from 'vitest';
import { angularMomentum, precessionRate, gyroscopeTorque, precessionPeriod } from './gyroscope';

describe('gyroscope — precession (verified)', () => {
  const I = 0.001, omega = 200, m = 0.5, g = 9.80665, d = 0.05;
  const tau = gyroscopeTorque(m, g, d);

  it('precesses at Ω = τ/(Iω) = τ/L', () => {
    expect(angularMomentum(I, omega)).toBeCloseTo(I * omega, 12);
    expect(precessionRate(tau, I, omega)).toBeCloseTo(tau / angularMomentum(I, omega), 12);
    expect(gyroscopeTorque(m, g, d)).toBeCloseTo(m * g * d, 9);
  });

  it('precesses slower for a faster spin (Ω ∝ 1/ω)', () => {
    expect(precessionRate(tau, I, 2 * omega)).toBeCloseTo(precessionRate(tau, I, omega) / 2, 12);
  });

  it('precesses faster for a larger gravity torque', () => {
    expect(precessionRate(gyroscopeTorque(m, g, 2 * d), I, omega)).toBeCloseTo(2 * precessionRate(tau, I, omega), 9);
  });

  it('relates the precession period to the rate T_p = 2π/Ω', () => {
    const Omega = precessionRate(tau, I, omega);
    expect(precessionPeriod(Omega)).toBeCloseTo((2 * Math.PI) / Omega, 9);
  });
});
