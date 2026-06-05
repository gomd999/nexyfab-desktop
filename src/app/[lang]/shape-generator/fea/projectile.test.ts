/**
 * projectile — ballistic motion under gravity, verified: the 45° maximum range; the equal
 * range of complementary launch angles; the trajectory returning to y=0 at x=R; and the
 * apex height at x=R/2.
 */
import { describe, it, expect } from 'vitest';
import { range, maxHeight, timeOfFlight, trajectoryY, optimalAngle } from './projectile';

describe('projectile — ballistics (verified)', () => {
  const v0 = 20, g = 9.80665;

  it('maximises range at 45°', () => {
    const r45 = range(v0, Math.PI / 4, g);
    expect(r45).toBeGreaterThan(range(v0, Math.PI / 6, g));
    expect(r45).toBeGreaterThan(range(v0, Math.PI / 3, g));
    expect(optimalAngle()).toBeCloseTo(Math.PI / 4, 12);
    expect(r45).toBeCloseTo((v0 * v0) / g, 9); // sin(90°)=1
  });

  it('gives equal range for complementary launch angles', () => {
    expect(range(v0, Math.PI / 6, g)).toBeCloseTo(range(v0, Math.PI / 3, g), 9); // 30° vs 60°
  });

  it('returns to y=0 at x=R and apexes at x=R/2', () => {
    const th = Math.PI / 4, R = range(v0, th, g);
    expect(trajectoryY(R, v0, th, g)).toBeCloseTo(0, 6);
    expect(trajectoryY(R / 2, v0, th, g)).toBeCloseTo(maxHeight(v0, th, g), 9);
  });

  it('relates flight time and height', () => {
    const th = Math.PI / 4;
    expect(timeOfFlight(v0, th, g)).toBeCloseTo((2 * v0 * Math.sin(th)) / g, 9);
    // apex reached at half the flight time ⇒ H = ½g(T/2)²
    const T = timeOfFlight(v0, th, g);
    expect(maxHeight(v0, th, g)).toBeCloseTo(0.5 * g * (T / 2) ** 2, 6);
  });
});
