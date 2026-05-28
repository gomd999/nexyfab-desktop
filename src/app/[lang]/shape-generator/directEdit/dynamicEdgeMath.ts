/**
 * dynamicEdgeMath.ts — Wave 2 Phase 3 Track E2.
 *
 * Pure math helpers for dynamic edge editing (fillet / chamfer) via
 * direct manipulation. Mirrors `pushPullMath.ts` for E1.
 *
 * No THREE.js, no React. The applier files
 * (`applyDynamicFillet.ts` / `applyDynamicChamfer.ts`) compose these
 * helpers with the BufferGeometry traversal.
 *
 * Sign + projection convention:
 *   - Fillet radius is the perpendicular distance from the original
 *     edge to the rolled cylinder's axis (≡ the radius of the
 *     quarter-cylinder cap, by definition).
 *   - Chamfer distance is the setback from the corner along each
 *     adjacent face, measured along the in-face direction
 *     perpendicular to the edge axis. Symmetric chamfer only —
 *     asymmetric / angled chamfer is a Phase 4 B-Rep job.
 *
 * The drag-to-magnitude projection deliberately uses the same
 * "scalar projection onto a unit vector" idiom as `pushPullMath`,
 * so the gesture feel is consistent across direct-edit modes.
 */

export type Vec3 = readonly [number, number, number];

/** Smallest meaningful drag in mm. Mirrors pushPullMath. */
export const DYNAMIC_EDGE_EPSILON_MM = 1e-4;

/** Maximum |radius| / |distance| allowed by validation. Same scale
 *  guard as push-pull — keeps a 10m fillet on a 10mm box out of the
 *  session stack. */
export const DYNAMIC_EDGE_MAX_MM = 1000;

/** Quantisation step for `encodeEdgeId`. 1µm matches the OCCT
 *  tolerance used elsewhere in the pipeline (see
 *  `features/edgeCorrespondence.ts`), so two mesh edges that share
 *  endpoints to within tessellation noise resolve to the same id. */
const EDGE_ID_QUANTUM_MM = 1e-3;

const MIN_EDGE_LEN = 1e-6;

// ─── Encoding / decoding edge ids ───────────────────────────────────────────

/** Quantise + sort endpoint coordinates so reversing start/end resolves
 *  to the same edge id. Output: "x0:y0:z0|x1:y1:z1" with quantised
 *  integers (rounded to `EDGE_ID_QUANTUM_MM`). */
export function encodeEdgeId(start: Vec3, end: Vec3): string {
  const sx = Math.round(start[0] / EDGE_ID_QUANTUM_MM);
  const sy = Math.round(start[1] / EDGE_ID_QUANTUM_MM);
  const sz = Math.round(start[2] / EDGE_ID_QUANTUM_MM);
  const ex = Math.round(end[0] / EDGE_ID_QUANTUM_MM);
  const ey = Math.round(end[1] / EDGE_ID_QUANTUM_MM);
  const ez = Math.round(end[2] / EDGE_ID_QUANTUM_MM);
  // Compare lexicographically by (x, y, z) tuple — symmetric encoding.
  const cmp = sx !== ex ? sx - ex : sy !== ey ? sy - ey : sz - ez;
  const a = cmp <= 0 ? [sx, sy, sz] : [ex, ey, ez];
  const b = cmp <= 0 ? [ex, ey, ez] : [sx, sy, sz];
  return `${a[0]}:${a[1]}:${a[2]}|${b[0]}:${b[1]}:${b[2]}`;
}

/** Reverse of `encodeEdgeId`. Returns null for malformed input.
 *  Used by the applier to walk the mesh and find a matching edge. */
export function decodeEdgeId(edgeId: string): { a: Vec3; b: Vec3 } | null {
  const halves = edgeId.split('|');
  if (halves.length !== 2) return null;
  const parse = (s: string): Vec3 | null => {
    const parts = s.split(':');
    if (parts.length !== 3) return null;
    const xs = parts.map(p => Number(p) * EDGE_ID_QUANTUM_MM);
    if (xs.some(n => !Number.isFinite(n))) return null;
    return [xs[0]!, xs[1]!, xs[2]!];
  };
  const a = parse(halves[0]!);
  const b = parse(halves[1]!);
  if (!a || !b) return null;
  return { a, b };
}

// ─── Drag → radius / distance projections ───────────────────────────────────

/** Length of the perpendicular component of `dragDelta` relative to
 *  the edge axis (`edgeEnd - edgeStart`). This IS the natural
 *  "how far did the cursor move off the edge" magnitude, which we use
 *  as the live fillet radius during drag. Always non-negative.
 *
 *  When the edge is degenerate (zero length), we fall back to the
 *  full drag magnitude — the user is dragging a point, not an edge,
 *  and the projection is ill-defined. */
export function computeFilletRadiusFromDrag(
  edgeStart: Vec3,
  edgeEnd: Vec3,
  dragDelta: Vec3,
): number {
  const ex = edgeEnd[0] - edgeStart[0];
  const ey = edgeEnd[1] - edgeStart[1];
  const ez = edgeEnd[2] - edgeStart[2];
  const elen = Math.hypot(ex, ey, ez);
  if (elen < MIN_EDGE_LEN) {
    return Math.hypot(dragDelta[0], dragDelta[1], dragDelta[2]);
  }
  const ux = ex / elen, uy = ey / elen, uz = ez / elen;
  const dot = dragDelta[0] * ux + dragDelta[1] * uy + dragDelta[2] * uz;
  const px = dragDelta[0] - dot * ux;
  const py = dragDelta[1] - dot * uy;
  const pz = dragDelta[2] - dot * uz;
  const radius = Math.hypot(px, py, pz);
  return radius < DYNAMIC_EDGE_EPSILON_MM ? 0 : radius;
}

/** Length of the component of `dragDelta` parallel to the edge axis.
 *  Mirrors push-pull's projection onto the face normal — except for
 *  chamfer the "projection direction" is the edge itself. Returns
 *  absolute (sign-free) distance; a 5mm chamfer is a 5mm chamfer
 *  regardless of which way the user dragged. */
export function computeChamferDistanceFromDrag(
  edgeStart: Vec3,
  edgeEnd: Vec3,
  dragDelta: Vec3,
): number {
  const ex = edgeEnd[0] - edgeStart[0];
  const ey = edgeEnd[1] - edgeStart[1];
  const ez = edgeEnd[2] - edgeStart[2];
  const elen = Math.hypot(ex, ey, ez);
  if (elen < MIN_EDGE_LEN) {
    return Math.hypot(dragDelta[0], dragDelta[1], dragDelta[2]);
  }
  const ux = ex / elen, uy = ey / elen, uz = ez / elen;
  const dot = dragDelta[0] * ux + dragDelta[1] * uy + dragDelta[2] * uz;
  const distance = Math.abs(dot);
  return distance < DYNAMIC_EDGE_EPSILON_MM ? 0 : distance;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Refusal reasons produced by `validateDynamicFillet`.
 *  - `over_round` — radius > 50% of the shortest adjacent face's
 *    perpendicular extent (rounding would consume the face).
 *  - `edge_too_short` — edge length < 2 × radius. Without that
 *    headroom the quarter-cylinder cap doesn't fit along the edge
 *    and the mesh-level applier produces overlapping triangles.
 *  - `invalid_radius` — non-finite or non-positive radius.
 *  - `too_large` — radius exceeds the absolute scale guard. */
export type DynamicFilletValidationResult =
  | { ok: true }
  | { ok: false; reason: 'over_round' | 'edge_too_short' | 'invalid_radius' | 'too_large' };

export interface DynamicFilletValidationContext {
  /** Mesh edge length (mm). */
  edgeLengthMm: number;
  /** Smallest perpendicular extent (mm) of any face adjacent to the
   *  picked edge — i.e. the in-face dimension perpendicular to the
   *  edge axis, taken across the 2 adjacent faces on a typical
   *  manifold mesh. The applier computes this from the face's bbox
   *  before calling the validator. */
  shortestAdjacentFaceExtentMm: number;
}

export function validateDynamicFillet(
  radius: number,
  ctx: DynamicFilletValidationContext,
): DynamicFilletValidationResult {
  if (!Number.isFinite(radius) || radius <= 0) {
    return { ok: false, reason: 'invalid_radius' };
  }
  if (radius > DYNAMIC_EDGE_MAX_MM) {
    return { ok: false, reason: 'too_large' };
  }
  // edge_too_short before over_round — the headroom check is more
  // fundamental (a sub-2r edge cannot host the cap at all), and
  // over_round only matters once the cap fits along the edge.
  if (!Number.isFinite(ctx.edgeLengthMm) || ctx.edgeLengthMm < 2 * radius) {
    return { ok: false, reason: 'edge_too_short' };
  }
  if (
    Number.isFinite(ctx.shortestAdjacentFaceExtentMm)
    && ctx.shortestAdjacentFaceExtentMm > 0
    && radius > ctx.shortestAdjacentFaceExtentMm * 0.5
  ) {
    return { ok: false, reason: 'over_round' };
  }
  return { ok: true };
}

/** Refusal reasons for `validateDynamicChamfer`.
 *  - `distance_exceeds_edge` — chamfer setback ≥ edge length (no
 *    edge left after the bevel takes the corner).
 *  - `invalid_distance` — non-finite or non-positive.
 *  - `too_large` — exceeds absolute scale guard.
 *  - `over_chamfer` — setback > 50% of shortest adjacent face extent. */
export type DynamicChamferValidationResult =
  | { ok: true }
  | { ok: false; reason: 'distance_exceeds_edge' | 'invalid_distance' | 'too_large' | 'over_chamfer' };

export interface DynamicChamferValidationContext {
  edgeLengthMm: number;
  shortestAdjacentFaceExtentMm: number;
}

export function validateDynamicChamfer(
  distance: number,
  ctx: DynamicChamferValidationContext,
): DynamicChamferValidationResult {
  if (!Number.isFinite(distance) || distance <= 0) {
    return { ok: false, reason: 'invalid_distance' };
  }
  if (distance > DYNAMIC_EDGE_MAX_MM) {
    return { ok: false, reason: 'too_large' };
  }
  if (!Number.isFinite(ctx.edgeLengthMm) || distance >= ctx.edgeLengthMm) {
    return { ok: false, reason: 'distance_exceeds_edge' };
  }
  if (
    Number.isFinite(ctx.shortestAdjacentFaceExtentMm)
    && ctx.shortestAdjacentFaceExtentMm > 0
    && distance > ctx.shortestAdjacentFaceExtentMm * 0.5
  ) {
    return { ok: false, reason: 'over_chamfer' };
  }
  return { ok: true };
}

// ─── Snap helper (re-exports the push-pull snap so the two modes
//     stay in lockstep — different gesture, same shift-snap UX) ─────────────

/** Snap a magnitude to the nearest grid value. Identical semantics
 *  to `pushPullMath.dragSnapToGrid` — we re-implement here rather
 *  than import to keep the directEdit math modules independent (so a
 *  refactor of either doesn't ripple through the other's tests). */
export function dragSnapToGrid(value: number, gridSize: number): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(gridSize) || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

// ─── Edge endpoint extraction from a hit triangle ──────────────────────────

/** Given a triangle's three world-space vertices and a click point,
 *  return the triangle edge nearest to the click — that's the edge
 *  the user meant to pick. Returns `null` if the triangle is
 *  degenerate (zero area).
 *
 *  Closest-edge is decided by per-edge perpendicular distance from
 *  the click point to the line segment (clamped to the segment for
 *  endpoints — a click outside the segment's parametric range falls
 *  back to the endpoint distance). */
export function findNearestTriangleEdge(
  v0: Vec3, v1: Vec3, v2: Vec3,
  clickPoint: Vec3,
): { start: Vec3; end: Vec3; distance: number } | null {
  const edges: Array<{ a: Vec3; b: Vec3 }> = [
    { a: v0, b: v1 },
    { a: v1, b: v2 },
    { a: v2, b: v0 },
  ];
  let best: { start: Vec3; end: Vec3; distance: number } | null = null;
  for (const { a, b } of edges) {
    const d = pointToSegmentDistance(clickPoint, a, b);
    if (best === null || d < best.distance) {
      best = { start: a, end: b, distance: d };
    }
  }
  return best;
}

function pointToSegmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const abLen2 = abx * abx + aby * aby + abz * abz;
  if (abLen2 < MIN_EDGE_LEN * MIN_EDGE_LEN) {
    // Degenerate edge — return endpoint distance.
    return Math.hypot(apx, apy, apz);
  }
  let t = (apx * abx + apy * aby + apz * abz) / abLen2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
  return Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
}

/** Length of an edge from its endpoints. Small utility shared by
 *  the validator + the applier. */
export function edgeLength(start: Vec3, end: Vec3): number {
  return Math.hypot(
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  );
}
