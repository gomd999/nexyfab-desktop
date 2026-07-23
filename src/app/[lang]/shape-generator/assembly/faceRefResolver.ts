/**
 * faceRefResolver.ts — mate-solver unification, Step 2 PREP ONLY (260723).
 *
 * Scoping context (docs/strategy/M3_ASSEMBLY.md, architecture-debt review
 * 260723): #3 (`AssemblyMates.ts` / `applyGeometryMatesToPlaced` — the real
 * drag-and-drop/save path, product-critical) and #1 (`src/lib/assembly/api.ts`'s
 * `solveMates`, the most-tested engine) speak different data models — #3
 * picks mesh FACE INDICES on placed geometry, #1 mates reference NAMED,
 * LOCAL-FRAME primitives (`PartRefSpec`: point/axis/plane) registered per part.
 * `mateSelectionMapping.ts` already bridges #3's face picks → #2's
 * (`matesSolver.ts`) `MateSelection` shape; this module is the SAME bridge
 * targeting #1 instead, reusing the exact `faceCentroidLocal`/`faceNormalLocal`
 * primitives (a face is just a local point + normal either way).
 *
 * ⚠ THIS MODULE IS NOT WIRED INTO #3'S LIVE PATH. `applyGeometryMatesToPlaced`
 * still calls its own analytic solver, untouched. This is deliberate — the
 * scoping report flagged migrating #3 itself as "medium risk" (real
 * save/placement path) and recommended it only after the #4 retirement
 * (this session, see ShapeGeneratorInner.tsx's mate-solve effect) has had
 * time to prove out live. What ships here is the boundable, low-risk PREP:
 * a tested geometry-resolver + input-builder that a FUTURE #3 migration can
 * call directly — building it now, separately, means that migration won't
 * also have to invent the geometry bridge from scratch under time pressure.
 *
 * Mate-kind coverage (honest, not silently patched over):
 *   `AssemblyMate['type']` has 13 members; `MateKind` (api.ts) has 11.
 *   9 share the same name and are mapped 1:1 below: coincident, concentric,
 *   distance, angle, parallel, perpendicular, tangent, hinge, gear.
 *   4 have NO api.ts equivalent and are reported as `unsupported_kind`,
 *   never silently coerced to something close:
 *     - slider     — api.ts's nearest concept is `slot`, but slot's actual
 *                    constraint semantics were not verified equivalent here;
 *                    mapping it would be a guess, not a fact.
 *     - limitDistance / limitAngle — no bounded-range mate kind in api.ts.
 *     - width      — api.ts has no second-reference-plane mate kind.
 *   (api.ts's `rack_pinion` and `slot` have no `AssemblyMate` source either
 *   — coverage is not 1:1 in either direction.)
 *
 * Separately open (solver-BEHAVIOR questions, not this module's job):
 *   whether #1's iterative/Newton solver's convergence behavior matches
 *   `applyGeometryMatesToPlaced`'s live-drag incremental semantics closely
 *   enough for a real migration. This module only proves the GEOMETRY
 *   plumbing is sound; solver-behavior parity is a separate, later question.
 */
import * as THREE from 'three';
import { buildShapeResult } from '../shapes';
import type { PlacedPart } from './PartPlacementPanel';
import type { AssemblyMate } from './AssemblyMates';
import {
  faceCentroidLocal,
  faceNormalLocal,
  classifyPlacedAssemblyMateMappingFailure,
} from './mateSelectionMapping';
import type {
  PartRefSpec,
  SolvePartSpec,
  SolveMateSpec,
  Vec3Like,
} from '@/lib/assembly/api';
import type { MateKind } from '@/lib/assembly/mate';

/** `AssemblyMate['type']` values with a same-named, 1:1 `MateKind` in api.ts.
 *  Anything absent from this map is `unsupported_kind` — see header doc. */
const KIND_MAP: Partial<Record<AssemblyMate['type'], MateKind>> = {
  coincident: 'coincident',
  concentric: 'concentric',
  distance: 'distance',
  angle: 'angle',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  tangent: 'tangent',
  hinge: 'hinge',
  gear: 'gear',
};

/** Mate kinds whose natural ref is a directed AXIS (origin + direction) —
 *  mirrors `mateSelectionFromPlacedFace`'s precedent for #2 (localAxis =
 *  face normal). Everything else maps to a PLANE ref (origin + normal). */
const AXIS_KINDS = new Set<AssemblyMate['type']>(['concentric', 'hinge', 'gear']);

/** Why a mate could not be turned into a `SolveMateSpec` — for UI/diagnostics,
 *  same shape as `mateSelectionMapping.ts`'s `MateMappingFailure` plus the
 *  one failure mode unique to this target (`unsupported_kind`). */
export type FaceRefMappingFailure =
  | 'part_a_not_found'
  | 'part_b_not_found'
  | 'geometry_a_missing'
  | 'geometry_b_missing'
  | 'unsupported_kind';

export interface PlacedFaceRefMappingReport {
  includedMateIds: string[];
  failures: { mateId: string; failure: FaceRefMappingFailure }[];
}

function toVec3Like(v: THREE.Vector3): Vec3Like {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * One face selection → a `PartRefSpec` in the part's LOCAL frame (api.ts's
 * `solveMates` applies the part's position/orientation itself — this
 * resolver never needs world coordinates, unlike a `GeometryResolver`).
 */
export function faceRefFromPlacedFace(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  mateType: AssemblyMate['type'],
): PartRefSpec {
  const origin = toVec3Like(faceCentroidLocal(geometry, faceIndex));
  const normal = toVec3Like(faceNormalLocal(geometry, faceIndex));
  if (AXIS_KINDS.has(mateType)) {
    return { kind: 'axis', origin, direction: normal };
  }
  return { kind: 'plane', origin, normal };
}

/** `null` = mappable. Reuses #2's part/geometry checks, adds kind coverage. */
export function classifyPlacedFaceRefMappingFailure(
  mate: AssemblyMate,
  placed: PlacedPart[],
): FaceRefMappingFailure | null {
  const base = classifyPlacedAssemblyMateMappingFailure(mate, placed);
  if (base) return base;
  if (!KIND_MAP[mate.type]) return 'unsupported_kind';
  return null;
}

/** Standard XYZ-order, degrees→radians Euler→quaternion — same convention
 *  `mateSelectionMapping.ts`'s `placedPartWorldMatrix` already uses for this
 *  exact `PlacedPart.rotation` field. */
function placedRotationToQuat(rotation: readonly [number, number, number]): { x: number; y: number; z: number; w: number } {
  const e = new THREE.Euler(
    (rotation[0] * Math.PI) / 180,
    (rotation[1] * Math.PI) / 180,
    (rotation[2] * Math.PI) / 180,
  );
  const q = new THREE.Quaternion().setFromEuler(e);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export type PlacedToSolveMatesOptions = {
  /** Default `true`: fix part index 0 (matches `mateSelectionMapping.ts`'s
   *  `PlacedToSolverStateOptions.fixFirstPart` default for #2). */
  fixFirstPart?: boolean;
};

/**
 * `PlacedPart[]` → api.ts `SolvePartSpec[]` (position/orientation carried
 * through as-is; no refs needed beyond the built-ins unless a mate below
 * adds a face ref for that part).
 */
function partSpecsFromPlaced(placed: PlacedPart[], fixFirst: boolean): SolvePartSpec[] {
  return placed.map((p, i) => ({
    partId: p.id,
    name: p.name,
    position: { x: p.position[0], y: p.position[1], z: p.position[2] },
    orientation: placedRotationToQuat(p.rotation),
    fixed: fixFirst && i === 0,
    refs: {},
  }));
}

/**
 * `PlacedPart[]` + `AssemblyMate[]` → api.ts `solveMates` input, mirroring
 * `mateSelectionMapping.ts`'s `placedPartsAndAssemblyMatesToSolverState` but
 * targeting #1 instead of #2. Unsupported/unmappable mates are excluded, not
 * silently guessed — see `report` for exactly which and why.
 *
 * NOT called by any live path today (see header doc) — exercised only by
 * this module's own tests until a future #3 migration adopts it.
 */
export function placedPartsAndAssemblyMatesToSolveMatesInput(
  placed: PlacedPart[],
  mates: AssemblyMate[],
  options?: PlacedToSolveMatesOptions,
): { parts: SolvePartSpec[]; mates: SolveMateSpec[]; report: PlacedFaceRefMappingReport } {
  const fixFirst = options?.fixFirstPart !== false;
  const parts = partSpecsFromPlaced(placed, fixFirst);
  const partById = new Map(parts.map(p => [p.partId!, p]));

  const solveMates: SolveMateSpec[] = [];
  const includedMateIds: string[] = [];
  const failures: { mateId: string; failure: FaceRefMappingFailure }[] = [];

  for (const m of mates) {
    const failure = classifyPlacedFaceRefMappingFailure(m, placed);
    if (failure) {
      failures.push({ mateId: m.id, failure });
      continue;
    }
    const kind = KIND_MAP[m.type]!;
    const ia = placed.findIndex(x => x.name === m.partA);
    const ib = placed.findIndex(x => x.name === m.partB);
    const partA = placed[ia]!;
    const partB = placed[ib]!;
    const geomA = buildShapeResult(partA.shapeId, partA.params)!.geometry!;
    const geomB = buildShapeResult(partB.shapeId, partB.params)!.geometry!;
    const fa = m.faceA ?? 0;
    const fb = m.faceB ?? 0;

    const refA = faceRefFromPlacedFace(geomA, fa, m.type);
    const refB = faceRefFromPlacedFace(geomB, fb, m.type);
    const refIdA = `face_${fa}`;
    const refIdB = `face_${fb}`;
    partById.get(partA.id)!.refs![refIdA] = refA;
    partById.get(partB.id)!.refs![refIdB] = refB;

    const spec: SolveMateSpec = {
      id: m.id,
      kind,
      a: { partId: partA.id, refId: refIdA },
      b: { partId: partB.id, refId: refIdB },
      suppressed: m.locked,
    };
    if (m.type === 'distance' && m.value !== undefined) spec.value = m.value;
    if (m.type === 'angle' && m.value !== undefined) spec.value = m.value;
    if (m.type === 'gear' && m.value !== undefined) spec.ratio = m.value;
    solveMates.push(spec);
    includedMateIds.push(m.id);
  }

  return { parts, mates: solveMates, report: { includedMateIds, failures } };
}
