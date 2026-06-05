/**
 * dampedVibration.ts — closed-form damped single-DOF free vibration.
 *
 *   critical damping:   c_c = 2√(km) = 2·m·ωn,   ζ = c/c_c
 *   natural / damped:   ωn = √(k/m),  ωd = ωn·√(1−ζ²)   (underdamped ζ<1)
 *   regimes:  ζ<1 underdamped, ζ=1 critically damped, ζ>1 overdamped
 *   log decrement:  δ = 2πζ/√(1−ζ²)   ⇔   ζ = δ/√(4π²+δ²)
 *   quality factor:  Q = 1/(2ζ)
 *
 * Verified against those closed forms, the log-decrement round trip, the regime
 * classification, and the Q factor.
 */

export function naturalFrequency(k: number, m: number): number { return Math.sqrt(k / m); }
export function criticalDamping(k: number, m: number): number { return 2 * Math.sqrt(k * m); }
export function dampingRatio(c: number, k: number, m: number): number { return c / criticalDamping(k, m); }
/** Damped natural frequency ωd = ωn·√(1−ζ²) (undefined/0 for ζ≥1). */
export function dampedFrequency(wn: number, zeta: number): number {
  return zeta < 1 ? wn * Math.sqrt(1 - zeta * zeta) : 0;
}

export type DampingRegime = 'underdamped' | 'critically damped' | 'overdamped';
export function regime(zeta: number): DampingRegime {
  if (Math.abs(zeta - 1) < 1e-9) return 'critically damped';
  return zeta < 1 ? 'underdamped' : 'overdamped';
}

/** Logarithmic decrement δ = 2πζ/√(1−ζ²). */
export function logarithmicDecrement(zeta: number): number {
  return (2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta);
}
/** Damping ratio recovered from the logarithmic decrement: ζ = δ/√(4π²+δ²). */
export function dampingFromLogDecrement(delta: number): number {
  return delta / Math.sqrt(4 * Math.PI * Math.PI + delta * delta);
}
/** Quality factor Q = 1/(2ζ). */
export function qualityFactor(zeta: number): number { return 1 / (2 * zeta); }
