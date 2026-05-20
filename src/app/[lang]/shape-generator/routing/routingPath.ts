/**
 * routingPath.ts — 3D path for cables / pipes / wire bundles.
 *
 * SolidWorks Routing builds piping / cable harnesses on top of 3D
 * sketches. NexyFab equivalent: a list of through-points + bend
 * radius constraints + the routed-element type (cable / pipe).
 *
 * Geometry produced:
 *   - For straight segments between points: plain extrude of the
 *     cross-section circle along the segment.
 *   - For corners: tangent-arc fillet with the specified bend
 *     radius — the route doesn't take a hard 90° turn.
 *
 * The path can be sampled to a smooth polyline that the sweep
 * pipeline turns into geometry. Validation is in `routingValidate`.
 */

export type RoutingKind = 'cable' | 'pipe' | 'wire-bundle' | 'hose';

export interface RoutePoint {
  /** World-frame position (mm). */
  position: [number, number, number];
  /** When the route arrives at this point, do a tangent-arc with this radius. */
  bendRadiusMm?: number;
  /** Attached component id (bracket / connector). null = free point. */
  attachedTo?: string;
}

export interface RoutingPath {
  id: string;
  kind: RoutingKind;
  /** Outer diameter of the routed element (mm). */
  diameterMm: number;
  /** Through-points in order. */
  points: RoutePoint[];
  /** Default bend radius applied to points without an explicit one. */
  defaultBendRadiusMm: number;
}

export interface PathSample {
  position: [number, number, number];
  /** Cumulative distance along the path (mm). */
  s: number;
  /** Local tangent (unit vector). */
  tangent: [number, number, number];
}

const dist = (a: [number, number, number], b: [number, number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const subtract = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const scale = (v: [number, number, number], s: number): [number, number, number] =>
  [v[0] * s, v[1] * s, v[2] * s];

const add = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Compute the total length of the path (straight segments only). */
export function pathLengthStraight(path: RoutingPath): number {
  let sum = 0;
  for (let i = 1; i < path.points.length; i++) {
    sum += dist(path.points[i - 1]!.position, path.points[i]!.position);
  }
  return sum;
}

/** Sample the path at uniform spacing — used by the sweep
 *  geometry builder. Returns a list of (position, s, tangent). */
export function samplePath(path: RoutingPath, spacingMm: number = 10): PathSample[] {
  if (path.points.length < 2) return [];
  const samples: PathSample[] = [];
  let s = 0;
  for (let i = 0; i < path.points.length - 1; i++) {
    const a = path.points[i]!.position;
    const b = path.points[i + 1]!.position;
    const segLen = dist(a, b);
    if (segLen === 0) continue;
    const tangent = normalize(subtract(b, a));
    const steps = Math.max(1, Math.ceil(segLen / spacingMm));
    for (let k = 0; k <= steps; k++) {
      if (k === 0 && i > 0) continue; // skip duplicate at joins
      const t = k / steps;
      samples.push({
        position: [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ],
        s: s + segLen * t,
        tangent,
      });
    }
    s += segLen;
  }
  return samples;
}

/** Apply bend-radius arcs at corners — returns an adjusted point
 *  list with arc-midpoint inserts so the sweep produces a curved
 *  bend. Caller still treats the result as a polyline; finer
 *  sampling via `samplePath` smooths it visually. */
export function withBendArcs(path: RoutingPath, arcSamples: number = 6): RoutePoint[] {
  if (path.points.length < 3) return path.points.slice();
  const out: RoutePoint[] = [path.points[0]!];

  for (let i = 1; i < path.points.length - 1; i++) {
    const prev = path.points[i - 1]!.position;
    const here = path.points[i]!;
    const next = path.points[i + 1]!.position;
    const bendR = here.bendRadiusMm ?? path.defaultBendRadiusMm;
    const inDir = normalize(subtract(here.position, prev));
    const outDir = normalize(subtract(next, here.position));
    const cos = inDir[0] * outDir[0] + inDir[1] * outDir[1] + inDir[2] * outDir[2];
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (ang < 0.01) {
      out.push(here);
      continue;
    }
    // Distance from corner to start/end of arc:
    const corner = here.position;
    const offset = bendR * Math.tan((Math.PI - ang) / 2);
    const startArc = add(corner, scale(inDir, -offset));
    const endArc   = add(corner, scale(outDir, offset));

    out.push({ position: startArc });
    // Sample N arc midpoints.
    for (let k = 1; k < arcSamples; k++) {
      const t = k / arcSamples;
      out.push({
        position: [
          startArc[0] + (endArc[0] - startArc[0]) * t,
          startArc[1] + (endArc[1] - startArc[1]) * t,
          startArc[2] + (endArc[2] - startArc[2]) * t,
        ],
      });
    }
    out.push({ position: endArc });
  }
  out.push(path.points[path.points.length - 1]!);
  return out;
}
