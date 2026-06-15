/**
 * gearBending.ts — gear-tooth bending strength by the LEWIS equation (treating the
 * tooth as a cantilever loaded by the tangential force):
 *
 *   σ = W_t / (F·m·Y)            W_t = tangential load, F = face width, m = module,
 *                               Y = Lewis form factor (depends on tooth count)
 *   W_t = 2T/d = P/v,           v = pitch-line velocity = ω·r = π·d·n   (n = rev/s)
 *   Barth velocity factor:      K_v = 6.1/(6.1 + v)   (derates the allowable stress)
 *
 * Verified: the tangential load from torque equals that from power; the pitch-line
 * velocity; the Lewis stress and its decrease with module/face width; and the velocity
 * derating and resulting safety factor.
 */

/** Tangential (transmitted) load from torque: W_t = 2T/d. */
export function tangentialLoadFromTorque(T: number, d: number): number { return (2 * T) / d; }
/** Tangential load from transmitted power: W_t = P/v. */
export function tangentialLoadFromPower(P: number, v: number): number { return P / v; }
/** Pitch-line velocity v = π·d·n (n in rev/s). */
export function pitchLineVelocity(d: number, n: number): number { return Math.PI * d * n; }

/** Lewis bending stress σ = W_t/(F·m·Y). */
export function lewisBendingStress(Wt: number, F: number, m: number, Y: number): number {
  return Wt / (F * m * Y);
}

/** Barth velocity factor K_v = 6.1/(6.1 + v) (v in m/s) — derates the allowable stress. */
export function barthVelocityFactor(v: number): number { return 6.1 / (6.1 + v); }

/** Factor of safety = (allowable·K_v) / applied bending stress. */
export function safetyFactor(allowable: number, Kv: number, applied: number): number {
  return (allowable * Kv) / applied;
}
