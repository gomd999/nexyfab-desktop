/**
 * hydraulicMotor — positive-displacement pump/motor, verified: the flow Q=D·N; the ideal
 * power balance Q·Δp = T·ω; the torque T=D·Δp/(2π); the speed inverse N=Q/D; and the
 * overall efficiency product.
 */
import { describe, it, expect } from 'vitest';
import { flowRate, motorTorque, shaftSpeed, hydraulicPower, volumetricEfficiency, overallEfficiency } from './hydraulicMotor';

describe('hydraulicMotor — displacement machine (verified)', () => {
  const D = 1e-4, N = 25, dp = 15e6;

  it('flows Q = D·N and inverts to N = Q/D', () => {
    const Q = flowRate(D, N);
    expect(Q).toBeCloseTo(D * N, 12);
    expect(shaftSpeed(Q, D)).toBeCloseTo(N, 9);
  });

  it('balances hydraulic and mechanical power Q·Δp = T·ω (ideal)', () => {
    const Q = flowRate(D, N), T = motorTorque(D, dp), omega = 2 * Math.PI * N;
    expect(hydraulicPower(Q, dp)).toBeCloseTo(T * omega, 6); // 37.5 kW both ways
  });

  it('gives the torque T = D·Δp/(2π)', () => {
    expect(motorTorque(D, dp)).toBeCloseTo((D * dp) / (2 * Math.PI), 9); // 238.7 N·m
    expect(motorTorque(D, 2 * dp)).toBeCloseTo(2 * motorTorque(D, dp), 9); // ∝ Δp
  });

  it('multiplies efficiencies η = η_v·η_m', () => {
    expect(volumetricEfficiency(0.95, 1)).toBeCloseTo(0.95, 12);
    expect(overallEfficiency(0.95, 0.9)).toBeCloseTo(0.855, 12);
  });
});
