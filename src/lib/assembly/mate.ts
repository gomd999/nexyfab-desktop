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
  | 'tangent'
  // ── Phase 3.2.5 advanced mate IR (no analytical solver yet) ──────────
  | 'hinge'
  | 'slot'
  | 'gear'
  | 'rack_pinion';

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
  // ── advanced mates ───────────────────────────────────────────────────
  // hinge: composite coincident+concentric on a shared axis. Both sides
  // are axes (the axis the hinge rotates around).
  hinge: [
    ['axis', 'axis'],
  ],
  // slot: slot edge on part A + pin axis on part B. Pin slides along the
  // slot (1 DoF), and is free to spin around its own axis (1 DoF).
  slot: [
    ['edge', 'axis'],
  ],
  // gear: two rotation axes whose angular velocities are coupled by ratio.
  gear: [
    ['axis', 'axis'],
  ],
  // rack & pinion: pinion rotation axis + rack edge (translation direction).
  rack_pinion: [
    ['axis', 'edge'],
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

// ── Advanced mates (Phase 3.2.5 IR only — analytical solver TBD) ────────

/** Optional [min, max] angle limits for a hinge in degrees. */
export interface HingeLimit {
  /** Minimum allowed angle in degrees. */
  minAngleDeg: number;
  /** Maximum allowed angle in degrees. Must be ≥ minAngleDeg. */
  maxAngleDeg: number;
}

/**
 * Hinge — composite coincident + concentric on a shared axis. The two
 * parts share an axis line and may rotate relative to each other around
 * that axis. Optional angular limits clamp the rotation range.
 *
 * Combined coincident+concentric: removes 5 DoF (only 1 rotational DoF
 * remains around the shared axis).
 */
export interface HingeMate extends BaseMate {
  kind: 'hinge';
  /** Optional angular range — undefined = unlimited (full 360° spin). */
  limit?: HingeLimit;
}

/**
 * Slot — a pin (cylindrical axis) constrained to ride along a slot edge.
 * The pin axis remains perpendicular to the slot's host face (implicit in
 * the slot edge's geometry); pin slides along the slot's length (1 DoF)
 * and is free to spin around its own axis (1 DoF). Removes 4 DoF.
 */
export interface SlotMate extends BaseMate {
  kind: 'slot';
  /** Slot edge ref (refKind: 'edge'). */
  a: MateRef;
  /** Pin axis ref (refKind: 'axis'). */
  b: MateRef;
}

/**
 * Gear — couples the rotations of two axes by a fixed ratio. e.g.,
 * ratio = 2 means side A turns 2x for every turn of side B (2:1 reduction).
 * Removes 1 DoF (the relative spin is no longer free). Does NOT physically
 * collocate the axes — pair with a concentric/coincident hinge in the
 * usual case where the gears sit on parallel shafts at a fixed offset.
 */
export interface GearMate extends BaseMate {
  kind: 'gear';
  /** Ratio of (rotation_a / rotation_b). Must be > 0. e.g., 2 = 2:1. */
  ratio: number;
  /** When true, the gears rotate in opposite senses (default: external
   *  gear mesh = opposite; internal mesh = same direction). */
  reverse?: boolean;
}

/**
 * Rack & pinion — couples a pinion's angular rotation around its axis to
 * a rack's linear translation along its edge. Removes 1 DoF.
 */
export interface RackPinionMate extends BaseMate {
  kind: 'rack_pinion';
  /** Pinion rotation axis (refKind: 'axis'). */
  a: MateRef;
  /** Rack edge defining the translation direction (refKind: 'edge'). */
  b: MateRef;
  /** Pinion pitch-circle radius in mm. Must be > 0. The linear/angular
   *  coupling is: linear_displacement = pinionRadius × angular_radians. */
  pinionRadius: number;
}

export type Mate =
  | CoincidentMate
  | ConcentricMate
  | DistanceMate
  | AngleMate
  | ParallelMate
  | PerpendicularMate
  | TangentMate
  | HingeMate
  | SlotMate
  | GearMate
  | RackPinionMate;

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
  if (mate.kind === 'hinge' && mate.limit !== undefined) {
    const { minAngleDeg, maxAngleDeg } = mate.limit;
    if (!Number.isFinite(minAngleDeg) || !Number.isFinite(maxAngleDeg)) {
      throw new MateValidationError(
        `hinge mate ${mate.id}: limit angles must be finite`,
      );
    }
    if (minAngleDeg > maxAngleDeg) {
      throw new MateValidationError(
        `hinge mate ${mate.id}: limit min (${minAngleDeg}) > max (${maxAngleDeg})`,
      );
    }
  }
  if (mate.kind === 'gear') {
    if (!Number.isFinite(mate.ratio) || mate.ratio <= 0) {
      throw new MateValidationError(`gear mate ${mate.id}: ratio must be > 0`);
    }
  }
  if (mate.kind === 'rack_pinion') {
    if (!Number.isFinite(mate.pinionRadius) || mate.pinionRadius <= 0) {
      throw new MateValidationError(
        `rack_pinion mate ${mate.id}: pinionRadius must be > 0`,
      );
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
    case 'hinge':
      // coincident + concentric on a shared axis: pins down 3 translations
      // and 2 of 3 rotations (only the axial spin is free) → 5 DoF removed.
      return 5;
    case 'slot':
      // pin axis must align with slot's local normal (2) + pin must lie on
      // the slot line, 2 in-plane translations minus 1 free slide along the
      // slot = 1 fixed translation, leaving (slide along slot + pin spin)
      // free overall. Net DoF removed: 4 (3 trans pinned to a 1-D path is
      // 2 DoF removed, plus 2 rotational alignments to the slot face) — 4
      // total, matching SW's documented slot mate.
      return 4;
    case 'gear':
      // couples one scalar DoF (relative spin) between the two axes.
      return 1;
    case 'rack_pinion':
      // couples pinion rotation to rack translation, one scalar constraint.
      return 1;
  }
}
