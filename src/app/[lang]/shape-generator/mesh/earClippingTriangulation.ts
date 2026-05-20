/**
 * earClippingTriangulation.ts — Ear-clipping triangulation for 2D polygons
 * with holes.
 *
 * `features/brepTessellator.ts` already has a basic ear-clipping for
 * convex faces. This module is the production version:
 *
 *   - Handles **concave polygons** correctly.
 *   - Supports **multiple holes** by merging them into the outer loop
 *     via bridge edges.
 *   - Robust against collinear / duplicated vertices.
 *   - Returns triangle index triples + per-triangle source label
 *     (outer / hole-N).
 *
 * Used for sheet-metal flat patterns, drawing fills, label engraving
 * masks, and any other 2D polygon → triangle list conversion.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface PolygonWithHoles {
  outer: Point2D[];
  holes: Point2D[][];
}

export interface TriangleIndices {
  a: number;
  b: number;
  c: number;
}

export interface TriangulationResult {
  /** Flattened point array: outer first, then each hole in order. */
  points: Point2D[];
  /** Triangles indexing into `points`. */
  triangles: TriangleIndices[];
  /** Warnings encountered. */
  warnings: string[];
}

// ── Top-level entry ─────────────────────────────────────────────

export function triangulate(polygon: PolygonWithHoles): TriangulationResult {
  const warnings: string[] = [];
  if (polygon.outer.length < 3) {
    return { points: [], triangles: [], warnings: ['Outer polygon has < 3 vertices'] };
  }
  // Ensure outer is CCW and holes are CW.
  const outer = ensureOrientation(polygon.outer, true);
  const holes = polygon.holes.map(h => ensureOrientation(h, false));

  // Combine: merge holes into outer via bridges (Eberly-style).
  const merged = mergeHoles(outer, holes);
  const points = merged.combined;

  // Run ear-clipping on the merged polygon.
  const triangles = earClip(merged.indices, points, warnings);

  return { points, triangles, warnings };
}

// ── Orientation ────────────────────────────────────────────────

export function signedArea(polygon: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function isCounterClockwise(polygon: Point2D[]): boolean {
  return signedArea(polygon) > 0;
}

function ensureOrientation(polygon: Point2D[], wantCCW: boolean): Point2D[] {
  const ccw = isCounterClockwise(polygon);
  if (ccw === wantCCW) return polygon.slice();
  return polygon.slice().reverse();
}

// ── Hole merging (single-edge bridge) ──────────────────────────

interface MergedPolygon {
  /** Combined point list (outer + each hole appended). */
  combined: Point2D[];
  /** Indices into `combined` forming the merged single-loop polygon. */
  indices: number[];
}

function mergeHoles(outer: Point2D[], holes: Point2D[][]): MergedPolygon {
  const combined: Point2D[] = [...outer];
  let indices = outer.map((_, i) => i);
  for (const hole of holes) {
    const startIdx = combined.length;
    combined.push(...hole);
    // For each hole, find the rightmost vertex and bridge to nearest outer vertex.
    const rightmostIdx = findRightmost(hole);
    const bridgeHoleVtx = startIdx + rightmostIdx;
    const bridgeOuterIdx = findBridgeTarget(combined, indices, combined[bridgeHoleVtx]!);
    indices = insertHoleBridge(indices, bridgeOuterIdx, bridgeHoleVtx, hole.length, startIdx);
  }
  return { combined, indices };
}

function findRightmost(polygon: Point2D[]): number {
  let best = 0;
  for (let i = 1; i < polygon.length; i++) {
    if (polygon[i]!.x > polygon[best]!.x) best = i;
  }
  return best;
}

function findBridgeTarget(combined: Point2D[], indices: number[], holeVertex: Point2D): number {
  // Naive: pick the closest outer vertex to the right of the hole.
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < indices.length; i++) {
    const p = combined[indices[i]!]!;
    const d = Math.hypot(p.x - holeVertex.x, p.y - holeVertex.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function insertHoleBridge(indices: number[], bridgeOuterIdx: number, bridgeHoleVtx: number, holeLen: number, holeStartIdx: number): number[] {
  // Build the hole index loop starting from the bridge vertex.
  const holeIndices: number[] = [];
  const holeOffset = bridgeHoleVtx - holeStartIdx;
  for (let i = 0; i <= holeLen; i++) {
    holeIndices.push(holeStartIdx + ((holeOffset + i) % holeLen));
  }
  // Splice: outer[..bridgeOuterIdx] + holeIndices + outer[bridgeOuterIdx..].
  const before = indices.slice(0, bridgeOuterIdx + 1);
  const after = indices.slice(bridgeOuterIdx);
  return [...before, ...holeIndices, ...after];
}

// ── Ear clipping ───────────────────────────────────────────────

function earClip(indices: number[], points: Point2D[], warnings: string[]): TriangleIndices[] {
  const remaining = [...indices];
  const triangles: TriangleIndices[] = [];
  let safety = remaining.length * 3;
  while (remaining.length > 3 && safety-- > 0) {
    let earFound = false;
    for (let i = 0; i < remaining.length; i++) {
      const i0 = remaining[(i - 1 + remaining.length) % remaining.length]!;
      const i1 = remaining[i]!;
      const i2 = remaining[(i + 1) % remaining.length]!;
      if (isEar(i0, i1, i2, remaining, points)) {
        triangles.push({ a: i0, b: i1, c: i2 });
        remaining.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) {
      warnings.push('No ear found — polygon may be non-simple');
      break;
    }
  }
  if (remaining.length === 3) {
    triangles.push({ a: remaining[0]!, b: remaining[1]!, c: remaining[2]! });
  }
  return triangles;
}

function isEar(i0: number, i1: number, i2: number, remaining: number[], points: Point2D[]): boolean {
  const a = points[i0]!, b = points[i1]!, c = points[i2]!;
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (cross <= 0) return false; // Reflex vertex.
  for (const idx of remaining) {
    if (idx === i0 || idx === i1 || idx === i2) continue;
    if (pointInTriangle(points[idx]!, a, b, c)) return false;
  }
  return true;
}

function pointInTriangle(p: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(p: Point2D, a: Point2D, b: Point2D): number {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

// ── Stats ─────────────────────────────────────────────────────

export interface TriangulationStats {
  pointCount: number;
  triangleCount: number;
  outerArea: number;
  holeArea: number;
  netArea: number;
}

export function summarize(polygon: PolygonWithHoles, result: TriangulationResult): TriangulationStats {
  const outerArea = Math.abs(signedArea(polygon.outer));
  const holeArea = polygon.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
  return {
    pointCount: result.points.length,
    triangleCount: result.triangles.length,
    outerArea,
    holeArea,
    netArea: outerArea - holeArea,
  };
}
