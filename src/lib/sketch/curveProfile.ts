/**
 * curveProfile — bridge sketch curves (Bézier / ellipse) into a closed
 * polyline loop usable as a solid profile (extrude / revolve).
 *
 * Phase 2.1.5 of NexyFab Pro own-CAD (ADR-013). The sketch solver models
 * point/line/circle/arc; spline + ellipse OUTLINES become solids by
 * tessellating them here (via sketchCurves) into a loop the existing
 * extrudeProfile IR consumes. Pure logic, deterministic.
 */

import { tessellateBezier, tessellateEllipse, polylineLength } from './sketchCurves';
import type { ExtrudeFeature, ExtrudeDirection, ExtrudeMode } from '@/lib/cad/extrudeProfile';

export interface Pt {
  x: number;
  y: number;
}

/**
 * One segment of a closed path, starting from the previous point (the path
 * start for the first segment) and ending at `to`. Curves are tessellated.
 */
export type PathSegment =
  | { kind: 'line'; to: Pt }
  | { kind: 'quad'; ctrl: Pt; to: Pt }
  | { kind: 'cubic'; ctrl1: Pt; ctrl2: Pt; to: Pt };

const DEFAULT_SAMPLES = 16;

function samePoint(a: Pt, b: Pt, eps = 1e-9): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

/**
 * Walk a path of mixed line / Bézier segments from `start`, tessellating
 * curves into `samplesPerCurve` sub-segments, and return a single closed
 * polyline loop (the trailing point that coincides with `start` is dropped).
 */
export function tessellatePath(
  start: Pt,
  segments: ReadonlyArray<PathSegment>,
  samplesPerCurve: number = DEFAULT_SAMPLES,
): Pt[] {
  if (!Number.isInteger(samplesPerCurve) || samplesPerCurve < 1) {
    throw new Error(`tessellatePath: samplesPerCurve must be a positive integer, got ${samplesPerCurve}`);
  }
  const out: Pt[] = [{ x: start.x, y: start.y }];
  let cur = start;
  for (const seg of segments) {
    if (seg.kind === 'line') {
      out.push({ x: seg.to.x, y: seg.to.y });
      cur = seg.to;
    } else if (seg.kind === 'quad') {
      // tessellateBezier returns samples+1 points incl. both endpoints; skip
      // the first (== cur, already in `out`).
      const pts = tessellateBezier([cur, seg.ctrl, seg.to], samplesPerCurve);
      for (let i = 1; i < pts.length; i++) out.push(pts[i]);
      cur = seg.to;
    } else {
      const pts = tessellateBezier([cur, seg.ctrl1, seg.ctrl2, seg.to], samplesPerCurve);
      for (let i = 1; i < pts.length; i++) out.push(pts[i]);
      cur = seg.to;
    }
  }
  // Drop a closing duplicate so the loop is non-repeating.
  if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** Closed ellipse outline as a polyline loop (delegates to sketchCurves). */
export function ellipseLoop(
  center: Pt,
  rx: number,
  ry: number,
  samples: number = 48,
  rotationRad = 0,
): Pt[] {
  return tessellateEllipse(center, rx, ry, samples, rotationRad);
}

/** Perimeter of a closed loop (sum of edges incl. the closing edge). */
export function loopPerimeter(loop: ReadonlyArray<Pt>): number {
  if (loop.length < 2) return 0;
  // polylineLength is open; add the closing edge.
  const open = polylineLength(loop);
  const a = loop[0];
  const b = loop[loop.length - 1];
  return open + Math.hypot(a.x - b.x, a.y - b.y);
}

export interface CurveExtrudeOptions {
  depth: number;
  direction?: ExtrudeDirection;
  mode?: ExtrudeMode;
}

/**
 * Turn a tessellated curve loop into an ExtrudeFeature. Validates a minimal
 * closed loop (>= 3 distinct points) and a positive depth — so a spline /
 * ellipse outline can be extruded like any other profile.
 */
export function curveLoopToExtrude(loop: ReadonlyArray<Pt>, opts: CurveExtrudeOptions): ExtrudeFeature {
  if (loop.length < 3) {
    throw new Error(`curveLoopToExtrude: loop needs >= 3 points, got ${loop.length}`);
  }
  if (!(opts.depth > 0) || !Number.isFinite(opts.depth)) {
    throw new Error(`curveLoopToExtrude: depth must be positive, got ${opts.depth}`);
  }
  for (const p of loop) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error('curveLoopToExtrude: loop has a non-finite point');
    }
  }
  return {
    kind: 'extrude',
    loop: loop.map((p) => ({ x: p.x, y: p.y })),
    depth: opts.depth,
    direction: opts.direction ?? 'one_sided',
    mode: opts.mode ?? 'add',
  };
}
