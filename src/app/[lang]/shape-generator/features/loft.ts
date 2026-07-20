import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { occtLoftProfiles } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';

const SEGS = 32;

// ────────────────────────────────────────────────────────────────────────────
// W5-A real-loft core
//
// `loftSolid` lofts 2+ arbitrary planar CONVEX polygon sections (vertex counts
// may differ) into a closed, consistently-oriented triangle mesh:
//   - side walls: ruled strips between consecutive sections,
//   - both ends: fan caps (valid because sections are convex).
//
// Correspondence rule (explicit): every section is re-parameterized by
// normalized arc length with the seam anchored at its vertex 0, all sections
// are evaluated at the UNION of every section's vertex parameters, so
//   (1) all rings share one point count, and
//   (2) every original section vertex appears exactly in the output mesh.
// Supply sections with roughly corresponding first vertices to avoid an
// unintended twist — the core does not auto-rotate seams.
//
// Refusals (with reasons): <2 sections, <3 points, non-finite coords,
// degenerate (zero-area), NON-PLANAR, SELF-INTERSECTING and NON-CONVEX
// sections, and stacks whose centroids do not advance in space.
// ────────────────────────────────────────────────────────────────────────────

export interface LoftPoint3 { x: number; y: number; z: number }
export interface LoftSectionInput { points: LoftPoint3[] }

export type LoftResult =
  | {
      ok: true;
      /** Float64 so downstream volume checks keep full precision. */
      positions: Float64Array;
      indices: Uint32Array;
      ringCount: number;
      ringSize: number;
      /** Enclosed volume (mesh oriented outward, so this is ≥ 0). */
      volume: number;
    }
  | { ok: false; reason: string };

/** Signed volume of an indexed triangle mesh (divergence theorem). */
export function meshSignedVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = (indices[i] as number) * 3, b = (indices[i + 1] as number) * 3, c = (indices[i + 2] as number) * 3;
    const ax = positions[a] as number, ay = positions[a + 1] as number, az = positions[a + 2] as number;
    const bx = positions[b] as number, by = positions[b + 1] as number, bz = positions[b + 2] as number;
    const cx = positions[c] as number, cy = positions[c + 1] as number, cz = positions[c + 2] as number;
    v += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

interface P2 { x: number; y: number }

function newellNormal(pts: LoftPoint3[]): LoftPoint3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return { x: nx / 2, y: ny / 2, z: nz / 2 }; // magnitude == section area
}

function sub(a: LoftPoint3, b: LoftPoint3): LoftPoint3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot3(a: LoftPoint3, b: LoftPoint3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross3(a: LoftPoint3, b: LoftPoint3): LoftPoint3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm3(a: LoftPoint3): number { return Math.hypot(a.x, a.y, a.z); }

/** Proper segment-segment intersection (excluding shared endpoints). */
function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

interface PreparedSection {
  centroid: LoftPoint3;
  u: LoftPoint3;
  v: LoftPoint3;
  /** CCW (w.r.t. the outward-stacking normal) 2D loop, seam = original vertex 0. */
  loop: P2[];
  /** Cumulative arc length at each loop vertex (loop[0] → 0). */
  cum: number[];
  total: number;
}

function prepareSection(section: LoftSectionInput, index: number, stackDir: LoftPoint3): PreparedSection | { reason: string } {
  const pts = section.points;
  if (pts.length < 3) return { reason: `section ${index} needs at least 3 points (got ${pts.length})` };
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      return { reason: `section ${index} has a non-finite coordinate` };
    }
  }
  const centroid: LoftPoint3 = { x: 0, y: 0, z: 0 };
  for (const p of pts) { centroid.x += p.x; centroid.y += p.y; centroid.z += p.z; }
  centroid.x /= pts.length; centroid.y /= pts.length; centroid.z /= pts.length;

  let scale = 0;
  for (const p of pts) scale = Math.max(scale, norm3(sub(p, centroid)));

  const n = newellNormal(pts);
  const nLen = norm3(n);
  if (!(nLen > Math.max(1e-12, 1e-12 * scale * scale))) {
    return { reason: `section ${index} is degenerate (zero area)` };
  }
  let nHat: LoftPoint3 = { x: n.x / nLen, y: n.y / nLen, z: n.z / nLen };
  // Orient the section normal along the stacking direction so every 2D loop
  // ends up CCW when viewed from "above" the stack.
  if (dot3(nHat, stackDir) < 0) nHat = { x: -nHat.x, y: -nHat.y, z: -nHat.z };

  // Planarity: max out-of-plane deviation vs a size-relative tolerance.
  const planarTol = Math.max(1e-9, 1e-6 * scale);
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, Math.abs(dot3(sub(p, centroid), nHat)));
  if (maxDev > planarTol) {
    return { reason: `section ${index} is non-planar (max out-of-plane deviation ${maxDev.toExponential(3)} > tol ${planarTol.toExponential(3)})` };
  }

  // In-plane basis.
  let u: LoftPoint3 | null = null;
  for (const p of pts) {
    const d = sub(p, centroid);
    const inPlane = sub(d, { x: nHat.x * dot3(d, nHat), y: nHat.y * dot3(d, nHat), z: nHat.z * dot3(d, nHat) });
    const len = norm3(inPlane);
    if (len > 1e-12) { u = { x: inPlane.x / len, y: inPlane.y / len, z: inPlane.z / len }; break; }
  }
  if (!u) return { reason: `section ${index} is degenerate (all points coincide with the centroid)` };
  const v = cross3(nHat, u);

  let loop: P2[] = pts.map(p => {
    const d = sub(p, centroid);
    return { x: dot3(d, u!), y: dot3(d, v) };
  });

  // CCW normalization (keep vertex 0 as the seam anchor).
  let area2 = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area2) / 2 < Math.max(1e-18, 1e-12 * scale * scale)) {
    return { reason: `section ${index} is degenerate (zero area)` };
  }
  if (area2 < 0) loop = [loop[0]!, ...loop.slice(1).reverse()];

  // Self-intersection (pairwise non-adjacent edge test).
  const m = loop.length;
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      if (j === i || (j + 1) % m === i || (i + 1) % m === j) continue;
      if (segmentsCross(loop[i]!, loop[(i + 1) % m]!, loop[j]!, loop[(j + 1) % m]!)) {
        return { reason: `section ${index} is self-intersecting (edges ${i} and ${j} cross)` };
      }
    }
  }

  // Convexity: with a CCW loop every non-collinear turn must be a left turn.
  const convexEps = 1e-9 * scale * scale;
  for (let i = 0; i < m; i++) {
    const a = loop[i]!, b = loop[(i + 1) % m]!, c = loop[(i + 2) % m]!;
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cr < -convexEps) {
      return { reason: `section ${index} is non-convex (reflex vertex at index ${(i + 1) % m}) — only convex sections are supported` };
    }
  }

  const cum: number[] = [0];
  let total = 0;
  for (let i = 0; i < m; i++) {
    total += Math.hypot(loop[(i + 1) % m]!.x - loop[i]!.x, loop[(i + 1) % m]!.y - loop[i]!.y);
    if (i < m - 1) cum.push(total);
  }
  if (!(total > 0)) return { reason: `section ${index} is degenerate (zero perimeter)` };

  return { centroid, u, v, loop, cum, total };
}

/** Evaluate the closed loop at normalized arc-length parameter t ∈ [0,1). */
function evalLoopAt(sec: PreparedSection, t: number): P2 {
  const target = t * sec.total;
  const m = sec.loop.length;
  const snap = 1e-9 * sec.total;
  for (let k = 0; k < m; k++) {
    if (Math.abs(target - sec.cum[k]!) <= snap) return sec.loop[k]!; // exact original vertex
  }
  let k = m - 1;
  for (let i = 0; i < m - 1; i++) {
    if (sec.cum[i + 1]! > target) { k = i; break; }
  }
  const a = sec.loop[k]!;
  const b = sec.loop[(k + 1) % m]!;
  const segLen = (k === m - 1 ? sec.total : sec.cum[k + 1]!) - sec.cum[k]!;
  const f = segLen > 0 ? (target - sec.cum[k]!) / segLen : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** Strip + mirrored fan-cap mesh over same-length rings; winding fixed by sign of volume. */
function buildRingsMesh(rings: LoftPoint3[][]): { positions: number[]; indices: number[]; volume: number } {
  const M = rings[0]!.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const ring of rings) for (const p of ring) positions.push(p.x, p.y, p.z);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < M; i++) {
      const a = r * M + i, b = r * M + (i + 1) % M;
      const c = (r + 1) * M + i, d = (r + 1) * M + (i + 1) % M;
      indices.push(a, b, d, a, d, c);
    }
  }
  const lastBase = (rings.length - 1) * M;
  for (let p = 1; p < M - 1; p++) {
    indices.push(0, p + 1, p);               // bottom cap
    indices.push(lastBase, lastBase + p, lastBase + p + 1); // top cap
  }
  let vol = meshSignedVolume(positions, indices);
  if (vol < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]!; indices[i + 1] = indices[i + 2]!; indices[i + 2] = t;
    }
    vol = -vol;
  }
  return { positions, indices, volume: vol };
}

export function loftSolid(sections: LoftSectionInput[]): LoftResult {
  if (sections.length < 2) {
    return { ok: false, reason: `loft needs at least 2 sections (got ${sections.length})` };
  }
  // Stacking direction: first→last centroid.
  const cent = (s: LoftSectionInput): LoftPoint3 => {
    const c: LoftPoint3 = { x: 0, y: 0, z: 0 };
    for (const p of s.points) { c.x += p.x; c.y += p.y; c.z += p.z; }
    const n = Math.max(1, s.points.length);
    return { x: c.x / n, y: c.y / n, z: c.z / n };
  };
  const c0 = cent(sections[0]!);
  const cN = cent(sections[sections.length - 1]!);
  const stackDir = sub(cN, c0);
  if (!(norm3(stackDir) > 1e-9)) {
    return { ok: false, reason: 'sections do not advance along a stacking direction (first and last centroids coincide)' };
  }

  const prepared: PreparedSection[] = [];
  for (let i = 0; i < sections.length; i++) {
    const r = prepareSection(sections[i]!, i, stackDir);
    if ('reason' in r) return { ok: false, reason: r.reason };
    prepared.push(r);
  }

  // Union of normalized arc-length vertex parameters (seam = vertex 0 of each section).
  const paramSet: number[] = [];
  for (const sec of prepared) for (const c of sec.cum) paramSet.push(c / sec.total);
  paramSet.sort((a, b) => a - b);
  const params: number[] = [];
  for (const t of paramSet) {
    if (params.length === 0 || t - params[params.length - 1]! > 1e-9) params.push(t);
  }
  if (params.length < 3) return { ok: false, reason: 'sections resolve to fewer than 3 correspondence parameters' };

  const rings: LoftPoint3[][] = prepared.map(sec =>
    params.map(t => {
      const p = evalLoopAt(sec, t);
      return {
        x: sec.centroid.x + sec.u.x * p.x + sec.v.x * p.y,
        y: sec.centroid.y + sec.u.y * p.x + sec.v.y * p.y,
        z: sec.centroid.z + sec.u.z * p.x + sec.v.z * p.y,
      };
    }),
  );

  const mesh = buildRingsMesh(rings);
  return {
    ok: true,
    positions: new Float64Array(mesh.positions),
    indices: new Uint32Array(mesh.indices),
    ringCount: rings.length,
    ringSize: params.length,
    volume: mesh.volume,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Preset (UI) loft — circle / square / triangle sections.
//
// W5-A rework: rings are built by RADIAL sampling on a COMMON angle grid
// (uniform SEGS angles ∪ both shapes' corner angles), so
//   - preset polygons keep their exact corners (exact prism/frustum volumes),
//   - a shape morph (e.g. circle→square) is a true continuous radial blend
//     r(t, a) = (1−t)·r_start(a) + t·r_end(a) instead of the old abrupt
//     mid-height preset switch.
// The circle stays a SEGS-gon approximation of the true circle (stated).
// ────────────────────────────────────────────────────────────────────────────

/** Unit-size corner list per preset shape (CCW). Circle has no corners. */
function shapeCorners(shapeType: number): P2[] {
  if (shapeType === 1) return [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
  if (shapeType === 2) {
    return [0, 1, 2].map(k => ({ x: Math.cos((k / 3) * Math.PI * 2), y: Math.sin((k / 3) * Math.PI * 2) }));
  }
  return [];
}

/** Boundary radius of the unit shape along direction `angle` (radial support). */
function radialRadius(shapeType: number, angle: number): number {
  const corners = shapeCorners(shapeType);
  if (corners.length === 0) return 1; // circle
  const d: P2 = { x: Math.cos(angle), y: Math.sin(angle) };
  let best = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const A = corners[i]!;
    const B = corners[(i + 1) % corners.length]!;
    const E: P2 = { x: B.x - A.x, y: B.y - A.y };
    const det = E.x * d.y - E.y * d.x;
    if (Math.abs(det) < 1e-12) continue;
    const r = (E.x * A.y - E.y * A.x) / det;
    const s = (d.x * A.y - d.y * A.x) / det;
    if (r > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, r);
  }
  return Number.isFinite(best) ? best : 1;
}

/** Common angle grid: SEGS uniform angles ∪ corner angles of both shapes. */
function presetAngles(startShape: number, endShape: number): number[] {
  const TWO_PI = Math.PI * 2;
  const set: number[] = [];
  for (let i = 0; i < SEGS; i++) set.push((i / SEGS) * TWO_PI);
  for (const shape of [startShape, endShape]) {
    for (const c of shapeCorners(shape)) {
      set.push(((Math.atan2(c.y, c.x) % TWO_PI) + TWO_PI) % TWO_PI);
    }
  }
  set.sort((a, b) => a - b);
  const out: number[] = [];
  for (const a of set) {
    if (out.length === 0 || a - out[out.length - 1]! > 1e-9) out.push(a);
  }
  return out;
}

/** The ordered set of section rings (shared by the mesh + B-rep paths). */
function loftSections(params: Record<string, number>) {
  // Sanitize non-finite params: a NaN sections → 0/NaN loop bounds (empty loft),
  // and sections===0 makes t = s/0 = Infinity. Floor sections ≥ 1, cap at 200,
  // and default the rest so a single NaN can't write NaN coords into the rings.
  const sections = Math.max(1, Math.min(200, Math.round(Number.isFinite(params.sections) ? params.sections : 12)));
  const height = Number.isFinite(params.height) ? params.height : 50;
  const startShape = Math.round(Number.isFinite(params.startShape) ? params.startShape : 0);
  const endShape = Math.round(Number.isFinite(params.endShape) ? params.endShape : 0);
  const startSize = Number.isFinite(params.startSize) ? params.startSize : 20;
  const endSize = Number.isFinite(params.endSize) ? params.endSize : 20;
  const twistTotal = ((Number.isFinite(params.twist) ? params.twist : 0) / 360) * Math.PI * 2;

  const angles = presetAngles(startShape, endShape);
  const rStart = angles.map(a => radialRadius(startShape, a) * startSize);
  const rEnd = angles.map(a => radialRadius(endShape, a) * endSize);

  const rings: { points: [number, number][]; y: number }[] = [];
  for (let s = 0; s <= sections; s++) {
    const t = s / sections;
    const y = t * height - height / 2;
    const rot = twistTotal * t;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const points: [number, number][] = [];
    for (let k = 0; k < angles.length; k++) {
      const r = rStart[k]! * (1 - t) + rEnd[k]! * t; // true radial blend
      const px = r * Math.cos(angles[k]!);
      const py = r * Math.sin(angles[k]!);
      points.push([px * cosR - py * sinR, px * sinR + py * cosR]);
    }
    rings.push({ points, y });
  }
  return { rings, height };
}

function applyLoftMesh(params: Record<string, number>): THREE.BufferGeometry {
  const { rings } = loftSections(params);
  const rings3: LoftPoint3[][] = rings.map(r => r.points.map(([px, pz]) => ({ x: px, y: r.y, z: pz })));
  const mesh = buildRingsMesh(rings3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geo.setIndex(mesh.indices);
  geo.computeVertexNormals();
  return geo;
}

/** OCCT B-rep loft: skin the same section rings into a real solid stacked
 *  along +Y (matching the mesh), attaching an occtHandle so a downstream
 *  fillet/chamfer rounds the real loft instead of its bounding box. */
function applyLoftOcct(params: Record<string, number>): THREE.BufferGeometry | null {
  try {
    const { rings } = loftSections(params);
    const profiles = rings.map(r => ({
      points: r.points.map(([x, y]) => ({ x, y })),
      z: r.y,
    }));
    const result = occtLoftProfiles(profiles, {}, 'Y');
    if (!result.handle) return null;
    result.geometry.userData.occtHandle = result.handle;
    return result.geometry;
  } catch (err) {
    console.warn('[loft] OCCT path failed, falling back to mesh:', err);
    return null;
  }
}

export const loftFeature: FeatureDefinition = {
  type: 'loft',
  icon: '◈',
  params: [
    { key: 'sections', labelKey: 'paramLoftSections', default: 4, min: 2, max: 8, step: 1, unit: '' },
    { key: 'height', labelKey: 'paramLoftHeight', default: 100, min: 10, max: 500, step: 5, unit: 'mm' },
    {
      key: 'startShape', labelKey: 'paramLoftStartShape', default: 0, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'shapeCircle' },
        { value: 1, labelKey: 'shapeSquare' },
        { value: 2, labelKey: 'shapeTriangle' },
      ],
    },
    {
      key: 'endShape', labelKey: 'paramLoftEndShape', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'shapeCircle' },
        { value: 1, labelKey: 'shapeSquare' },
        { value: 2, labelKey: 'shapeTriangle' },
      ],
    },
    { key: 'startSize', labelKey: 'paramLoftStartSize', default: 40, min: 5, max: 200, step: 5, unit: 'mm' },
    { key: 'endSize', labelKey: 'paramLoftEndSize', default: 20, min: 5, max: 200, step: 5, unit: 'mm' },
    { key: 'twist', labelKey: 'paramLoftTwist', default: 0, min: 0, max: 360, step: 5, unit: '°' },
  ],
  apply(_geometry, params) {
    return applyLoftMesh(params);
  },
  async applyAsync(_geometry, params) {
    if (shouldUseOcctEngine()) {
      const brep = applyLoftOcct(params);
      if (brep) return brep;
    }
    return applyLoftMesh(params);
  },
};
