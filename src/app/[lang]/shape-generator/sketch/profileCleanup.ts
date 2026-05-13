import type { SketchProfile, SketchSegment, SketchPoint } from './types';

/**
 * Profile cleanup ("중첩 없애기") — removes redundant geometry that creeps
 * into hand-drawn or imported (STEP/DXF) sketches. Two classes of redundancy:
 *
 *   1. Exact duplicates — same segment drawn twice (same start + end, or
 *      reversed) within a small distance tolerance. Common when user
 *      double-clicks the same point or imports a DXF where edges are
 *      stored per polygon and shared edges appear twice.
 *
 *   2. Collinear overlaps — two line segments on the same infinite line
 *      whose mm ranges overlap. The merged segment spans the union of
 *      both endpoints; the two originals are deleted.
 *
 * The cleanup is intentionally *only* destructive on lines. Arcs, circles,
 * splines, etc. need their own dedupe logic (curve sampling + Frechet
 * distance) and are out of scope here — they're left untouched so
 * cleanup can never silently destroy a non-line construction.
 *
 * Returns the cleaned profile plus a `summary` the caller can surface in
 * a toast or confirmation modal.
 */

export interface CleanupSummary {
  segmentsBefore: number;
  segmentsAfter: number;
  duplicatesRemoved: number;
  overlapsCollapsed: number;
}

export interface CleanupOptions {
  /** Endpoint distance tolerance, mm. Two endpoints within this are "same". */
  pointTolMm?: number;
  /** Perpendicular distance tolerance, mm. For collinear-overlap detection. */
  lineTolMm?: number;
}

const DEFAULT_POINT_TOL = 0.05;
const DEFAULT_LINE_TOL = 0.02;

function dist(a: SketchPoint, b: SketchPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function samePoint(a: SketchPoint, b: SketchPoint, tol: number): boolean {
  return dist(a, b) <= tol;
}

/** Are two line segments "exact duplicates" (same endpoints, either direction)? */
function isDuplicateLine(a: SketchSegment, b: SketchSegment, tol: number): boolean {
  if (a.type !== 'line' || b.type !== 'line') return false;
  const [a0, a1] = a.points;
  const [b0, b1] = b.points;
  return (samePoint(a0, b0, tol) && samePoint(a1, b1, tol))
      || (samePoint(a0, b1, tol) && samePoint(a1, b0, tol));
}

/**
 * Are two line segments collinear (on the same infinite line within tol)
 * AND have overlapping or touching mm ranges? Returns the merged span as
 * two endpoints when yes, null otherwise.
 *
 * Collinearity check uses signed area: |(p1-p0) × (q-p0)| / |p1-p0| is the
 * perpendicular distance from q to the line through p0,p1.
 */
function tryCollinearMerge(
  a: SketchSegment,
  b: SketchSegment,
  pointTol: number,
  lineTol: number,
): [SketchPoint, SketchPoint] | null {
  if (a.type !== 'line' || b.type !== 'line') return null;
  if (a.construction !== b.construction) return null;

  const [a0, a1] = a.points;
  const [b0, b1] = b.points;

  // Direction vector of segment A
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const aLen = Math.sqrt(ax * ax + ay * ay);
  if (aLen < pointTol) return null;

  // Perpendicular distance from b0 and b1 to line through a0-a1
  const distLine = (q: SketchPoint) =>
    Math.abs((ax * (q.y - a0.y) - ay * (q.x - a0.x)) / aLen);
  if (distLine(b0) > lineTol || distLine(b1) > lineTol) return null;

  // Projected positions along A's direction (0 at a0, aLen at a1)
  const proj = (q: SketchPoint) => ((q.x - a0.x) * ax + (q.y - a0.y) * ay) / aLen;
  const tA0 = 0;
  const tA1 = aLen;
  const tB0 = proj(b0);
  const tB1 = proj(b1);
  const bMin = Math.min(tB0, tB1);
  const bMax = Math.max(tB0, tB1);

  // Require *strict* overlap (more than pointTol of shared length). Pure
  // end-to-end chaining (no overlap, just a shared endpoint) must not be
  // collapsed — those segments are intentional polyline chains and may
  // carry separate constraints.
  const overlapLen = Math.min(tA1, bMax) - Math.max(tA0, bMin);
  if (overlapLen <= pointTol) return null;
  if (bMin > tA0 + pointTol && bMax < tA1 - pointTol) {
    // B is strictly inside A — A swallows B
    return [a0, a1];
  }

  const tMin = Math.min(tA0, bMin);
  const tMax = Math.max(tA1, bMax);
  // Build span endpoints along A's direction
  const nx = ax / aLen;
  const ny = ay / aLen;
  const p0: SketchPoint = { x: a0.x + nx * tMin, y: a0.y + ny * tMin };
  const p1: SketchPoint = { x: a0.x + nx * tMax, y: a0.y + ny * tMax };
  return [p0, p1];
}

/** Zero-length lines (a == b) are pure noise — strip them silently. */
function isZeroLength(s: SketchSegment, tol: number): boolean {
  if (s.type !== 'line') return false;
  return samePoint(s.points[0], s.points[1], tol);
}

export function cleanupProfile(
  profile: SketchProfile,
  opts: CleanupOptions = {},
): { profile: SketchProfile; summary: CleanupSummary } {
  const pointTol = opts.pointTolMm ?? DEFAULT_POINT_TOL;
  const lineTol = opts.lineTolMm ?? DEFAULT_LINE_TOL;

  const before = profile.segments.length;
  let segments = profile.segments.filter(s => !isZeroLength(s, pointTol));
  let dupCount = before - segments.length;
  let overlapCount = 0;

  // Pass 1 — exact duplicate removal (O(n²) but n is small for sketches)
  const keepDup: SketchSegment[] = [];
  for (const seg of segments) {
    const dup = keepDup.find(kept => isDuplicateLine(kept, seg, pointTol));
    if (dup) {
      dupCount++;
      continue;
    }
    keepDup.push(seg);
  }
  segments = keepDup;

  // Pass 2 — collinear overlap merging. Iterate until no merge happens to
  // catch chains of overlapping segments that fold into one.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const span = tryCollinearMerge(segments[i], segments[j], pointTol, lineTol);
        if (!span) continue;
        const mergedSeg: SketchSegment = {
          ...segments[i],
          points: [span[0], span[1]],
        };
        segments = [
          ...segments.slice(0, i),
          mergedSeg,
          ...segments.slice(i + 1, j),
          ...segments.slice(j + 1),
        ];
        overlapCount++;
        merged = true;
        break;
      }
      if (merged) break;
    }
  }

  return {
    profile: { ...profile, segments },
    summary: {
      segmentsBefore: before,
      segmentsAfter: segments.length,
      duplicatesRemoved: dupCount,
      overlapsCollapsed: overlapCount,
    },
  };
}
