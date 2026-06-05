/**
 * bearingLife.ts — rolling-element bearing fatigue life (ISO 281 basic rating life).
 *
 *   L10 = (C/P)^p        [millions of revolutions],  p = 3 (ball), 10/3 (roller)
 *   L10h = L10·10⁶/(60·n)   [hours],  n = speed (rpm)
 *   equivalent load:  P = X·Fr + Y·Fa
 *   adjusted life:    Lna = a1·L10   (a1 = reliability factor)
 *
 * Verified against the rating-life formula, the strong load dependence (doubling the
 * load cuts ball-bearing life to 1/8), the hours conversion, and the equivalent-load
 * combination.
 */

export const BALL_EXPONENT = 3;
export const ROLLER_EXPONENT = 10 / 3;

/** Basic rating life L10 = (C/P)^p [millions of revolutions]. */
export function ratingLife(C: number, P: number, exponent = BALL_EXPONENT): number {
  return Math.pow(C / P, exponent);
}

/** Rating life in hours: L10h = L10·10^6/(60·n). */
export function lifeHours(L10: number, rpm: number): number {
  return (L10 * 1e6) / (60 * rpm);
}

/** Equivalent dynamic load P = X·Fr + Y·Fa. */
export function equivalentLoad(Fr: number, Fa: number, X = 1, Y = 0): number {
  return X * Fr + Y * Fa;
}

/** Reliability-adjusted life Lna = a1·L10 (a1<1 for reliability above 90%). */
export function adjustedLife(L10: number, a1: number): number {
  return a1 * L10;
}
