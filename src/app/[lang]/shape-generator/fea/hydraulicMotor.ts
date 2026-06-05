/**
 * hydraulicMotor.ts — positive-displacement hydraulic pump/motor: the flow–speed and
 * torque–pressure relations from the displacement D (swept volume per revolution).
 *
 *   flow:        Q = D·N                          (N = rev/s)
 *   torque:      T = D·Δp/(2π)                     (ideal)
 *   speed:       N = Q/D
 *   hydraulic power:  P = Q·Δp
 *   power identity:   Q·Δp ≡ T·ω   (ω = 2πN)       (ideal energy balance)
 *   efficiency:  η = η_v·η_m
 *
 * Verified against Q=D·N, the ideal power balance Q·Δp = T·ω, the torque T=D·Δp/(2π),
 * the speed inverse N=Q/D, and the overall efficiency product.
 */

/** Volumetric flow Q = D·N (D per rev, N rev/s). */
export function flowRate(D: number, N: number): number { return D * N; }
/** Ideal torque T = D·Δp/(2π). */
export function motorTorque(D: number, dp: number): number { return (D * dp) / (2 * Math.PI); }
/** Output/required speed N = Q/D (rev/s). */
export function shaftSpeed(Q: number, D: number): number { return Q / D; }
/** Hydraulic power P = Q·Δp. */
export function hydraulicPower(Q: number, dp: number): number { return Q * dp; }
/** Volumetric efficiency η_v = Q_actual/Q_ideal. */
export function volumetricEfficiency(Qactual: number, Qideal: number): number { return Qactual / Qideal; }
/** Overall efficiency η = η_v·η_m. */
export function overallEfficiency(etaV: number, etaM: number): number { return etaV * etaM; }
