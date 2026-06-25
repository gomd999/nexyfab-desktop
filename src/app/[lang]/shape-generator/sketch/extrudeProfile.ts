import * as THREE from 'three';
import type { SketchProfile, SketchConfig, SketchPoint, SketchSegment } from './types';
import { sampleNurbsSegment } from './nurbs';

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
 *
 * Exported so the B-rep path (occtEngine.occtExtrudeProfile) samples the
 * profile identically to the mesh path — keeping the replicad solid and the
 * displayed ExtrudeGeometry mesh in correspondence.
 */
/**
 * Build a single closed contour's 2D points for the B-rep extruder. Returns
 * null when the profile can't be a single B-rep contour (a single `circle` —
 * handled separately by occtExtrudeCircle for an exact cylinder — or a
 * multi-contour profile with holes, i.e. a `circle`/`rect` mixed among other
 * segments). Single `rect` keeps its exact 4-corner contour here; the other
 * closed primitives (polygon/ellipse/slot) flow through `profileToPoints`,
 * which now tessellates them identically for the mesh and B-rep paths.
 */
export function brepContourPoints(profile: SketchProfile): SketchPoint[] | null {
  const segs = profile.segments;
  if (!segs || segs.length === 0) return null;
  if (segs.length === 1) {
    const s = segs[0];
    if (s.type === 'rect') {
      const a = s.points[0], b = s.points[1];
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return null;
      return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    }
    // single circle → exact-cylinder path (occtExtrudeCircle), not here
    if (s.type === 'circle') return null;
  }
  // Outer + holes (a circle/rect among multiple segments) = multi-contour,
  // which a single replicad polyline can't represent → skip (no handle).
  if (segs.some(s => s.type === 'circle' || s.type === 'rect')) return null;
  const pts = profileToPoints(profile);
  return pts.length >= 3 ? pts : null;
}

// ─── Closed-primitive tessellation densities ─────────────────────────────────
// One closed primitive segment (circle/rect/polygon/ellipse/slot) expands to a
// fixed point count so countContourEdgesPerSegment can mirror the sampler
// EXACTLY (the pipeline maps triangle ranges back to authoring segments).
export const CIRCLE_CONTOUR_EDGES = 32;
export const ELLIPSE_CONTOUR_EDGES = 36;
/** Sampled edges per semicircular slot cap → a slot contributes 2·(CAP+1) points. */
export const SLOT_CAP_EDGES = 16;
/**
 * The SketchSegment data model stores a polygon as [center, vertex] with NO
 * side count (the interactive polygon tool emits plain line segments instead,
 * see SketchCanvas generatePolygonSegments) — so a typed 'polygon' segment
 * (imports/scripts) tessellates with this default.
 */
export const POLYGON_DEFAULT_SIDES = 6;

/** N points around a circle given [center, rim] — starts at the rim point's
 *  angle so the loop is deterministic w.r.t. the authored geometry. */
function sampleCirclePoints(center: SketchPoint, rim: SketchPoint, n: number): SketchPoint[] {
  const r = Math.hypot(rim.x - center.x, rim.y - center.y);
  if (!(r > 1e-9)) return [];
  const a0 = Math.atan2(rim.y - center.y, rim.x - center.x);
  const pts: SketchPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return pts;
}

/** Capsule outline for slot [c1, c2, radiusPt]: cap around c1, cap around c2. */
function sampleSlotPoints(c1: SketchPoint, c2: SketchPoint, radiusPt: SketchPoint): SketchPoint[] {
  const r = Math.hypot(radiusPt.x - c1.x, radiusPt.y - c1.y);
  if (!(r > 1e-9)) return [];
  const theta = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  const pts: SketchPoint[] = [];
  // Cap 1: from θ+90° to θ+270° around c1 (SLOT_CAP_EDGES+1 points).
  for (let i = 0; i <= SLOT_CAP_EDGES; i++) {
    const a = theta + Math.PI / 2 + (i / SLOT_CAP_EDGES) * Math.PI;
    pts.push({ x: c1.x + r * Math.cos(a), y: c1.y + r * Math.sin(a) });
  }
  // Cap 2: from θ-90° to θ+90° around c2 (SLOT_CAP_EDGES+1 points). The two
  // straight flanks are the edges cap1[last]→cap2[0] and the closing edge.
  for (let i = 0; i <= SLOT_CAP_EDGES; i++) {
    const a = theta - Math.PI / 2 + (i / SLOT_CAP_EDGES) * Math.PI;
    pts.push({ x: c2.x + r * Math.cos(a), y: c2.y + r * Math.sin(a) });
  }
  return pts;
}

/**
 * Closed-primitive segment → contour point loop, or null for the segment
 * types handled inline by profileToPoints (line/arc/nurbs).
 */
function closedPrimitivePoints(seg: SketchSegment): SketchPoint[] | null {
  const p = seg.points;
  switch (seg.type) {
    case 'circle':
      return p.length >= 2 ? sampleCirclePoints(p[0], p[1], CIRCLE_CONTOUR_EDGES) : [];
    case 'rect': {
      if (p.length < 2) return [];
      const x0 = Math.min(p[0].x, p[1].x), x1 = Math.max(p[0].x, p[1].x);
      const y0 = Math.min(p[0].y, p[1].y), y1 = Math.max(p[0].y, p[1].y);
      if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return [];
      return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    }
    case 'polygon':
      return p.length >= 2 ? sampleCirclePoints(p[0], p[1], POLYGON_DEFAULT_SIDES) : [];
    case 'ellipse': {
      if (p.length < 3) return [];
      const rx = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      const ry = Math.hypot(p[2].x - p[0].x, p[2].y - p[0].y);
      if (!(rx > 1e-9) || !(ry > 1e-9)) return [];
      const pts: SketchPoint[] = [];
      for (let i = 0; i < ELLIPSE_CONTOUR_EDGES; i++) {
        const a = (i / ELLIPSE_CONTOUR_EDGES) * Math.PI * 2;
        pts.push({ x: p[0].x + rx * Math.cos(a), y: p[0].y + ry * Math.sin(a) });
      }
      return pts;
    }
    case 'slot':
      return p.length >= 3 ? sampleSlotPoints(p[0], p[1], p[2]) : [];
    default:
      return null;
  }
}

/**
 * NOTE on holes / inner loops: a closed primitive is tessellated INTO the
 * single contour this function returns. Holes are NOT modelled at this level —
 * the multi-profile path (`profileToGeometryMulti`, profiles[1..] = holes /
 * SketchCanvas's auto-hole flow) is where an inner circle becomes a hole.
 * A circle mixed into the SAME profile as other segments is appended inline
 * (degenerate authoring; previously it was silently DROPPED, which made a
 * circle-only sketch unextrudable — see REF-PART 2 finding).
 */
export function profileToPoints(profile: SketchProfile): SketchPoint[] {
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
    } else if (seg.type === 'nurbs' && seg.points.length >= 2) {
      const nurbsPts = sampleNurbsSegment(seg, 32);
      const startIdx = (points.length > 0 && nurbsPts.length > 0 &&
        Math.abs(points[points.length - 1].x - nurbsPts[0].x) < 0.01 &&
        Math.abs(points[points.length - 1].y - nurbsPts[0].y) < 0.01) ? 1 : 0;
      for (let j = startIdx; j < nurbsPts.length; j++) {
        points.push(nurbsPts[j]);
      }
    } else {
      // Closed primitives (circle/rect/polygon/ellipse/slot). These used to be
      // SKIPPED entirely — a circle-only sketch sampled to 0 points and the
      // most common sketch op ("draw a circle, extrude/cut") errored with
      // "Sketch produced empty geometry".
      const prim = closedPrimitivePoints(seg);
      if (prim) for (const q of prim) points.push(q);
    }
  }
  return points;
}

/**
 * How many contour edges each profile segment contributes to the closed
 * loop fed to ExtrudeGeometry. Lines = 1 edge; arcs sample to 16 points
 * → 15 edges; nurbs to 32 → 31 edges; closed primitives contribute their
 * full tessellated loop (circle 32, rect 4, polygon 6, ellipse 36, slot
 * 2·(SLOT_CAP_EDGES+1)). The numbers mirror exactly what `profileToPoints`
 * produces so a downstream caller (pipelineManager's runSketchExtrude →
 * sideSegmentRanges) can map a hit triangle index back to its authoring
 * segment hash without re-walking the sampler.
 */
export function countContourEdgesPerSegment(profile: SketchProfile): number[] {
  const out: number[] = [];
  for (const seg of profile.segments) {
    if (seg.type === 'line') out.push(1);
    else if (seg.type === 'arc') out.push(15);
    else if (seg.type === 'nurbs') out.push(31);
    else {
      const prim = closedPrimitivePoints(seg);
      out.push(prim ? Math.max(1, prim.length) : 1);
    }
  }
  return out;
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

  if (config.mode === 'extrude' || config.mode === 'extrudeCut') {
    // extrudeCut tool body is geometrically identical to a normal extrude;
    // the cut semantics happen at the boolean step in the pipeline.
    return extrudeGeometry(profile, config);
  } else if (config.mode === 'sweep') {
    // Phase 1 — sweep along a CatmullRom path. Falls back to straight
    // extrude when no path is supplied so callers that flip the mode
    // without populating sweepPath still get a usable body.
    return sweepGeometry(profile, config) ?? extrudeGeometry(profile, config);
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

/**
 * Sweep `profile` along the `config.sweepPath` curve.
 *
 * Phase 1 — uses three.js `CatmullRomCurve3` + `ExtrudeGeometry`'s
 * `extrudePath` option, which is the standard way to follow a 3-D path
 * with a 2-D cross-section. Phase 2 will add a UI for drawing the path
 * in the viewport; for now any caller that hands us a 2+ point path
 * (test fixtures, AI Copilot, server intent) gets a real sweep body.
 */
function sweepGeometry(profile: SketchProfile, config: SketchConfig): THREE.BufferGeometry | null {
  const path = config.sweepPath;
  if (!path || path.points.length < 2) return null;

  const shape = new THREE.Shape();
  const points = profileToPoints(profile);
  if (points.length < 3) return null;
  if (hasSelfIntersection(points)) {
    console.warn('Sketch profile self-intersects — cannot sweep');
    return null;
  }
  shape.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i].x, points[i].y);
  }
  shape.closePath();

  const curve = new THREE.CatmullRomCurve3(
    path.points.map(p => new THREE.Vector3(p.x, p.y, p.z)),
    false,
    'catmullrom',
  );
  const geometry = new THREE.ExtrudeGeometry(shape, {
    steps: Math.max(4, path.steps ?? 32),
    bevelEnabled: false,
    extrudePath: curve,
  });
  geometry.computeVertexNormals();
  return geometry;
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
