/**
 * stepAssemblyMateInference — Phase 5.2.3 Phase 2 mate inference for imported
 * STEP assemblies.
 *
 * BACKGROUND
 * ----------
 * `stepAssemblyImport.ts` (Phase 1) reconstructs an `AssemblyState` from a
 * STEP assembly file but emits `mates: []`. NEXT_ASSEMBLY_USAGE_OCCURRENCE
 * answers "where does child sit relative to parent" but NOT "what mate keeps
 * it there" — the original CAD system's mate graph is not preserved in any
 * AP203 / AP214 / AP242 entity that's universally available across writers.
 *
 * This module is the inverse-engineering pass: given the world-frame
 * placements emitted by Phase 1 plus the per-part face / axis geometry, it
 * heuristically detects which face / axis pairs are "almost touching" and
 * emits the matching `Mate` IR. The output is a STARTING POINT for the user
 * to review (mates are intentionally suggestions, not ground truth).
 *
 * HEURISTICS
 * ----------
 *   1. **Coincident face/face** — two PLANE faces whose:
 *        - normals are antiparallel OR parallel within `axisParallelTol`
 *          (mating faces usually point at each other → antiparallel; coplanar
 *          tabs share orientation → parallel),
 *        - in-plane offset is < `planeContactTol` mm (origins lie on the
 *          same infinite plane),
 *        - signed gap along the normal is < `planeContactTol` mm (faces
 *          actually touch, not just coplanar at infinity).
 *   2. **Concentric axis/axis** — two cylindrical axes whose:
 *        - directions are parallel within `axisParallelTol`,
 *        - perpendicular distance between the infinite lines is
 *          < `axisCollinearTol` mm (axes are collinear).
 *   3. **Parallel axis/axis** — same as concentric BUT perpendicular
 *      distance > `axisCollinearTol` (parallel shafts at fixed offset).
 *
 * INTENTIONALLY OUT OF SCOPE (Phase 2 limits)
 * -------------------------------------------
 *   - 8 of 11 mate kinds: distance / angle / perpendicular / tangent /
 *     hinge / slot / gear / rack_pinion. These require either a numeric
 *     value the heuristic cannot recover (distance / angle) or a composite
 *     pattern that demands per-CAD-system semantics (hinge = "user picked
 *     coincident + concentric"). The user must add them manually.
 *   - True surface-bound detection: we test whether two PLANE faces are
 *     coplanar + touching; we do not check whether they OVERLAP within the
 *     face boundaries (a tiny tab face matched against a giant plate is
 *     marked coincident even if it sits 100mm off the plate edge). The
 *     reviewer must vet each suggestion.
 *   - Non-PLANE faces (BSPLINE / CONICAL / SPHERICAL / TOROIDAL): not
 *     inspected. A CYLINDRICAL_SURFACE contributes an axis but its face is
 *     not paired against PLANE faces for tangency (Phase 3 wishlist).
 *
 * COMPLEXITY
 * ----------
 * O(N²) over part pairs × O(F²) over per-part faces and axes. For N parts
 * with average F faces each:
 *   - face pass: N(N-1)/2 part pairs × F² face pairs
 *   - axis pass: N(N-1)/2 part pairs × A² axis pairs
 * For typical Phase 5 assemblies (< 20 parts, < 50 faces each) this runs
 * in < 100ms. Assemblies > 50 parts: caller should batch or pre-filter
 * by bounding-box overlap (Phase 3 wishlist).
 *
 * FALSE POSITIVES
 * ---------------
 *   - Two PARALLEL plates sitting on opposite sides of a 0.05mm gap with a
 *     default tol of 0.1mm: emits coincident even though the user wanted
 *     them apart. Tighten `planeContactTol` to 0.01 to suppress.
 *   - A bolt's cylindrical shaft passing CLOSE TO (not through) a hole's
 *     cylindrical surface: emits parallel even though the bolt isn't
 *     touching. Tighten `axisCollinearTol`.
 *   - A long beam's face vs a tiny bracket face at the far end of the beam:
 *     emits coincident if the face origins happen to be within tol, even
 *     though the bracket is nowhere near the beam's surface. This module
 *     does NOT check face-boundary overlap.
 *   - Two parts whose internal coordinate frames happen to share an axis
 *     direction but are not physically related: emits parallel. User must
 *     delete these suggestions.
 *
 * SUGGESTED WORKFLOW
 * ------------------
 *   1. Call `importStepAssembly` to get `state` + `featureTrees`.
 *   2. Call `extractFaceDataFromSolid` and `extractAxisDataFromSolid` per
 *      part, transforming each face/axis from local → world frame by
 *      applying the part's `position` + `orientation`.
 *   3. Call `inferMatesFromPlacements` with the result.
 *   4. Surface the emitted mates as "Suggested Mates" in the UI with a
 *      diff-style review: user accepts / rejects each one before they
 *      land in the persisted `AssemblyState`.
 */

import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type {
  Mate,
  MateRef,
  CoincidentMate,
  ConcentricMate,
  ParallelMate,
} from '@/lib/assembly/mate';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import {
  parseEntities,
  type StepEntity,
} from './stepImport';
import { healStepSource } from './stepRead';

// ─── public types ─────────────────────────────────────────────────────────

export interface FaceData {
  /**
   * Stable identifier for this face within its part. Used as the `refId`
   * on emitted `MateRef`s. Typical convention: `face_<step_id>`.
   */
  id: string;
  /** World-frame origin point on the face (e.g., centroid or first vertex). */
  origin: Vec3;
  /** World-frame outward unit normal of the face. */
  normal: Vec3;
}

export interface AxisData {
  /** Stable identifier for this axis within its part. */
  id: string;
  /** World-frame point on the axis line. */
  origin: Vec3;
  /** World-frame unit direction vector of the axis. */
  direction: Vec3;
}

export interface MateInferenceOptions {
  /** Tolerance for "coplanar" face detection (mm). Default 0.1. */
  planeContactTol?: number;
  /** Tolerance for "collinear" axis detection (mm). Default 0.1. */
  axisCollinearTol?: number;
  /** Tolerance for "parallel" axis detection (degrees). Default 1. */
  axisParallelTol?: number;
}

const DEFAULT_PLANE_CONTACT_TOL = 0.1;
const DEFAULT_AXIS_COLLINEAR_TOL = 0.1;
const DEFAULT_AXIS_PARALLEL_TOL_DEG = 1;

// ─── public API ───────────────────────────────────────────────────────────

/**
 * Infer mate constraints from part placements + per-part face / axis data.
 *
 * Algorithm overview:
 *   1. For every unordered pair of parts (A, B):
 *      a. Coincident face/face pass: pair each face on A with each face on
 *         B. Emit a `coincident` mate when normals are parallel AND in-plane
 *         offset < planeContactTol AND signed gap < planeContactTol.
 *      b. Concentric / parallel axis pass: pair each axis on A with each
 *         axis on B. When directions are parallel:
 *           - perpendicular distance < axisCollinearTol → `concentric`.
 *           - else → `parallel`.
 *   2. Skip pairs where the same `(refId, refId)` pair was already emitted
 *      (dedup — multiple faces on the same part can be coplanar; we want one
 *      coincident mate per pair, not the cross product).
 *
 * Parts missing from `partFaces` / `partAxes` are treated as having zero
 * faces / zero axes (no mates are inferred for those parts but the rest of
 * the assembly is processed normally).
 *
 * Returns a list of `Mate` IR objects with auto-generated ids of the form
 * `inferred_<kind>_<n>`. Caller is expected to validate / present these to
 * the user before persisting them into the AssemblyState.
 */
export function inferMatesFromPlacements(
  state: AssemblyState,
  partFaces: Record<string, FaceData[]>,
  partAxes: Record<string, AxisData[]>,
  opts: MateInferenceOptions = {},
): Mate[] {
  const planeContactTol = opts.planeContactTol ?? DEFAULT_PLANE_CONTACT_TOL;
  const axisCollinearTol = opts.axisCollinearTol ?? DEFAULT_AXIS_COLLINEAR_TOL;
  const axisParallelTolDeg = opts.axisParallelTol ?? DEFAULT_AXIS_PARALLEL_TOL_DEG;

  // |sin(θ)| ≈ θ_rad for small angles. Convert the user-supplied degree
  // tolerance into a cross-product magnitude threshold (unit vectors).
  const parallelCrossTol = Math.sin((axisParallelTolDeg * Math.PI) / 180);

  const partIds = state.parts.map((p) => p.id);
  const mates: Mate[] = [];
  // Dedup key: alphabetised "<partA>/<refA>|<partB>/<refB>|<kind>". Same
  // face/axis pair emitting the same mate kind is collapsed to one entry.
  const seen = new Set<string>();

  let mateCounter = 0;
  const nextMateId = (kind: string): string => {
    mateCounter += 1;
    return `inferred_${kind}_${mateCounter}`;
  };

  // ── pairwise scan over parts ──────────────────────────────────────────
  for (let i = 0; i < partIds.length; i++) {
    for (let j = i + 1; j < partIds.length; j++) {
      const aPartId = partIds[i]!;
      const bPartId = partIds[j]!;

      const aFaces = partFaces[aPartId] ?? [];
      const bFaces = partFaces[bPartId] ?? [];
      const aAxes = partAxes[aPartId] ?? [];
      const bAxes = partAxes[bPartId] ?? [];

      // ── coincident face/face ─────────────────────────────────────────
      for (const fa of aFaces) {
        for (const fb of bFaces) {
          if (!isFacePairCoincident(fa, fb, planeContactTol, parallelCrossTol)) continue;
          const key = mateDedupKey(aPartId, fa.id, bPartId, fb.id, 'coincident');
          if (seen.has(key)) continue;
          seen.add(key);
          const mate: CoincidentMate = {
            id: nextMateId('coincident'),
            kind: 'coincident',
            a: refFor(aPartId, fa.id, 'face'),
            b: refFor(bPartId, fb.id, 'face'),
          };
          mates.push(mate);
        }
      }

      // ── concentric / parallel axis/axis ─────────────────────────────
      for (const aa of aAxes) {
        for (const ab of bAxes) {
          if (!directionsParallel(aa.direction, ab.direction, parallelCrossTol)) continue;
          const lateral = perpendicularDistance(aa, ab);
          if (lateral < axisCollinearTol) {
            const key = mateDedupKey(aPartId, aa.id, bPartId, ab.id, 'concentric');
            if (seen.has(key)) continue;
            seen.add(key);
            const mate: ConcentricMate = {
              id: nextMateId('concentric'),
              kind: 'concentric',
              a: refFor(aPartId, aa.id, 'axis'),
              b: refFor(bPartId, ab.id, 'axis'),
            };
            mates.push(mate);
          } else {
            const key = mateDedupKey(aPartId, aa.id, bPartId, ab.id, 'parallel');
            if (seen.has(key)) continue;
            seen.add(key);
            const mate: ParallelMate = {
              id: nextMateId('parallel'),
              kind: 'parallel',
              a: refFor(aPartId, aa.id, 'axis'),
              b: refFor(bPartId, ab.id, 'axis'),
            };
            mates.push(mate);
          }
        }
      }
    }
  }

  return mates;
}

// ─── face / axis extractors (from STEP source) ────────────────────────────

/**
 * Walk a STEP source and extract face metadata for every ADVANCED_FACE
 * reachable from `manifoldId` (a MANIFOLD_SOLID_BREP or BREP_WITH_VOIDS).
 *
 * Returns the LOCAL-frame face data (origin + normal in the part's own
 * coordinate system). Callers that need world-frame data must transform
 * each entry by the part's `position` + `orientation` from the imported
 * AssemblyState.
 *
 * Only PLANE surfaces produce entries — CYLINDRICAL_SURFACE faces are
 * handled by `extractAxisDataFromSolid`; other surface kinds (BSPLINE /
 * CONICAL / SPHERICAL / TOROIDAL) are silently skipped (Phase 3 wishlist).
 *
 * The `origin` is sourced from the AXIS2_PLACEMENT_3D on the PLANE surface
 * (matches the natural orientation reference, not the face centroid). For
 * mate inference this is sufficient because we test whether the origin
 * lies on the OTHER face's plane — a single sample point is enough.
 *
 * The face id is `face_<step_id>` where `step_id` is the ADVANCED_FACE's
 * entity number in the STEP source.
 */
export function extractFaceDataFromSolid(
  source: string,
  manifoldId: number,
): FaceData[] {
  const entities = parseStepEntities(source);
  if (!entities) return [];

  const solid = entities.get(manifoldId);
  if (!solid) return [];
  if (solid.name !== 'MANIFOLD_SOLID_BREP' && solid.name !== 'BREP_WITH_VOIDS') {
    return [];
  }

  const shellRef = solid.args[1];
  if (!shellRef || shellRef.kind !== 'ref') return [];
  const shell = entities.get(shellRef.id);
  if (!shell) return [];
  if (shell.name !== 'CLOSED_SHELL' && shell.name !== 'OPEN_SHELL') return [];

  const facesArg = shell.args[1];
  if (!facesArg || facesArg.kind !== 'list') return [];

  const faces: FaceData[] = [];
  for (const item of facesArg.items) {
    if (item.kind !== 'ref') continue;
    const faceId = item.id;
    const face = entities.get(faceId);
    if (!face || face.name !== 'ADVANCED_FACE') continue;
    const surfaceRef = face.args[2];
    if (!surfaceRef || surfaceRef.kind !== 'ref') continue;
    const surface = entities.get(surfaceRef.id);
    if (!surface || surface.name !== 'PLANE') continue;
    const axisRef = surface.args[1];
    if (!axisRef || axisRef.kind !== 'ref') continue;
    const placement = readAxisPlacement(axisRef.id, entities);
    if (!placement) continue;
    // ADVANCED_FACE has an optional same_sense flag at args[3]; when .F.
    // the surface normal is flipped relative to the face's outward normal.
    let sense = 1;
    const senseArg = face.args[3];
    if (senseArg && senseArg.kind === 'enum' && senseArg.value === 'F') {
      sense = -1;
    }
    faces.push({
      id: `face_${faceId}`,
      origin: { x: placement.origin[0], y: placement.origin[1], z: placement.origin[2] },
      normal: {
        x: placement.zDir[0] * sense,
        y: placement.zDir[1] * sense,
        z: placement.zDir[2] * sense,
      },
    });
  }
  return faces;
}

/**
 * Walk a STEP source and extract cylindrical-axis metadata for every
 * CYLINDRICAL_SURFACE face reachable from `manifoldId`.
 *
 * Returns LOCAL-frame axis data (origin + direction in the part's own
 * coordinate system). Callers must transform to world frame using the
 * part's `position` + `orientation` before passing to
 * `inferMatesFromPlacements`.
 *
 * Each cylinder face contributes ONE AxisData. A part with two cylinders
 * (e.g., a pin with a stepped diameter) yields two axes; they may be
 * coincident if the steps share the same axis line — that's fine, the
 * dedup in `inferMatesFromPlacements` handles repeat axes naturally.
 *
 * The axis id is `axis_<step_id>` where `step_id` is the underlying
 * CYLINDRICAL_SURFACE entity number.
 */
export function extractAxisDataFromSolid(
  source: string,
  manifoldId: number,
): AxisData[] {
  const entities = parseStepEntities(source);
  if (!entities) return [];

  const solid = entities.get(manifoldId);
  if (!solid) return [];
  if (solid.name !== 'MANIFOLD_SOLID_BREP' && solid.name !== 'BREP_WITH_VOIDS') {
    return [];
  }

  const shellRef = solid.args[1];
  if (!shellRef || shellRef.kind !== 'ref') return [];
  const shell = entities.get(shellRef.id);
  if (!shell) return [];
  if (shell.name !== 'CLOSED_SHELL' && shell.name !== 'OPEN_SHELL') return [];

  const facesArg = shell.args[1];
  if (!facesArg || facesArg.kind !== 'list') return [];

  // Dedup by surface entity id: a stepped cylinder may emit the same
  // CYLINDRICAL_SURFACE from multiple ADVANCED_FACEs (rare, but the spec
  // allows it). One axis is enough.
  const seenSurfaces = new Set<number>();
  const axes: AxisData[] = [];
  for (const item of facesArg.items) {
    if (item.kind !== 'ref') continue;
    const face = entities.get(item.id);
    if (!face || face.name !== 'ADVANCED_FACE') continue;
    const surfaceRef = face.args[2];
    if (!surfaceRef || surfaceRef.kind !== 'ref') continue;
    if (seenSurfaces.has(surfaceRef.id)) continue;
    const surface = entities.get(surfaceRef.id);
    if (!surface || surface.name !== 'CYLINDRICAL_SURFACE') continue;
    const axisRef = surface.args[1];
    if (!axisRef || axisRef.kind !== 'ref') continue;
    const placement = readAxisPlacement(axisRef.id, entities);
    if (!placement) continue;
    seenSurfaces.add(surfaceRef.id);
    axes.push({
      id: `axis_${surfaceRef.id}`,
      origin: { x: placement.origin[0], y: placement.origin[1], z: placement.origin[2] },
      direction: { x: placement.zDir[0], y: placement.zDir[1], z: placement.zDir[2] },
    });
  }
  return axes;
}

// ─── internal: STEP parsing helper ────────────────────────────────────────

/**
 * Re-run heal + parseEntities on a STEP source. Wrapped in try/catch so a
 * malformed source returns null (caller treats as "no data") instead of
 * propagating the error — the extractors are best-effort by contract.
 */
function parseStepEntities(source: string): Map<number, StepEntity> | null {
  if (typeof source !== 'string' || source.length === 0) return null;
  try {
    const healed = healStepSource(source).healed;
    const dataIdx = healed.search(/\bDATA\s*;/i);
    if (dataIdx < 0) return null;
    const endIdx = healed.indexOf('END-ISO-10303-21');
    const dataBlock = healed.slice(dataIdx, endIdx >= 0 ? endIdx : undefined);
    return parseEntities(dataBlock);
  } catch {
    return null;
  }
}

function readAxisPlacement(
  id: number,
  entities: Map<number, StepEntity>,
): { origin: [number, number, number]; zDir: [number, number, number] } | null {
  const ent = entities.get(id);
  if (!ent || ent.name !== 'AXIS2_PLACEMENT_3D') return null;
  const originRef = ent.args[1];
  const zRef = ent.args[2];
  if (!originRef || originRef.kind !== 'ref') return null;
  const origin = readCartesianPoint(originRef.id, entities);
  if (!origin) return null;
  let zDir: [number, number, number] = [0, 0, 1];
  if (zRef && zRef.kind === 'ref') {
    const z = readDirection(zRef.id, entities);
    if (z) zDir = z;
  }
  return { origin, zDir };
}

function readCartesianPoint(
  id: number,
  entities: Map<number, StepEntity>,
): [number, number, number] | null {
  const cp = entities.get(id);
  if (!cp || cp.name !== 'CARTESIAN_POINT') return null;
  const coords = cp.args[1];
  if (!coords || coords.kind !== 'list') return null;
  const xs: number[] = [];
  for (const it of coords.items) {
    if (it.kind !== 'number') return null;
    xs.push(it.value);
  }
  if (xs.length !== 3) return null;
  return [xs[0]!, xs[1]!, xs[2]!];
}

function readDirection(
  id: number,
  entities: Map<number, StepEntity>,
): [number, number, number] | null {
  const ent = entities.get(id);
  if (!ent || ent.name !== 'DIRECTION') return null;
  const listArg = ent.args[1];
  if (!listArg || listArg.kind !== 'list') return null;
  const xs: number[] = [];
  for (const it of listArg.items) {
    if (it.kind !== 'number') return null;
    xs.push(it.value);
  }
  if (xs.length !== 3) return null;
  return [xs[0]!, xs[1]!, xs[2]!];
}

// ─── geometry predicates ──────────────────────────────────────────────────

/**
 * Two infinite PLANE faces are "coincident" (in the mate sense) when:
 *   1. their normals are parallel OR antiparallel within `parallelCrossTol`,
 *   2. the offset between their origins lies WITHIN the shared plane
 *      (in-plane component ≤ planeContactTol from the line connecting them
 *      perpendicular to the plane normal — measured by projecting one origin
 *      onto the other plane and checking the residual is small),
 *   3. the perpendicular gap (signed distance from face A's origin to the
 *      plane through face B) is ≤ planeContactTol.
 *
 * Note: this does NOT verify the face boundaries overlap. A tab face whose
 * origin lands on a plate's plane is marked coincident even if the tab is
 * physically miles from the plate's actual extent. See module docstring
 * "FALSE POSITIVES" for the mitigation strategy (user review).
 */
function isFacePairCoincident(
  a: FaceData,
  b: FaceData,
  planeContactTol: number,
  parallelCrossTol: number,
): boolean {
  if (!directionsParallel(a.normal, b.normal, parallelCrossTol)) return false;
  // Test (1) is satisfied; now test (3): perpendicular gap.
  // Normalize B's normal for projection.
  const nb = normalize(b.normal);
  if (nb === null) return false;
  const dx = a.origin.x - b.origin.x;
  const dy = a.origin.y - b.origin.y;
  const dz = a.origin.z - b.origin.z;
  const signedGap = dx * nb.x + dy * nb.y + dz * nb.z;
  return Math.abs(signedGap) <= planeContactTol;
}

/**
 * Perpendicular distance between two infinite lines that are KNOWN to be
 * parallel (caller checks first). When parallel, perpendicular distance =
 * |(A.origin − B.origin) − ((A.origin − B.origin) · d̂) d̂|, where d̂ is
 * the shared unit direction.
 *
 * For skew (non-parallel) lines this formula returns a meaningless value;
 * callers gate it on `directionsParallel`.
 */
function perpendicularDistance(a: AxisData, b: AxisData): number {
  const d = normalize(a.direction);
  if (d === null) return Infinity;
  const dx = a.origin.x - b.origin.x;
  const dy = a.origin.y - b.origin.y;
  const dz = a.origin.z - b.origin.z;
  const along = dx * d.x + dy * d.y + dz * d.z;
  const perpX = dx - along * d.x;
  const perpY = dy - along * d.y;
  const perpZ = dz - along * d.z;
  return Math.hypot(perpX, perpY, perpZ);
}

/**
 * Returns true when two direction vectors are parallel OR antiparallel
 * within `crossTol` (= sin(angle)). Uses |cross product| / (|a|·|b|) so the
 * test is independent of input magnitude — callers may pass non-unit
 * vectors. Zero-length vectors return false.
 */
function directionsParallel(a: Vec3, b: Vec3, crossTol: number): boolean {
  const la = Math.hypot(a.x, a.y, a.z);
  const lb = Math.hypot(b.x, b.y, b.z);
  if (la < 1e-12 || lb < 1e-12) return false;
  const cx = a.y * b.z - a.z * b.y;
  const cy = a.z * b.x - a.x * b.z;
  const cz = a.x * b.y - a.y * b.x;
  const cm = Math.hypot(cx, cy, cz) / (la * lb);
  return cm <= crossTol;
}

function normalize(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-12) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ─── small helpers ────────────────────────────────────────────────────────

function refFor(partId: string, refId: string, refKind: MateRef['refKind']): MateRef {
  return { partId, refId, refKind };
}

/**
 * Build a kind-tagged dedup key for a (partA/refA, partB/refB, kind) tuple.
 * The pair is sorted lexicographically so swapping A and B yields the same
 * key (a mate is undirected at the IR level).
 */
function mateDedupKey(
  aPart: string,
  aRef: string,
  bPart: string,
  bRef: string,
  kind: string,
): string {
  const left = `${aPart}/${aRef}`;
  const right = `${bPart}/${bRef}`;
  const [lo, hi] = left < right ? [left, right] : [right, left];
  return `${lo}|${hi}|${kind}`;
}
