/**
 * compressibleFlow.ts — 1-D isentropic compressible flow (nozzles). With ratio of
 * specific heats γ and Mach number M:
 *
 *   T0/T = 1 + (γ−1)/2·M²,   p0/p = (T0/T)^{γ/(γ−1)}
 *   A/A* = (1/M)·[ (2/(γ+1))·(1+(γ−1)/2·M²) ]^{(γ+1)/(2(γ−1))}
 *   choking at M=1 (A=A*); critical pressure ratio p_throat/p0 = (2/(γ+1))^{γ/(γ−1)} ≈ 0.528
 *
 * The area ratio A/A* > 1 for both subsonic and supersonic M (converging-diverging),
 * giving two Mach solutions per area. Verified against those closed forms and limits.
 */

/** Stagnation temperature ratio T0/T = 1 + (γ−1)/2·M². */
export function stagnationTempRatio(M: number, gamma = 1.4): number {
  return 1 + ((gamma - 1) / 2) * M * M;
}
/** Stagnation pressure ratio p0/p. */
export function stagnationPressureRatio(M: number, gamma = 1.4): number {
  return Math.pow(stagnationTempRatio(M, gamma), gamma / (gamma - 1));
}
/** Area ratio A/A* (=1 at M=1). */
export function areaRatio(M: number, gamma = 1.4): number {
  const t = (2 / (gamma + 1)) * stagnationTempRatio(M, gamma);
  return (1 / M) * Math.pow(t, (gamma + 1) / (2 * (gamma - 1)));
}
/** Critical (throat) pressure ratio p_throat/p0 = (2/(γ+1))^{γ/(γ−1)}. */
export function criticalPressureRatio(gamma = 1.4): number {
  return Math.pow(2 / (gamma + 1), gamma / (gamma - 1));
}
/** Speed of sound a = √(γ·R·T). */
export function speedOfSound(gamma: number, R: number, T: number): number {
  return Math.sqrt(gamma * R * T);
}

/** Mach number from an area ratio A/A* (≥1), choosing the subsonic or supersonic root. */
export function machFromAreaRatio(AAstar: number, gamma = 1.4, supersonic = false): number {
  let lo = supersonic ? 1 : 1e-6, hi = supersonic ? 50 : 1;
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (lo + hi);
    const ar = areaRatio(m, gamma);
    // A/A* decreases with M below 1 and increases above 1.
    if (supersonic ? ar < AAstar : ar > AAstar) lo = m; else hi = m;
  }
  return 0.5 * (lo + hi);
}
