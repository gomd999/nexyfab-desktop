/**
 * dampedVibration — closed-form damped SDOF free vibration, verified: the critical
 * damping 2√(km) and damping ratio; the damped frequency ωn√(1−ζ²); the log-decrement
 * round trip (δ=2πζ/√(1−ζ²) ⇔ ζ); the Q factor 1/(2ζ); and the regime classification.
 */
import { describe, it, expect } from 'vitest';
import {
  naturalFrequency, criticalDamping, dampingRatio, dampedFrequency, regime,
  logarithmicDecrement, dampingFromLogDecrement, qualityFactor,
} from './dampedVibration';

const k = 10000, m = 1;
const wn = naturalFrequency(k, m);

describe('dampedVibration — damped SDOF (verified)', () => {
  it('critical damping is 2√(km) and the damping ratio is c/c_c', () => {
    expect(wn).toBeCloseTo(100, 9);
    expect(criticalDamping(k, m)).toBeCloseTo(2 * Math.sqrt(k * m), 9); // 200
    expect(dampingRatio(10, k, m)).toBeCloseTo(0.05, 12);
    expect(dampingRatio(criticalDamping(k, m), k, m)).toBeCloseTo(1, 9); // c = c_c ⇒ ζ = 1
  });

  it('the damped frequency is ωn√(1−ζ²) and vanishes at critical', () => {
    expect(dampedFrequency(wn, 0.05)).toBeCloseTo(wn * Math.sqrt(1 - 0.05 ** 2), 9);
    expect(dampedFrequency(wn, 0)).toBeCloseTo(wn, 9);   // undamped
    expect(dampedFrequency(wn, 1)).toBe(0);              // critical ⇒ no oscillation
  });

  it('the logarithmic decrement round-trips to the damping ratio', () => {
    const zeta = 0.05;
    const delta = logarithmicDecrement(zeta);
    expect(delta).toBeCloseTo((2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta), 9);
    expect(dampingFromLogDecrement(delta)).toBeCloseTo(zeta, 9);
  });

  it('the quality factor is 1/(2ζ)', () => {
    expect(qualityFactor(0.05)).toBeCloseTo(10, 9);
    expect(qualityFactor(0.01)).toBeGreaterThan(qualityFactor(0.05)); // lighter damping ⇒ sharper
  });

  it('classifies the damping regime', () => {
    expect(regime(0.05)).toBe('underdamped');
    expect(regime(1)).toBe('critically damped');
    expect(regime(2)).toBe('overdamped');
  });
});
