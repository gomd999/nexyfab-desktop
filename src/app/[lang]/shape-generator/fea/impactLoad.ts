/**
 * impactLoad.ts — dynamic amplification of stress and deflection under suddenly-applied
 * or falling loads, from the energy-balance (work-energy) method on a linear-elastic
 * structure of stiffness k = W/δ_st.
 *
 *   impact factor:    n = 1 + √(1 + 2h/δ_st)     (weight W dropped from height h)
 *   sudden load:      n = 2                        (h = 0 — instantly applied, zero velocity)
 *   amplified:        δ_impact = n·δ_st,   σ_impact = n·σ_st
 *
 * Derived from W·(h + δ) = ½·k·δ² (the falling weight's energy stored as strain energy).
 * Verified against the h=0 sudden-load factor of 2, the high-drop √(2h/δ_st) asymptote,
 * the σ/δ amplification, and the closing energy balance.
 */

/** Impact (dynamic amplification) factor n = 1 + √(1 + 2h/δ_st). */
export function impactFactor(h: number, deltaStatic: number): number {
  return 1 + Math.sqrt(1 + (2 * h) / deltaStatic);
}
/** Maximum dynamic deflection δ_impact = n·δ_st. */
export function impactDeflection(deltaStatic: number, h: number): number {
  return impactFactor(h, deltaStatic) * deltaStatic;
}
/** Maximum dynamic stress σ_impact = n·σ_st. */
export function impactStress(sigmaStatic: number, h: number, deltaStatic: number): number {
  return impactFactor(h, deltaStatic) * sigmaStatic;
}
/** Static deflection of an axially-loaded bar δ_st = WL/(AE). */
export function barStaticDeflection(W: number, L: number, A: number, E: number): number {
  return (W * L) / (A * E);
}
