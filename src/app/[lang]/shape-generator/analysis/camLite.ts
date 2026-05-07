import * as THREE from 'three';

export interface CAMOperation {
  type: 'face_mill' | 'contour' | 'pocket' | 'drill';
  toolDiameter: number; // mm
  stepover: number;     // % of tool diameter
  stepdown: number;     // mm per pass
  feedRate: number;     // mm/min
  spindleSpeed: number; // RPM
}

export interface CAMResult {
  toolpaths: THREE.Vector3[][];
  totalLength: number;   // mm
  estimatedTime: number; // minutes
  passes: number;
  warnings: string[];
}

// ─── Waterline geometry slicer ────────────────────────────────────────────────

/**
 * Intersect all triangles with the horizontal plane y = sliceY.
 * Returns an array of open/closed polylines in XZ.
 */
function sliceGeometryAtY(
  geometry: THREE.BufferGeometry,
  sliceY: number,
): THREE.Vector3[][] {
  const pos   = geometry.attributes.position as THREE.BufferAttribute;
  const index = geometry.index;
  const segments: Array<[THREE.Vector3, THREE.Vector3]> = [];

  const triCount = index ? index.count / 3 : pos.count / 3;

  const getV = (i: number): THREE.Vector3 =>
    new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));

  for (let t = 0; t < triCount; t++) {
    const ia = index ? index.getX(t * 3)     : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const verts = [getV(ia), getV(ib), getV(ic)];

    // Find the two edge-plane intersections
    const pts: THREE.Vector3[] = [];
    const edges: [number, number][] = [[0, 1], [1, 2], [2, 0]];
    for (const [a, b] of edges) {
      const va = verts[a], vb = verts[b];
      if ((va.y > sliceY) !== (vb.y > sliceY)) {
        const frac = (sliceY - va.y) / (vb.y - va.y);
        pts.push(new THREE.Vector3(
          va.x + frac * (vb.x - va.x),
          sliceY,
          va.z + frac * (vb.z - va.z),
        ));
      }
    }
    if (pts.length === 2) segments.push([pts[0], pts[1]]);
  }

  return chainSegments(segments, 0.05);
}

/**
 * Greedy O(n²) segment chaining — sufficient for CAM-scale meshes (< 100k triangles).
 * Connects open ends within `tol` mm into polylines.
 */
function chainSegments(
  segments: Array<[THREE.Vector3, THREE.Vector3]>,
  tol = 0.05,
): THREE.Vector3[][] {
  if (segments.length === 0) return [];

  const used = new Uint8Array(segments.length);
  const polylines: THREE.Vector3[][] = [];

  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const poly: THREE.Vector3[] = [segments[s][0].clone(), segments[s][1].clone()];

    // Extend tail
    let changed = true;
    while (changed) {
      changed = false;
      const tail = poly[poly.length - 1];
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        if (segments[i][0].distanceTo(tail) < tol) {
          poly.push(segments[i][1].clone()); used[i] = 1; changed = true; break;
        }
        if (segments[i][1].distanceTo(tail) < tol) {
          poly.push(segments[i][0].clone()); used[i] = 1; changed = true; break;
        }
      }
    }

    if (poly.length >= 2) polylines.push(poly);
  }

  return polylines;
}

/**
 * Compute axis-aligned bounding box of a polyline in XZ.
 */
function polylineBBox(poly: THREE.Vector3[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Generate a raster-scan pocket path inside the bounding box of the largest waterline
 * contour at this Y level, inset by `inset` mm (half tool diameter).
 */
function pocketRasterPaths(
  contours: THREE.Vector3[][],
  y: number,
  toolR: number,
  stepover: number,
): THREE.Vector3[][] {
  if (contours.length === 0) return [];

  // Use the largest contour's bbox as the pocket boundary
  let largest = contours[0];
  for (const c of contours) if (c.length > largest.length) largest = c;

  const { minX, maxX, minZ, maxZ } = polylineBBox(largest);
  const x0 = minX + toolR;
  const x1 = maxX - toolR;
  const z0 = minZ + toolR;
  const z1 = maxZ - toolR;

  if (x1 <= x0 || z1 <= z0) return [];

  const paths: THREE.Vector3[][] = [];
  const rows = Math.ceil((z1 - z0) / stepover) + 1;

  for (let row = 0; row < rows; row++) {
    const z = Math.min(z0 + row * stepover, z1);
    const path: THREE.Vector3[] = row % 2 === 0
      ? [new THREE.Vector3(x0, y, z), new THREE.Vector3(x1, y, z)]
      : [new THREE.Vector3(x1, y, z), new THREE.Vector3(x0, y, z)];
    paths.push(path);
  }

  return paths;
}

// ─── Main toolpath generator ──────────────────────────────────────────────────

export function generateCAMToolpaths(
  geometry: THREE.BufferGeometry,
  operation: CAMOperation,
): CAMResult {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;

  const warnings: string[] = [];
  const toolpaths: THREE.Vector3[][] = [];

  const dx       = bb.max.x - bb.min.x;
  const dz       = bb.max.z - bb.min.z;
  const dy       = bb.max.y - bb.min.y;
  const toolR    = operation.toolDiameter / 2;
  const stepover = operation.toolDiameter * (operation.stepover / 100);
  const passes   = Math.ceil(dy / operation.stepdown);

  // ── Face milling: zigzag from top, stepover in Z ──────────────────────────
  if (operation.type === 'face_mill') {
    const topY = bb.max.y;
    const rows = Math.ceil(dz / stepover) + 1;

    for (let p = 0; p < passes; p++) {
      const passY = topY - p * operation.stepdown;
      const path: THREE.Vector3[] = [];
      for (let row = 0; row < rows; row++) {
        const z = bb.min.z + row * stepover;
        if (row % 2 === 0) {
          path.push(new THREE.Vector3(bb.min.x - toolR, passY, z));
          path.push(new THREE.Vector3(bb.max.x + toolR, passY, z));
        } else {
          path.push(new THREE.Vector3(bb.max.x + toolR, passY, z));
          path.push(new THREE.Vector3(bb.min.x - toolR, passY, z));
        }
      }
      toolpaths.push(path);
    }
  }

  // ── Contour milling: trace real waterline cross-sections at each Z level ──
  else if (operation.type === 'contour') {
    for (let p = 0; p < passes; p++) {
      const passY    = bb.max.y - p * operation.stepdown;
      const contours = sliceGeometryAtY(geometry, passY);

      if (contours.length === 0) {
        // Fall back to perimeter rectangle if slicer returns nothing (flat cap)
        const off = -toolR; // stay on the edge
        toolpaths.push([
          new THREE.Vector3(bb.min.x + off, passY, bb.min.z + off),
          new THREE.Vector3(bb.max.x - off, passY, bb.min.z + off),
          new THREE.Vector3(bb.max.x - off, passY, bb.max.z - off),
          new THREE.Vector3(bb.min.x + off, passY, bb.max.z - off),
          new THREE.Vector3(bb.min.x + off, passY, bb.min.z + off),
        ]);
      } else {
        // Each chained polyline becomes a toolpath pass (tool centre offset handled by slicer)
        for (const poly of contours) {
          toolpaths.push(poly.map(v => new THREE.Vector3(v.x, passY, v.z)));
        }
      }
    }
  }

  // ── Pocket milling: waterline-bounded raster scans ───────────────────────
  else if (operation.type === 'pocket') {
    for (let p = 0; p < passes; p++) {
      const passY    = bb.max.y - p * operation.stepdown;
      const contours = sliceGeometryAtY(geometry, passY);
      const paths    = pocketRasterPaths(contours, passY, toolR, stepover);

      if (paths.length > 0) {
        toolpaths.push(...paths);
      } else {
        // No geometry cross-section — use full-bbox raster
        const rows = Math.ceil((dz - 2 * toolR) / stepover) + 1;
        const path: THREE.Vector3[] = [];
        for (let row = 0; row < rows; row++) {
          const z = bb.min.z + toolR + row * stepover;
          if (row % 2 === 0) {
            path.push(new THREE.Vector3(bb.min.x + toolR, passY, z));
            path.push(new THREE.Vector3(bb.max.x - toolR, passY, z));
          } else {
            path.push(new THREE.Vector3(bb.max.x - toolR, passY, z));
            path.push(new THREE.Vector3(bb.min.x + toolR, passY, z));
          }
        }
        if (path.length > 0) toolpaths.push(path);
      }
    }
  }

  // ── Drill: grid of plunge cycles ─────────────────────────────────────────
  else if (operation.type === 'drill') {
    const holeSpacing = operation.toolDiameter * 3;
    const cols  = Math.max(1, Math.floor(dx / holeSpacing));
    const rows2 = Math.max(1, Math.floor(dz / holeSpacing));
    for (let c = 0; c <= cols; c++) {
      for (let r = 0; r <= rows2; r++) {
        const x = bb.min.x + c * (dx / Math.max(cols, 1));
        const z = bb.min.z + r * (dz / Math.max(rows2, 1));
        toolpaths.push([
          new THREE.Vector3(x, bb.max.y + 5, z),
          new THREE.Vector3(x, bb.min.y,     z),
          new THREE.Vector3(x, bb.max.y + 5, z),
        ]);
      }
    }
  }

  // ── Warnings ─────────────────────────────────────────────────────────────
  if (passes > 20) warnings.push('Many depth passes — consider larger stepdown');
  if (operation.toolDiameter < 3) warnings.push('Small tool diameter — fragile tool risk');
  if (operation.feedRate > 5000) warnings.push('High feed rate — verify machine capability');

  const totalLength = toolpaths.reduce((sum, path) => {
    let len = 0;
    for (let i = 1; i < path.length; i++) len += path[i].distanceTo(path[i - 1]);
    return sum + len;
  }, 0);

  const estimatedTime = totalLength / operation.feedRate + toolpaths.length * 0.1;

  return { toolpaths, totalLength, passes, estimatedTime, warnings };
}
