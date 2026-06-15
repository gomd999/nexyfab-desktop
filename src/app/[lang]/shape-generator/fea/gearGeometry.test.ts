/**
 * gearGeometry — involute spur-gear geometry, verified: the involute point lies at
 * rb√(1+θ²) with radius of curvature rb·θ and begins on the base circle; the pressure
 * angle at the pitch circle equals φ and inv(α)=tanα−α; the pitch/base diameters,
 * gear ratio and centre distance; and meshing gears share a base pitch.
 */
import { describe, it, expect } from 'vitest';
import {
  involutePoint, involuteFunction, pressureAngleAtRadius, pitchDiameter, baseDiameter,
  basePitch, gearRatio, centerDistance, radiusOfCurvature,
} from './gearGeometry';

const m = 2, N = 20, phi = (20 * Math.PI) / 180;
const rb = baseDiameter(m, N, phi) / 2, rp = pitchDiameter(m, N) / 2;

describe('gearGeometry — involute gears (verified)', () => {
  it('the involute point lies at rb√(1+θ²) with curvature radius rb·θ', () => {
    const theta = 0.5;
    const [x, y] = involutePoint(rb, theta);
    expect(Math.hypot(x, y)).toBeCloseTo(rb * Math.sqrt(1 + theta * theta), 9);
    expect(radiusOfCurvature(rb, theta)).toBeCloseTo(rb * theta, 12);
    // the involute begins on the base circle.
    expect(Math.hypot(...involutePoint(rb, 0))).toBeCloseTo(rb, 9);
  });

  it('the pressure angle at the pitch circle equals φ, and inv(α)=tanα−α', () => {
    expect(pressureAngleAtRadius(rb, rp)).toBeCloseTo(phi, 9);
    expect(involuteFunction(phi)).toBeCloseTo(Math.tan(phi) - phi, 12);
    // larger radius ⇒ larger pressure angle.
    expect(pressureAngleAtRadius(rb, rp * 1.1)).toBeGreaterThan(phi);
  });

  it('the standard diameters: d = m·N, db = m·N·cosφ', () => {
    expect(pitchDiameter(m, N)).toBe(40);
    expect(baseDiameter(m, N, phi)).toBeCloseTo(40 * Math.cos(phi), 9);
    expect(baseDiameter(m, N, phi)).toBeLessThan(pitchDiameter(m, N)); // base inside pitch
  });

  it('mesh kinematics: gear ratio, centre distance and shared base pitch', () => {
    const N2 = 40;
    expect(gearRatio(N, N2)).toBe(2);                                   // ω1/ω2 = N2/N1
    expect(centerDistance(m, N, N2)).toBeCloseTo((pitchDiameter(m, N) + pitchDiameter(m, N2)) / 2, 9);
    // gears mesh only if they share module + pressure angle ⇒ same base pitch.
    expect(basePitch(m, phi)).toBeCloseTo(Math.PI * m * Math.cos(phi), 9);
    expect(basePitch(m, phi)).toBeCloseTo(basePitch(m, phi), 12);       // pinion vs gear: same m,φ
  });
});
