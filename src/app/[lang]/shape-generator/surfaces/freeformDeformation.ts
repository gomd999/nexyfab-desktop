/**
 * freeformDeformation.ts — Direct NURBS control-point manipulation +
 * Free-Form Deformation (FFD) lattice.
 *
 * SolidWorks "Freeform" lets you drag NURBS control points to sculpt
 * a surface, with falloff weights so neighbouring points move smoothly.
 * "Deform" lets you embed a part inside a lattice cage and warp the
 * whole part by moving cage nodes.
 *
 * Two algorithms shipped:
 *
 *   - **Control-point push-pull** — pick N control points, drag them
 *     along a direction by Δ. Smooth falloff around each picked
 *     point (Gaussian or polynomial).
 *   - **Free-Form Deformation** (Sederberg & Parry 1986) — embed the
 *     part in a parametric lattice cage; deform the part by moving
 *     cage points. The part follows via trivariate Bernstein basis.
 */

export type Vec3 = [number, number, number];

// ── NURBS control-point push-pull ───────────────────────────────

export interface NurbsSurfaceGrid {
  /** Control points as flat (nU × nV × 3) array. */
  controlPoints: number[];
  /** Grid dimensions. */
  nU: number;
  nV: number;
}

export type FalloffShape = 'gaussian' | 'cubic' | 'linear' | 'sharp';

export interface PushPullSpec {
  /** Picked control point grid indices (i, j). */
  picked: Array<{ i: number; j: number }>;
  /** Drag direction (world coords). */
  direction: Vec3;
  /** Drag magnitude (mm). */
  amount: number;
  /** Falloff radius — distance (in grid steps) within which neighbour
   *  points are also displaced. */
  falloffRadius: number;
  /** Falloff shape. */
  falloff: FalloffShape;
}

function applyFalloff(distance: number, radius: number, shape: FalloffShape): number {
  if (radius <= 0) return distance === 0 ? 1 : 0;
  const t = Math.min(1, distance / radius);
  switch (shape) {
    case 'gaussian': return Math.exp(-3 * t * t);
    case 'cubic': return 1 - (3 * t * t - 2 * t * t * t);
    case 'linear': return 1 - t;
    case 'sharp': return distance === 0 ? 1 : 0;
  }
}

/** Apply control-point push-pull to a NURBS grid. Returns a *new*
 *  grid with displaced control points. */
export function pushPullControlPoints(surface: NurbsSurfaceGrid, spec: PushPullSpec): NurbsSurfaceGrid {
  const cps = surface.controlPoints.slice();
  const { nU, nV } = surface;
  for (let j = 0; j < nV; j++) {
    for (let i = 0; i < nU; i++) {
      // Find minimum distance to any picked point.
      let minDist = Infinity;
      for (const pick of spec.picked) {
        const d = Math.hypot(i - pick.i, j - pick.j);
        if (d < minDist) minDist = d;
      }
      const w = applyFalloff(minDist, spec.falloffRadius, spec.falloff);
      const idx = (j * nU + i) * 3;
      cps[idx]     += spec.direction[0] * spec.amount * w;
      cps[idx + 1] += spec.direction[1] * spec.amount * w;
      cps[idx + 2] += spec.direction[2] * spec.amount * w;
    }
  }
  return { ...surface, controlPoints: cps };
}

/** Compute the total displacement applied to each control point — useful
 *  for visualizing "what changed". */
export function controlPointDisplacements(before: NurbsSurfaceGrid, after: NurbsSurfaceGrid): number[] {
  const out: number[] = [];
  const n = Math.min(before.controlPoints.length, after.controlPoints.length) / 3;
  for (let i = 0; i < n; i++) {
    const dx = after.controlPoints[i * 3]! - before.controlPoints[i * 3]!;
    const dy = after.controlPoints[i * 3 + 1]! - before.controlPoints[i * 3 + 1]!;
    const dz = after.controlPoints[i * 3 + 2]! - before.controlPoints[i * 3 + 2]!;
    out.push(Math.hypot(dx, dy, dz));
  }
  return out;
}

// ── Free-Form Deformation (FFD) ─────────────────────────────────

export interface FfdLattice {
  /** Number of control points along each axis (typ 3 or 4). */
  nU: number;
  nV: number;
  nW: number;
  /** Flat (nU × nV × nW × 3) control-point array. */
  controlPoints: number[];
  /** Lattice axes — local coordinate system. */
  origin: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  wAxis: Vec3;
}

/** Bernstein basis B_{n,k}(t). */
function bernstein(n: number, k: number, t: number): number {
  let binomial = 1;
  for (let i = 0; i < k; i++) binomial = binomial * (n - i) / (i + 1);
  return binomial * Math.pow(t, k) * Math.pow(1 - t, n - k);
}

/** Build an initial undeformed lattice that bounds the given points. */
export function buildLattice(points: Vec3[], nU: number, nV: number, nW: number): FfdLattice {
  if (points.length === 0) {
    return {
      nU, nV, nW, controlPoints: new Array(nU * nV * nW * 3).fill(0),
      origin: [0, 0, 0], uAxis: [1, 0, 0], vAxis: [0, 1, 0], wAxis: [0, 0, 1],
    };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] > maxZ) maxZ = p[2];
  }
  const origin: Vec3 = [minX, minY, minZ];
  const uAxis: Vec3 = [maxX - minX, 0, 0];
  const vAxis: Vec3 = [0, maxY - minY, 0];
  const wAxis: Vec3 = [0, 0, maxZ - minZ];
  const cps: number[] = [];
  for (let k = 0; k < nW; k++) {
    for (let j = 0; j < nV; j++) {
      for (let i = 0; i < nU; i++) {
        const u = nU > 1 ? i / (nU - 1) : 0;
        const v = nV > 1 ? j / (nV - 1) : 0;
        const w = nW > 1 ? k / (nW - 1) : 0;
        cps.push(
          origin[0] + uAxis[0] * u + vAxis[0] * v + wAxis[0] * w,
          origin[1] + uAxis[1] * u + vAxis[1] * v + wAxis[1] * w,
          origin[2] + uAxis[2] * u + vAxis[2] * v + wAxis[2] * w,
        );
      }
    }
  }
  return { nU, nV, nW, controlPoints: cps, origin, uAxis, vAxis, wAxis };
}

/** Convert world point → local lattice (u, v, w) ∈ [0,1]³. */
function pointToLatticeLocal(p: Vec3, lattice: FfdLattice): { u: number; v: number; w: number } {
  const dx = p[0] - lattice.origin[0];
  const dy = p[1] - lattice.origin[1];
  const dz = p[2] - lattice.origin[2];
  // Project onto each axis.
  const uLen = Math.hypot(lattice.uAxis[0], lattice.uAxis[1], lattice.uAxis[2]) || 1;
  const vLen = Math.hypot(lattice.vAxis[0], lattice.vAxis[1], lattice.vAxis[2]) || 1;
  const wLen = Math.hypot(lattice.wAxis[0], lattice.wAxis[1], lattice.wAxis[2]) || 1;
  const u = (dx * lattice.uAxis[0] + dy * lattice.uAxis[1] + dz * lattice.uAxis[2]) / (uLen * uLen);
  const v = (dx * lattice.vAxis[0] + dy * lattice.vAxis[1] + dz * lattice.vAxis[2]) / (vLen * vLen);
  const w = (dx * lattice.wAxis[0] + dy * lattice.wAxis[1] + dz * lattice.wAxis[2]) / (wLen * wLen);
  return { u, v, w };
}

/** Evaluate a point's deformed position from the lattice. */
export function deformPoint(point: Vec3, lattice: FfdLattice): Vec3 {
  const local = pointToLatticeLocal(point, lattice);
  let x = 0, y = 0, z = 0;
  const n = lattice.nU - 1;
  const m = lattice.nV - 1;
  const l = lattice.nW - 1;
  for (let k = 0; k < lattice.nW; k++) {
    const bw = bernstein(l, k, Math.max(0, Math.min(1, local.w)));
    for (let j = 0; j < lattice.nV; j++) {
      const bv = bernstein(m, j, Math.max(0, Math.min(1, local.v)));
      for (let i = 0; i < lattice.nU; i++) {
        const bu = bernstein(n, i, Math.max(0, Math.min(1, local.u)));
        const w = bu * bv * bw;
        const idx = ((k * lattice.nV + j) * lattice.nU + i) * 3;
        x += w * lattice.controlPoints[idx]!;
        y += w * lattice.controlPoints[idx + 1]!;
        z += w * lattice.controlPoints[idx + 2]!;
      }
    }
  }
  return [x, y, z];
}

/** Deform an entire point set through the lattice. */
export function deformPoints(points: Vec3[], lattice: FfdLattice): Vec3[] {
  return points.map(p => deformPoint(p, lattice));
}

/** Move a single lattice control point — non-destructive (returns new lattice). */
export function moveLatticeNode(lattice: FfdLattice, i: number, j: number, k: number, delta: Vec3): FfdLattice {
  const cps = lattice.controlPoints.slice();
  const idx = ((k * lattice.nV + j) * lattice.nU + i) * 3;
  if (idx >= cps.length) return lattice;
  cps[idx]     += delta[0];
  cps[idx + 1] += delta[1];
  cps[idx + 2] += delta[2];
  return { ...lattice, controlPoints: cps };
}
