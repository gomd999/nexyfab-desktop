/**
 * flowMeter — differential-pressure flow metering and free-jet discharge, verified:
 * the Torricelli head velocity √(2gh); the velocity-of-approach factor E→1 as β→0
 * (small meter in a large pipe); mass continuity v₁A₁ = v₂A₂ = Q; and the discharge
 * coefficient reducing the metered flow below the ideal.
 */
import { describe, it, expect } from 'vitest';
import { betaRatio, approachFactor, throatVelocity, meteredFlow, torricelliVelocity, circleArea } from './flowMeter';

describe('flowMeter — DP flow measurement (verified)', () => {
  it('Torricelli free jet: v = √(2gh)', () => {
    expect(torricelliVelocity(5)).toBeCloseTo(Math.sqrt(2 * 9.80665 * 5), 9); // 9.903 m/s
    // four times the head ⇒ twice the velocity (√ scaling)
    expect(torricelliVelocity(20) / torricelliVelocity(5)).toBeCloseTo(2, 9);
  });

  it('the approach factor E→1 for a small meter in a large pipe (β→0)', () => {
    expect(approachFactor(0.001)).toBeCloseTo(1, 9);
    expect(approachFactor(0.5)).toBeCloseTo(1 / Math.sqrt(1 - 0.5 ** 4), 12); // 1.0328
    expect(approachFactor(0.5)).toBeGreaterThan(1);        // correction always raises v₂
  });

  it('conserves mass: v₁A₁ = v₂A₂ = Q', () => {
    const dPipe = 0.1, dTh = 0.05, beta = betaRatio(dTh, dPipe);
    const A2 = circleArea(dTh), A1 = circleArea(dPipe);
    const v2 = throatVelocity(2000, 1000, beta);
    const Q = meteredFlow(1, A2, 2000, 1000, beta);         // ideal (Cd=1)
    expect(v2 * A2).toBeCloseTo(Q, 12);
    const v1 = Q / A1;
    expect(v1 * A1).toBeCloseTo(v2 * A2, 12);               // continuity
    expect(v2).toBeGreaterThan(v1);                         // throat is faster
  });

  it('the discharge coefficient reduces the metered flow below ideal', () => {
    const dPipe = 0.1, dTh = 0.05, beta = betaRatio(dTh, dPipe), A2 = circleArea(dTh);
    expect(meteredFlow(0.6, A2, 2000, 1000, beta)).toBeCloseTo(0.6 * meteredFlow(1, A2, 2000, 1000, beta), 12);
    expect(meteredFlow(0.6, A2, 2000, 1000, beta)).toBeLessThan(meteredFlow(1, A2, 2000, 1000, beta));
  });
});
