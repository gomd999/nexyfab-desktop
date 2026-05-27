/**
 * contactAnalysis.ts — Surface-to-surface contact in FEA.
 *
 * The default linear FEA solver in `fea/` assumes bodies are rigidly
 * connected at coincident nodes. Real assemblies have **contact**:
 * surfaces that touch under load, transmit normal pressure, and
 * resist tangential slip via friction. Contact is the dominant
 * source of nonlinearity in mechanical assemblies — without it
 * a bolt-clamped joint reads as floppy, two parts pressed together
 * read as two free bodies.
 *
 * Common formulations:
 *
 *   - **Penalty method** — when surface A penetrates surface B by
 *     depth `g > 0`, apply a restoring force `F = -k g n`. The
 *     stiffness `k` is high (10⁹+ N/m typical) so penetration stays
 *     small. Pros: simple, no extra DOF. Cons: ill-conditioned at
 *     high k, exact non-penetration unattainable.
 *   - **Lagrange multiplier** — introduce an extra DOF per contact
 *     pair enforcing g ≥ 0 exactly. Cons: adds DOFs, indefinite K.
 *   - **Augmented Lagrange** — penalty + Newton update of multiplier.
 *     Pros: best of both. Cons: iterative.
 *
 * This module implements the **penalty method** for the linear
 * preview pipeline. It identifies candidate contact pairs (faces
 * within a tolerance), computes gap functions, and emits the
 * additional stiffness/force contributions that the existing FEA
 * solver merges into K and F.
 *
 * Coulomb friction:
 *   - Stick: |f_tangent| ≤ μ * |f_normal| — no slip.
 *   - Slip:  |f_tangent| = μ * |f_normal| — kinetic friction in
 *            opposite direction of relative tangential velocity.
 */

export interface ContactSurface {
  id: string;
  /** Sampled points on the surface (mm). */
  points: Array<[number, number, number]>;
  /** Outward normal at each point. */
  normals: Array<[number, number, number]>;
  /** Body id this surface belongs to. */
  bodyId: string;
}

export interface ContactPair {
  id: string;
  surfaceA: string;
  surfaceB: string;
  /** Friction coefficient (0 = frictionless, 1 = perfect grip). */
  frictionCoefficient: number;
  /** Penalty stiffness (N/mm). Higher = stiffer, more ill-conditioned. */
  penaltyStiffness: number;
}

export interface ContactPoint {
  /** Index of the source point on surface A. */
  indexA: number;
  /** Position of closest point on surface B. */
  closestPointB: [number, number, number];
  /** Index of B's closest point. */
  indexB: number;
  /** Gap value (negative = penetration). */
  gapMm: number;
  /** Surface normal at the contact (taken from A). */
  normal: [number, number, number];
  /** Active flag: contact engages only when gap ≤ tolerance. */
  active: boolean;
}

export interface ContactDetection {
  pairId: string;
  contactPoints: ContactPoint[];
  /** Number of penetrating points. */
  penetratingCount: number;
  /** Maximum penetration depth. */
  maxPenetrationMm: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function detectContact(
  pair: ContactPair,
  surfaceA: ContactSurface,
  surfaceB: ContactSurface,
  tolerance: number = 0.01,
): ContactDetection {
  const contactPoints: ContactPoint[] = [];
  let maxPenetration = 0;
  let penetrating = 0;
  for (let i = 0; i < surfaceA.points.length; i++) {
    const pa = surfaceA.points[i]!;
    const na = surfaceA.normals[i]!;
    let bestDist = Infinity;
    let bestIndex = -1;
    let bestPoint: [number, number, number] = [0, 0, 0];
    for (let j = 0; j < surfaceB.points.length; j++) {
      const pb = surfaceB.points[j]!;
      const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = j;
        bestPoint = pb;
      }
    }
    if (bestIndex === -1) continue;
    // Signed gap = (pb - pa) · na  (positive when B is in front of A's normal).
    const dx = bestPoint[0] - pa[0], dy = bestPoint[1] - pa[1], dz = bestPoint[2] - pa[2];
    const gap = dx * na[0] + dy * na[1] + dz * na[2];
    const active = gap <= tolerance;
    if (active && gap < 0) {
      penetrating++;
      if (-gap > maxPenetration) maxPenetration = -gap;
    }
    contactPoints.push({
      indexA: i,
      closestPointB: bestPoint,
      indexB: bestIndex,
      gapMm: gap,
      normal: na,
      active,
    });
  }
  return {
    pairId: pair.id,
    contactPoints,
    penetratingCount: penetrating,
    maxPenetrationMm: maxPenetration,
  };
}

// ── Penalty force ───────────────────────────────────────────────

export interface PenaltyForce {
  /** Surface and point index this force applies to. */
  surfaceA: string;
  pointAIndex: number;
  /** Force vector (N). */
  force: [number, number, number];
}

/** For each active contact point with gap < 0, apply F = -k * gap * n
 *  on A's side and equal-and-opposite on B's side. */
export function computePenaltyForces(
  detection: ContactDetection,
  pair: ContactPair,
  surfaceAId: string,
  surfaceBId: string,
): { forcesA: PenaltyForce[]; forcesB: PenaltyForce[] } {
  const forcesA: PenaltyForce[] = [];
  const forcesB: PenaltyForce[] = [];
  for (const cp of detection.contactPoints) {
    if (!cp.active || cp.gapMm >= 0) continue;
    const magnitude = -pair.penaltyStiffness * cp.gapMm; // positive (push apart)
    const force: [number, number, number] = [cp.normal[0] * magnitude, cp.normal[1] * magnitude, cp.normal[2] * magnitude];
    forcesA.push({ surfaceA: surfaceAId, pointAIndex: cp.indexA, force });
    forcesB.push({ surfaceA: surfaceBId, pointAIndex: cp.indexB, force: [-force[0], -force[1], -force[2]] });
  }
  return { forcesA, forcesB };
}

// ── Coulomb friction ────────────────────────────────────────────

export interface FrictionState {
  /** Slip vector (tangential displacement, mm). */
  slipVector: [number, number, number];
  /** True if surface is sliding (slip); false if sticking. */
  sliding: boolean;
  /** Friction force magnitude. */
  forceMagnitude: number;
}

export function evaluateFriction(
  normalForce: number,
  tangentialDisplacement: [number, number, number],
  friction: number,
  tangentStiffness: number,
): FrictionState {
  const tMag = Math.hypot(tangentialDisplacement[0], tangentialDisplacement[1], tangentialDisplacement[2]);
  const tForce = tMag * tangentStiffness;
  const cap = friction * Math.abs(normalForce);
  if (tForce <= cap) {
    return { slipVector: tangentialDisplacement, sliding: false, forceMagnitude: tForce };
  }
  // Slip: cap the force, project displacement onto tangent direction.
  const dir = tMag > 0
    ? [tangentialDisplacement[0] / tMag, tangentialDisplacement[1] / tMag, tangentialDisplacement[2] / tMag] as [number, number, number]
    : [0, 0, 0] as [number, number, number];
  const slipLen = cap / tangentStiffness;
  return {
    slipVector: [dir[0] * slipLen, dir[1] * slipLen, dir[2] * slipLen],
    sliding: true,
    forceMagnitude: cap,
  };
}

// ── Convergence helper ──────────────────────────────────────────

export interface ContactConvergence {
  iteration: number;
  maxPenetration: number;
  totalForce: number;
  converged: boolean;
}

export function checkConvergence(
  iteration: number,
  detection: ContactDetection,
  toleranceMm: number = 1e-3,
): ContactConvergence {
  const totalForce = detection.contactPoints.reduce(
    (s, cp) => s + (cp.active && cp.gapMm < 0 ? -cp.gapMm : 0),
    0,
  );
  return {
    iteration,
    maxPenetration: detection.maxPenetrationMm,
    totalForce,
    converged: detection.maxPenetrationMm < toleranceMm,
  };
}

// ── Diagnostics ─────────────────────────────────────────────────

export interface ContactDiagnostics {
  /** Number of contact pairs analyzed. */
  pairCount: number;
  /** Total active contact points across pairs. */
  activePoints: number;
  /** Total points with penetration. */
  penetratingPoints: number;
  /** Aggregated max penetration. */
  worstPenetrationMm: number;
}

export function summarizeContact(detections: ContactDetection[]): ContactDiagnostics {
  let active = 0;
  let penetrating = 0;
  let worst = 0;
  for (const d of detections) {
    for (const cp of d.contactPoints) {
      if (cp.active) active++;
      if (cp.active && cp.gapMm < 0) penetrating++;
    }
    if (d.maxPenetrationMm > worst) worst = d.maxPenetrationMm;
  }
  return {
    pairCount: detections.length,
    activePoints: active,
    penetratingPoints: penetrating,
    worstPenetrationMm: worst,
  };
}

// ── Heuristic preset library ────────────────────────────────────

export const FRICTION_COEFFICIENTS: Record<string, number> = {
  'steel-on-steel-dry': 0.74,
  'steel-on-steel-lubricated': 0.16,
  'aluminum-on-aluminum': 1.05,
  'aluminum-on-steel': 0.61,
  'rubber-on-dry-concrete': 0.9,
  'teflon-on-teflon': 0.04,
  'wood-on-wood-dry': 0.4,
};

export function recommendPenaltyStiffness(youngsModulusMPa: number, lengthMm: number): number {
  // Rule of thumb: k ≈ 100 × E × L (in N/mm).
  return 100 * youngsModulusMPa * lengthMm;
}
