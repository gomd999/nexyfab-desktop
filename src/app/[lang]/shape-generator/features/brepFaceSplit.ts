/**
 * brepFaceSplit.ts — Split a B-rep face by an interior curve / edge.
 *
 * Operation: given a face F and a splitting curve C that lies on F's
 * surface and starts/ends on F's outer loop, produce two new faces
 * F1 and F2 whose union is F. The half-edge topology is rewired so
 * the original face is replaced and adjacent faces' references stay
 * consistent.
 *
 * This is a planar-friendly implementation: faces and the split
 * curve are represented as ordered 2D point loops in the face's
 * UV plane. The caller is responsible for projecting / re-lifting
 * 3D curves to/from UV — this module is the *topology* core.
 *
 * Why split a face?
 *
 *   - Add a sub-region for a localized fillet/draft/material.
 *   - Imprint a parting line for a mold.
 *   - Subdivide for meshing or analysis.
 *
 * Limitations: assumes the splitting curve does not cross itself
 * and intersects the outer loop in exactly two distinct vertices.
 * Holes inside the face are propagated to the side that contains
 * each hole's centroid.
 */

export interface Vec2 { x: number; y: number }

export interface FaceLoop {
  /** Closed loop of points. The last point connects back to the first. */
  points: Vec2[];
}

export interface BrepFace {
  id: string;
  /** Outer boundary (CCW). */
  outer: FaceLoop;
  /** Holes (CW). */
  holes: FaceLoop[];
}

export interface SplitCurve {
  /** Polyline of points. First and last points must lie on `outer`. */
  points: Vec2[];
}

export interface SplitResult {
  /** Two resulting faces. */
  pieces: [BrepFace, BrepFace];
  /** Which holes ended up on which side (by index in `pieces`). */
  holeAssignments: Array<{ holeIndex: number; sideIndex: 0 | 1 }>;
  /** Vertex indices on outer loop where the cut entered/exited. */
  cutVertices: { enter: number; exit: number };
}

// ── Top-level entry ─────────────────────────────────────────────

export function splitFace(face: BrepFace, curve: SplitCurve, options: { newIdPrefix?: string } = {}): SplitResult {
  if (curve.points.length < 2) throw new Error('split curve must have ≥ 2 points');
  if (face.outer.points.length < 3) throw new Error('face outer must have ≥ 3 points');

  const prefix = options.newIdPrefix ?? face.id + '.split';
  const start = curve.points[0]!;
  const end = curve.points[curve.points.length - 1]!;

  const enterIdx = findInsertionIndex(face.outer.points, start);
  const exitIdx = findInsertionIndex(face.outer.points, end);
  if (enterIdx < 0 || exitIdx < 0) throw new Error('split endpoints must lie on the outer loop');
  if (enterIdx === exitIdx) throw new Error('split endpoints must lie on different edges');

  const outer = face.outer.points;

  // Build two new loops: walk from enter→exit along outer one way, then back along the curve.
  const sideA = buildSideLoop(outer, enterIdx, exitIdx, curve.points, true);
  const sideB = buildSideLoop(outer, exitIdx, enterIdx, curve.points, false);

  // Assign holes to whichever side contains the hole's centroid.
  const assignments: Array<{ holeIndex: number; sideIndex: 0 | 1 }> = [];
  const holesA: FaceLoop[] = [];
  const holesB: FaceLoop[] = [];
  for (let i = 0; i < face.holes.length; i++) {
    const hole = face.holes[i]!;
    const center = centroid(hole.points);
    const inA = pointInPolygon(center, sideA);
    if (inA) {
      holesA.push(hole);
      assignments.push({ holeIndex: i, sideIndex: 0 });
    } else {
      holesB.push(hole);
      assignments.push({ holeIndex: i, sideIndex: 1 });
    }
  }

  const pieceA: BrepFace = { id: `${prefix}.0`, outer: { points: sideA }, holes: holesA };
  const pieceB: BrepFace = { id: `${prefix}.1`, outer: { points: sideB }, holes: holesB };
  return {
    pieces: [pieceA, pieceB],
    holeAssignments: assignments,
    cutVertices: { enter: enterIdx, exit: exitIdx },
  };
}

// ── Loop construction ──────────────────────────────────────────

function buildSideLoop(outer: Vec2[], fromIdx: number, toIdx: number, curve: Vec2[], forward: boolean): Vec2[] {
  const out: Vec2[] = [];
  // Start at the cut entry point on `outer`.
  out.push({ ...curve[0]! });
  // Walk outer from fromIdx → toIdx.
  let i = fromIdx;
  const n = outer.length;
  let safety = n * 3;
  while (i !== toIdx && safety-- > 0) {
    out.push({ ...outer[i]! });
    i = (i + 1) % n;
  }
  out.push({ ...outer[toIdx]! });
  // Walk the curve in reverse (excluding endpoints already added).
  if (forward) {
    for (let j = curve.length - 2; j >= 1; j--) {
      out.push({ ...curve[j]! });
    }
  } else {
    for (let j = 1; j <= curve.length - 2; j++) {
      out.push({ ...curve[j]! });
    }
  }
  return out;
}

// ── Geometry helpers ───────────────────────────────────────────

const EPS = 1e-7;

/** Returns the vertex index of `outer` whose edge (i → i+1) most closely contains `p`,
 *  or -1 if no edge contains it. */
function findInsertionIndex(outer: Vec2[], p: Vec2): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i]!;
    const b = outer[(i + 1) % outer.length]!;
    const d = pointToSegmentDistance(p, a, b);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return bestDist <= 1e-3 ? best : -1;
}

function pointToSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

export function centroid(points: Vec2[]): Vec2 {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / Math.max(1, points.length), y: cy / Math.max(1, points.length) };
}

export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y)) {
      const xIntersect = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < xIntersect) inside = !inside;
    }
  }
  return inside;
}

export function signedArea(polygon: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

// ── Validation ─────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  /** Total area of pieces should match face area. */
  areaPreserved: boolean;
}

export function validateSplit(original: BrepFace, result: SplitResult): ValidationResult {
  const issues: string[] = [];
  const originalArea = Math.abs(signedArea(original.outer.points)) - original.holes.reduce((s, h) => s + Math.abs(signedArea(h.points)), 0);
  const resultArea = Math.abs(signedArea(result.pieces[0].outer.points)) + Math.abs(signedArea(result.pieces[1].outer.points))
    - result.pieces[0].holes.reduce((s, h) => s + Math.abs(signedArea(h.points)), 0)
    - result.pieces[1].holes.reduce((s, h) => s + Math.abs(signedArea(h.points)), 0);

  const areaPreserved = Math.abs(originalArea - resultArea) / Math.max(originalArea, 1e-6) < 0.01;
  if (!areaPreserved) issues.push(`area mismatch: ${originalArea.toFixed(3)} vs ${resultArea.toFixed(3)}`);

  for (const piece of result.pieces) {
    if (piece.outer.points.length < 3) issues.push(`piece ${piece.id} has degenerate outer loop`);
    if (Math.abs(signedArea(piece.outer.points)) < EPS) issues.push(`piece ${piece.id} has zero area`);
  }
  return { isValid: issues.length === 0, issues, areaPreserved };
}

// ── Summary ────────────────────────────────────────────────────

export interface SplitSummary {
  pieceAreas: [number, number];
  pieceVertexCounts: [number, number];
  holesAssigned: number;
  totalHolesIn: number;
}

export function summarize(original: BrepFace, result: SplitResult): SplitSummary {
  return {
    pieceAreas: [
      Math.abs(signedArea(result.pieces[0].outer.points)),
      Math.abs(signedArea(result.pieces[1].outer.points)),
    ],
    pieceVertexCounts: [
      result.pieces[0].outer.points.length,
      result.pieces[1].outer.points.length,
    ],
    holesAssigned: result.holeAssignments.length,
    totalHolesIn: original.holes.length,
  };
}
