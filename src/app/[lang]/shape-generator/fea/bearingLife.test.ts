/**
 * bearingLife — rolling-bearing fatigue life, verified: the rating life L10=(C/P)^p
 * (p=3 ball, 10/3 roller); the strong load dependence (doubling P cuts ball life to
 * 1/8); the hours conversion L10·1e6/(60·n); the equivalent dynamic load X·Fr+Y·Fa;
 * and the reliability adjustment.
 */
import { describe, it, expect } from 'vitest';
import { BALL_EXPONENT, ROLLER_EXPONENT, ratingLife, lifeHours, equivalentLoad, adjustedLife } from './bearingLife';

const C = 50000, P = 10000;

describe('bearingLife — ISO 281 rating life (verified)', () => {
  it('the rating life is (C/P)^p (p=3 ball, 10/3 roller)', () => {
    expect(ratingLife(C, P, BALL_EXPONENT)).toBeCloseTo(5 ** 3, 6);    // 125 M revs
    expect(ratingLife(C, P, ROLLER_EXPONENT)).toBeCloseTo(5 ** (10 / 3), 4);
    expect(ratingLife(C, P, ROLLER_EXPONENT)).toBeGreaterThan(ratingLife(C, P, BALL_EXPONENT)); // roller longer
  });

  it('doubling the load cuts ball-bearing life to 1/8 (cubic)', () => {
    expect(ratingLife(C, 2 * P)).toBeCloseTo(ratingLife(C, P) / 8, 6);
    expect(ratingLife(C, P / 2)).toBeCloseTo(ratingLife(C, P) * 8, 6);  // half load ⇒ 8× life
  });

  it('the hours conversion is L10·1e6/(60·n)', () => {
    const L10 = ratingLife(C, P);
    expect(lifeHours(L10, 1500)).toBeCloseTo((L10 * 1e6) / (60 * 1500), 6);
    // higher speed ⇒ fewer hours for the same revolutions.
    expect(lifeHours(L10, 3000)).toBeCloseTo(lifeHours(L10, 1500) / 2, 6);
  });

  it('the equivalent dynamic load combines radial and axial loads', () => {
    expect(equivalentLoad(8000, 3000, 0.56, 1.5)).toBeCloseTo(0.56 * 8000 + 1.5 * 3000, 6);
    expect(equivalentLoad(5000, 0)).toBeCloseTo(5000, 9); // pure radial, X=1
  });

  it('the reliability adjustment reduces the life for higher reliability (a1<1)', () => {
    const L10 = ratingLife(C, P);
    expect(adjustedLife(L10, 0.62)).toBeCloseTo(0.62 * L10, 9);
    expect(adjustedLife(L10, 0.62)).toBeLessThan(L10);
    expect(adjustedLife(L10, 1)).toBeCloseTo(L10, 9); // a1=1 at 90% reliability
  });
});
