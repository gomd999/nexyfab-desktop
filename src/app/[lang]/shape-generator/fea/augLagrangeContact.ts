/**
 * augLagrangeContact — augmented-Lagrange normal contact (the iterative solver
 * the penalty-only `contactAnalysis` lacked).
 *
 * Pure penalty leaves a residual penetration = R/ε (large unless ε is huge,
 * which ill-conditions the system). Augmented Lagrange wraps the penalty in an
 * Uzawa multiplier update so the gap constraint (no penetration) is satisfied to
 * tolerance INDEPENDENT of the penalty stiffness — the standard production
 * contact scheme.
 *
 * Model (1D normal contact, closed-form verifiable): a node on a structure of
 * stiffness `k`, an initial gap `g0` to a rigid wall, pushed by force `F`.
 *   - No contact when F/k ≤ g0  → u = F/k, R = 0.
 *   - Contact otherwise         → u = g0, reaction R = F − k·g0 (penetration → 0).
 *
 * Uzawa iteration at active contact:
 *   u  = (F − λ + ε·g0) / (k + ε)        (equilibrium with penalty + multiplier)
 *   g  = u − g0                          (penetration, want → 0)
 *   λ ← max(0, λ + ε·g)                  (multiplier update)
 * The residual r = F − λ − k·g0 contracts by k/(k+ε) per sweep → fast for ε ≫ k,
 * and at the fixed point λ = F − k·g0 with g = 0.
 */

export interface AugLagrangeContactInput {
  /** Structural stiffness k (N/mm). */
  structuralStiffness: number;
  /** Initial gap to the rigid surface (mm; positive = separated). */
  initialGapMm: number;
  /** Applied force toward the surface (N). */
  appliedForceN: number;
  /** Penalty stiffness ε (N/mm). Default 1e5. */
  penaltyStiffness?: number;
  maxIterations?: number;  // default 50
  /** Penetration tolerance (mm). Default 1e-6. */
  toleranceMm?: number;
}

export interface AugLagrangeContactResult {
  displacementMm: number;
  /** Converged contact reaction (N) — the Lagrange multiplier. */
  contactForceN: number;
  /** Residual penetration (mm) — driven → 0 by the multiplier update. */
  penetrationMm: number;
  contactActive: boolean;
  iterations: number;
  converged: boolean;
}

export function solveAugLagrangeContact(input: AugLagrangeContactInput): AugLagrangeContactResult {
  const k = input.structuralStiffness;
  const g0 = input.initialGapMm;
  const F = input.appliedForceN;
  const eps = input.penaltyStiffness ?? 1e5;
  const maxIter = input.maxIterations ?? 50;
  const tol = input.toleranceMm ?? 1e-6;

  // Elastic trial — does the gap even close?
  const uFree = F / k;
  if (uFree <= g0) {
    return { displacementMm: uFree, contactForceN: 0, penetrationMm: 0, contactActive: false, iterations: 0, converged: true };
  }

  let lambda = 0;
  let u = uFree;
  let penetration = u - g0;
  let iters = 0;
  let converged = false;
  for (iters = 1; iters <= maxIter; iters++) {
    u = (F - lambda + eps * g0) / (k + eps);
    penetration = u - g0;
    lambda = Math.max(0, lambda + eps * penetration);
    if (Math.abs(penetration) < tol) { converged = true; break; }
  }

  return {
    displacementMm: u,
    contactForceN: lambda,
    penetrationMm: penetration,
    contactActive: true,
    iterations: iters,
    converged,
  };
}

/**
 * Pure-penalty single-shot (for contrast): leaves penetration = (F − k·g0)/(k+ε).
 * Exposed so tests can show augmented Lagrange beats it at a modest ε.
 */
export function purePenaltyPenetrationMm(input: AugLagrangeContactInput): number {
  const k = input.structuralStiffness;
  const g0 = input.initialGapMm;
  const F = input.appliedForceN;
  const eps = input.penaltyStiffness ?? 1e5;
  if (F / k <= g0) return 0;
  return (F - k * g0) / (k + eps);
}
