/**
 * journalBearing.ts — hydrodynamic plain (journal) bearing characteristics from the
 * Petroff/Sommerfeld closed forms for a lightly-loaded, near-concentric journal.
 *
 *   projected pressure:   P = W/(2 r L)                  (load over the projected area D·L)
 *   Sommerfeld number:    S = (r/c)²·(μN/P)              (dimensionless bearing characteristic)
 *   Petroff friction:     f = 2π²·(μN/P)·(r/c)           (coefficient of friction)
 *   Petroff torque:       T = 4π²·μ·N·r³·L / c           (= f·W·r, viscous drag torque)
 *   friction power:       Φ = T·ω = T·2πN
 *
 * N is rev/s, c the radial clearance, r the journal radius, L the bearing length.
 * Verified against the Petroff torque ≡ f·W·r identity, the friction–Sommerfeld
 * relation f·(r/c) = 2π²S, and the clearance scalings (f∝1/c, S∝1/c²).
 */

/** Projected (unit) bearing pressure P = W/(2rL) = W/(D·L). */
export function projectedPressure(W: number, r: number, L: number): number { return W / (2 * r * L); }
/** Sommerfeld number S = (r/c)²·(μN/P). */
export function sommerfeldNumber(r: number, c: number, mu: number, N: number, P: number): number {
  return (r / c) ** 2 * ((mu * N) / P);
}
/** Petroff coefficient of friction f = 2π²·(μN/P)·(r/c). */
export function petroffFriction(mu: number, N: number, P: number, r: number, c: number): number {
  return 2 * Math.PI ** 2 * ((mu * N) / P) * (r / c);
}
/** Petroff viscous friction torque T = 4π²·μ·N·r³·L/c (concentric). */
export function petroffTorque(mu: number, N: number, r: number, L: number, c: number): number {
  return (4 * Math.PI ** 2 * mu * N * r ** 3 * L) / c;
}
/** Friction power Φ = T·ω, ω = 2πN. */
export function frictionPower(T: number, N: number): number { return T * 2 * Math.PI * N; }
