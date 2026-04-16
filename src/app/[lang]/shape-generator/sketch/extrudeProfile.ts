import * as THREE from 'three';
import type { SketchProfile, SketchConfig, SketchPoint } from './types';

/**
 * Build a THREE.Path from a SketchProfile (for use as a hole).
 * Returns null if the profile has fewer than 3 unique points.
 */
function profileToPath(profile: SketchProfile): THREE.Path | null {
  const points = profileToPoints(profile);
  if (points.length < 3) return null;
  const path = new THREE.Path();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x, points[i].y);
  }
  path.closePath();
  return path;
}

/**
 * Convert multiple closed 2D sketch profiles to a 3D BufferGeometry with holes.
 * profiles[0] = outer contour (extruded solid)
 * profiles[1..] = inner contours (holes punched through)
 * Falls back to profileToGeometry when only one profile is provided.
 * Returns null if the outer profile is invalid.
 */
export function profileToGeometryMulti(profiles: SketchProfile[], config: SketchConfig): THREE.BufferGeometry | null {
  if (profiles.length === 0) return null;
  if (profiles.length === 1) return profileToGeometry(profiles[0], config);

  const outer = profiles[0];
  if (!outer.closed) return null;

  const outerPoints = profileToPoints(outer);
  if (outerPoints.length < 3) return null;
  if (hasSelfIntersection(outerPoints)) {
    console.warn('Outer sketch profile has self-intersecting edges — cannot extrude');
    return null;
  }

  if (config.mode !== 'extrude') {
    // Multi-profile holes only supported for extrude mode; fall back to outer only
    return profileToGeometry(outer, config);
  }

  const shape = new THREE.Shape();
  shape.moveTo(outerPoints[0].x, outerPoints[0].y);
  for (let i = 1; i < outerPoints.length; i++) {
    shape.lineTo(outerPoints[i].x, outerPoints[i].y);
  }
  shape.closePath();

  // Add hole paths
  for (let h = 1; h < profiles.length; h++) {
    const holeProfile = profiles[h];
    if (!holeProfile.closed) continue;
    const holePath = profileToPath(holeProfile);
    if (holePath) {
      shape.holes.push(holePath);
    }
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: config.depth,
    bevelEnabled: false,
    steps: 1,
  });

  geometry.translate(0, 0, -config.depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Compute circle through 3 points. Returns null if colinear.
 */
function circleThrough3(p1: SketchPoint, p2: SketchPoint, p3: SketchPoint): { cx: number; cy: number; r: number } | null {
  const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  return { cx: ux, cy: uy, r: Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2) };
}

/**
 * Sample an arc (defined by 3 points) into a series of line points.
 */
function sampleArcPoints(start: SketchPoint, through: SketchPoint, end: SketchPoint, n: number = 16): SketchPoint[] {
  const circle = circleThrough3(start, through, end);
  if (!circle) return [start, end];
  const { cx, cy, r } = circle;
  const a1 = Math.atan2(start.y - cy, start.x - cx);
  let a2 = Math.atan2(end.y - cy, end.x - cx);
  const aMid = Math.atan2(through.y - cy, through.x - cx);

  function normAngle(a: number, ref: number): number {
    while (a < ref) a += 2 * Math.PI;
    while (a > ref + 2 * Math.PI) a -= 2 * Math.PI;
    return a;
  }
  a2 = normAngle(a2, a1);
  const aMidN = normAngle(aMid, a1);

  let sweep: number;
  if (aMidN <= a2) {
    sweep = a2 - a1;
  } else {
    sweep = a2 - a1 - 2 * Math.PI;
  }

  const pts: SketchPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a1 + sweep * t;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/**
 * Extract all profile points as a flat array, sampling arcs.
 */
function profileToPoints(profile: SketchProfile): SketchPoint[] {
  const points: SketchPoint[] = [];
  for (let i = 0; i < profile.segments.length; i++) {
    const seg = profile.segments[i];
    if (seg.type === 'line') {
      if (i === 0) points.push(seg.points[0]);
      points.push(seg.points[1]);
    } else if (seg.type === 'arc' && seg.points.length === 3) {
      const arcPts = sampleArcPoints(seg.points[0], seg.points[1], seg.points[2], 16);
      // Skip first point if it duplicates the last pushed point
      const startIdx = (points.length > 0 && arcPts.length > 0 &&
        Math.abs(points[points.length - 1].x - arcPts[0].x) < 0.01 &&
        Math.abs(points[points.length - 1].y - arcPts[0].y) < 0.01) ? 1 : 0;
      for (let j = startIdx; j < arcPts.length; j++) {
        points.push(arcPts[j]);
      }
    }
  }
  return points;
}

/**
 * Count unique points in the profile.
 */
function countUniquePoints(profile: SketchProfile): number {
  const pts = profileToPoints(profile);
  // Remove near-duplicates for counting
  const unique: SketchPoint[] = [];
  for (const p of pts) {
    const dup = unique.some(u => Math.abs(u.x - p.x) < 0.01 && Math.abs(u.y - p.y) < 0.01);
    if (!dup) unique.push(p);
  }
  return unique.length;
}

/**
 * Convert a closed 2D sketch profile to a 3D BufferGeometry.
 * Returns null if the profile is not closed or has fewer than 3 unique points.
 */
export function profileToGeometry(profile: SketchProfile, config: SketchConfig): THREE.BufferGeometry | null {
  if (!profile.closed) return null;
  if (countUniquePoints(profile) < 3) return null;

  if (config.mode === 'extrude') {
    return extrudeGeometry(profile, config);
  } else {
    return revolveGeometry(profile, config);
  }
}

/**
 * Check if a polygon self-intersects by testing all non-adjacent edge pairs.
 */
function hasSelfIntersection(points: SketchPoint[]): boolean {
  const n = points.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // skip adjacent (closing edge)
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1: SketchPoint, p2: SketchPoint, p3: SketchPoint, p4: SketchPoint): boolean {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / cross;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

function extrudeGeometry(profile: SketchProfile, config: SketchConfig): THREE.BufferGeometry | null {
  const shape = new THREE.Shape();
  const points = profileToPoints(profile);
  if (points.length < 3) return null;

  // Validate: reject self-intersecting profiles
  if (hasSelfIntersection(points)) {
    console.warn('Sketch profile has self-intersecting edges — cannot extrude');
    return null;
  }

  shape.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i].x, points[i].y);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: config.depth,
    bevelEnabled: false,
    steps: 1,
  });

  // Center along extrusion axis (Z)
  geometry.translate(0, 0, -config.depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function revolveGeometry(profile: SketchProfile, config: SketchConfig): THREE.BufferGeometry | null {
  const rawPoints = profileToPoints(profile);
  if (rawPoints.length < 3) return null;

  // For LatheGeometry: points are Vector2 where x = distance from axis, y = height
  // Profile is drawn in X-Y plane; for revolve around Y axis: x = profile.x, y = profile.y
  // For revolve around X axis: x = profile.y, y = profile.x (then rotate later)
  const lathePoints: THREE.Vector2[] = rawPoints.map(p => {
    if (config.revolveAxis === 'y') {
      return new THREE.Vector2(Math.abs(p.x), p.y);
    } else {
      return new THREE.Vector2(Math.abs(p.y), p.x);
    }
  });

  // LatheGeometry needs points ordered by Y (ascending) — but we must preserve
  // the profile's topology (the outline shape). Instead of destructive sort,
  // extract the unique right-side "silhouette" by walking the profile in order
  // and keeping only one point per Y band, preserving the contour shape.
  //
  // Strategy: split profile into "going up" and "going down" halves,
  // use the rightmost x for each y level. For simple closed profiles,
  // just use the original order — only sort as last resort for open profiles.

  // Remove near-duplicate consecutive points
  const dedupedPoints: THREE.Vector2[] = [lathePoints[0]];
  for (let i = 1; i < lathePoints.length; i++) {
    const prev = dedupedPoints[dedupedPoints.length - 1];
    if (Math.abs(lathePoints[i].y - prev.y) > 0.01 || Math.abs(lathePoints[i].x - prev.x) > 0.01) {
      dedupedPoints.push(lathePoints[i]);
    }
  }

  if (dedupedPoints.length < 2) return null;

  // For LatheGeometry, points must be sorted by Y ascending.
  // Build a silhouette: for each unique Y level, take the maximum X (outermost).
  // Group by Y bins (0.5mm resolution)
  const yBins = new Map<number, number>(); // rounded Y -> max X
  for (const p of dedupedPoints) {
    const yKey = Math.round(p.y * 2) / 2; // 0.5mm bins
    const existing = yBins.get(yKey);
    if (existing === undefined || p.x > existing) {
      yBins.set(yKey, p.x);
    }
  }

  // Convert to sorted array
  const silhouette = Array.from(yBins.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([y, x]) => new THREE.Vector2(x, y));

  if (silhouette.length < 2) return null;

  const angleRad = (config.revolveAngle * Math.PI) / 180;
  const geometry = new THREE.LatheGeometry(silhouette, config.segments, 0, angleRad);

  // If revolve around X axis, rotate result
  if (config.revolveAxis === 'x') {
    geometry.rotateZ(Math.PI / 2);
  }

  geometry.computeVertexNormals();
  return geometry;
}
