/**
 * routingValidate.ts — Bend-radius / clearance / interference checks.
 *
 * Three classes of validation:
 *   1. Bend-radius: each corner's effective radius ≥ minimum for
 *      that material (e.g. CAT6 cable bend ≥ 4× diameter).
 *   2. Clearance: route stays clear of walls / brackets by some
 *      minimum gap.
 *   3. Inter-route interference: two cable runs don't overlap.
 *
 * Each check emits a `RoutingIssue` the UI surfaces inline (red
 * highlight on the offending segment). No auto-fix here — fixes
 * vary per case and require user judgement.
 */

import type { RoutingPath } from './routingPath';

export type RoutingSeverity = 'warn' | 'block';

export interface RoutingIssue {
  pathId: string;
  /** Index of the through-point or segment with the problem. */
  segmentIndex: number;
  severity: RoutingSeverity;
  code: 'BEND_TOO_TIGHT' | 'CLEARANCE_VIOLATION' | 'INTER_ROUTE_INTERFERENCE' | 'PATH_TOO_SHORT';
  message: string;
  /** Required minimum / actual value for surfacing in UI. */
  required?: number;
  actual?: number;
}

/** Minimum bend radius as a multiple of cable diameter. */
const BEND_RATIO: Record<string, number> = {
  cable: 4,      // ethernet / power cables
  'wire-bundle': 6,
  pipe: 1.5,
  hose: 3,
};

function dist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function distPointSegment(
  p: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const lenSq = dx * dx + dy * dy + dz * dz;
  if (lenSq === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / lenSq));
  return dist(p, [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t]);
}

function bendAngleDeg(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): number {
  const v1: [number, number, number] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v2: [number, number, number] = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const l1 = Math.hypot(...v1) || 1;
  const l2 = Math.hypot(...v2) || 1;
  const dot = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (l1 * l2);
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}

/** Check a single path's bend radii + minimum length. */
export function validateBendRadius(path: RoutingPath): RoutingIssue[] {
  const out: RoutingIssue[] = [];
  if (path.points.length < 2) {
    out.push({
      pathId: path.id,
      segmentIndex: 0,
      severity: 'block',
      code: 'PATH_TOO_SHORT',
      message: 'Path must have at least 2 points',
    });
    return out;
  }
  const minRatio = BEND_RATIO[path.kind] ?? 4;
  const minRadius = path.diameterMm * minRatio;
  for (let i = 1; i < path.points.length - 1; i++) {
    const corner = path.points[i]!;
    const bendR = corner.bendRadiusMm ?? path.defaultBendRadiusMm;
    const ang = bendAngleDeg(path.points[i - 1]!.position, corner.position, path.points[i + 1]!.position);
    // Only flag actual bends (180° = straight ≠ bend).
    if (ang > 170) continue;
    if (bendR < minRadius) {
      out.push({
        pathId: path.id,
        segmentIndex: i,
        severity: 'warn',
        code: 'BEND_TOO_TIGHT',
        message: `Bend radius ${bendR}mm below minimum ${minRadius}mm for ${path.kind} of Ø${path.diameterMm}mm`,
        required: minRadius,
        actual: bendR,
      });
    }
  }
  return out;
}

/** Clearance check against obstacles (axis-aligned boxes). */
export interface Obstacle {
  id: string;
  min: [number, number, number];
  max: [number, number, number];
  /** Minimum clearance required (mm). */
  clearanceMm: number;
}

export function validateClearance(path: RoutingPath, obstacles: Obstacle[]): RoutingIssue[] {
  const out: RoutingIssue[] = [];
  for (let i = 0; i < path.points.length - 1; i++) {
    const a = path.points[i]!.position;
    const b = path.points[i + 1]!.position;
    for (const obs of obstacles) {
      // Approximate: check each corner of the AABB.
      const center: [number, number, number] = [
        (obs.min[0] + obs.max[0]) / 2,
        (obs.min[1] + obs.max[1]) / 2,
        (obs.min[2] + obs.max[2]) / 2,
      ];
      const halfSize = Math.max(
        obs.max[0] - obs.min[0],
        obs.max[1] - obs.min[1],
        obs.max[2] - obs.min[2],
      ) / 2;
      const distToObs = distPointSegment(center, a, b);
      if (distToObs - halfSize < obs.clearanceMm) {
        out.push({
          pathId: path.id,
          segmentIndex: i,
          severity: 'block',
          code: 'CLEARANCE_VIOLATION',
          message: `Segment ${i} too close to obstacle "${obs.id}" (clearance ${obs.clearanceMm}mm)`,
          required: obs.clearanceMm,
          actual: distToObs - halfSize,
        });
      }
    }
  }
  return out;
}

/** Two-route interference (segment-to-segment minimum distance). */
export function validateInterRouteInterference(
  paths: RoutingPath[],
  minSeparationMm: number = 5,
): RoutingIssue[] {
  const out: RoutingIssue[] = [];
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const pA = paths[i]!;
      const pB = paths[j]!;
      for (let si = 0; si < pA.points.length - 1; si++) {
        for (let sj = 0; sj < pB.points.length - 1; sj++) {
          const aStart = pA.points[si]!.position;
          const aEnd = pA.points[si + 1]!.position;
          const bMid: [number, number, number] = [
            (pB.points[sj]!.position[0] + pB.points[sj + 1]!.position[0]) / 2,
            (pB.points[sj]!.position[1] + pB.points[sj + 1]!.position[1]) / 2,
            (pB.points[sj]!.position[2] + pB.points[sj + 1]!.position[2]) / 2,
          ];
          const d = distPointSegment(bMid, aStart, aEnd);
          if (d < minSeparationMm) {
            out.push({
              pathId: pA.id,
              segmentIndex: si,
              severity: 'warn',
              code: 'INTER_ROUTE_INTERFERENCE',
              message: `Route "${pA.id}" segment ${si} too close to route "${pB.id}"`,
              required: minSeparationMm,
              actual: d,
            });
          }
        }
      }
    }
  }
  return out;
}
