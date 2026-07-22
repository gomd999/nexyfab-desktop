/**
 * meshAnalysis.ts — deterministic triangle-mesh measurement for the reconstruction gate.
 *
 * The reference gate (참고파일들/result/tools/gate.py) renders generated OpenSCAD with the
 * OpenSCAD binary and measures the resulting STL with trimesh (bbox / volume / watertight /
 * euler → genus). That path needs a native binary and Python. This module reproduces the same
 * measurements in pure TypeScript from a triangle mesh, so the gate is self-contained and
 * testable in vitest without OpenSCAD installed.
 *
 * A candidate reconstruction reaches the gate as a mesh:
 *   - SCAD output   → render to STL (existing openscad-render) → parseStl() → mesh
 *   - intent output → tessellate (scripts/drawing-to-3d/render-preview.mjs) → mesh
 *
 * All measurements are topological/metric only — no orientation assumptions — so a mesh with
 * inconsistent winding is still measured correctly as long as it is closed.
 */

export type Vec3 = [number, number, number];

/** Indexed triangle mesh. `faces` index into `verts`. */
export interface IndexedMesh {
  verts: Vec3[];
  faces: [number, number, number][];
}

/** Triangle soup (each triangle carries its own 3 points; verts may be duplicated). */
export type TriangleSoup = Vec3[][];

export interface MeshMeasurement {
  ok: boolean;
  error: string | null;
  /** Axis-aligned bounding box size [x,y,z]. */
  extents: Vec3 | null;
  bboxMin: Vec3 | null;
  bboxMax: Vec3 | null;
  /** Absolute enclosed volume (only trustworthy when watertight). */
  volume: number | null;
  area: number | null;
  triangles: number;
  vertices: number;
  edges: number;
  /** Every undirected edge is shared by exactly two triangles. */
  watertight: boolean;
  /** True if any edge is shared by >2 triangles (topologically broken). */
  nonManifold: boolean;
  eulerNumber: number | null;
  /** Number of through-holes/handles. Only meaningful when watertight. */
  genus: number | null;
  /** Number of disconnected solid bodies. */
  bodyCount: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function trianglesToIndexed(tris: TriangleSoup, weldTol?: number): IndexedMesh {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const p of t) {
      for (let i = 0; i < 3; i++) {
        if (p[i] < lo[i]) lo[i] = p[i];
        if (p[i] > hi[i]) hi[i] = p[i];
      }
    }
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const tol = weldTol ?? diag * 1e-7;
  const q = tol > 0 ? tol : 1e-9;
  const key = (p: Vec3) => `${Math.round(p[0] / q)},${Math.round(p[1] / q)},${Math.round(p[2] / q)}`;
  const index = new Map<string, number>();
  const verts: Vec3[] = [];
  const idOf = (p: Vec3): number => {
    const k = key(p);
    let id = index.get(k);
    if (id === undefined) {
      id = verts.length;
      verts.push(p);
      index.set(k, id);
    }
    return id;
  };
  const faces: [number, number, number][] = [];
  for (const t of tris) {
    if (t.length < 3) continue;
    const a = idOf(t[0]);
    const b = idOf(t[1]);
    const c = idOf(t[2]);
    if (a === b || b === c || a === c) continue; // drop degenerate
    faces.push([a, b, c]);
  }
  return { verts, faces };
}

/** Union-find over triangles connected by shared edges → number of solid bodies. */
function countBodies(faceCount: number, edgeFaces: Map<string, number[]>): number {
  const parent = Array.from({ length: faceCount }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const fs of edgeFaces.values()) {
    for (let i = 1; i < fs.length; i++) union(fs[0], fs[i]);
  }
  const roots = new Set<number>();
  for (let i = 0; i < faceCount; i++) roots.add(find(i));
  return roots.size || (faceCount ? 1 : 0);
}

export function analyzeIndexed(mesh: IndexedMesh): MeshMeasurement {
  const out: MeshMeasurement = {
    ok: false,
    error: null,
    extents: null,
    bboxMin: null,
    bboxMax: null,
    volume: null,
    area: null,
    triangles: mesh.faces.length,
    vertices: mesh.verts.length,
    edges: 0,
    watertight: false,
    nonManifold: false,
    eulerNumber: null,
    genus: null,
    bodyCount: 0,
  };
  if (!mesh.faces.length || !mesh.verts.length) {
    out.error = 'empty mesh (no faces/verts)';
    return out;
  }

  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.verts) {
    for (let i = 0; i < 3; i++) {
      if (v[i] < lo[i]) lo[i] = v[i];
      if (v[i] > hi[i]) hi[i] = v[i];
    }
  }
  let vol6 = 0;
  let area2 = 0;
  const edgeFaces = new Map<string, number[]>();
  const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  mesh.faces.forEach((f, fi) => {
    const a = mesh.verts[f[0]];
    const b = mesh.verts[f[1]];
    const c = mesh.verts[f[2]];
    vol6 += dot(a, cross(b, c));
    area2 += Math.hypot(...cross(sub(b, a), sub(c, a)));
    const pairs: [number, number][] = [
      [f[0], f[1]],
      [f[1], f[2]],
      [f[2], f[0]],
    ];
    for (const [x, y] of pairs) {
      const k = ek(x, y);
      const arr = edgeFaces.get(k);
      if (arr) arr.push(fi);
      else edgeFaces.set(k, [fi]);
    }
  });

  out.bboxMin = lo;
  out.bboxMax = hi;
  out.extents = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  out.area = area2 / 2;
  out.edges = edgeFaces.size;

  let boundary = 0;
  let over = 0;
  for (const arr of edgeFaces.values()) {
    if (arr.length === 1) boundary++;
    else if (arr.length > 2) over++;
  }
  out.nonManifold = over > 0;
  out.watertight = boundary === 0 && over === 0;

  const V = mesh.verts.length;
  const E = edgeFaces.size;
  const F = mesh.faces.length;
  out.eulerNumber = V - E + F;
  out.bodyCount = countBodies(F, edgeFaces);

  if (out.watertight) {
    out.volume = Math.abs(vol6) / 6;
    // Closed orientable surface: euler = 2*bodies - 2*genus → genus = (2*bodies - euler)/2
    out.genus = Math.round((2 * out.bodyCount - out.eulerNumber) / 2);
  }
  out.ok = true;
  return out;
}

export function analyzeTriangles(tris: TriangleSoup): MeshMeasurement {
  return analyzeIndexed(trianglesToIndexed(tris));
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic watertight primitives — used to build controlled candidate meshes
// (good / axis-flipped / hole-missing) for wiring and tests.
// ─────────────────────────────────────────────────────────────────────────────

/** Solid axis-aligned box at the origin. Closed, genus 0. */
export function solidBox(w: number, d: number, h: number): IndexedMesh {
  const v: Vec3[] = [
    [0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0],
    [0, 0, h], [w, 0, h], [w, d, h], [0, d, h],
  ];
  const quads: [number, number, number, number][] = [
    [0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0],
  ];
  const faces: [number, number, number][] = [];
  for (const [a, b, c, e] of quads) faces.push([a, b, c], [a, c, e]);
  return { verts: v, faces };
}

/**
 * Box with a rectangular through-hole along Z. Topologically a torus → genus 1, watertight.
 * Genus is a topological count of through-holes; a rectangular hole demonstrates a genus-1
 * feature exactly as a cylindrical bore would, so the gate's hole↔genus check is exercised
 * without needing a curved-surface tessellator.
 */
export function frameBox(
  w: number,
  d: number,
  h: number,
  hole: { w: number; d: number },
): IndexedMesh {
  const x0 = (w - hole.w) / 2;
  const x1 = x0 + hole.w;
  const y0 = (d - hole.d) / 2;
  const y1 = y0 + hole.d;
  // O0..3 bottom outer, I0..3 bottom inner, O4..7 top outer, I4..7 top inner
  const v: Vec3[] = [
    [0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0],
    [x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0],
    [0, 0, h], [w, 0, h], [w, d, h], [0, d, h],
    [x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h],
  ];
  const O = [0, 1, 2, 3];
  const I = [4, 5, 6, 7];
  const Ot = [8, 9, 10, 11];
  const It = [12, 13, 14, 15];
  const faces: [number, number, number][] = [];
  const quad = (a: number, b: number, c: number, e: number) => faces.push([a, b, c], [a, c, e]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(O[i], O[j], I[j], I[i]); // bottom annulus strip
    quad(Ot[i], It[i], It[j], Ot[j]); // top annulus strip
    quad(O[i], Ot[i], Ot[j], O[j]); // outer wall
    quad(I[i], I[j], It[j], It[i]); // inner wall (hole surface)
  }
  return { verts: v, faces };
}
