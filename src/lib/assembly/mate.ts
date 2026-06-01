/**
 * mate — Phase 3.1 of NexyFab Pro own-CAD (ADR-013).
 *
 * Assembly mate constraints between two part instances. Each part exposes
 * named "mate references" (faces, edges, axes, points) — usually derived
 * from the part's feature tree during preflight. A mate links one
 * reference on part A to a reference on part B by enforcing a geometric
 * relationship (coincident, concentric, parallel, etc.).
 *
 * This module covers the IR layer only. The mate SOLVER (Phase 3.2) takes
 * an assembly + initial part transforms and finds transforms that satisfy
 * every mate. Phase 3.2 will use a Lagrange-multiplier formulation
 * analogous to planegcs but in 3D with rigid-body DoF.
 *
 * Scope (Phase 3.1 minimal):
 *   - 7 mate kinds: coincident / concentric / distance / angle / parallel
 *     / perpendicular / tangent.
 *   - Reference IDs are opaque strings (resolved at solve time against the
 *     part's geometry registry).
 *   - Distance / angle mates carry a numeric value; the others don't.
 *   - Validation: type-check refs against the mate kind's allowed
 *     geometry kinds (e.g., 'parallel' applies to two axes or two faces,
 *     not to two points).
 *
 * Out of scope (Phase 3.2+):
 *   - Mate solver (rigid-body 6-DoF constraint solver)
 *   - Sub-assembly hierarchy (a mate references "part X" — Phase 3.5
 *     introduces sub-assemblies as nested AssemblyState)
 *   - Motion-study controller (Phase 3.6)
 *   - Interference check (Phase 3.4 — separate analysis pass)
 */

// ─── reference kinds ──────────────────────────────────────────────────────

/**
 * Kinds of geometry a mate can reference on a part. The solver in Phase
 * 3.2 will pull positions/orientations of these from the part's resolved
 * geometry registry.
 */
export type MateRefKind = 'face' | 'edge' | 'axis' | 'plane' | 'point';

export interface MateRef {
  /** Part instance id within the assembly. */
  partId: string;
  /** Reference id within the part's geometry registry. */
  refId: string;
  /** What kind of geometry refId points to. */
  refKind: MateRefKind;
}

// ─── mate kinds ──────────────────────────────────────────────────────────

export type MateKind =
  | 'coincident'
  | 'concentric'
  | 'distance'
  | 'angle'
  | 'parallel'
  | 'perpendicular'
  | 'tangent';

/**
 * Allowed (refKindA, refKindB) combinations for each mate kind. Used by
 * validateMate to reject mismatched references before they reach the solver.
 *
 * Order within a pair is canonical (alphabetical): a mate between an axis
 * and a face is stored as (axis, face), not (face, axis).
 */
const ALLOWED_REF_COMBOS: Record<MateKind, ReadonlyArray<readonly [MateRefKind, MateRefKind]>> = {
  coincident: [
    ['face', 'face'],
    ['edge', 'edge'],
    ['point', 'point'],
    ['plane', 'plane'],
  ],
  concentric: [
    ['axis', 'axis'],
    // axis with circular edge (an edge constrained to be a circle in the
    // part feature tree).
    ['axis', 'edge'],
  ],
  distance: [
    ['face', 'face'],
    ['edge', 'edge'],
    ['point', 'point'],
    ['plane', 'plane'],
  ],
  angle: [
    ['face', 'face'],
    ['edge', 'edge'],
    ['axis', 'axis'],
  ],
  parallel: [
    ['face', 'face'],
    ['edge', 'edge'],
    ['axis', 'axis'],
    ['plane', 'plane'],
  ],
  perpendicular: [
    ['face', 'face'],
    ['edge', 'edge'],
    ['axis', 'axis'],
    ['plane', 'plane'],
    // edge perpendicular to face
    ['edge', 'face'],
    ['axis', 'face'],
  ],
  tangent: [
    ['face', 'face'],
    // edge tangent to face (e.g., circular edge tangent to a plane)
    ['edge', 'face'],
  ],
};

// ─── Mate IR ──────────────────────────────────────────────────────────────

export interface BaseMate {
  id: string;
  a: MateRef;
  b: MateRef;
  /** When false the mate is parked (solver ignores it but UI shows it). */
  suppressed?: boolean;
}

export interface CoincidentMate extends BaseMate { kind: 'coincident' }
export interface ConcentricMate extends BaseMate { kind: 'concentric' }
export interface DistanceMate extends BaseMate {
  kind: 'distance';
  /** Distance in mm. Positive. */
  value: number;
}
export interface AngleMate extends BaseMate {
  kind: 'angle';
  /** Angle in degrees, range [-180, 180]. */
  value: number;
}
export interface ParallelMate extends BaseMate { kind: 'parallel' }
export interface PerpendicularMate extends BaseMate { kind: 'perpendicular' }
export interface TangentMate extends BaseMate { kind: 'tangent' }

export type Mate =
  | CoincidentMate
  | ConcentricMate
  | DistanceMate
  | AngleMate
  | ParallelMate
  | PerpendicularMate
  | TangentMate;

// ─── validation ───────────────────────────────────────────────────────────

export class MateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MateValidationError';
  }
}

/**
 * Validate a single mate:
 *   - id non-empty
 *   - part ids must differ (no self-mate)
 *   - refKind combination must be allowed for the mate's kind
 *   - distance value ≥ 0 (zero allowed — degenerate but solver handles)
 *   - angle value within [-180, 180]
 */
export function validateMate(mate: Mate): void {
  if (!mate.id) throw new MateValidationError('mate id is empty');
  if (mate.a.partId === mate.b.partId) {
    throw new MateValidationError(`mate ${mate.id} references same part on both sides`);
  }
  if (!isAllowedCombo(mate.kind, mate.a.refKind, mate.b.refKind)) {
    throw new MateValidationError(
      `mate ${mate.id}: kind '${mate.kind}' does not accept ` +
        `(${mate.a.refKind}, ${mate.b.refKind}) reference combination`,
    );
  }
  if (mate.kind === 'distance') {
    if (!Number.isFinite(mate.value) || mate.value < 0) {
      throw new MateValidationError(`distance mate ${mate.id}: value must be ≥ 0`);
    }
  }
  if (mate.kind === 'angle') {
    if (!Number.isFinite(mate.value) || mate.value < -180 || mate.value > 180) {
      throw new MateValidationError(`angle mate ${mate.id}: value must be in [-180, 180]`);
    }
  }
}

function isAllowedCombo(kind: MateKind, a: MateRefKind, b: MateRefKind): boolean {
  const combos = ALLOWED_REF_COMBOS[kind];
  for (const [ca, cb] of combos) {
    if ((ca === a && cb === b) || (ca === b && cb === a)) return true;
  }
  return false;
}

// ─── DoF accounting helpers ─────────────────────────────────────────────-

/**
 * Approximate DoF reduction per mate kind. Used by the assembly DoF
 * counter (Phase 3.3 surfaces this in UI). Approximate because real DoF
 * reduction depends on the rest of the constraint system; this is a
 * worst-case-independent lower bound.
 *
 * Reference: rigid body in 3D has 6 DoF (3 translation + 3 rotation).
 *   - coincident face/face: removes 3 DoF (in-plane translation + rotation around normal still free)
 *   - coincident point/point: removes 3 DoF
 *   - coincident edge/edge: removes 4 DoF (translation along edge + rotation around edge still free)
 *   - concentric axis/axis: removes 4 DoF (slide + spin along axis still free)
 *   - parallel face/face or axis/axis: removes 2 DoF (orientation)
 *   - perpendicular: removes 1 DoF (one angle pinned)
 *   - distance face/face: removes 1 DoF (perpendicular distance pinned)
 *   - angle: removes 1 DoF
 *   - tangent face/face: removes 1 DoF (perpendicular distance = combined radii)
 *
 * These are heuristic. Phase 3.2 solver gives the real DoF after
 * Jacobian-rank analysis.
 */
export function approxDofReduction(mate: Mate): number {
  switch (mate.kind) {
    case 'coincident':
      if (mate.a.refKind === 'edge' || mate.b.refKind === 'edge') return 4;
      if (mate.a.refKind === 'point' || mate.b.refKind === 'point') return 3;
      return 3; // face/face or plane/plane
    case 'concentric':
      return 4;
    case 'parallel':
      return 2;
    case 'perpendicular':
      return 1;
    case 'distance':
      return 1;
    case 'angle':
      return 1;
    case 'tangent':
      return 1;
  }
}
