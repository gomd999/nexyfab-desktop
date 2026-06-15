/**
 * rotorBalance.ts — rotating-mass unbalance and single-/static-plane balancing. A mass m
 * at eccentricity e spins up a centrifugal force that grows with ω²; balancing cancels
 * the vector sum of the unbalance vectors U = m·r.
 *
 *   centrifugal force:  F = m·e·ω²
 *   unbalance:          U = m·r            (kg·m, a vector at the mass angle)
 *   single-plane fix:   m_c·r_c = m·e      (correction opposite the unbalance)
 *   static balance:     Σ (mᵢ·rᵢ) = 0      (resultant unbalance vector vanishes)
 *
 * Verified against the ω² force scaling, the correction-moment balance m_c·r_c = m·e,
 * the resultant of a vector sum of unbalance vectors, and a two-mass 180°-opposed pair
 * being statically balanced.
 */

/** Centrifugal force of an unbalance F = m·e·ω². */
export function unbalanceForce(m: number, e: number, omega: number): number { return m * e * omega * omega; }
/** Single-plane correction mass m_c = m·e/r_c (placed opposite the unbalance). */
export function correctionMass(m: number, e: number, rc: number): number { return (m * e) / rc; }

/** Resultant static unbalance (vector sum of mᵢ·rᵢ) → magnitude [kg·m] and angle [rad]. */
export function staticUnbalance(masses: number[], radii: number[], angles: number[]): { magnitude: number; angle: number } {
  let x = 0, y = 0;
  for (let i = 0; i < masses.length; i++) {
    const U = masses[i] * radii[i];
    x += U * Math.cos(angles[i]);
    y += U * Math.sin(angles[i]);
  }
  return { magnitude: Math.hypot(x, y), angle: Math.atan2(y, x) };
}
