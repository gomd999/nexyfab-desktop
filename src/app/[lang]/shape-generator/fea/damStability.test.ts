/**
 * damStability — hydrostatic dam loading and stability, verified: the H² resultant force
 * acting at H/3; the linear depth pressure; and the sliding/overturning factors of
 * safety (a heavier or wider dam is more stable).
 */
import { describe, it, expect } from 'vitest';
import { pressureAtDepth, hydrostaticForce, centerOfPressure, overturningMoment, slidingFactorOfSafety, overturningFactorOfSafety } from './damStability';

describe('damStability — hydrostatic + stability (verified)', () => {
  const rho = 1000, g = 9.80665, H = 10;

  it('has a linear pressure and an H² resultant at H/3', () => {
    expect(pressureAtDepth(rho, g, H)).toBeCloseTo(rho * g * H, 6);    // 98.07 kPa at base
    expect(pressureAtDepth(rho, g, H / 2)).toBeCloseTo(pressureAtDepth(rho, g, H) / 2, 6);
    expect(hydrostaticForce(rho, g, H)).toBeCloseTo(0.5 * rho * g * H * H, 3);
    expect(centerOfPressure(H)).toBeCloseTo(H / 3, 9);
  });

  it('grows the force with H²', () => {
    expect(hydrostaticForce(rho, g, 2 * H) / hydrostaticForce(rho, g, H)).toBeCloseTo(4, 9);
  });

  it('gives sliding and overturning factors of safety', () => {
    const W = 2e6, F = hydrostaticForce(rho, g, H), x = 4, mu = 0.6;
    expect(slidingFactorOfSafety(mu, W, F)).toBeCloseTo((mu * W) / F, 9);
    expect(overturningFactorOfSafety(W, x, F, H)).toBeCloseTo((W * x) / overturningMoment(F, H), 9);
    // both factors of safety exceed 1 ⇒ stable
    expect(slidingFactorOfSafety(mu, W, F)).toBeGreaterThan(1);
    expect(overturningFactorOfSafety(W, x, F, H)).toBeGreaterThan(1);
    // a heavier dam is more stable
    expect(slidingFactorOfSafety(mu, 2 * W, F)).toBeCloseTo(2 * slidingFactorOfSafety(mu, W, F), 9);
  });
});
