/**
 * routingFittings.ts — Standard pipe / cable fittings catalog.
 *
 * When a route turns, branches, or terminates, a fitting goes
 * there. This module catalogs common types + an auto-detector
 * that walks a RoutingPath and proposes the right fitting at
 * each junction.
 */

import type { RoutingPath, RoutePoint } from './routingPath';

export type FittingKind =
  | 'elbow-90'
  | 'elbow-45'
  | 'tee'
  | 'cross'
  | 'reducer'
  | 'coupling'
  | 'end-cap'
  | 'flange'
  | 'union'
  | 'cable-tie';

export interface Fitting {
  kind: FittingKind;
  /** Pipe / cable diameter (mm). */
  diameterMm: number;
  /** Optional second diameter for reducers. */
  secondDiameterMm?: number;
  /** Position in 3D space. */
  position: [number, number, number];
  /** Standard reference (ASTM / ISO / JIS / KS). */
  standardCode?: string;
  /** Material (PVC, copper, steel, etc.). */
  material?: string;
}

/** Auto-detect fittings along a routing path. */
export function detectFittings(path: RoutingPath): Fitting[] {
  const out: Fitting[] = [];
  if (path.points.length === 0) return out;

  // End caps at start + end when point is not attached.
  if (path.points.length > 0 && !path.points[0]!.attachedTo) {
    out.push({
      kind: 'end-cap',
      diameterMm: path.diameterMm,
      position: path.points[0]!.position,
    });
  }
  if (path.points.length > 1) {
    const last = path.points[path.points.length - 1]!;
    if (!last.attachedTo) {
      out.push({
        kind: 'end-cap',
        diameterMm: path.diameterMm,
        position: last.position,
      });
    }
  }

  // Elbow at each interior corner.
  for (let i = 1; i < path.points.length - 1; i++) {
    const a = path.points[i - 1]!.position;
    const b = path.points[i]!.position;
    const c = path.points[i + 1]!.position;
    const ang = bendAngleDeg(a, b, c);
    if (ang > 30) {
      out.push({
        kind: ang > 60 ? 'elbow-90' : 'elbow-45',
        diameterMm: path.diameterMm,
        position: b,
      });
    }
  }
  return out;
}

function bendAngleDeg(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): number {
  const v1 = norm(sub(a, b));
  const v2 = norm(sub(c, b));
  const dotP = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  return Math.acos(Math.max(-1, Math.min(1, dotP))) * 180 / Math.PI;
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Standard pipe fittings (ISO 7-1 tapered thread) — common sizes. */
export const STANDARD_PIPE_FITTINGS: ReadonlyArray<{
  kind: FittingKind;
  diameterMm: number;
  standardCode: string;
}> = [
  { kind: 'elbow-90', diameterMm: 15, standardCode: 'ISO 7-1 1/2"' },
  { kind: 'elbow-90', diameterMm: 20, standardCode: 'ISO 7-1 3/4"' },
  { kind: 'elbow-90', diameterMm: 25, standardCode: 'ISO 7-1 1"' },
  { kind: 'tee',      diameterMm: 15, standardCode: 'ISO 7-1 1/2"' },
  { kind: 'tee',      diameterMm: 20, standardCode: 'ISO 7-1 3/4"' },
  { kind: 'coupling', diameterMm: 15, standardCode: 'ISO 7-1 1/2"' },
  { kind: 'end-cap',  diameterMm: 15, standardCode: 'ISO 7-1 1/2"' },
  { kind: 'flange',   diameterMm: 50, standardCode: 'ISO 7005-1' },
];

/** Find the closest standard fitting for a custom diameter. */
export function nearestStandardFitting(
  kind: FittingKind,
  diameterMm: number,
): typeof STANDARD_PIPE_FITTINGS[number] | null {
  const candidates = STANDARD_PIPE_FITTINGS.filter(f => f.kind === kind);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) =>
    Math.abs(cur.diameterMm - diameterMm) < Math.abs(best.diameterMm - diameterMm) ? cur : best);
}
