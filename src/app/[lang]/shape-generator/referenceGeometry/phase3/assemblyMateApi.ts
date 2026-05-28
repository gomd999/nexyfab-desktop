/**
 * referenceGeometry/phase3/assemblyMateApi.ts —
 * Phase 3 forward declaration — no implementation; Phase 2 ships only the
 * type surface to lock in the API shape and allow downstream tools (CAM,
 * FEA) to type their dependencies.
 *
 * Wave 2 Phase 2 Track D Week 4. Spec §12 + §17.
 *
 * What lives here:
 *
 *   - `AssemblyMateRef`     — discriminated union over the entities a
 *                              mate can reference. Phase 3 will add face
 *                              and edge variants once the topology-naming
 *                              layer (spec §19.1) ships.
 *   - `AssemblyMateKind`    — the closed set of mate types Phase 3 will
 *                              solve. Names mirror the SolidWorks /
 *                              Onshape vocabulary so users porting
 *                              assemblies recognise the terminology.
 *   - `AssemblyMateConstraints` — per-kind constraint params (e.g.
 *                              distance for `distance` mates, angle for
 *                              `angle` mates).
 *   - `AssemblyMate`        — the full mate entry: id, kind, two refs,
 *                              constraint params, and a flag for whether
 *                              the mate is currently solved.
 *
 * What does NOT live here:
 *
 *   - A solver. Phase 3 will add `assemblyMateSolver.ts` that takes a
 *     list of `AssemblyMate` + the current ref-geom resolved values and
 *     emits a rigid-body transform per moving part.
 *   - UI. Phase 3 ships the mate-creation dialog + tree integration.
 *   - .nfab schema. Phase 3 bumps to v4 to persist `assemblyMates: AssemblyMate[]`.
 *
 * Why a forward-declared type surface in Phase 2:
 *
 *   - Downstream code that *consumes* mates (e.g. CAM toolpath planning
 *     reading mate constraints to derive fixture orientation, FEA
 *     reading distance/angle mates as boundary conditions) can already
 *     type its inputs against this module. When Phase 3 implements the
 *     solver the consumers don't need a type rewrite.
 *   - The shape locks in the API contract. If Phase 3 wants to change a
 *     mate kind or the constraint shape, that's an API-breaking change
 *     visible in code review — much harder to sneak past than if the
 *     types lived only in Phase 3's branch.
 *   - Per spec §12, the data model for ref-geom is "ready for Phase 3
 *     mates". This module makes that readiness explicit.
 *
 * No runtime symbols beyond type exports. Importing this module costs
 * zero bytes at runtime (TS strips type-only re-exports).
 */

// ─── Mate kinds (closed union) ───────────────────────────────────

/**
 * The set of mate types Phase 3 will solve. Order follows
 * SolidWorks "Standard mates" panel for muscle-memory familiarity.
 *
 *   - `coincident`     : two entities share the same point/line/plane
 *   - `concentric`     : two cylinders/axes share the same axis line
 *   - `parallel`       : two directions are parallel (no point coupling)
 *   - `perpendicular`  : two directions are mutually orthogonal
 *   - `tangent`        : a curve/surface is tangent to a curve/surface
 *   - `distance`       : two entities are a fixed signed distance apart
 *   - `angle`          : two directions are at a fixed signed angle
 */
export type AssemblyMateKind =
  | 'coincident'
  | 'concentric'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'distance'
  | 'angle';

// ─── Mate-ref discriminated union ────────────────────────────────

/**
 * The entities a mate can reference. Phase 3 will add `face` and `edge`
 * variants once the topology-naming layer ships (spec §19.1 — stable
 * names for picked faces/edges). For Phase 2 we surface only the
 * reference-geometry variants, which are already stable identifiers.
 *
 *   - `reference` : a `ReferenceNode` id (plane / axis / point / csys).
 *                   The mate consumer resolves the node via the same
 *                   evaluator used by sketches.
 *
 * Phase 3 additions (not in Phase 2):
 *   - `face`   : `{ kind: 'face', bodyId, faceId }` — once stable face
 *                ids exist via topology naming.
 *   - `edge`   : `{ kind: 'edge', bodyId, edgeId }` — same gate.
 *   - `vertex` : `{ kind: 'vertex', bodyId, vertexId }` — same gate.
 */
export type AssemblyMateRef = {
  readonly kind: 'reference';
  /** Stable id of the upstream `ReferenceNode`. */
  readonly nodeId: string;
};

// ─── Per-kind constraint params ──────────────────────────────────

/**
 * Constraint params for a `distance` mate.
 *
 *   - `distanceMm` : signed perpendicular distance between the two
 *                    entities (mm). Sign convention follows the
 *                    first-ref-frame outward normal.
 *   - `flip`       : when `true`, reverses the sign convention. UI
 *                    helper for users picking the wrong side of a face.
 */
export interface DistanceMateConstraints {
  readonly distanceMm: number;
  readonly flip?: boolean;
}

/**
 * Constraint params for an `angle` mate.
 *
 *   - `angleDeg` : signed angle between the two direction vectors (deg).
 *   - `flip`     : reverse-sign helper.
 */
export interface AngleMateConstraints {
  readonly angleDeg: number;
  readonly flip?: boolean;
}

/**
 * The other mate kinds (coincident / concentric / parallel /
 * perpendicular / tangent) have no parametric constraint beyond the
 * choice of two refs. We model that as `Record<string, never>` so the
 * discriminated union over `AssemblyMateConstraints` is exhaustive and
 * the type makes clear no params are expected.
 */
export type EmptyMateConstraints = Record<string, never>;

/**
 * Per-mate-kind constraints. Discriminated by the outer `AssemblyMate.kind`,
 * so consumers narrow with a single switch.
 */
export type AssemblyMateConstraints =
  | { readonly kind: 'coincident'; readonly params: EmptyMateConstraints }
  | { readonly kind: 'concentric'; readonly params: EmptyMateConstraints }
  | { readonly kind: 'parallel'; readonly params: EmptyMateConstraints }
  | { readonly kind: 'perpendicular'; readonly params: EmptyMateConstraints }
  | { readonly kind: 'tangent'; readonly params: EmptyMateConstraints }
  | { readonly kind: 'distance'; readonly params: DistanceMateConstraints }
  | { readonly kind: 'angle'; readonly params: AngleMateConstraints };

// ─── The mate record ─────────────────────────────────────────────

/**
 * A single assembly mate. Phase 3 will persist a `readonly AssemblyMate[]`
 * on each `.nfab` v4 project alongside the existing `referenceGeometry[]`.
 *
 *   - `id`         : stable UUID. Survives renames; referenced by Phase 3
 *                    CRDT y-array entries.
 *   - `kind`       : one of the closed set in `AssemblyMateKind`.
 *   - `entities`   : two refs (always exactly two in Phase 3). Tuple
 *                    type so the solver doesn't have to runtime-check
 *                    length.
 *   - `constraints`: per-kind parametric body.
 *   - `label`      : user-visible name, e.g. "Bolt axis ↔ Hole".
 *   - `enabled`    : when `false`, solver skips the mate but keeps it in
 *                    the document. UI toggle.
 *   - `solved`     : transient — set by the solver each pass, never
 *                    persisted. Phase 3 will model this as a separate
 *                    derived map.
 */
export interface AssemblyMate {
  readonly id: string;
  readonly kind: AssemblyMateKind;
  readonly entities: readonly [AssemblyMateRef, AssemblyMateRef];
  readonly constraints: AssemblyMateConstraints;
  readonly label: string;
  readonly enabled: boolean;
}

// ─── Type guards (consumer convenience) ─────────────────────────

/** Narrow an `AssemblyMate` by kind. */
export function isMateKind<K extends AssemblyMateKind>(
  mate: AssemblyMate,
  kind: K,
): mate is AssemblyMate & { kind: K } {
  return mate.kind === kind;
}

/** Narrow constraints by kind for downstream switch ergonomics. */
export function isDistanceMate(
  mate: AssemblyMate,
): mate is AssemblyMate & { kind: 'distance'; constraints: { kind: 'distance'; params: DistanceMateConstraints } } {
  return mate.kind === 'distance';
}

export function isAngleMate(
  mate: AssemblyMate,
): mate is AssemblyMate & { kind: 'angle'; constraints: { kind: 'angle'; params: AngleMateConstraints } } {
  return mate.kind === 'angle';
}

/** All mate kinds — useful for UI dropdowns / fuzzy completion in the
 *  Phase 3 mate-creation dialog. */
export const ASSEMBLY_MATE_KINDS: readonly AssemblyMateKind[] = [
  'coincident',
  'concentric',
  'parallel',
  'perpendicular',
  'tangent',
  'distance',
  'angle',
] as const;
