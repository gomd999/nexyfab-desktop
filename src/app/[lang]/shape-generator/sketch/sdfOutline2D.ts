/**
 * sdfOutline2D.ts — 2D signed-distance field for sketch outlines.
 *
 * 3D SDF modeling (`features/sdfModeling`) operates in volume; many
 * CAD tools need the *2D* equivalent: a signed distance from any
 * point in the plane to a sketch outline. Used for:
 *
 *   - **Engraving inset**: "make a 0.5mm groove that traces the
 *     outline" → polygon offset → engraving toolpath.
 *   - **Sheet-metal corner detect**: distance from a corner to the
 *     nearest outer edge gates min-bend-radius enforcement.
 *   - **Text on path**: distance to a curve helps walk letters along.
 *   - **Sketch ↔ sketch fit** check: is shape A entirely inside B?
 *
 * The module:
 *
 *   - Builds a sampled SDF grid from a polygon (with holes).
 *   - Evaluates exact point-to-polygon distance.
 *   - Boolean ops on grids (union/intersect/subtract).
 *   - Iso-line extraction (marching squares).
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface Polygon2D {
  outer: Point2D[];
  holes: Point2D[][];
}

// ── Exact point-to-polygon distance ────────────────────────────

/** Signed distance from point to a closed polygon.
 *  Negative inside, positive outside. */
export function signedDistanceToPolygon(p: Point2D, polygon: Point2D[]): number {
  if (polygon.length < 3) return Infinity;
  let minDistSq = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const d = pointToSegmentSqDist(p, a, b);
    if (d < minDistSq) minDistSq = d;
  }
  const minDist = Math.sqrt(minDistSq);
  return pointInPolygon(p, polygon) ? -minDist : minDist;
}

/** With holes: distance to nearest boundary, sign flipped when in a hole. */
export function signedDistanceToPolygonWithHoles(p: Point2D, poly: Polygon2D): number {
  let dOuter = signedDistanceToPolygon(p, poly.outer);
  // Negative inside outer; positive outside.
  for (const hole of poly.holes) {
    const dHole = signedDistanceToPolygon(p, hole);
    // Inside outer + inside hole = effectively outside (hole carves it).
    if (dOuter < 0 && dHole < 0) {
      // We're in the hole — distance is |dHole|.
      dOuter = -dHole;
    } else if (dOuter < 0 && Math.abs(dHole) < Math.abs(dOuter)) {
      // Close to the hole's boundary, still inside outer.
      dOuter = -Math.min(-dOuter, Math.abs(dHole));
    }
  }
  return dOuter;
}

function pointToSegmentSqDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    const dxp = p.x - a.x, dyp = p.y - a.y;
    return dxp * dxp + dyp * dyp;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = a.x + dx * t, cy = a.y + dy * t;
  const dxc = p.x - cx, dyc = p.y - cy;
  return dxc * dxc + dyc * dyc;
}

export function pointInPolygon(p: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if (((a.y > p.y) !== (b.y > p.y)) &&
        (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Sampled SDF grid ──────────────────────────────────────────

export interface SdfGrid2D {
  /** Grid dimensions. */
  nx: number;
  ny: number;
  /** Origin (mm). */
  originMm: Point2D;
  /** Cell spacing (mm). */
  cellMm: number;
  /** φ values, row-major. */
  values: Float32Array;
}

export function sampleSdfGrid(polygon: Polygon2D, originMm: Point2D, sizeMm: { width: number; height: number }, cellMm: number): SdfGrid2D {
  const nx = Math.max(1, Math.ceil(sizeMm.width / cellMm) + 1);
  const ny = Math.max(1, Math.ceil(sizeMm.height / cellMm) + 1);
  const values = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p: Point2D = {
        x: originMm.x + i * cellMm,
        y: originMm.y + j * cellMm,
      };
      values[j * nx + i] = signedDistanceToPolygonWithHoles(p, polygon);
    }
  }
  return { nx, ny, originMm, cellMm, values };
}

export function sampleGridAt(grid: SdfGrid2D, p: Point2D): number {
  // Bilinear interpolation.
  const x = (p.x - grid.originMm.x) / grid.cellMm;
  const y = (p.y - grid.originMm.y) / grid.cellMm;
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const fx = x - i0;
  const fy = y - j0;
  const v00 = readClamped(grid, i0, j0);
  const v10 = readClamped(grid, i0 + 1, j0);
  const v01 = readClamped(grid, i0, j0 + 1);
  const v11 = readClamped(grid, i0 + 1, j0 + 1);
  const c0 = v00 * (1 - fx) + v10 * fx;
  const c1 = v01 * (1 - fx) + v11 * fx;
  return c0 * (1 - fy) + c1 * fy;
}

function readClamped(grid: SdfGrid2D, i: number, j: number): number {
  const ci = Math.max(0, Math.min(grid.nx - 1, i));
  const cj = Math.max(0, Math.min(grid.ny - 1, j));
  return grid.values[cj * grid.nx + ci] ?? 0;
}

// ── Grid boolean ops ──────────────────────────────────────────

export function unionGrids2D(a: SdfGrid2D, b: SdfGrid2D): void {
  for (let i = 0; i < a.values.length; i++) {
    a.values[i] = Math.min(a.values[i]!, b.values[i]!);
  }
}

export function intersectGrids2D(a: SdfGrid2D, b: SdfGrid2D): void {
  for (let i = 0; i < a.values.length; i++) {
    a.values[i] = Math.max(a.values[i]!, b.values[i]!);
  }
}

export function subtractGrids2D(a: SdfGrid2D, b: SdfGrid2D): void {
  for (let i = 0; i < a.values.length; i++) {
    a.values[i] = Math.max(a.values[i]!, -b.values[i]!);
  }
}

// ── Iso-line extraction (marching squares) ────────────────────

export interface Segment2D {
  start: Point2D;
  end: Point2D;
}

const MARCHING_SQUARES_EDGES: Record<number, [number, number][]> = {
  // Edges: 0=bottom, 1=right, 2=top, 3=left. Each entry maps case → pairs of (start, end) edges.
  0: [], 15: [],
  1: [[3, 0]], 14: [[3, 0]],
  2: [[0, 1]], 13: [[0, 1]],
  3: [[3, 1]], 12: [[3, 1]],
  4: [[1, 2]], 11: [[1, 2]],
  5: [[3, 0], [1, 2]],
  10: [[3, 2], [0, 1]],
  6: [[0, 2]], 9: [[0, 2]],
  7: [[3, 2]], 8: [[3, 2]],
};

export function extractIsoline(grid: SdfGrid2D, level: number = 0): Segment2D[] {
  const segments: Segment2D[] = [];
  for (let j = 0; j < grid.ny - 1; j++) {
    for (let i = 0; i < grid.nx - 1; i++) {
      const v00 = grid.values[j * grid.nx + i]!;
      const v10 = grid.values[j * grid.nx + (i + 1)]!;
      const v11 = grid.values[(j + 1) * grid.nx + (i + 1)]!;
      const v01 = grid.values[(j + 1) * grid.nx + i]!;
      let caseIdx = 0;
      if (v00 < level) caseIdx |= 1;
      if (v10 < level) caseIdx |= 2;
      if (v11 < level) caseIdx |= 4;
      if (v01 < level) caseIdx |= 8;
      const edges = MARCHING_SQUARES_EDGES[caseIdx] ?? [];
      const p00: Point2D = { x: grid.originMm.x + i * grid.cellMm, y: grid.originMm.y + j * grid.cellMm };
      const p10: Point2D = { x: grid.originMm.x + (i + 1) * grid.cellMm, y: grid.originMm.y + j * grid.cellMm };
      const p11: Point2D = { x: grid.originMm.x + (i + 1) * grid.cellMm, y: grid.originMm.y + (j + 1) * grid.cellMm };
      const p01: Point2D = { x: grid.originMm.x + i * grid.cellMm, y: grid.originMm.y + (j + 1) * grid.cellMm };
      const edgePoints: Point2D[] = [
        interp(p00, p10, v00, v10, level),
        interp(p10, p11, v10, v11, level),
        interp(p01, p11, v01, v11, level),
        interp(p00, p01, v00, v01, level),
      ];
      for (const [a, b] of edges) {
        segments.push({ start: edgePoints[a]!, end: edgePoints[b]! });
      }
    }
  }
  return segments;
}

function interp(a: Point2D, b: Point2D, va: number, vb: number, level: number): Point2D {
  const denom = vb - va;
  if (Math.abs(denom) < 1e-9) return a;
  const t = (level - va) / denom;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ── Containment / fit check ──────────────────────────────────

/** Is shape A entirely inside shape B?
 *  True when max φ_B(p) for p ∈ A.boundary is ≤ 0 (all A-points inside B). */
export function isContainedIn(inner: Point2D[], outer: Point2D[]): boolean {
  for (const p of inner) {
    if (!pointInPolygon(p, outer)) return false;
  }
  return true;
}

// ── Stats ────────────────────────────────────────────────────

export interface SdfGridStats {
  minPhi: number;
  maxPhi: number;
  /** Estimated polygon area from negative cells. */
  areaMm2: number;
}

export function gridStats(grid: SdfGrid2D): SdfGridStats {
  let minPhi = Infinity, maxPhi = -Infinity;
  let insideCount = 0;
  for (const v of grid.values) {
    if (v < minPhi) minPhi = v;
    if (v > maxPhi) maxPhi = v;
    if (v < 0) insideCount++;
  }
  return {
    minPhi: isFinite(minPhi) ? minPhi : 0,
    maxPhi: isFinite(maxPhi) ? maxPhi : 0,
    areaMm2: insideCount * grid.cellMm * grid.cellMm,
  };
}
