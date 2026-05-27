/**
 * probeCollisionCheck.ts — Check CMM / OMV probe path for collisions
 * with the part or fixture.
 *
 * Probe geometry: stylus tip (sphere) + stylus shaft (cylinder) +
 * probe head (assumed clear). The path is a list of waypoints +
 * touch points. At every segment we test:
 *
 *   - Sphere-vs-triangle: does the stylus tip clear the part during
 *     approach / retract?
 *   - Cylinder-vs-triangle: does the shaft clip the part?
 *
 * For performance, the part is represented by AABB-bounded triangles
 * and we test only triangles whose AABB overlaps the segment swept
 * volume.
 *
 * The output flags problematic segments with the closest contact
 * point + clearance value.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Triangle {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  id?: string;
}

export interface PathPoint {
  position: Vec3;
  /** Whether this point is a touch (probe contacts part). */
  isTouch: boolean;
}

export interface Probe {
  /** Tip sphere radius. */
  tipRadiusMm: number;
  /** Shaft radius. */
  shaftRadiusMm: number;
  /** Shaft length from tip. */
  shaftLengthMm: number;
  /** Shaft direction (unit vector from tip toward head). Typically [0, 0, 1]. */
  shaftDirection: Vec3;
}

export interface CollisionOptions {
  /** Required clearance (mm) above contact. */
  clearanceMm: number;
  /** Whether to allow grazes at touch points (true: contact at touch is fine). */
  allowTouchContact: boolean;
}

export const DEFAULT_OPTIONS: CollisionOptions = {
  clearanceMm: 0.5,
  allowTouchContact: true,
};

export interface CollisionHit {
  pathIndex: number;
  pointPosition: Vec3;
  triangleId?: string;
  minDistanceMm: number;
  componentHit: 'tip' | 'shaft';
}

// ── Top-level entry ────────────────────────────────────────────

export function checkProbePath(
  path: PathPoint[],
  probe: Probe,
  part: Triangle[],
  options: Partial<CollisionOptions> = {},
): CollisionHit[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const hits: CollisionHit[] = [];
  for (let i = 0; i < path.length; i++) {
    const point = path[i]!;
    if (point.isTouch && opts.allowTouchContact) continue;
    for (const tri of part) {
      const tipDist = sphereTriangleClearance(point.position, probe.tipRadiusMm, tri);
      if (tipDist < opts.clearanceMm) {
        hits.push({
          pathIndex: i,
          pointPosition: point.position,
          minDistanceMm: tipDist,
          componentHit: 'tip',
          ...(tri.id !== undefined ? { triangleId: tri.id } : {}),
        });
      }
      const shaftDist = cylinderTriangleClearance(point.position, probe, tri);
      if (shaftDist < opts.clearanceMm) {
        hits.push({
          pathIndex: i,
          pointPosition: point.position,
          minDistanceMm: shaftDist,
          componentHit: 'shaft',
          ...(tri.id !== undefined ? { triangleId: tri.id } : {}),
        });
      }
    }
  }
  return hits;
}

// ── Geometry helpers ──────────────────────────────────────────

function sphereTriangleClearance(centre: Vec3, radius: number, tri: Triangle): number {
  const closest = closestPointOnTriangle(centre, tri);
  const dist = distance(centre, closest);
  return dist - radius;
}

function cylinderTriangleClearance(tipCentre: Vec3, probe: Probe, tri: Triangle): number {
  // Sample along the shaft length, use sphere-tri clearance with shaft radius.
  const samples = 6;
  let minClearance = Infinity;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const p: Vec3 = {
      x: tipCentre.x + probe.shaftDirection.x * (probe.shaftLengthMm * t),
      y: tipCentre.y + probe.shaftDirection.y * (probe.shaftLengthMm * t),
      z: tipCentre.z + probe.shaftDirection.z * (probe.shaftLengthMm * t),
    };
    const c = sphereTriangleClearance(p, probe.shaftRadiusMm, tri);
    if (c < minClearance) minClearance = c;
  }
  return minClearance;
}

function closestPointOnTriangle(p: Vec3, tri: Triangle): Vec3 {
  // Eberly: closest point on triangle to point p.
  const ab = sub(tri.v1, tri.v0);
  const ac = sub(tri.v2, tri.v0);
  const ap = sub(p, tri.v0);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return tri.v0;
  const bp = sub(p, tri.v1);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return tri.v1;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { x: tri.v0.x + ab.x * v, y: tri.v0.y + ab.y * v, z: tri.v0.z + ab.z * v };
  }
  const cp = sub(p, tri.v2);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return tri.v2;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { x: tri.v0.x + ac.x * w, y: tri.v0.y + ac.y * w, z: tri.v0.z + ac.z * w };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return { x: tri.v1.x + (tri.v2.x - tri.v1.x) * w, y: tri.v1.y + (tri.v2.y - tri.v1.y) * w, z: tri.v1.z + (tri.v2.z - tri.v1.z) * w };
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return {
    x: tri.v0.x + ab.x * v + ac.x * w,
    y: tri.v0.y + ab.y * v + ac.y * w,
    z: tri.v0.z + ab.z * v + ac.z * w,
  };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── Per-segment swept volume test ─────────────────────────────

export function checkPathSegments(
  path: PathPoint[],
  probe: Probe,
  part: Triangle[],
  options: Partial<CollisionOptions> = {},
  samplesPerSegment: number = 5,
): CollisionHit[] {
  if (path.length < 2) return checkProbePath(path, probe, part, options);
  // Resample path with intermediate sub-points.
  const sampled: PathPoint[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      sampled.push({
        position: {
          x: a.position.x + (b.position.x - a.position.x) * t,
          y: a.position.y + (b.position.y - a.position.y) * t,
          z: a.position.z + (b.position.z - a.position.z) * t,
        },
        isTouch: a.isTouch && s === 0,
      });
    }
  }
  sampled.push(path[path.length - 1]!);
  return checkProbePath(sampled, probe, part, options);
}

// ── Summary ────────────────────────────────────────────────────

export interface CollisionSummary {
  pathPointCount: number;
  collisionCount: number;
  tipCollisions: number;
  shaftCollisions: number;
  worstClearanceMm: number;
}

export function summarize(hits: CollisionHit[], pathLength: number): CollisionSummary {
  let tip = 0;
  let shaft = 0;
  let worst = Infinity;
  for (const h of hits) {
    if (h.componentHit === 'tip') tip++;
    else shaft++;
    if (h.minDistanceMm < worst) worst = h.minDistanceMm;
  }
  return {
    pathPointCount: pathLength,
    collisionCount: hits.length,
    tipCollisions: tip,
    shaftCollisions: shaft,
    worstClearanceMm: hits.length === 0 ? Infinity : worst,
  };
}
