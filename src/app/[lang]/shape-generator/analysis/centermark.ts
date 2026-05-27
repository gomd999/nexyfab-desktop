/**
 * centermark.ts — ASME Y14.5 / ISO 128 centerline + centermark generation
 * for circular features in 2D engineering drawings.
 *
 * A centermark is the cross at the centre of a hole or cylinder — four
 * short ticks pointing at 0°/90°/180°/270°. Centerlines are the longer
 * dashed crosses on cylindrical features above a certain size threshold
 * (typically Ø > 6mm in ISO practice).
 *
 * **Input model**: caller supplies a list of detected circular features
 * (centre 3-D point + radius + axis direction). This module is
 * deliberately oblivious to how the features were extracted — they
 * could come from B-Rep face introspection, mesh-cluster heuristics
 * (see `detectCircularFeatures`), or user-pinned annotations.
 *
 * **Output**: an array of DrawingLine entries with `type: 'center'`
 * matching the line-type convention already in use by `drawingExport`.
 */

import * as THREE from 'three';
import type { DrawingLine, ProjectionView } from './autoDrawing';
import { getProjectionDef } from './autoDrawing';

export interface CircularFeature {
  /** Centre point in world coordinates (mm). */
  center: THREE.Vector3;
  /** Hole/cylinder radius in mm. */
  radius: number;
  /** Axis of revolution as a unit vector. Used to decide which views
   *  show the feature as a circle (axis ⊥ view plane) vs. as a pair
   *  of parallel lines (axis ∥ view plane). */
  axis: THREE.Vector3;
}

/** ISO 128 threshold — features above this diameter get extended
 *  centerlines (the long dashed cross), below get just the tick
 *  centermark. */
const CENTERLINE_DIAMETER_THRESHOLD = 6;

/** Length the centerline extends past the feature radius. ISO 128
 *  recommends 2–5mm; we use a fixed 4mm for predictability. */
const CENTERLINE_EXTENSION = 4;

/** Length of each centermark tick when the feature is small enough
 *  that no full centerline is drawn. */
const CENTERMARK_TICK = 2;

/**
 * Decide whether a circular feature appears as a circle (axis points
 * out of the page) for the given projection. Axis aligned with the
 * view direction → circle; axis perpendicular → straight line; oblique
 * → ellipse (out of scope, treated as line).
 */
function featureFacesView(axis: THREE.Vector3, projection: ProjectionView): boolean {
  // Build the view direction vector for each orthographic projection.
  const viewDir = (() => {
    switch (projection) {
      case 'front':  return new THREE.Vector3(0, 0, 1);
      case 'back':   return new THREE.Vector3(0, 0, -1);
      case 'top':    return new THREE.Vector3(0, 1, 0);
      case 'bottom': return new THREE.Vector3(0, -1, 0);
      case 'right':  return new THREE.Vector3(1, 0, 0);
      case 'left':   return new THREE.Vector3(-1, 0, 0);
      case 'iso':    return new THREE.Vector3(1, 1, 1).normalize();
    }
  })();
  if (!viewDir) return false;
  // Axis-of-revolution ⋅ view-direction ≈ ±1 means circle is fully
  // visible. 0.9 threshold lets us catch lightly off-axis cases without
  // false-positiving genuinely side-on cylinders.
  return Math.abs(viewDir.dot(axis.clone().normalize())) > 0.9;
}

/**
 * Generate ASME Y14.5 centerlines + centermarks for the supplied
 * circular features, projected to the given view. Returns DrawingLine
 * entries with `type: 'center'` ready to merge into a ViewResult.
 */
export function generateCentermarks(
  features: CircularFeature[],
  projection: ProjectionView,
  scale = 1,
): DrawingLine[] {
  const out: DrawingLine[] = [];
  const def = getProjectionDef(projection);
  for (const f of features) {
    if (!featureFacesView(f.axis, projection)) continue;
    const c = def.project(f.center);
    const cx = c.x * scale;
    const cy = c.y * scale;
    const r = f.radius * scale;
    const useFullCenterline = f.radius * 2 >= CENTERLINE_DIAMETER_THRESHOLD;
    const half = (useFullCenterline ? r + CENTERLINE_EXTENSION : CENTERMARK_TICK) * scale;

    // Horizontal centerline
    out.push({ x1: cx - half, y1: cy, x2: cx + half, y2: cy, type: 'center' });
    // Vertical centerline
    out.push({ x1: cx, y1: cy - half, x2: cx, y2: cy + half, type: 'center' });
  }
  return out;
}

/**
 * Mesh-based heuristic: scan vertices for ring patterns lying on a
 * common plane. Each ring infers one CircularFeature with axis =
 * plane normal. This works for canonical primitives (boxes with
 * cylinder cuts, free-standing cylinders) where the mesh has clean
 * radial samples. For imported STEP it's a best-effort fallback —
 * proper B-Rep face introspection lives in occtEngine.ts.
 */
export function detectCircularFeatures(
  geometry: THREE.BufferGeometry,
  opts: { tolerance?: number; minRingPoints?: number } = {},
): CircularFeature[] {
  const tol = opts.tolerance ?? 0.01;
  // 10 is the sweet spot — high enough to filter box-corner false
  // positives, low enough to detect coarse imported rings (8-sided
  // OCCT tessellation defaults). Tune per-call via opts when needed.
  const minPts = opts.minRingPoints ?? 10;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return [];

  const tryAxis = (axis: 'x' | 'y' | 'z'): CircularFeature[] => {
    const planeKey = axis;
    const buckets = new Map<string, { x: number; y: number; z: number }[]>();
    for (let i = 0; i < pos.count; i++) {
      const v = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
      const k = Math.round(v[planeKey] / tol) * tol;
      const arr = buckets.get(k.toString());
      if (arr) arr.push(v); else buckets.set(k.toString(), [v]);
    }
    const found: CircularFeature[] = [];
    for (const [planeCoord, verts] of buckets) {
      if (verts.length < minPts) continue;
      // Compute centroid in the two non-axis coords.
      let sumA = 0, sumB = 0;
      for (const v of verts) {
        if (axis === 'x') { sumA += v.y; sumB += v.z; }
        else if (axis === 'y') { sumA += v.x; sumB += v.z; }
        else { sumA += v.x; sumB += v.y; }
      }
      const ca = sumA / verts.length;
      const cb = sumB / verts.length;
      // Check radial uniformity — std-dev of distances should be small.
      const dists = verts.map(v => {
        const a = axis === 'x' ? v.y : v.x;
        const b = axis === 'x' ? v.z : axis === 'y' ? v.z : v.y;
        return Math.hypot(a - ca, b - cb);
      });
      const meanR = dists.reduce((s, d) => s + d, 0) / dists.length;
      if (meanR < 0.5) continue; // too small to matter
      const stdR = Math.sqrt(dists.reduce((s, d) => s + (d - meanR) ** 2, 0) / dists.length);
      if (stdR / meanR > 0.05) continue; // not circular by radius
      // Angular spread check — points must wrap most of the circle, not
      // just cluster at a few angles. Without this, four corners of a
      // box test as "circular" because they're equidistant from centre.
      const angles = verts.map(v => {
        const a = axis === 'x' ? v.y : v.x;
        const b = axis === 'x' ? v.z : axis === 'y' ? v.z : v.y;
        return Math.atan2(b - cb, a - ca);
      });
      angles.sort((a, b) => a - b);
      let maxGap = 0;
      for (let i = 0; i < angles.length; i++) {
        const next = i === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
        maxGap = Math.max(maxGap, next - angles[i]);
      }
      // Gap > 90° means < 270° of the supposed circle is sampled —
      // typically a corner cluster, not a real ring. 90° lets us
      // detect rings that have a tessellation seam (one missing vertex)
      // while still rejecting box corners.
      if (maxGap > Math.PI / 2) continue;
      const planeVal = Number(planeCoord);
      const center = axis === 'x'
        ? new THREE.Vector3(planeVal, ca, cb)
        : axis === 'y'
        ? new THREE.Vector3(ca, planeVal, cb)
        : new THREE.Vector3(ca, cb, planeVal);
      const axisVec = axis === 'x'
        ? new THREE.Vector3(1, 0, 0)
        : axis === 'y'
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
      found.push({ center, radius: meanR, axis: axisVec });
    }
    return found;
  };

  // Try all three axes; dedupe identical features (same centre + radius).
  const all = [...tryAxis('x'), ...tryAxis('y'), ...tryAxis('z')];
  const seen = new Set<string>();
  const dedup: CircularFeature[] = [];
  for (const f of all) {
    const key = `${f.center.x.toFixed(2)}|${f.center.y.toFixed(2)}|${f.center.z.toFixed(2)}|${f.radius.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(f);
  }
  return dedup;
}
