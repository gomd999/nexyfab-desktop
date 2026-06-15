/**
 * doppler — acoustic Doppler effect, verified: the stationary f'=f; the blue/red shift of
 * an approaching/receding source; the classical source–observer asymmetry at equal speed;
 * and the Mach number.
 */
import { describe, it, expect } from 'vitest';
import { dopplerFrequency, dopplerSourceMoving, dopplerObserverMoving, machNumber } from './doppler';

describe('doppler — acoustic shift (verified)', () => {
  const f = 1000, c = 343;

  it('returns the source frequency when nothing moves', () => {
    expect(dopplerFrequency(f, c, 0, 0)).toBeCloseTo(f, 9);
  });

  it('blue-shifts an approaching source and red-shifts a receding one', () => {
    expect(dopplerSourceMoving(f, c, 30, true)).toBeGreaterThan(f);   // approaching ⇒ higher
    expect(dopplerSourceMoving(f, c, 30, false)).toBeLessThan(f);     // receding ⇒ lower
    expect(dopplerSourceMoving(f, c, 30, true)).toBeCloseTo((f * c) / (c - 30), 9);
  });

  it('is asymmetric: a moving source shifts more than a moving observer at the same speed', () => {
    const src = dopplerSourceMoving(f, c, 30, true);
    const obs = dopplerObserverMoving(f, c, 30, true);
    expect(src).toBeGreaterThan(obs);                                 // classical asymmetry
    expect(obs).toBeCloseTo((f * (c + 30)) / c, 9);
  });

  it('computes the Mach number', () => {
    expect(machNumber(686, c)).toBeCloseTo(2, 6);
    expect(machNumber(c, c)).toBeCloseTo(1, 9);                       // sonic
  });
});
