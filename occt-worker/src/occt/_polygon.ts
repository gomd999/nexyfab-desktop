/**
 * Polygon profile builder — W13 D1-2 (ADR-007).
 *
 * Converts a vertex list into a replicad DrawingLike via
 * draw().moveTo(p[0]).lineTo(p[1])...close(). Shared by extrude and
 * revolve so the polygon path validates identically in both ops.
 *
 * Constraints:
 *   - ≥ 3 points (degenerate otherwise — 0 area = no extrusion volume)
 *   - All coords finite
 *   - First and last points are NOT both equal — close() handles the
 *     final segment so an explicit duplicate would emit a zero-length
 *     edge that OCCT rejects.
 *
 * Self-intersection isn't checked here (would need a 2D segment-sweep);
 * OCCT will surface the error at extrude time. Future hardening could
 * pre-screen with a segment intersection pass.
 */

import type { ReplicadLike, DrawingLike, DrawBuilder } from './_types.js';

export interface PolygonProfile {
  kind: 'polygon';
  /** Vertex list as [[x, y], ...]. Closed automatically — do not
   *  duplicate the first point at the end. */
  points: [number, number][];
}

export function validatePolygonGeometry(points: [number, number][]): void {
  if (points.length < 3) {
    throw new Error(`invalid params: polygon needs ≥ 3 points (got ${points.length})`);
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new Error(`invalid params: polygon point ${i} non-finite`);
    }
  }
  const first = points[0]!, last = points[points.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) {
    throw new Error(
      'invalid params: polygon first and last points are identical — close() handles closure, do not duplicate',
    );
  }
}

export function buildPolygonDrawing(replicad: ReplicadLike, profile: PolygonProfile): DrawingLike {
  if (!replicad.draw) {
    throw new Error('replicad.draw unavailable — kernel build mismatch');
  }
  validatePolygonGeometry(profile.points);

  let builder: DrawBuilder = replicad.draw();
  const first = profile.points[0]!;
  if (!builder.moveTo) {
    throw new Error('replicad draw builder has no moveTo()');
  }
  builder = builder.moveTo(first[0], first[1]);

  for (let i = 1; i < profile.points.length; i++) {
    const p = profile.points[i]!;
    if (!builder.lineTo) {
      throw new Error('replicad draw builder has no lineTo()');
    }
    builder = builder.lineTo(p[0], p[1]);
  }

  if (!builder.close) {
    throw new Error('replicad draw builder has no close()');
  }
  return builder.close();
}
