import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { meshVolume } from './roundingGuard';

/**
 * meshRounding.ts — Real fillet/chamfer for the mesh-CSG engine (no OCCT).
 *
 * The legacy approximator (inflate-then-INTERSECT) is a no-op on convex solids.
 * For the dominant case — an axis-aligned box — this produces genuine geometry:
 *   • fillet  → three's RoundedBoxGeometry (watertight, outer extent preserved)
 *   • chamfer → box minus 12 triangular-prism edge wedges via three-bvh-csg
 *
 * Restricted to box-like inputs (bbox fill ratio ≈ 1) so it never silently
 * rounds a *bounding box* for a non-box shape — those return null and the
 * caller keeps its loud-fail guard.
 */

const BOX_FILL_RATIO = 0.97;

interface Vec3 { x: number; y: number; z: number; }
export interface BoxFit { center: Vec3; half: Vec3; boxLike: boolean; }

/** Fit an axis-aligned box and decide whether the geometry really is one. */
export function fitAxisAlignedBox(geometry: THREE.BufferGeometry): BoxFit {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const half: Vec3 = { x: (bb.max.x - bb.min.x) / 2, y: (bb.max.y - bb.min.y) / 2, z: (bb.max.z - bb.min.z) / 2 };
  const center: Vec3 = { x: (bb.max.x + bb.min.x) / 2, y: (bb.max.y + bb.min.y) / 2, z: (bb.max.z + bb.min.z) / 2 };
  const bboxVol = 8 * half.x * half.y * half.z;
  const boxLike = bboxVol > 1e-9 && meshVolume(geometry) / bboxVol >= BOX_FILL_RATIO;
  return { center, half, boxLike };
}

function minHalf(h: Vec3): number { return Math.min(h.x, h.y, h.z); }

const CYL_FILL_RATIO = 0.74; // π/4 ≈ 0.785; allow tessellation slack

export interface CylinderFit {
  center: Vec3;
  radius: number;
  halfHeight: number;
  axis: 'x' | 'y' | 'z';
  cylLike: boolean;
}

/** Fit an axis-aligned cylinder: the axis is the dimension whose two
 *  perpendicular extents are equal (the diameter), confirmed by a ~π/4 bbox
 *  fill ratio. */
export function fitCylinder(geometry: THREE.BufferGeometry): CylinderFit {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const half: Vec3 = { x: (bb.max.x - bb.min.x) / 2, y: (bb.max.y - bb.min.y) / 2, z: (bb.max.z - bb.min.z) / 2 };
  const center: Vec3 = { x: (bb.max.x + bb.min.x) / 2, y: (bb.max.y + bb.min.y) / 2, z: (bb.max.z + bb.min.z) / 2 };
  const bboxVol = 8 * half.x * half.y * half.z;
  const ratioOk = bboxVol > 1e-9 && Math.abs(meshVolume(geometry) / bboxVol - Math.PI / 4) < 0.06;

  const axes: Array<['x' | 'y' | 'z', number, number, number]> = [
    ['x', half.x, half.y, half.z],
    ['y', half.y, half.x, half.z],
    ['z', half.z, half.x, half.y],
  ];
  for (const [axis, hAxis, p, q] of axes) {
    if (p > 1e-9 && Math.abs(p - q) / Math.max(p, q) < 0.02) {
      return { center, radius: (p + q) / 2, halfHeight: hAxis, axis, cylLike: ratioOk };
    }
  }
  return { center, radius: 0, halfHeight: 0, axis: 'y', cylLike: false };
}

/** Revolve a 2D profile (Vector2 r,h) into a solid about the given axis, then
 *  place it at `center`. Clean lathe topology (like RoundedBoxGeometry for the
 *  box) — no CSG, no slivers. */
function buildLatheSolid(profile: THREE.Vector2[], axis: 'x' | 'y' | 'z', center: Vec3, segments = 48): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(profile, segments); // revolves about local +Y
  if (axis === 'x') geo.rotateZ(-Math.PI / 2);
  else if (axis === 'z') geo.rotateX(Math.PI / 2);
  geo.translate(center.x, center.y, center.z);
  geo.computeVertexNormals();
  return geo;
}

/** Profile (r,h) for a cylinder with both rims rounded by radius r. */
function filletCylinderProfile(R: number, H: number, r: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const ARC = 6;
  pts.push(new THREE.Vector2(0, -H));
  pts.push(new THREE.Vector2(R - r, -H));
  for (let i = 0; i <= ARC; i++) { const a = -Math.PI / 2 + (i / ARC) * (Math.PI / 2); pts.push(new THREE.Vector2(R - r + r * Math.cos(a), -(H - r) + r * Math.sin(a))); }
  for (let i = 0; i <= ARC; i++) { const a = (i / ARC) * (Math.PI / 2); pts.push(new THREE.Vector2(R - r + r * Math.cos(a), (H - r) + r * Math.sin(a))); }
  pts.push(new THREE.Vector2(R - r, H));
  pts.push(new THREE.Vector2(0, H));
  return pts;
}

/** Profile (r,h) for a cylinder with both rims chamfered (45°) by distance d. */
function chamferCylinderProfile(R: number, H: number, d: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, -H),
    new THREE.Vector2(R - d, -H),
    new THREE.Vector2(R, -(H - d)),
    new THREE.Vector2(R, H - d),
    new THREE.Vector2(R - d, H),
    new THREE.Vector2(0, H),
  ];
}

// ── Procedural chamfered-box mesh ──────────────────────────────────────────
// A chamfered (edge-beveled) box is a clean polyhedron: 6 octagon faces +
// 12 rectangular bevel strips + 8 corner triangles, on 24 vertices (each
// original corner split into 3, one per adjacent face). Building it directly
// gives high-quality triangles — unlike CSG, which leaves elongated slivers
// where it triangulates the long bevel strips. Every triangle is auto-oriented
// against its face's outward normal, so winding can't be wrong by construction.

function buildChamferedBox(hx: number, hy: number, hz: number, d: number): THREE.BufferGeometry {
  const signs: Array<1 | -1> = [1, -1];
  const V = new Map<string, [number, number, number]>();
  // vKey: corner signs + the axis kept at FULL extent; the other two coords are
  // pulled in by d. Three such verts per corner form the corner-cut triangle.
  const k = (sx: number, sy: number, sz: number, axis: string) => `${sx > 0 ? 'p' : 'm'}${sy > 0 ? 'p' : 'm'}${sz > 0 ? 'p' : 'm'}${axis}`;
  for (const sx of signs) for (const sy of signs) for (const sz of signs) {
    V.set(k(sx, sy, sz, 'x'), [sx * hx, sy * (hy - d), sz * (hz - d)]); // on ±X face
    V.set(k(sx, sy, sz, 'y'), [sx * (hx - d), sy * hy, sz * (hz - d)]); // on ±Y face
    V.set(k(sx, sy, sz, 'z'), [sx * (hx - d), sy * (hy - d), sz * hz]); // on ±Z face
  }
  const order = [...V.keys()];
  const idxOf = new Map(order.map((key, i) => [key, i]));
  const positions: number[] = [];
  for (const key of order) positions.push(...V.get(key)!);

  const tris: number[] = [];
  const pos = (key: string): [number, number, number] => V.get(key)!;
  const pushTri = (a: string, b: string, c: string, n: Vec3) => {
    const pa = pos(a), pb = pos(b), pc = pos(c);
    const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
    const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const ia = idxOf.get(a)!, ib = idxOf.get(b)!, ic = idxOf.get(c)!;
    if (cx * n.x + cy * n.y + cz * n.z >= 0) tris.push(ia, ib, ic);
    else tris.push(ia, ic, ib);
  };
  // Fan-triangulate a planar convex polygon (keys given in any order — we sort
  // them by angle around the centroid in the face plane).
  const pushPolygon = (keys: string[], n: Vec3) => {
    const c: [number, number, number] = [0, 0, 0];
    for (const key of keys) { const p = pos(key); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= keys.length; c[1] /= keys.length; c[2] /= keys.length;
    // Two in-plane basis axes perpendicular to n.
    const up: Vec3 = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    const ex = { x: up.y * n.z - up.z * n.y, y: up.z * n.x - up.x * n.z, z: up.x * n.y - up.y * n.x };
    const exl = Math.hypot(ex.x, ex.y, ex.z) || 1; ex.x /= exl; ex.y /= exl; ex.z /= exl;
    const ey = { x: n.y * ex.z - n.z * ex.y, y: n.z * ex.x - n.x * ex.z, z: n.x * ex.y - n.y * ex.x };
    const sorted = [...keys].sort((ka, kb) => {
      const pa = pos(ka), pb = pos(kb);
      const aa = Math.atan2((pa[0] - c[0]) * ey.x + (pa[1] - c[1]) * ey.y + (pa[2] - c[2]) * ey.z, (pa[0] - c[0]) * ex.x + (pa[1] - c[1]) * ex.y + (pa[2] - c[2]) * ex.z);
      const ab = Math.atan2((pb[0] - c[0]) * ey.x + (pb[1] - c[1]) * ey.y + (pb[2] - c[2]) * ey.z, (pb[0] - c[0]) * ex.x + (pb[1] - c[1]) * ex.y + (pb[2] - c[2]) * ex.z);
      return aa - ab;
    });
    for (let i = 1; i < sorted.length - 1; i++) pushTri(sorted[0]!, sorted[i]!, sorted[i + 1]!, n);
  };

  // 8 corner triangles.
  for (const sx of signs) for (const sy of signs) for (const sz of signs) {
    pushTri(k(sx, sy, sz, 'x'), k(sx, sy, sz, 'y'), k(sx, sy, sz, 'z'), { x: sx, y: sy, z: sz });
  }
  // 6 receded face rectangles (each original face shrunk by d on all sides).
  for (const sz of signs) pushPolygon([1, -1].flatMap(sx => [1, -1].map(sy => k(sx, sy, sz, 'z'))), { x: 0, y: 0, z: sz });
  for (const sy of signs) pushPolygon([1, -1].flatMap(sx => [1, -1].map(sz => k(sx, sy, sz, 'y'))), { x: 0, y: sy, z: 0 });
  for (const sx of signs) pushPolygon([1, -1].flatMap(sy => [1, -1].map(sz => k(sx, sy, sz, 'x'))), { x: sx, y: 0, z: 0 });
  // 12 bevel quads (4 per edge direction).
  for (const sx of signs) for (const sy of signs) pushPolygon([k(sx, sy, 1, 'x'), k(sx, sy, 1, 'y'), k(sx, sy, -1, 'y'), k(sx, sy, -1, 'x')], { x: sx, y: sy, z: 0 });
  for (const sy of signs) for (const sz of signs) pushPolygon([k(1, sy, sz, 'y'), k(1, sy, sz, 'z'), k(-1, sy, sz, 'z'), k(-1, sy, sz, 'y')], { x: 0, y: sy, z: sz });
  for (const sx of signs) for (const sz of signs) pushPolygon([k(sx, 1, sz, 'x'), k(sx, 1, sz, 'z'), k(sx, -1, sz, 'z'), k(sx, -1, sz, 'x')], { x: sx, y: 0, z: sz });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(tris);
  geo.computeVertexNormals();
  return geo;
}

/** Real mesh fillet for a box (RoundedBoxGeometry) or a cylinder (lathe with
 *  rounded rims). Null when the input is neither / the radius is invalid. */
export function tryMeshFillet(geometry: THREE.BufferGeometry, radius: number): THREE.BufferGeometry | null {
  if (radius <= 0) return null;
  const boxFit = fitAxisAlignedBox(geometry);
  if (boxFit.boxLike && radius < minHalf(boxFit.half)) {
    // segments per rounded corner: scale with radius for a smooth-enough arc.
    const segments = Math.max(2, Math.min(6, Math.round(radius)));
    const geo = new RoundedBoxGeometry(2 * boxFit.half.x, 2 * boxFit.half.y, 2 * boxFit.half.z, segments, radius);
    geo.translate(boxFit.center.x, boxFit.center.y, boxFit.center.z);
    geo.computeVertexNormals();
    return geo;
  }
  const cyl = fitCylinder(geometry);
  if (cyl.cylLike && radius < cyl.radius && radius < cyl.halfHeight) {
    return buildLatheSolid(filletCylinderProfile(cyl.radius, cyl.halfHeight, radius), cyl.axis, cyl.center);
  }
  return null;
}

/** Real mesh chamfer for a box (procedural chamfered box) or a cylinder (lathe
 *  with 45° rims). Both build clean topology directly — no CSG slivers. */
export function tryMeshChamfer(geometry: THREE.BufferGeometry, distance: number): THREE.BufferGeometry | null {
  if (distance <= 0) return null;
  const boxFit = fitAxisAlignedBox(geometry);
  if (boxFit.boxLike && distance < minHalf(boxFit.half)) {
    const geo = buildChamferedBox(boxFit.half.x, boxFit.half.y, boxFit.half.z, distance);
    geo.translate(boxFit.center.x, boxFit.center.y, boxFit.center.z);
    geo.computeVertexNormals();
    return geo;
  }
  const cyl = fitCylinder(geometry);
  if (cyl.cylLike && distance < cyl.radius && distance < cyl.halfHeight) {
    return buildLatheSolid(chamferCylinderProfile(cyl.radius, cyl.halfHeight, distance), cyl.axis, cyl.center);
  }
  return null;
}

