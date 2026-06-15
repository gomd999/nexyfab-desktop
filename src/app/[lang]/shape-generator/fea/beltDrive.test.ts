/**
 * beltDrive — capstan belt-friction transmission, verified: the flat-belt ratio e^{μθ};
 * the V-belt amplification e^{μθ/sin(β/2)} (wedging); the transmitted power (T1−T2)v;
 * the centrifugal tension m·v²; the open-belt wrap angle; and the increase of the ratio
 * with wrap angle and friction.
 */
import { describe, it, expect } from 'vitest';
import { tensionRatioFlat, tensionRatioV, powerTransmitted, centrifugalTension, wrapAngleSmallPulley } from './beltDrive';

describe('beltDrive — belt friction transmission (verified)', () => {
  it('the flat-belt tension ratio is e^{μθ}', () => {
    expect(tensionRatioFlat(0.3, Math.PI)).toBeCloseTo(Math.exp(0.3 * Math.PI), 9);
    expect(tensionRatioFlat(0.3, 0)).toBeCloseTo(1, 12);          // no wrap ⇒ no grip difference
  });

  it('a V-belt grips far harder than a flat belt (wedging)', () => {
    const flat = tensionRatioFlat(0.3, Math.PI);
    const vee = tensionRatioV(0.3, Math.PI, (38 * Math.PI) / 180);
    expect(vee).toBeCloseTo(Math.exp((0.3 * Math.PI) / Math.sin((19 * Math.PI) / 180)), 6);
    expect(vee).toBeGreaterThan(flat * 5);                        // much higher ratio
  });

  it('the transmitted power is (T1 − T2)·v and the centrifugal tension is m·v²', () => {
    const T1 = 1000, T2 = T1 / tensionRatioFlat(0.3, Math.PI);
    expect(powerTransmitted(T1, T2, 10)).toBeCloseTo((T1 - T2) * 10, 6);
    expect(centrifugalTension(0.5, 20)).toBeCloseTo(0.5 * 400, 9);
    expect(centrifugalTension(0.5, 40) / centrifugalTension(0.5, 20)).toBeCloseTo(4, 9); // v²
  });

  it('the wrap angle is below 180° for unequal pulleys, exactly 180° for equal', () => {
    expect(wrapAngleSmallPulley(0.3, 0.1, 0.5)).toBeLessThan(Math.PI);
    expect(wrapAngleSmallPulley(0.1, 0.1, 0.5)).toBeCloseTo(Math.PI, 9);
  });

  it('the tension ratio grows with wrap angle and friction', () => {
    expect(tensionRatioFlat(0.3, 2 * Math.PI)).toBeGreaterThan(tensionRatioFlat(0.3, Math.PI));
    expect(tensionRatioFlat(0.5, Math.PI)).toBeGreaterThan(tensionRatioFlat(0.3, Math.PI));
  });
});
