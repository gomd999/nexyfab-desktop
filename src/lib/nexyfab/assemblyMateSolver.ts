// Assembly mate solver — resolves concentric / coincident / distance /
// parallel / angle mates to a 4×4 transform per part. Iterative steepest-
// descent with closed-form Jacobians for the common cases. Refines toward
// a residual of < 1e-4 mm or stops after `maxIters`.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // w,x,y,z

export interface Frame {
  position: Vec3;
  rotation: Quat;
}

export interface MateAxis {
  /** Part id this axis belongs to. */
  partId: string;
  /** Axis origin in part-local mm. */
  origin: Vec3;
  /** Axis direction (unit). */
  direction: Vec3;
}

export interface MatePoint {
  partId: string;
  /** Point in part-local mm. */
  position: Vec3;
}

export type Mate =
  | { kind: 'concentric'; a: MateAxis; b: MateAxis }
  | { kind: 'coincident'; a: MatePoint; b: MatePoint }
  | { kind: 'distance'; a: MatePoint; b: MatePoint; distMm: number }
  | { kind: 'parallel'; a: MateAxis; b: MateAxis }
  | { kind: 'angle'; a: MateAxis; b: MateAxis; deg: number };

export interface SolveOptions {
  maxIters?: number;
  /** Parts NOT in this list are free to move; parts in it are fixed. */
  fixedPartIds?: string[];
  /** Convergence tolerance (mm or radians). */
  tolerance?: number;
}

export interface SolveResult {
  frames: Record<string, Frame>;
  iterations: number;
  residual: number;
  converged: boolean;
  /** Per-mate residual after solve — used to surface "conflict" badges in UI. */
  mateResiduals: { mate: Mate; residual: number }[];
}

// ─── Quaternion / vector helpers ───────────────────────────────────────────

function vadd(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vsub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vscale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function vdot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vcross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function vlen(a: Vec3): number { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function vnorm(a: Vec3): Vec3 {
  const l = vlen(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

function qrotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

function qmul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function qFromAxisAngle(axis: Vec3, rad: number): Quat {
  const a = vnorm(axis);
  const s = Math.sin(rad / 2);
  return [Math.cos(rad / 2), a[0] * s, a[1] * s, a[2] * s];
}

function transformPoint(frame: Frame, local: Vec3): Vec3 {
  return vadd(frame.position, qrotate(frame.rotation, local));
}

function transformDirection(frame: Frame, local: Vec3): Vec3 {
  return qrotate(frame.rotation, local);
}

// ─── Residual evaluation ───────────────────────────────────────────────────

function mateResidual(mate: Mate, frames: Record<string, Frame>): { error: number; targetPart: string | null; correction: { dPos?: Vec3; dRotAxis?: Vec3; dRotAngle?: number } } {
  switch (mate.kind) {
    case 'coincident': {
      const fa = frames[mate.a.partId];
      const fb = frames[mate.b.partId];
      const pa = transformPoint(fa, mate.a.position);
      const pb = transformPoint(fb, mate.b.position);
      const delta = vsub(pa, pb);
      return {
        error: vlen(delta),
        targetPart: mate.b.partId,
        correction: { dPos: delta },
      };
    }
    case 'distance': {
      const fa = frames[mate.a.partId];
      const fb = frames[mate.b.partId];
      const pa = transformPoint(fa, mate.a.position);
      const pb = transformPoint(fb, mate.b.position);
      const d = vsub(pa, pb);
      const dist = vlen(d);
      const err = dist - mate.distMm;
      const dir = dist > 1e-9 ? vscale(d, 1 / dist) : [1, 0, 0] as Vec3;
      return {
        error: Math.abs(err),
        targetPart: mate.b.partId,
        correction: { dPos: vscale(dir, err) },
      };
    }
    case 'concentric': {
      const fa = frames[mate.a.partId];
      const fb = frames[mate.b.partId];
      const oa = transformPoint(fa, mate.a.origin);
      const ob = transformPoint(fb, mate.b.origin);
      const da = transformDirection(fa, mate.a.direction);
      const db = transformDirection(fb, mate.b.direction);
      // Position component: shortest distance between two skew lines.
      const offset = vsub(ob, oa);
      const perpOnA = vsub(offset, vscale(da, vdot(offset, da)));
      const posErr = vlen(perpOnA);
      // Angular component: parallel axes.
      const angErr = Math.acos(Math.max(-1, Math.min(1, Math.abs(vdot(da, db)))));
      const rotAxis = vcross(db, da);
      return {
        error: posErr + angErr * 10, // angular weighted higher in mm-equivalent
        targetPart: mate.b.partId,
        correction: { dPos: perpOnA, dRotAxis: rotAxis, dRotAngle: angErr },
      };
    }
    case 'parallel': {
      const fa = frames[mate.a.partId];
      const fb = frames[mate.b.partId];
      const da = transformDirection(fa, mate.a.direction);
      const db = transformDirection(fb, mate.b.direction);
      const dot = Math.max(-1, Math.min(1, vdot(da, db)));
      const ang = Math.acos(Math.abs(dot));
      return {
        error: ang,
        targetPart: mate.b.partId,
        correction: { dRotAxis: vcross(db, da), dRotAngle: ang },
      };
    }
    case 'angle': {
      const fa = frames[mate.a.partId];
      const fb = frames[mate.b.partId];
      const da = transformDirection(fa, mate.a.direction);
      const db = transformDirection(fb, mate.b.direction);
      const targetRad = (mate.deg * Math.PI) / 180;
      const current = Math.acos(Math.max(-1, Math.min(1, vdot(da, db))));
      const err = current - targetRad;
      return {
        error: Math.abs(err),
        targetPart: mate.b.partId,
        correction: { dRotAxis: vcross(db, da), dRotAngle: err },
      };
    }
  }
}

// ─── Solver ────────────────────────────────────────────────────────────────

export function solveMates(
  initial: Record<string, Frame>,
  mates: Mate[],
  opts: SolveOptions = {},
): SolveResult {
  const { maxIters = 60, fixedPartIds = [], tolerance = 1e-4 } = opts;
  const fixed = new Set(fixedPartIds);
  const frames: Record<string, Frame> = {};
  for (const [k, v] of Object.entries(initial)) {
    frames[k] = { position: [...v.position] as Vec3, rotation: [...v.rotation] as Quat };
  }

  const dampingPos = 0.5;
  const dampingRot = 0.3;
  let iter = 0;
  let totalErr = Infinity;
  for (iter = 0; iter < maxIters; iter++) {
    totalErr = 0;
    for (const mate of mates) {
      const { error, targetPart, correction } = mateResidual(mate, frames);
      totalErr += error;
      if (!targetPart || fixed.has(targetPart)) continue;
      const f = frames[targetPart];
      if (!f) continue;
      if (correction.dPos) {
        f.position = vsub(f.position, vscale(correction.dPos, dampingPos));
      }
      if (correction.dRotAxis && correction.dRotAngle && Math.abs(correction.dRotAngle) > 1e-6) {
        const q = qFromAxisAngle(correction.dRotAxis, correction.dRotAngle * dampingRot);
        f.rotation = qmul(q, f.rotation);
        // Normalize the quaternion to prevent drift over many iterations.
        const m = Math.sqrt(f.rotation.reduce((a, b) => a + b * b, 0));
        if (m > 1e-9) f.rotation = f.rotation.map(x => x / m) as Quat;
      }
    }
    if (totalErr < tolerance) break;
  }

  const mateResiduals = mates.map(m => ({ mate: m, residual: mateResidual(m, frames).error }));
  return {
    frames,
    iterations: iter,
    residual: totalErr,
    converged: totalErr < tolerance,
    mateResiduals,
  };
}

export const IDENTITY_FRAME: Frame = { position: [0, 0, 0], rotation: [1, 0, 0, 0] };
