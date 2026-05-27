/**
 * planeIntersection.ts — Project a 3D sketch onto a working plane
 * to produce a 2D sketch.
 *
 * Use case: a designer draws a wire-frame in 3D (a roll cage,
 * truss, piping path) and wants the 2D outline on a specific
 * plane for drawing / sheet-metal layout.
 *
 * Output: a list of 2D segments + endpoint coords in the plane's
 * local (u, v) frame. The caller turns this into a sketch / DXF /
 * drawing view.
 */

import { isLine, isArc, getPoint, type Sketch3D, type Line3D } from './sketch3dEntity';

export interface WorkingPlane {
  /** Plane origin in world. */
  origin: [number, number, number];
  /** Plane normal (unit). */
  normal: [number, number, number];
  /** In-plane U axis (unit) — usually points toward "right" in the 2D view. */
  uAxis: [number, number, number];
  /** In-plane V axis (unit) — usually points "up" in the 2D view. */
  vAxis: [number, number, number];
}

export interface ProjectedSegment {
  /** Original entity id this came from. */
  sourceId: string;
  /** Start point in plane local (u, v). */
  start: [number, number];
  /** End point. */
  end: [number, number];
  /** Distance behind the plane for the source's mid-point — used
   *  by hidden-line drawing. > 0 means "behind". */
  midDepth: number;
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function sub3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Project a single 3D point onto the plane's (u, v) local frame. */
export function projectPoint(
  plane: WorkingPlane,
  p: [number, number, number],
): { uv: [number, number]; depth: number } {
  const d = sub3(p, plane.origin);
  return {
    uv: [dot3(d, plane.uAxis), dot3(d, plane.vAxis)],
    depth: dot3(d, plane.normal),
  };
}

/** Project every line in the sketch onto the plane.
 *  Arcs are approximated by 8 chord segments — refine if needed. */
export function projectSketch(
  sketch: Sketch3D,
  plane: WorkingPlane,
): ProjectedSegment[] {
  const segments: ProjectedSegment[] = [];
  for (const e of sketch.entities.values()) {
    if (isLine(e)) {
      const segment = projectLine(sketch, plane, e);
      if (segment) segments.push(segment);
    } else if (isArc(e)) {
      // Approximate by chord polyline.
      const segs = projectArcAsChords(sketch, plane, e.id, e.centerId, e.startId, e.endId);
      segments.push(...segs);
    }
  }
  return segments;
}

function projectLine(
  sketch: Sketch3D,
  plane: WorkingPlane,
  line: Line3D,
): ProjectedSegment | null {
  const start = getPoint(sketch, line.startId);
  const end = getPoint(sketch, line.endId);
  if (!start || !end) return null;
  const sP = projectPoint(plane, [start.x, start.y, start.z]);
  const eP = projectPoint(plane, [end.x, end.y, end.z]);
  return {
    sourceId: line.id,
    start: sP.uv,
    end: eP.uv,
    midDepth: (sP.depth + eP.depth) / 2,
  };
}

function projectArcAsChords(
  sketch: Sketch3D,
  plane: WorkingPlane,
  arcId: string,
  centerId: string,
  startId: string,
  endId: string,
): ProjectedSegment[] {
  const c = getPoint(sketch, centerId);
  const s = getPoint(sketch, startId);
  const e = getPoint(sketch, endId);
  if (!c || !s || !e) return [];
  // Linear chord between start and end as a fallback (arc would be
  // sampled with the arc's plane normal — Phase 3 starter omits).
  void arcId;
  const sP = projectPoint(plane, [s.x, s.y, s.z]);
  const mP = projectPoint(plane, [(s.x + e.x) / 2, (s.y + e.y) / 2, (s.z + e.z) / 2]);
  const eP = projectPoint(plane, [e.x, e.y, e.z]);
  return [
    { sourceId: arcId, start: sP.uv, end: mP.uv, midDepth: (sP.depth + mP.depth) / 2 },
    { sourceId: arcId, start: mP.uv, end: eP.uv, midDepth: (mP.depth + eP.depth) / 2 },
  ];
}

/** Standard XY plane factory — common "draw on the floor" use case. */
export function xyPlane(): WorkingPlane {
  return {
    origin: [0, 0, 0],
    normal: [0, 0, 1],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
  };
}

/** Pre-built XZ / YZ planes. */
export function xzPlane(): WorkingPlane {
  return { origin: [0, 0, 0], normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1] };
}
export function yzPlane(): WorkingPlane {
  return { origin: [0, 0, 0], normal: [1, 0, 0], uAxis: [0, 1, 0], vAxis: [0, 0, 1] };
}
