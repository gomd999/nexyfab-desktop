/**
 * featureMesh — turn a CAD feature into a closed polyhedron (vertices +
 * oriented faces + derived edges). Pure TS, no OCCT.
 *
 * Phase 4.1.2 of NexyFab Pro own-CAD (ADR-013). This is the geometry source
 * the drawing layer projects to 2D (see lib/drawing/projectView.ts) and that
 * stats / interference can sharpen later. Designed to extend kind-by-kind;
 * Phase 1 covers `extrude` (prisms), which is the most common drawing case.
 *
 * Conventions:
 *   - Right-handed world frame; the sketch XY plane is the world XY plane and
 *     extrude grows along +Z (per extrudeProfile's direction modes).
 *   - Faces store a CCW vertex loop AS SEEN FROM OUTSIDE and an outward unit
 *     normal. Normals are computed from the loop and flipped if they point
 *     toward the solid centroid, so winding mistakes can't produce inward
 *     normals — the HLR pass relies on this.
 */

import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { add, sub, cross, dot, lengthOf, scale, normalize } from '@/lib/sketch/sketchPlane';
import type { ExtrudeFeature } from './extrudeProfile';
import type { RevolveFeature } from './revolveProfile';
import type { SweepFeature, LoftFeature } from './sweepLoft';
import type { SweepPathFeature } from './sweepPath';

// ─── types ───────────────────────────────────────────────────────────────

export interface PolyFace {
  /** Vertex indices, CCW as seen from outside the solid. */
  vertices: number[];
  /** Outward unit normal. */
  normal: Vec3;
}

export interface Polyhedron {
  vertices: Vec3[];
  faces: PolyFace[];
}

export interface PolyEdge {
  a: number;
  b: number;
  /** Indices of the faces sharing this edge (1 for boundary, 2 for manifold). */
  faces: number[];
}

// ─── extrude → prism ────────────────────────────────────────────────────────

/**
 * Z extent of an extrude given its direction mode.
 */
function extrudeZRange(feature: ExtrudeFeature): { z0: number; z1: number } {
  const d = feature.depth;
  switch (feature.direction) {
    case 'two_sided':
      return { z0: -d, z1: d };
    case 'midplane':
      return { z0: -d / 2, z1: d / 2 };
    case 'one_sided':
    default:
      return { z0: 0, z1: d };
  }
}

/**
 * Build a prism polyhedron from an extrude feature. The loop is taken as-is
 * (extrudeProfile already re-orients it CCW). Degenerate loops (< 3 distinct
 * points) throw.
 */
export function extrudePolyhedron(feature: ExtrudeFeature): Polyhedron {
  const loop = dedupeLoop(feature.loop);
  if (loop.length < 3) {
    throw new Error(`featureMesh: extrude loop needs ≥ 3 distinct points, got ${loop.length}`);
  }
  const { z0, z1 } = extrudeZRange(feature);
  const n = loop.length;

  const vertices: Vec3[] = [];
  // Bottom ring [0, n), top ring [n, 2n).
  for (const p of loop) vertices.push({ x: p.x, y: p.y, z: z0 });
  for (const p of loop) vertices.push({ x: p.x, y: p.y, z: z1 });

  const centroid = polyCentroid(vertices);
  const faces: PolyFace[] = [];

  // Bottom cap (loop reversed so it reads CCW from below).
  faces.push(orientedFace([...Array(n).keys()].reverse(), vertices, centroid));
  // Top cap.
  faces.push(orientedFace([...Array(n).keys()].map((i) => i + n), vertices, centroid));
  // Sides: quad per loop edge.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push(orientedFace([i, j, j + n, i + n], vertices, centroid));
  }

  return { vertices, faces };
}

// ─── revolve → solid of revolution ──────────────────────────────────────────

const DEFAULT_REVOLVE_SEGMENTS = 32;

/**
 * Mesh a revolve feature: the canonical profile loop (axis = Y, X ≥ 0) swept
 * around the Y axis. A full 360° sweep wraps into a closed torus-like surface
 * (no caps); a partial sweep adds the two end-cap profile faces. The result is
 * faceted — projectView suppresses the smooth tessellation edges so drawings
 * read as a clean silhouette.
 */
export function revolvePolyhedron(
  feature: RevolveFeature,
  segments: number = DEFAULT_REVOLVE_SEGMENTS,
): Polyhedron {
  const loop = dedupeLoop(feature.loop);
  if (loop.length < 3) {
    throw new Error(`featureMesh: revolve loop needs ≥ 3 distinct points, got ${loop.length}`);
  }
  if (!Number.isInteger(segments) || segments < 3) {
    throw new Error(`featureMesh: revolve segments must be an integer ≥ 3, got ${segments}`);
  }
  const angle = Math.max(0, Math.min(360, feature.angleDegrees));
  const full = angle >= 360 - 1e-9;
  const n = loop.length;
  const rings = full ? segments : segments + 1;

  const vertices: Vec3[] = [];
  for (let j = 0; j < rings; j++) {
    const t = (angle * (j / segments) * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    for (const p of loop) {
      // radius = p.x (X≥0), height = p.y, rotate about Y into XZ.
      vertices.push({ x: p.x * c, y: p.y, z: p.x * s });
    }
  }
  const idx = (i: number, j: number): number => j * n + i;
  const centroid = polyCentroid(vertices);
  const faces: PolyFace[] = [];

  // Side quads.
  for (let j = 0; j < segments; j++) {
    const jn = full ? (j + 1) % segments : j + 1;
    for (let i = 0; i < n; i++) {
      const inx = (i + 1) % n;
      faces.push(orientedFace([idx(i, j), idx(inx, j), idx(inx, jn), idx(i, jn)], vertices, centroid));
    }
  }
  // End caps for a partial sweep (the profile face at θ=0 and θ=angle).
  if (!full) {
    faces.push(orientedFace([...Array(n).keys()].map((i) => idx(i, 0)), vertices, centroid));
    faces.push(orientedFace([...Array(n).keys()].map((i) => idx(i, segments)), vertices, centroid));
  }

  return { vertices, faces };
}

// ─── sweep → profile swept along a 3D path ───────────────────────────────────

/** Per-station unit tangents (averaged at interior stations). */
function pathTangents(path: Vec3[]): Vec3[] {
  const n = path.length;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    let dir: Vec3;
    if (i === 0) dir = sub(path[1], path[0]);
    else if (i === n - 1) dir = sub(path[n - 1], path[n - 2]);
    else dir = add(sub(path[i], path[i - 1]), sub(path[i + 1], path[i]));
    out.push(normalize(dir));
  }
  return out;
}

/** Rotate v about unit axis k by (cos, sin) via Rodrigues' formula. */
function rodrigues(v: Vec3, k: Vec3, cos: number, sin: number): Vec3 {
  return add(add(scale(v, cos), scale(cross(k, v), sin)), scale(k, dot(k, v) * (1 - cos)));
}

/**
 * Parallel-transport frames along the path so the profile doesn't twist: the
 * initial normal is seeded from a reference up, then rotated minimally to
 * follow each tangent change.
 */
function transportFrames(tangents: Vec3[]): Array<{ n: Vec3; b: Vec3 }> {
  const frames: Array<{ n: Vec3; b: Vec3 }> = [];
  const t0 = tangents[0];
  const up: Vec3 = Math.abs(dot(t0, { x: 0, y: 0, z: 1 })) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  let n = normalize(sub(up, scale(t0, dot(up, t0))));
  let b = cross(t0, n);
  frames.push({ n, b });
  for (let i = 1; i < tangents.length; i++) {
    const axis = cross(tangents[i - 1], tangents[i]);
    const al = lengthOf(axis);
    if (al < 1e-9) {
      frames.push({ n, b });
      continue;
    }
    const k = scale(axis, 1 / al);
    const cos = Math.max(-1, Math.min(1, dot(tangents[i - 1], tangents[i])));
    n = normalize(rodrigues(n, k, cos, al)); // |axis| == sin for unit tangents
    b = cross(tangents[i], n);
    frames.push({ n, b });
  }
  return frames;
}

function dedupePath(path: ReadonlyArray<{ x: number; y: number; z: number }>): Vec3[] {
  const out: Vec3[] = [];
  for (const p of path) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y, prev.z - p.z) < 1e-9) continue;
    out.push({ x: p.x, y: p.y, z: p.z });
  }
  return out;
}

/**
 * Sweep a closed 2D profile along a 3D polyline path, keeping the profile
 * plane perpendicular to the path tangent (parallel-transport frames avoid
 * twist). End caps close the swept tube. Shared by `sweep` and `sweep_path`.
 */
function sweepAlongPath(
  profile2d: ReadonlyArray<{ x: number; y: number }>,
  path3d: ReadonlyArray<{ x: number; y: number; z: number }>,
): Polyhedron {
  const profile = dedupeLoop(profile2d);
  if (profile.length < 3) {
    throw new Error(`featureMesh: sweep profile needs ≥ 3 distinct points, got ${profile.length}`);
  }
  const path = dedupePath(path3d);
  if (path.length < 2) {
    throw new Error(`featureMesh: sweep path needs ≥ 2 distinct points, got ${path.length}`);
  }
  const frames = transportFrames(pathTangents(path));
  const m = profile.length;

  const vertices: Vec3[] = [];
  for (let si = 0; si < path.length; si++) {
    const s = path[si];
    const f = frames[si];
    for (const p of profile) {
      vertices.push(add(add({ x: s.x, y: s.y, z: s.z }, scale(f.n, p.x)), scale(f.b, p.y)));
    }
  }
  const idx = (pi: number, si: number): number => si * m + pi;
  const centroid = polyCentroid(vertices);
  const faces: PolyFace[] = [];
  for (let si = 0; si < path.length - 1; si++) {
    for (let pi = 0; pi < m; pi++) {
      const pin = (pi + 1) % m;
      faces.push(orientedFace([idx(pi, si), idx(pin, si), idx(pin, si + 1), idx(pi, si + 1)], vertices, centroid));
    }
  }
  // End caps.
  faces.push(orientedFace([...Array(m).keys()].map((pi) => idx(pi, 0)), vertices, centroid));
  faces.push(orientedFace([...Array(m).keys()].map((pi) => idx(pi, path.length - 1)), vertices, centroid));
  return { vertices, faces };
}

/** Mesh a sweep feature (profile.points swept along path). */
export function sweepPolyhedron(feature: SweepFeature): Polyhedron {
  return sweepAlongPath(feature.profile.points, feature.path);
}

/** Mesh a sweep-along-path feature. */
export function sweepPathPolyhedron(feature: SweepPathFeature): Polyhedron {
  return sweepAlongPath(feature.profile, feature.path);
}

// ─── loft → stacked sections ──────────────────────────────────────────────

/**
 * Mesh a loft: 2+ profile sections stacked along z, connected section-to-
 * section by side quads + end caps. v1 requires all sections to share the
 * same point count (corresponding-vertex lofting); mismatched counts throw
 * (resampling lands in a later phase).
 */
export function loftPolyhedron(feature: LoftFeature): Polyhedron {
  const sections = feature.sections;
  if (sections.length < 2) {
    throw new Error(`featureMesh: loft needs ≥ 2 sections, got ${sections.length}`);
  }
  const n = sections[0].profile.points.length;
  if (n < 3) {
    throw new Error(`featureMesh: loft section needs ≥ 3 points, got ${n}`);
  }
  for (const s of sections) {
    if (s.profile.points.length !== n) {
      throw new Error('featureMesh: all loft sections must share the same point count (v1)');
    }
  }

  const vertices: Vec3[] = [];
  for (const s of sections) {
    for (const p of s.profile.points) vertices.push({ x: p.x, y: p.y, z: s.z });
  }
  const idx = (pi: number, si: number): number => si * n + pi;
  const centroid = polyCentroid(vertices);
  const faces: PolyFace[] = [];
  for (let si = 0; si < sections.length - 1; si++) {
    for (let pi = 0; pi < n; pi++) {
      const pin = (pi + 1) % n;
      faces.push(orientedFace([idx(pi, si), idx(pin, si), idx(pin, si + 1), idx(pi, si + 1)], vertices, centroid));
    }
  }
  // End caps (first + last section).
  faces.push(orientedFace([...Array(n).keys()].map((pi) => idx(pi, 0)), vertices, centroid));
  faces.push(orientedFace([...Array(n).keys()].map((pi) => idx(pi, sections.length - 1)), vertices, centroid));
  return { vertices, faces };
}

// ─── dispatcher ────────────────────────────────────────────────────────────

/** Feature kinds featureToPolyhedron can currently mesh. */
export type MeshableFeature =
  | ExtrudeFeature
  | RevolveFeature
  | SweepFeature
  | SweepPathFeature
  | LoftFeature;

/**
 * Convert a feature to a polyhedron, or null when the kind is not meshable
 * (e.g. fillet / chamfer / hole / pattern, which transform other bodies).
 * Callers that need a hard failure can check for null.
 */
export function featureToPolyhedron(feature: { kind: string }): Polyhedron | null {
  switch (feature.kind) {
    case 'extrude':
      return extrudePolyhedron(feature as ExtrudeFeature);
    case 'revolve':
      return revolvePolyhedron(feature as RevolveFeature);
    case 'sweep':
      return sweepPolyhedron(feature as SweepFeature);
    case 'sweep_path':
      return sweepPathPolyhedron(feature as SweepPathFeature);
    case 'loft':
      return loftPolyhedron(feature as LoftFeature);
    default:
      return null;
  }
}

// ─── derived edges ──────────────────────────────────────────────────────────

/**
 * Unique undirected edges of a polyhedron with their adjacent face indices.
 * Edge key is `min-max` of the endpoint indices.
 */
export function polyhedronEdges(poly: Polyhedron): PolyEdge[] {
  const map = new Map<string, PolyEdge>();
  poly.faces.forEach((face, fi) => {
    const vs = face.vertices;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}-${hi}`;
      const existing = map.get(key);
      if (existing) {
        if (!existing.faces.includes(fi)) existing.faces.push(fi);
      } else {
        map.set(key, { a: lo, b: hi, faces: [fi] });
      }
    }
  });
  return [...map.values()];
}

// ─── helpers ─────────────────────────────────────────────────────────────

function dedupeLoop(loop: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const EPS = 1e-9;
  for (const p of loop) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < EPS && Math.abs(prev.y - p.y) < EPS) continue;
    out.push({ x: p.x, y: p.y });
  }
  // Drop a closing duplicate (last == first).
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f.x - l.x) < EPS && Math.abs(f.y - l.y) < EPS) out.pop();
  }
  return out;
}

function polyCentroid(vertices: Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const v of vertices) {
    x += v.x; y += v.y; z += v.z;
  }
  const n = vertices.length || 1;
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Build a face from a vertex-index loop, computing the outward normal via the
 * first non-degenerate corner and flipping it (plus reversing the loop) if it
 * points toward the solid centroid.
 */
function orientedFace(loopIdx: number[], vertices: Vec3[], centroid: Vec3): PolyFace {
  const normal = faceNormal(loopIdx, vertices);
  // Vector from a point on the face to the centroid.
  const p0 = vertices[loopIdx[0]];
  const toCentroid = sub(centroid, p0);
  if (dot(normal, toCentroid) > 0) {
    // Normal points inward → flip normal + reverse winding.
    return { vertices: [...loopIdx].reverse(), normal: scale(normal, -1) };
  }
  return { vertices: loopIdx, normal };
}

/** Newell's method — robust face normal for a (possibly non-planar) loop. */
function faceNormal(loopIdx: number[], vertices: Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < loopIdx.length; i++) {
    const cur = vertices[loopIdx[i]];
    const nxt = vertices[loopIdx[(i + 1) % loopIdx.length]];
    nx += (cur.y - nxt.y) * (cur.z + nxt.z);
    ny += (cur.z - nxt.z) * (cur.x + nxt.x);
    nz += (cur.x - nxt.x) * (cur.y + nxt.y);
  }
  const n = { x: nx, y: ny, z: nz };
  const len = lengthOf(n);
  if (len < 1e-12) {
    // Fallback: cross of first two edges.
    const a = vertices[loopIdx[0]];
    const b = vertices[loopIdx[1]];
    const c = vertices[loopIdx[2]];
    const c2 = cross(sub(b, a), sub(c, a));
    const l2 = lengthOf(c2);
    return l2 < 1e-12 ? { x: 0, y: 0, z: 1 } : scale(c2, 1 / l2);
  }
  return scale(n, 1 / len);
}
