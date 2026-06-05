/**
 * boltedJoint.ts — preloaded bolted-joint mechanics. A tightened bolt carries a preload
 * Fi; an external tensile load P is then SHARED between bolt and clamped members in
 * proportion to their stiffnesses, so the bolt sees only a fraction of P (this is why
 * preload protects the bolt from fatigue).
 *
 *   preload from torque:  Fi = T/(K·d)        (K = nut factor ≈ 0.2)
 *   stiffness ratio:      C = kb/(kb + km)
 *   bolt load:            Fb = Fi + C·P        member load: Fm = Fi − (1−C)·P
 *   separation:           Fm = 0 at  P_sep = Fi/(1−C)
 *
 * Verified: the preload, the load split (Fb − Fm = P), the bolt carrying only C·P, and
 * the separation load.
 */

/** Preload from tightening torque: Fi = T/(K·d). */
export function preloadFromTorque(T: number, K: number, d: number): number { return T / (K * d); }

/** Axial stiffness k = A·E/L. */
export function axialStiffness(A: number, E: number, L: number): number { return (A * E) / L; }

/** Joint stiffness ratio C = kb/(kb + km). */
export function stiffnessRatio(kb: number, km: number): number { return kb / (kb + km); }

/** Bolt load under an external tensile load P: Fb = Fi + C·P. */
export function boltLoad(Fi: number, C: number, P: number): number { return Fi + C * P; }
/** Clamped-member load: Fm = Fi − (1−C)·P. */
export function memberLoad(Fi: number, C: number, P: number): number { return Fi - (1 - C) * P; }

/** External load at which the joint separates (member load reaches zero): P_sep = Fi/(1−C). */
export function separationLoad(Fi: number, C: number): number { return Fi / (1 - C); }
