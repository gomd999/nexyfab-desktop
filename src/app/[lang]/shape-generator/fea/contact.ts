/**
 * contact.ts — frictionless node-to-rigid-plane unilateral (Signorini) contact on
 * the HEX8 elastic grid, solved by an ACTIVE-SET method.
 *
 *   gap:        g_i = u_i·n − gap0_i ≤ 0      (no penetration of the rigid wall)
 *   pressure:   p_i ≥ 0                        (contact only pushes, never pulls)
 *   complementarity:  p_i · g_i = 0           (pressure only where in contact)
 *
 * The active set (nodes touching the wall) is found by iteration: solve with the
 * active nodes clamped to the wall, then activate any penetrating node and release
 * any active node whose reaction turns tensile, until the set is consistent.
 *
 * Verified against the analytic spring-against-a-wall: below the gap the wall
 * reacts with zero; once closed the contact displacement clamps at the gap and the
 * wall carries F − k·δ.
 */
import { TopologyGrid, buildHex8K0 } from '../analysis/topology3D';

export interface ContactOptions {
  E: number; nu: number; cell: number;
  /** Support DOFs (node*3+axis → prescribed displacement). */
  fixed: Map<number, number>;
  /** External nodal loads (node*3+axis → force). */
  load?: Map<number, number>;
  /** Candidate contact nodes (on the contacting surface). */
  contactNodes: number[];
  /** Wall normal axis (0=x,1=y,2=z); the wall blocks motion in +normal. */
  normalAxis: 0 | 1 | 2;
  /** Allowed normal displacement before the node hits the wall (gap0). */
  gap: number;
  maxActiveIters?: number;
}

export interface ContactResult {
  displacement: Float64Array;       // full DOF vector
  /** Normal contact reaction per contact node (≤ 0 means the wall pushes back). */
  reactions: Map<number, number>;
  /** Node ids currently in contact. */
  activeSet: number[];
  iterations: number;
}

/**
 * Consistent nodal forces for a uniform traction of resultant `total` on a grid
 * face, applied along `loadAxis`. Distributes by the bilinear-quad tributary areas
 * (corner:edge:centre = 1:2:4), so a uniform-stress field is reproduced exactly.
 */
export function consistentFaceLoad(grid: TopologyGrid, axis: 'x' | 'y' | 'z', atMax: boolean, total: number, loadAxis: 0 | 1 | 2): Map<number, number> {
  const n = axis === 'x' ? grid.nx : axis === 'y' ? grid.ny : grid.nz;
  const at = atMax ? n : 0;
  const quads: number[][] = [];
  if (axis === 'x') for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++)
    quads.push([grid.node(at, ey, ez), grid.node(at, ey + 1, ez), grid.node(at, ey + 1, ez + 1), grid.node(at, ey, ez + 1)]);
  else if (axis === 'y') for (let ez = 0; ez < grid.nz; ez++) for (let ex = 0; ex < grid.nx; ex++)
    quads.push([grid.node(ex, at, ez), grid.node(ex + 1, at, ez), grid.node(ex + 1, at, ez + 1), grid.node(ex, at, ez + 1)]);
  else for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++)
    quads.push([grid.node(ex, ey, at), grid.node(ex + 1, ey, at), grid.node(ex + 1, ey + 1, at), grid.node(ex, ey + 1, at)]);
  const weight = new Map<number, number>();
  for (const q of quads) for (const nd of q) weight.set(nd, (weight.get(nd) ?? 0) + 0.25);
  let sum = 0; for (const w of weight.values()) sum += w;
  const load = new Map<number, number>();
  for (const [nd, w] of weight) load.set(nd * 3 + loadAxis, (total * w) / sum);
  return load;
}

/** Dense elastic stiffness (nDof × nDof) of the uniform solid grid. */
function buildElasticK(grid: TopologyGrid, E: number, nu: number, h: number): Float64Array {
  const K0 = buildHex8K0(nu);
  const kScale = E * h;
  const nDof = grid.nNodes * 3;
  const K = new Float64Array(nDof * nDof);
  const edof = new Int32Array(24);
  for (let ez = 0; ez < grid.nz; ez++) for (let ey = 0; ey < grid.ny; ey++) for (let ex = 0; ex < grid.nx; ex++) {
    const ns = grid.elemNodes(ex, ey, ez);
    for (let i = 0; i < 8; i++) { edof[i * 3] = ns[i] * 3; edof[i * 3 + 1] = ns[i] * 3 + 1; edof[i * 3 + 2] = ns[i] * 3 + 2; }
    for (let i = 0; i < 24; i++) { const di = edof[i], row = di * nDof, k0row = i * 24; for (let j = 0; j < 24; j++) K[row + edof[j]] += kScale * K0[k0row + j]; }
  }
  return K;
}

function cgSolveReduced(K: Float64Array, f: Float64Array, nDof: number, fixedMap: Map<number, number>): Float64Array {
  const isFixed = new Uint8Array(nDof);
  for (const d of fixedMap.keys()) isFixed[d] = 1;
  const freeIdx = new Int32Array(nDof).fill(-1);
  let nFree = 0;
  for (let d = 0; d < nDof; d++) if (!isFixed[d]) freeIdx[d] = nFree++;
  // reduced RHS: f_free − K_fp·u_p
  const b = new Float64Array(nFree);
  for (let d = 0; d < nDof; d++) {
    const r = freeIdx[d]; if (r < 0) continue;
    let s = f[d];
    const row = d * nDof;
    for (const [pd, pv] of fixedMap) s -= K[row + pd] * pv;
    b[r] = s;
  }
  // reduced matvec
  const cols: Int32Array[] = [], vals: Float64Array[] = [];
  for (let d = 0; d < nDof; d++) {
    if (freeIdx[d] < 0) continue;
    const row = d * nDof; const c: number[] = [], v: number[] = [];
    for (let e = 0; e < nDof; e++) { const re = freeIdx[e]; if (re >= 0 && K[row + e] !== 0) { c.push(re); v.push(K[row + e]); } }
    cols.push(Int32Array.from(c)); vals.push(Float64Array.from(v));
  }
  const matvec = (x: Float64Array, out: Float64Array) => { for (let i = 0; i < nFree; i++) { const c = cols[i], vv = vals[i]; let s = 0; for (let j = 0; j < c.length; j++) s += vv[j] * x[c[j]]; out[i] = s; } };
  // PCG
  const x = new Float64Array(nFree), r = Float64Array.from(b), Ap = new Float64Array(nFree);
  const diag = new Float64Array(nFree);
  for (let i = 0; i < nFree; i++) { const c = cols[i], vv = vals[i]; for (let j = 0; j < c.length; j++) if (c[j] === i) diag[i] = vv[j]; }
  const z = new Float64Array(nFree); for (let i = 0; i < nFree; i++) z[i] = r[i] / (diag[i] || 1);
  const p = Float64Array.from(z);
  const dot = (u: Float64Array, w: Float64Array) => { let s = 0; for (let i = 0; i < nFree; i++) s += u[i] * w[i]; return s; };
  let rz = dot(r, z); const b2 = Math.max(dot(b, b), 1e-300);
  for (let it = 0; it < Math.max(400, nFree * 2); it++) {
    matvec(p, Ap);
    const alpha = rz / (dot(p, Ap) || 1e-300);
    for (let i = 0; i < nFree; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    if (dot(r, r) / b2 < 1e-22) break;
    for (let i = 0; i < nFree; i++) z[i] = r[i] / (diag[i] || 1);
    const rzNew = dot(r, z); const beta = rzNew / (rz || 1e-300);
    for (let i = 0; i < nFree; i++) p[i] = z[i] + beta * p[i]; rz = rzNew;
  }
  const u = new Float64Array(nDof);
  for (const [d, val] of fixedMap) u[d] = val;
  for (let d = 0; d < nDof; d++) { const r2 = freeIdx[d]; if (r2 >= 0) u[d] = x[r2]; }
  return u;
}

/** Solve frictionless node-to-rigid-wall contact by active-set iteration. */
export function hex8RigidContact(grid: TopologyGrid, opts: ContactOptions): ContactResult {
  const nDof = grid.nNodes * 3;
  const K = buildElasticK(grid, opts.E, opts.nu, opts.cell);
  const f = new Float64Array(nDof);
  if (opts.load) for (const [d, v] of opts.load) f[d] += v;
  const axis = opts.normalAxis, gap = opts.gap;
  const reactionDof = (nd: number) => nd * 3 + axis;
  const reactionOf = (u: Float64Array, d: number) => { const row = d * nDof; let s = 0; for (let e = 0; e < nDof; e++) s += K[row + e] * u[e]; return s - f[d]; };

  const active = new Set<number>();
  const maxIt = opts.maxActiveIters ?? 30;
  let u: Float64Array = new Float64Array(nDof);
  let iterations = 0;
  for (let it = 0; it < maxIt; it++) {
    iterations = it + 1;
    const fixedMap = new Map(opts.fixed);
    for (const nd of active) fixedMap.set(reactionDof(nd), gap);  // clamp to wall
    u = cgSolveReduced(K, f, nDof, fixedMap);

    let changed = false;
    // activate penetrating nodes
    for (const nd of opts.contactNodes) {
      if (active.has(nd)) continue;
      if (u[reactionDof(nd)] > gap + 1e-9) { active.add(nd); changed = true; }
    }
    // release nodes whose contact reaction turns tensile (wall would have to pull).
    for (const nd of [...active]) {
      const R = reactionOf(u, reactionDof(nd));
      if (R > 1e-6) { active.delete(nd); changed = true; }   // R>0 ⇒ wall pulling ⇒ invalid
    }
    if (!changed) break;
  }

  const reactions = new Map<number, number>();
  for (const nd of active) reactions.set(nd, reactionOf(u, reactionDof(nd)));
  return { displacement: u, reactions, activeSet: [...active], iterations };
}
