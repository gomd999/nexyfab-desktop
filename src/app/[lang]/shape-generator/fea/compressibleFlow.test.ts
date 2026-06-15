/**
 * compressibleFlow — 1-D isentropic nozzle flow, verified: the stagnation ratios
 * (T0/T=1.2, p/p0=0.528 at M=1); the area-Mach relation (A/A*=1 at M=1, 1.6875 at M=2,
 * >1 elsewhere); the critical pressure ratio 0.528 for air; the speed of sound; and the
 * two (subsonic/supersonic) Mach roots of a given area ratio.
 */
import { describe, it, expect } from 'vitest';
import { stagnationTempRatio, stagnationPressureRatio, areaRatio, criticalPressureRatio, speedOfSound, machFromAreaRatio } from './compressibleFlow';

describe('compressibleFlow — isentropic nozzle (verified)', () => {
  it('stagnation ratios: T0/T = 1+(γ-1)/2 M², p/p0 = 0.528 at M=1', () => {
    expect(stagnationTempRatio(1)).toBeCloseTo(1.2, 9);
    expect(1 / stagnationPressureRatio(1)).toBeCloseTo(0.5283, 4);
    expect(stagnationTempRatio(2)).toBeCloseTo(1.8, 9);
  });

  it('the area-Mach relation: A/A*=1 at M=1, 1.6875 at M=2, and >1 elsewhere', () => {
    expect(areaRatio(1)).toBeCloseTo(1, 6);
    expect(areaRatio(2)).toBeCloseTo(1.6875, 4);
    expect(areaRatio(0.5)).toBeGreaterThan(1);         // converging-diverging both sides
    expect(areaRatio(3)).toBeGreaterThan(1);
  });

  it('the critical pressure ratio is 0.528 for air (and lower for higher γ)', () => {
    expect(criticalPressureRatio(1.4)).toBeCloseTo(0.5283, 4);
    expect(criticalPressureRatio(1.667)).toBeLessThan(criticalPressureRatio(1.4));
  });

  it('the speed of sound is √(γRT)', () => {
    expect(speedOfSound(1.4, 287, 300)).toBeCloseTo(Math.sqrt(1.4 * 287 * 300), 6); // ≈ 347 m/s
    // doubling the absolute temperature raises a by √2.
    expect(speedOfSound(1.4, 287, 600) / speedOfSound(1.4, 287, 300)).toBeCloseTo(Math.SQRT2, 6);
  });

  it('a given area ratio has both a subsonic and a supersonic Mach solution', () => {
    const sub = machFromAreaRatio(2, 1.4, false);
    const sup = machFromAreaRatio(2, 1.4, true);
    expect(sub).toBeLessThan(1);
    expect(sup).toBeGreaterThan(1);
    expect(areaRatio(sub)).toBeCloseTo(2, 4);
    expect(areaRatio(sup)).toBeCloseTo(2, 4);
  });
});
