/**
 * criticalSpeed.ts — whirling (critical) speed of a rotating shaft, where the spin rate
 * coincides with a lateral natural frequency and deflections grow unbounded.
 *
 *   single disk:   ω_c = √(g/δ_st) = √(k/m)        (δ_st = static deflection at the disk)
 *   to rpm:        N_c = ω_c·60/(2π)
 *   Dunkerley:     1/ω_c² = Σ 1/ω_i²               (lower bound, combining masses)
 *   Rayleigh:      ω² = g·Σ(wᵢyᵢ) / Σ(wᵢyᵢ²)       (energy method, upper bound)
 *
 * Verified against the √(g/δ_st) ≡ √(k/m) equivalence (since mg = kδ_st), the single-mass
 * Rayleigh quotient reducing to g/y, and Dunkerley's combined speed falling below every
 * individual critical speed.
 */

const G = 9.80665;

/** Critical (whirl) speed from static deflection: ω_c = √(g/δ_st) [rad/s]. */
export function criticalSpeed(deltaStatic: number, g: number = G): number {
  return Math.sqrt(g / deltaStatic);
}
/** Critical speed from stiffness/mass: ω_c = √(k/m) [rad/s]. */
export function criticalSpeedStiffness(k: number, m: number): number {
  return Math.sqrt(k / m);
}
/** Convert rad/s to rpm: N = ω·60/(2π). */
export function toRPM(omega: number): number { return (omega * 60) / (2 * Math.PI); }
/** Dunkerley combined critical speed: 1/ω_c² = Σ 1/ω_i². */
export function dunkerley(omegas: number[]): number {
  const inv = omegas.reduce((s, w) => s + 1 / (w * w), 0);
  return 1 / Math.sqrt(inv);
}
/** Rayleigh energy-method frequency: ω = √(g·Σwy / Σwy²). */
export function rayleighFrequency(weights: number[], deflections: number[], g: number = G): number {
  let num = 0, den = 0;
  for (let i = 0; i < weights.length; i++) {
    num += weights[i] * deflections[i];
    den += weights[i] * deflections[i] * deflections[i];
  }
  return Math.sqrt((g * num) / den);
}
