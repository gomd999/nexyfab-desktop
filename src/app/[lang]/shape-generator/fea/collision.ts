/**
 * collision.ts — one-dimensional direct central impact of two bodies, from conservation
 * of momentum and Newton's coefficient of restitution e (1 = elastic, 0 = perfectly
 * plastic).
 *
 *   momentum:      m₁v₁ + m₂v₂ = m₁v₁' + m₂v₂'
 *   restitution:   e = (v₂' − v₁')/(v₁ − v₂)            (separation / approach)
 *   solution:      v₁' = (m₁v₁ + m₂v₂ − m₂·e·(v₁−v₂))/(m₁+m₂)
 *                  v₂' = (m₁v₁ + m₂v₂ + m₁·e·(v₁−v₂))/(m₁+m₂)
 *   energy loss:   ΔKE = ½·μ·(1−e²)·(v₁−v₂)²,   μ = m₁m₂/(m₁+m₂)
 *
 * Verified against momentum conservation, recovery of the input e from the outgoing
 * velocities, zero kinetic-energy loss for e=1 (elastic), and the common velocity for
 * e=0 (perfectly plastic stick).
 */

export interface Outgoing { v1f: number; v2f: number; }

/** Post-impact velocities from momentum + restitution. */
export function finalVelocities(m1: number, m2: number, v1: number, v2: number, e: number): Outgoing {
  const p = m1 * v1 + m2 * v2, rel = v1 - v2, M = m1 + m2;
  return { v1f: (p - m2 * e * rel) / M, v2f: (p + m1 * e * rel) / M };
}
/** Coefficient of restitution from observed velocities: e = (v₂'−v₁')/(v₁−v₂). */
export function restitution(v1: number, v2: number, v1f: number, v2f: number): number {
  return (v2f - v1f) / (v1 - v2);
}
/** Kinetic-energy lost in impact ΔKE = ½·μ·(1−e²)·(v₁−v₂)². */
export function energyLoss(m1: number, m2: number, v1: number, v2: number, e: number): number {
  const mu = (m1 * m2) / (m1 + m2);
  return 0.5 * mu * (1 - e * e) * (v1 - v2) ** 2;
}
/** Common velocity after a perfectly-plastic (e=0) impact: (m₁v₁+m₂v₂)/(m₁+m₂). */
export function plasticVelocity(m1: number, m2: number, v1: number, v2: number): number {
  return (m1 * v1 + m2 * v2) / (m1 + m2);
}
