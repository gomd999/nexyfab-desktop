/**
 * splitByComponent — split a triangle-soup geometry (e.g. an imported STL that
 * actually contains several disconnected bodies) into its connected shells.
 *
 * STL carries no part structure — it's a bag of triangles. But a multi-part
 * STL has triangles that form spatially disjoint shells. We weld vertices by
 * rounded position (so coincident triangle corners share an id), union-find
 * over the welded graph, then emit one non-indexed BufferGeometry per
 * component, preserving position + normal.
 *
 * Pure + headless-testable. This is the foundation for turning a multi-body
 * import into separate assembly parts (each becomes a PlacedPart).
 */
import * as THREE from 'three';

const WELD = 1e4; // round to 1e-4 mm when welding coincident vertices

interface UF {
  ensure: (v: number) => void;
  find: (x: number) => number;
  union: (a: number, b: number) => void;
}

function makeUF(): UF {
  const parent: number[] = [];
  const ensure = (v: number) => { while (parent.length <= v) parent.push(parent.length); };
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[x] !== r) { const n = parent[x]!; parent[x] = r; x = n; }
    return r;
  };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  return { ensure, find, union };
}

/**
 * Split `geo` into its connected components. Returns one geometry per disjoint
 * shell (each non-indexed, with position + normal). A single solid → a
 * one-element array containing an equivalent geometry. Order is deterministic
 * (by first-triangle appearance). Components smaller than `minTriangles` are
 * dropped as noise.
 */
export function splitGeometryByConnectedComponent(
  geo: THREE.BufferGeometry,
  minTriangles = 1,
): THREE.BufferGeometry[] {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return [];
  const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const idx = geo.index ? Array.from(geo.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
  const triCount = Math.floor(idx.length / 3);

  // Weld coincident vertices into canonical ids.
  const vid = new Map<string, number>();
  const canon = (i: number) => {
    const k = `${Math.round(pos.getX(i) * WELD)},${Math.round(pos.getY(i) * WELD)},${Math.round(pos.getZ(i) * WELD)}`;
    let v = vid.get(k);
    if (v === undefined) { v = vid.size; vid.set(k, v); }
    return v;
  };

  const uf = makeUF();
  const triCanon: [number, number, number][] = [];
  for (let t = 0; t < triCount; t++) {
    const a = canon(idx[t * 3]!), b = canon(idx[t * 3 + 1]!), c = canon(idx[t * 3 + 2]!);
    uf.ensure(a); uf.ensure(b); uf.ensure(c);
    uf.union(a, b); uf.union(b, c);
    triCanon.push([a, b, c]);
  }

  // Group triangle INDICES by component root, preserving first-seen order.
  const groupOf = new Map<number, number>(); // root → group index
  const groups: number[][] = [];             // group index → triangle indices
  for (let t = 0; t < triCount; t++) {
    const root = uf.find(triCanon[t]![0]);
    let g = groupOf.get(root);
    if (g === undefined) { g = groups.length; groupOf.set(root, g); groups.push([]); }
    groups[g]!.push(t);
  }

  // Emit one non-indexed geometry per group (drop tiny noise shells).
  const out: THREE.BufferGeometry[] = [];
  for (const tris of groups) {
    if (tris.length < minTriangles) continue;
    const p = new Float32Array(tris.length * 9);
    const n = nrm ? new Float32Array(tris.length * 9) : null;
    let o = 0;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const vi = idx[t * 3 + k]!;
        p[o] = pos.getX(vi); p[o + 1] = pos.getY(vi); p[o + 2] = pos.getZ(vi);
        if (n && nrm) { n[o] = nrm.getX(vi); n[o + 1] = nrm.getY(vi); n[o + 2] = nrm.getZ(vi); }
        o += 3;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    if (n) g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    else g.computeVertexNormals();
    g.computeBoundingBox();
    out.push(g);
  }
  return out;
}

/** Count of connected shells without materialising the split geometries. */
export function connectedComponentCount(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return 0;
  const idx = geo.index ? Array.from(geo.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
  const vid = new Map<string, number>();
  const canon = (i: number) => {
    const k = `${Math.round(pos.getX(i) * WELD)},${Math.round(pos.getY(i) * WELD)},${Math.round(pos.getZ(i) * WELD)}`;
    let v = vid.get(k);
    if (v === undefined) { v = vid.size; vid.set(k, v); }
    return v;
  };
  const uf = makeUF();
  const seen = new Set<number>();
  for (let t = 0; t < idx.length / 3; t++) {
    const a = canon(idx[t * 3]!), b = canon(idx[t * 3 + 1]!), c = canon(idx[t * 3 + 2]!);
    uf.ensure(a); uf.ensure(b); uf.ensure(c);
    seen.add(a); seen.add(b); seen.add(c);
    uf.union(a, b); uf.union(b, c);
  }
  const roots = new Set<number>();
  for (const v of seen) roots.add(uf.find(v));
  return roots.size;
}
