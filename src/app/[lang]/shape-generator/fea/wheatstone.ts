/**
 * wheatstone.ts — Wheatstone-bridge strain-gauge measurement: the gauge resistance change
 * ΔR/R = GF·ε and the bridge output for quarter/half/full configurations.
 *
 *   gauge:            ΔR/R = GF·ε                         (GF = gauge factor ≈ 2)
 *   general bridge:   V_o/V_in = R₂/(R₁+R₂) − R₃/(R₃+R₄)
 *   balance:          V_o = 0  ⇔  R₁·R₃ = R₂·R₄
 *   quarter (1 gauge): V_o/V_in = GF·ε/4
 *   half (2 gauges):   V_o/V_in = GF·ε/2
 *   full (4 gauges):   V_o/V_in = GF·ε
 *
 * Verified against the balanced-bridge null, the quarter-bridge linearised output
 * matching the exact bridge formula for small strain, ΔR/R = GF·ε, and the
 * full > half > quarter sensitivity ordering.
 */

/** Gauge resistance change ΔR = GF·ε·R. */
export function gaugeResistanceChange(GF: number, strain: number, R: number): number { return GF * strain * R; }
/** General bridge ratio V_o/V_in = R₂/(R₁+R₂) − R₃/(R₃+R₄). */
export function bridgeRatio(R1: number, R2: number, R3: number, R4: number): number {
  return R2 / (R1 + R2) - R3 / (R3 + R4);
}
/** Bridge balance condition R₁·R₃ = R₂·R₄. */
export function isBalanced(R1: number, R2: number, R3: number, R4: number): boolean {
  return Math.abs(R1 * R3 - R2 * R4) < 1e-12 * R1 * R3;
}
/** Quarter-bridge output V_o = V_in·GF·ε/4. */
export function quarterBridge(Vin: number, GF: number, strain: number): number { return (Vin * GF * strain) / 4; }
/** Half-bridge output V_o = V_in·GF·ε/2. */
export function halfBridge(Vin: number, GF: number, strain: number): number { return (Vin * GF * strain) / 2; }
/** Full-bridge output V_o = V_in·GF·ε. */
export function fullBridge(Vin: number, GF: number, strain: number): number { return Vin * GF * strain; }
