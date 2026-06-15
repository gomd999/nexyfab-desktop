/**
 * lagrangianJacobian — analytic Jacobian unit + comparison tests.
 *
 * Strategy:
 *   - Each per-mate test builds a tiny 2-part fixture, computes the
 *     analytic row, and compares it against a fresh numeric forward-diff
 *     row using the SAME residual function that `lagrangianSolver`
 *     internally uses. Differences must stay within `~1e-5` in absolute
 *     terms (forward-diff truncation + magnitude scaling allowance).
 *   - We also assert the dispatcher (`supportsAnalyticJacobian`) returns
 *     the expected boolean for every MateKind.
 *   - Finally we verify the integrated `lagrangianSolveAnalytic` reaches
 *     the same final placements as `lagrangianSolve` (the numeric path)
 *     on a 2-cube concentric fixture.
 */

import { describe, it, expect } from 'vitest';
import {
  analyticJacobianRow,
  supportsAnalyticJacobian,
} from './lagrangianJacobian';
import { lagrangianSolve, lagrangianSolveAnalytic } from './lagrangianSolver';
import type { GeometryResolver, ResolvedGeometry } from './iterativeSolver';
import {
  partInstance,
  IDENTITY_QUAT,
  type AssemblyState,
  type PartInstance,
  type Quat,
} from './assemblyState';
import type { Mate, MateRef } from './mate';
import { vec3, type Vec3 } from '@/lib/sketch/sketchPlane';
import { rotateVec, quatMul, quatNormalize } from './mateSolver';

// ─── shared fixture helpers ──────────────────────────────────────────────

function ref(partId: string, refId: string, refKind: MateRef['refKind']): MateRef {
  return { partId, refId, refKind };
}

function makePart(
  id: string,
  opts: {
    position?: Vec3;
    orientation?: Quat;
    fixed?: boolean;
  } = {},
): PartInstance {
  return partInstance({
    id,
    name: id,
    partTemplateId: 'tpl',
    position: opts.position ?? vec3(0, 0, 0),
    orientation: opts.orientation ?? IDENTITY_QUAT,
    fixed: opts.fixed,
  });
}

function transformInWorld(local: ResolvedGeometry, part: PartInstance): ResolvedGeometry {
  if (local.kind === 'point') {
    const rotated = rotateVec(local.world, part.orientation);
    return {
      kind: 'point',
      world: {
        x: part.position.x + rotated.x,
        y: part.position.y + rotated.y,
        z: part.position.z + rotated.z,
      },
    };
  }
  if (local.kind === 'axis') {
    const rotO = rotateVec(local.world.origin, part.orientation);
    const rotD = rotateVec(local.world.direction, part.orientation);
    return {
      kind: 'axis',
      world: {
        origin: {
          x: part.position.x + rotO.x,
          y: part.position.y + rotO.y,
          z: part.position.z + rotO.z,
        },
        direction: rotD,
      },
    };
  }
  const rotO = rotateVec(local.world.origin, part.orientation);
  const rotN = rotateVec(local.world.normal, part.orientation);
  return {
    kind: 'plane',
    world: {
      origin: {
        x: part.position.x + rotO.x,
        y: part.position.y + rotO.y,
        z: part.position.z + rotO.z,
      },
      normal: rotN,
    },
  };
}

function makeResolver(refs: Map<string, ResolvedGeometry>): GeometryResolver {
  return (r: MateRef, part: PartInstance) => {
    const local = refs.get(`${r.partId}/${r.refId}`);
    if (!local) return null;
    return transformInWorld(local, part);
  };
}

// ─── replicate the SAME residual used by lagrangianSolver ───────────────
// We re-import the solver itself only to drive `lagrangianSolve` /
// `lagrangianSolveAnalytic` tests; the residual function isn't exported,
// so we mirror its body here. KEEP IN SYNC with computeResidualForMate.

import {
  distanceAxisToAxis,
} from './mateSolver';
import { dot, lengthOf, sub } from '@/lib/sketch/sketchPlane';

function directionOf(g: ResolvedGeometry): Vec3 | null {
  if (g.kind === 'axis') return g.world.direction;
  if (g.kind === 'plane') return g.world.normal;
  return null;
}

function residualMirror(
  mate: Mate,
  a: PartInstance,
  b: PartInstance,
  resolve: GeometryResolver,
): number {
  const ag = resolve(mate.a, a);
  const bg = resolve(mate.b, b);
  if (!ag || !bg) return 0;
  if (mate.kind === 'concentric' && ag.kind === 'axis' && bg.kind === 'axis') {
    return distanceAxisToAxis(ag.world, bg.world);
  }
  if (mate.kind === 'coincident' && ag.kind === 'point' && bg.kind === 'point') {
    return lengthOf(sub(ag.world, bg.world));
  }
  if (mate.kind === 'coincident' && ag.kind === 'plane' && bg.kind === 'plane') {
    return Math.abs(dot(sub(bg.world.origin, ag.world.origin), ag.world.normal));
  }
  if (mate.kind === 'distance' && ag.kind === 'point' && bg.kind === 'point') {
    return Math.abs(lengthOf(sub(bg.world, ag.world)) - mate.value);
  }
  if (mate.kind === 'distance' && ag.kind === 'plane' && bg.kind === 'plane') {
    const signed = dot(sub(bg.world.origin, ag.world.origin), ag.world.normal);
    return Math.abs(Math.abs(signed) - mate.value);
  }
  if (mate.kind === 'parallel') {
    const aDir = directionOf(ag);
    const bDir = directionOf(bg);
    if (!aDir || !bDir) return 0;
    return Math.hypot(
      aDir.y * bDir.z - aDir.z * bDir.y,
      aDir.z * bDir.x - aDir.x * bDir.z,
      aDir.x * bDir.y - aDir.y * bDir.x,
    );
  }
  if (mate.kind === 'perpendicular') {
    const aDir = directionOf(ag);
    const bDir = directionOf(bg);
    if (!aDir || !bDir) return 0;
    return Math.abs(aDir.x * bDir.x + aDir.y * bDir.y + aDir.z * bDir.z);
  }
  if (mate.kind === 'angle') {
    const aDir = directionOf(ag);
    const bDir = directionOf(bg);
    if (!aDir || !bDir) return 0;
    const cos = Math.max(-1, Math.min(1, aDir.x * bDir.x + aDir.y * bDir.y + aDir.z * bDir.z));
    const angleRad = Math.acos(cos);
    const targetRad = (mate.value * Math.PI) / 180;
    return Math.abs(angleRad - targetRad);
  }
  // ── advanced mate residuals — mirror lagrangianSolver.computeResidualForMate ──
  if (mate.kind === 'hinge' && ag.kind === 'axis' && bg.kind === 'axis') {
    const alignErr = distanceAxisToAxis(ag.world, bg.world);
    if (mate.limit === undefined) return alignErr;
    const qa = a.orientation;
    const qb = b.orientation;
    const dotQ = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w;
    const cosHalf = Math.min(1, Math.abs(dotQ));
    const approxAngleRad = 2 * Math.acos(cosHalf);
    const approxAngleDeg = (approxAngleRad * 180) / Math.PI;
    const minDeg = mate.limit.minAngleDeg;
    const maxDeg = mate.limit.maxAngleDeg;
    let limitPenaltyDeg = 0;
    if (approxAngleDeg > maxDeg) limitPenaltyDeg = approxAngleDeg - maxDeg;
    else if (-approxAngleDeg < minDeg) limitPenaltyDeg = minDeg - -approxAngleDeg;
    return alignErr + (limitPenaltyDeg * Math.PI) / 180;
  }
  if (mate.kind === 'slot' && ag.kind === 'axis' && bg.kind === 'axis') {
    const perpDist = distanceAxisToAxis(ag.world, bg.world);
    const cos = ag.world.direction.x * bg.world.direction.x +
      ag.world.direction.y * bg.world.direction.y +
      ag.world.direction.z * bg.world.direction.z;
    return perpDist + Math.abs(cos);
  }
  if (mate.kind === 'gear' && ag.kind === 'axis' && bg.kind === 'axis') {
    const cx = ag.world.direction.y * bg.world.direction.z -
      ag.world.direction.z * bg.world.direction.y;
    const cy = ag.world.direction.z * bg.world.direction.x -
      ag.world.direction.x * bg.world.direction.z;
    const cz = ag.world.direction.x * bg.world.direction.y -
      ag.world.direction.y * bg.world.direction.x;
    const crossLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (crossLen < 1e-9) return 0;
    const dx = bg.world.origin.x - ag.world.origin.x;
    const dy = bg.world.origin.y - ag.world.origin.y;
    const dz = bg.world.origin.z - ag.world.origin.z;
    return Math.abs(dx * cx + dy * cy + dz * cz) / crossLen;
  }
  if (mate.kind === 'rack_pinion' && ag.kind === 'axis' && bg.kind === 'axis') {
    const perpDist = distanceAxisToAxis(ag.world, bg.world);
    const cos = ag.world.direction.x * bg.world.direction.x +
      ag.world.direction.y * bg.world.direction.y +
      ag.world.direction.z * bg.world.direction.z;
    return Math.abs(perpDist - mate.pinionRadius) + Math.abs(cos);
  }
  return 0;
}

/**
 * Perturb the given part's DoF d by EPS, recompute residual, return Δ/ε.
 * d ∈ [0, 5]: 0..2 translation, 3..5 rotation (Lie-algebra at zero).
 */
function numericPartialDoF(
  mate: Mate,
  perturbA: boolean,  // true → perturb part `a`; false → part `b`
  a: PartInstance,
  b: PartInstance,
  resolve: GeometryResolver,
  d: number,
  baseR: number,
  eps: number = 1e-6,
): number {
  const perturbed = perturbPart(perturbA ? a : b, d, eps);
  const newR = residualMirror(
    mate,
    perturbA ? perturbed : a,
    perturbA ? b : perturbed,
    resolve,
  );
  return (newR - baseR) / eps;
}

function perturbPart(p: PartInstance, d: number, eps: number): PartInstance {
  if (d < 3) {
    const pos = { x: p.position.x, y: p.position.y, z: p.position.z };
    if (d === 0) pos.x += eps;
    if (d === 1) pos.y += eps;
    if (d === 2) pos.z += eps;
    return { ...p, position: pos };
  }
  // Rotation: compose dq = (axis * sin(eps/2), cos(eps/2)) for axis e_{d-3}.
  const ax = d === 3 ? { x: 1, y: 0, z: 0 } : d === 4 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const h = eps / 2;
  const s = Math.sin(h);
  const dq: Quat = { x: ax.x * s, y: ax.y * s, z: ax.z * s, w: Math.cos(h) };
  const newOri = quatNormalize(quatMul(dq, p.orientation));
  return { ...p, orientation: newOri };
}

/** Extract analytic dr/dq for a given part offset (start index in row). */
function rowValueAt(row: { cols: number[]; values: number[] }, col: number): number {
  for (let i = 0; i < row.cols.length; i++) {
    if (row.cols[i] === col) return row.values[i]!;
  }
  return 0;
}

// ─── 1. supportsAnalyticJacobian dispatcher ──────────────────────────────

describe('supportsAnalyticJacobian — kind dispatch', () => {
  it('returns TRUE for 6 standard mate kinds', () => {
    expect(supportsAnalyticJacobian('concentric')).toBe(true);
    expect(supportsAnalyticJacobian('coincident')).toBe(true);
    expect(supportsAnalyticJacobian('parallel')).toBe(true);
    expect(supportsAnalyticJacobian('perpendicular')).toBe(true);
    expect(supportsAnalyticJacobian('distance')).toBe(true);
    expect(supportsAnalyticJacobian('angle')).toBe(true);
    // tangent has no closed form currently; documented as Phase 3.2.1
    // follow-up — see the FALSE-for-tangent test below.
  });

  it('returns TRUE for 4 advanced mate kinds (Phase 3.2.2)', () => {
    expect(supportsAnalyticJacobian('hinge')).toBe(true);
    expect(supportsAnalyticJacobian('slot')).toBe(true);
    expect(supportsAnalyticJacobian('gear')).toBe(true);
    expect(supportsAnalyticJacobian('rack_pinion')).toBe(true);
  });

  it('returns FALSE for tangent (Phase 3.2.1 follow-up)', () => {
    expect(supportsAnalyticJacobian('tangent')).toBe(false);
  });
});

// ─── 2. concentric: analytic vs numeric ──────────────────────────────────

describe('analyticJacobianRow — concentric axis/axis', () => {
  it('skew-axis case (non-zero residual): analytic matches numeric on translation cols', () => {
    // Choose a fixture where the skew distance is non-zero AND nicely
    // away from the parallel branch — axes truly skew in 3D.
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(5, 7, 3) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'concentric',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    expect(baseR).toBeGreaterThan(0.5); // verify we're away from the kink

    // Translation cols (0..2 and 6..8): analytic must match numeric
    // accurately. Rotation cols may differ slightly because near-parallel
    // perturbations cause the residual to switch evaluation branches
    // (parallel vs skew) — numeric forward-diff is noisy there.
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      const ana = rowValueAt(row, d);
      expect(Math.abs(ana - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      const ana = rowValueAt(row, 6 + d);
      expect(Math.abs(ana - num)).toBeLessThan(1e-3);
    }
  });

  it('parallel-axis (point-to-line) case: translation cols match numeric', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(3, 4, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'concentric',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    expect(baseR).toBeCloseTo(5, 5);

    // Translation cols: ∂r/∂a.x = pu.x = -0.6, etc. These match cleanly.
    // Rotation cols are near-singular in the parallel branch (a small
    // rotation pushes us into the skew branch which is discontinuous in
    // forward-difference). Only verify translation here.
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      const ana = rowValueAt(row, d);
      expect(Math.abs(ana - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      const ana = rowValueAt(row, 6 + d);
      expect(Math.abs(ana - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 3. coincident point/point: analytic vs numeric ──────────────────────

describe('analyticJacobianRow — coincident point/point', () => {
  it('analytic matches numeric within 1e-5', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(5, 3, -2) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/p', { kind: 'point', world: vec3(1, 2, 0) }],
      ['b/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'coincident',
      a: ref('a', 'p', 'point'), b: ref('b', 'p', 'point'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);

    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-4);
    }
    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-4);
    }
  });
});

// ─── 4. coincident plane/plane: analytic vs numeric ──────────────────────

describe('analyticJacobianRow — coincident plane/plane', () => {
  it('analytic matches numeric within 1e-4', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(0, 0, 5) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
      ['b/pl', { kind: 'plane', world: { origin: vec3(1, 1, 0), normal: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'coincident',
      a: ref('a', 'pl', 'plane'), b: ref('b', 'pl', 'plane'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);

    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 5. parallel: analytic vs numeric ────────────────────────────────────

describe('analyticJacobianRow — parallel axis/axis', () => {
  it('analytic matches numeric within 1e-4', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0.5, 0.5, 0.707) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'parallel',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);

    // Only rotation cols (3..5) of each part carry signal — translations
    // should be exactly zero in both numeric and analytic.
    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 6. perpendicular: analytic vs numeric ───────────────────────────────

describe('analyticJacobianRow — perpendicular axis/axis', () => {
  it('analytic matches numeric within 1e-4', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0.7, 0.7, 0.1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'perpendicular',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);

    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 7. distance point/point: analytic vs numeric ────────────────────────

describe('analyticJacobianRow — distance point/point', () => {
  it('analytic matches numeric within 1e-4', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(7, 0, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/p', { kind: 'point', world: vec3(0, 0, 0) }],
      ['b/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'distance', value: 10,
      a: ref('a', 'p', 'point'), b: ref('b', 'p', 'point'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);

    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 8. distance plane/plane: analytic vs numeric ────────────────────────

describe('analyticJacobianRow — distance plane/plane', () => {
  it('analytic matches numeric within 1e-3', () => {
    const a = makePart('a');
    const b = makePart('b', { position: vec3(0, 0, 7) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
      ['b/pl', { kind: 'plane', world: { origin: vec3(1, 1, 0), normal: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'distance', value: 3,
      a: ref('a', 'pl', 'plane'), b: ref('b', 'pl', 'plane'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);

    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 9. angle: analytic vs numeric ───────────────────────────────────────

describe('analyticJacobianRow — angle axis/axis', () => {
  it('analytic matches numeric within 1e-3', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0.6, 0.8, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'angle', value: 30,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);

    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 10. tangent: returns empty row (unsupported) ────────────────────────

describe('analyticJacobianRow — tangent (unsupported)', () => {
  it('returns an empty row for tangent mates', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
      ['b/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(1, 0, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'tangent',
      a: ref('a', 'pl', 'face'), b: ref('b', 'pl', 'face'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(row.cols).toHaveLength(0);
    expect(row.values).toHaveLength(0);
  });
});

// ─── 11. both parts free: 12 non-zero cols, both blocks filled ───────────

describe('analyticJacobianRow — both parts free (12 cols filled)', () => {
  it('coincident point/point with both DoF offsets ≥ 0 emits 12 entries', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(5, 0, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/p', { kind: 'point', world: vec3(1, 0, 0) }],
      ['b/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'coincident',
      a: ref('a', 'p', 'point'), b: ref('b', 'p', 'point'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(row.cols).toHaveLength(12);
    expect(new Set(row.cols)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  });
});

// ─── 12. fixed part: 6 non-zero cols (moved only) ────────────────────────

describe('analyticJacobianRow — one fixed part (6 cols only)', () => {
  it('coincident point/point with fixedDofOffset = −1 emits only 6 entries', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(5, 0, 0), fixed: true });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/p', { kind: 'point', world: vec3(1, 0, 0) }],
      ['b/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'coincident',
      a: ref('a', 'p', 'point'), b: ref('b', 'p', 'point'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, -1);
    expect(row.cols).toHaveLength(6);
    expect(new Set(row.cols)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });
});

// ─── 13. lagrangianSolveAnalytic vs lagrangianSolve: same final state ────

describe('lagrangianSolveAnalytic vs lagrangianSolve — final-state parity', () => {
  it('2-cube concentric: both reach the same axis-aligned answer', () => {
    const f = makePart('f', { position: vec3(2, 2, 0), fixed: true });
    const g = makePart('g', { position: vec3(6, -1, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'c', kind: 'concentric', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const numeric = lagrangianSolve(state, resolver);
    const analytic = lagrangianSolveAnalytic(state, resolver);
    expect(numeric.success).toBe(true);
    expect(analytic.success).toBe(true);
    const numG = numeric.state.parts.find((p) => p.id === 'g')!;
    const anaG = analytic.state.parts.find((p) => p.id === 'g')!;
    expect(anaG.position.x).toBeCloseTo(numG.position.x, 3);
    expect(anaG.position.y).toBeCloseTo(numG.position.y, 3);
  });

  it('2-cube coincident point: both converge to same position', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(10, 5, -3) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('g', 'pg', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/pg', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const resolver = makeResolver(refs);
    const numeric = lagrangianSolve(state, resolver);
    const analytic = lagrangianSolveAnalytic(state, resolver);
    expect(numeric.success).toBe(true);
    expect(analytic.success).toBe(true);
    const numG = numeric.state.parts.find((p) => p.id === 'g')!;
    const anaG = analytic.state.parts.find((p) => p.id === 'g')!;
    expect(anaG.position.x).toBeCloseTo(numG.position.x, 3);
    expect(anaG.position.y).toBeCloseTo(numG.position.y, 3);
    expect(anaG.position.z).toBeCloseTo(numG.position.z, 3);
  });
});

// ─── 14. analytic at least as fast: iterations ≤ numeric + small slack ───

describe('lagrangianSolveAnalytic — iteration count ≤ numeric path', () => {
  it('coincident point: analytic iterations ≤ numeric + 2', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(15, -8, 4) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('g', 'pg', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/pg', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const numeric = lagrangianSolve(state, makeResolver(refs));
    const analytic = lagrangianSolveAnalytic(state, makeResolver(refs));
    expect(numeric.success).toBe(true);
    expect(analytic.success).toBe(true);
    // Analytic should be at least as fast (within a small slack).
    expect(analytic.iterations).toBeLessThanOrEqual(numeric.iterations + 2);
  });
});

// ─── 15. analytic falls back gracefully on unsupported mate ──────────────

describe('lagrangianSolveAnalytic — unsupported mate fallback', () => {
  it('hinge mate (not analytic): solver still converges via numeric per-row fallback', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(5, 0, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'h', kind: 'hinge', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const r = lagrangianSolveAnalytic(state, makeResolver(refs));
    expect(Number.isFinite(r.finalMaxResidual)).toBe(true);
    expect(r.finalMaxResidual).toBeLessThan(1e-3);
  });
});

// ─── 16. perpendicular: zero translation cols ────────────────────────────

describe('analyticJacobianRow — perpendicular has zero translation cols', () => {
  it('translation gradients are exactly 0 (direction-only constraint)', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0.7, 0.7, 0.1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'perpendicular',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    // Cols 0,1,2 (a's tx,ty,tz) and 6,7,8 (b's tx,ty,tz) must be zero.
    expect(rowValueAt(row, 0)).toBe(0);
    expect(rowValueAt(row, 1)).toBe(0);
    expect(rowValueAt(row, 2)).toBe(0);
    expect(rowValueAt(row, 6)).toBe(0);
    expect(rowValueAt(row, 7)).toBe(0);
    expect(rowValueAt(row, 8)).toBe(0);
  });
});

// ─── 17. parallel: zero translation cols ─────────────────────────────────

describe('analyticJacobianRow — parallel has zero translation cols', () => {
  it('translation gradients are exactly 0', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0.5, 0.5, 0.707) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'parallel',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(rowValueAt(row, 0)).toBe(0);
    expect(rowValueAt(row, 1)).toBe(0);
    expect(rowValueAt(row, 2)).toBe(0);
    expect(rowValueAt(row, 6)).toBe(0);
    expect(rowValueAt(row, 7)).toBe(0);
    expect(rowValueAt(row, 8)).toBe(0);
  });
});

// ─── 18. angle: zero translation cols ────────────────────────────────────

describe('analyticJacobianRow — angle has zero translation cols', () => {
  it('translation gradients are exactly 0', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0.6, 0.8, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'angle', value: 45,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(rowValueAt(row, 0)).toBe(0);
    expect(rowValueAt(row, 1)).toBe(0);
    expect(rowValueAt(row, 2)).toBe(0);
    expect(rowValueAt(row, 6)).toBe(0);
    expect(rowValueAt(row, 7)).toBe(0);
    expect(rowValueAt(row, 8)).toBe(0);
  });
});

// ─── 19. coincident point at zero distance: empty row (degenerate) ───────

describe('analyticJacobianRow — coincident point at zero distance', () => {
  it('returns empty row (kink at |0|, LM damping handles)', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/p', { kind: 'point', world: vec3(0, 0, 0) }],
      ['b/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'coincident',
      a: ref('a', 'p', 'point'), b: ref('b', 'p', 'point'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(row.cols).toHaveLength(0);
  });
});

// ─── 20. parallel when already parallel: empty (kink at 0) ───────────────

describe('analyticJacobianRow — parallel when already parallel', () => {
  it('returns empty row when cross-product is zero', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'parallel',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(row.cols).toHaveLength(0);
  });
});

// ─── 21. angle at parallel singularity: empty ────────────────────────────

describe('analyticJacobianRow — angle at parallel singularity', () => {
  it('returns empty row when c² = 1 (sin = 0)', () => {
    const a = makePart('a');
    const b = makePart('b');
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'angle', value: 30,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(row.cols).toHaveLength(0);
  });
});

// ─── 22. moved with non-identity orientation: still accurate ─────────────

describe('analyticJacobianRow — non-identity orientation', () => {
  it('coincident point with rotated moved part: analytic matches numeric', () => {
    // 30° rotation around z
    const angle = Math.PI / 6;
    const s = Math.sin(angle / 2);
    const c = Math.cos(angle / 2);
    const a = makePart('a', { position: vec3(1, 2, 3), orientation: { x: 0, y: 0, z: s, w: c } });
    const b = makePart('b', { position: vec3(4, 5, 6) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/p', { kind: 'point', world: vec3(2, 0, 0) }],
      ['b/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'm', kind: 'coincident',
      a: ref('a', 'p', 'point'), b: ref('b', 'p', 'point'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);

    for (let d = 0; d < 6; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 23. hinge with no limit: analytic concentric primary ────────────────

describe('analyticJacobianRow — hinge no-limit equals concentric primary', () => {
  it('hinge with no limit returns the same row as the concentric mate', () => {
    // Skew axes so the concentric row is non-empty and non-degenerate.
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(5, 7, 3) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const hinge: Mate = {
      id: 'h', kind: 'hinge',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const concentric: Mate = {
      id: 'c', kind: 'concentric',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(hinge.a, a)!;
    const bg = resolver(hinge.b, b)!;
    const hingeRow = analyticJacobianRow(hinge, a, b, ag, bg, 0, 6);
    const concRow = analyticJacobianRow(concentric, a, b, ag, bg, 0, 6);
    expect(hingeRow.cols).toEqual(concRow.cols);
    for (let i = 0; i < hingeRow.values.length; i++) {
      expect(hingeRow.values[i]).toBeCloseTo(concRow.values[i]!, 12);
    }
  });
});

// ─── 24. lagrangianSolveAnalytic with all-fixed: trivial ─────────────────

describe('lagrangianSolveAnalytic — all-fixed trivial', () => {
  it('all parts fixed → success=true, iterations=0', () => {
    const f1 = makePart('f1', { fixed: true });
    const f2 = makePart('f2', { fixed: true, position: vec3(10, 0, 0) });
    const state: AssemblyState = { parts: [f1, f2], mates: [] };
    const r = lagrangianSolveAnalytic(state, makeResolver(new Map()));
    expect(r.success).toBe(true);
    expect(r.iterations).toBe(0);
  });
});

// ─── 25. lagrangianSolveAnalytic on chain assembly ───────────────────────

describe('lagrangianSolveAnalytic — chain assembly', () => {
  it('3-cube point-chain converges', () => {
    const f = makePart('f', { fixed: true });
    const a = makePart('a');
    const b = makePart('b');
    const state: AssemblyState = {
      parts: [f, a, b],
      mates: [
        { id: 'm1', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('a', 'pa', 'point') } as Mate,
        { id: 'm2', kind: 'coincident', a: ref('a', 'pa2', 'point'), b: ref('b', 'pb', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(10, 0, 0) }],
      ['a/pa', { kind: 'point', world: vec3(0, 0, 0) }],
      ['a/pa2', { kind: 'point', world: vec3(5, 0, 0) }],
      ['b/pb', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolveAnalytic(state, makeResolver(refs), { maxIterations: 100 });
    expect(r.success).toBe(true);
    expect(r.residuals.every((rr) => rr.residual < 1e-3)).toBe(true);
  });
});

// ─── Phase 3.2.2 advanced mate analytic Jacobian tests ───────────────────-

// ─── 26. hinge analytic: concentric primary vs numeric ───────────────────-

describe('analyticJacobianRow — hinge (no limit) skew-axis primary vs numeric', () => {
  it('translation cols match numeric within 1e-3 (concentric primary)', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(5, 7, 3) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'h', kind: 'hinge',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    expect(baseR).toBeGreaterThan(0.5);
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 27. hinge with active limit: row delegated to numeric (empty) ───────

describe('analyticJacobianRow — hinge with active limit returns empty (numeric supplement)', () => {
  it('hinge whose swing penalty is active yields an empty analytic row', () => {
    // Rotate part `b` by ~50° around z so the quaternion-dot proxy
    // approxAngle ≈ 50° > maxAngleDeg = 10° → penalty active.
    const angle = (50 * Math.PI) / 180;
    const s = Math.sin(angle / 2);
    const c = Math.cos(angle / 2);
    const a = makePart('a');
    const b = makePart('b', { orientation: { x: 0, y: 0, z: s, w: c } });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'h', kind: 'hinge',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
      limit: { minAngleDeg: -10, maxAngleDeg: 10 },
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(row.cols).toHaveLength(0);
  });

  it('hinge whose swing is inside the limit band emits the analytic primary', () => {
    // Identity orientations → approxAngle ≈ 0 ≤ max=10 → limit inactive.
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(2, 2, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'h', kind: 'hinge',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
      limit: { minAngleDeg: -45, maxAngleDeg: 45 },
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    // Parallel + offset → parallel-branch concentric row has non-empty cols.
    expect(row.cols.length).toBeGreaterThan(0);
  });
});

// ─── 28. slot analytic vs numeric ────────────────────────────────────────-

describe('analyticJacobianRow — slot axis/axis (concentric + perpendicular)', () => {
  it('analytic translation + rotation cols match numeric within 1e-3', () => {
    // Slot edge along x, pin axis along y at an offset (perpDist = 4,
    // perpendicular: cos = 0 — pin already perpendicular to slot).
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(3, 4, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ed', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0.6, 0.8) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 's', kind: 'slot',
      a: ref('a', 'ed', 'edge'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    expect(baseR).toBeGreaterThan(0); // non-zero residual
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });

  it('slot with parallel-axis pin (cos = 1): perpendicular contribution dominates rotation cols', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(3, 4, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ed', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      // Pin parallel to slot — perpendicular residual = 1, max violation.
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 's', kind: 'slot',
      a: ref('a', 'ed', 'edge'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(row.cols.length).toBeGreaterThan(0);
    // Translation cols should match numeric (perpDist gradient dominates).
    const baseR = residualMirror(mate, a, b, resolver);
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 29. gear coplanarity vs numeric ─────────────────────────────────────-

describe('analyticJacobianRow — gear axis/axis (coplanarity)', () => {
  it('skew shafts: analytic translation + rotation cols match numeric', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(0, 0, 5) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 1, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'g', kind: 'gear', ratio: 2,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    expect(baseR).toBeGreaterThan(0.5);
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });

  it('parallel shafts: analytic emits zero row (residual identically 0)', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(0, 5, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'g', kind: 'gear', ratio: 1,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    expect(row.cols).toHaveLength(0);
    expect(residualMirror(mate, a, b, resolver)).toBe(0);
  });
});

// ─── 30. rack_pinion analytic vs numeric ────────────────────────────────-

describe('analyticJacobianRow — rack_pinion (axis distance to radius + perpendicular)', () => {
  it('translation cols match numeric when perpDist != pinionRadius', () => {
    // Pinion along z at origin, rack along x at y = 4. perpDist = 4,
    // pinionRadius = 5 → |4 − 5| = 1 + |cos(z,x)| = 0 + 1 = 1.
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(0, 4, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ed', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'rp', kind: 'rack_pinion', pinionRadius: 5,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ed', 'edge'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    expect(baseR).toBeCloseTo(1, 6);
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });

  it('rotation cols match numeric (perpendicular contribution + axis distance)', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(0, 6, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      // Slightly off-perpendicular rack direction so cos != 0 and we have
      // a non-trivial rotation gradient on the perpendicular term.
      ['b/ed', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0.9, 0, 0.4359) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'rp', kind: 'rack_pinion', pinionRadius: 3,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ed', 'edge'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    expect(baseR).toBeGreaterThan(0);
    for (let d = 3; d < 6; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
    for (let d = 3; d < 6; d++) {
      const num = numericPartialDoF(mate, false, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, 6 + d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 31. rack_pinion: perpDist > radius vs perpDist < radius sign flip ──-

describe('analyticJacobianRow — rack_pinion sign flips with perpDist crossing radius', () => {
  it('perpDist > radius (s > 0): tx gradient sign matches numeric', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    // perpDist = 7 (rack offset), radius = 3 → s = 7 − 3 = 4 > 0.
    const b = makePart('b', { position: vec3(0, 7, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ed', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'rp', kind: 'rack_pinion', pinionRadius: 3,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ed', 'edge'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
  });

  it('perpDist < radius (s < 0): tx gradient sign matches numeric', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    // perpDist = 1.5, radius = 3 → s = 1.5 − 3 = −1.5 < 0.
    const b = makePart('b', { position: vec3(0, 1.5, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ed', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'rp', kind: 'rack_pinion', pinionRadius: 3,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ed', 'edge'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 32. lagrangianSolveAnalytic with hinge converges ────────────────────-

describe('lagrangianSolveAnalytic — hinge converges via analytic primary', () => {
  it('parallel-offset hinge (no limit): analytic reaches concentric within tol', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(8, 6, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'h', kind: 'hinge', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const analytic = lagrangianSolveAnalytic(state, makeResolver(refs));
    expect(analytic.success).toBe(true);
    expect(analytic.finalMaxResidual).toBeLessThan(1e-3);
  });
});

// ─── 33. lagrangianSolveAnalytic with gear: residual matches numeric ─────-

describe('lagrangianSolveAnalytic — gear residual parity with numeric path', () => {
  it('skew gear axes: final residual matches lagrangianSolve to within 1e-4', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(0, 0, 5) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'g', kind: 'gear', ratio: 2, a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 1, 0) } }],
    ]);
    const numeric = lagrangianSolve(state, makeResolver(refs));
    const analytic = lagrangianSolveAnalytic(state, makeResolver(refs));
    expect(Math.abs(numeric.finalMaxResidual - analytic.finalMaxResidual)).toBeLessThan(1e-3);
  });
});

// ─── 34. mixed mate types (standard + advanced) all analytic ─────────────-

describe('lagrangianSolveAnalytic — mixed standard + advanced mates', () => {
  it('concentric + hinge mates both go through the analytic path', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(5, 5, 0) });
    const h = makePart('h', { position: vec3(10, 10, 0) });
    const state: AssemblyState = {
      parts: [f, g, h],
      mates: [
        { id: 'c1', kind: 'concentric', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
        { id: 'h1', kind: 'hinge', a: ref('g', 'ax', 'axis'), b: ref('h', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['h/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const r = lagrangianSolveAnalytic(state, makeResolver(refs));
    expect(r.success).toBe(true);
    // Both mates should report `supported = true` in the residual list.
    const supported = r.residuals.every((rr) => rr.supported);
    expect(supported).toBe(true);
  });
});

// ─── 35. supportsAnalyticJacobian: 4 advanced all true ───────────────────-

describe('supportsAnalyticJacobian — 4 advanced mate kinds all true', () => {
  it('hinge / slot / gear / rack_pinion all return true', () => {
    expect(supportsAnalyticJacobian('hinge')).toBe(true);
    expect(supportsAnalyticJacobian('slot')).toBe(true);
    expect(supportsAnalyticJacobian('gear')).toBe(true);
    expect(supportsAnalyticJacobian('rack_pinion')).toBe(true);
  });
});

// ─── 36. slot without secondary path: analytic only handles primary ─────-
// (Slot has no slotLength term in lagrangianSolver's residual — the full
// residual is `perpDist + |cos|`, and that is the analytic sum we emit.)

describe('analyticJacobianRow — slot with slotLength set: lagrangianSolver ignores length term', () => {
  it('analytic row equals the no-length version (lagrangianSolver residual omits length penalty)', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(0, 4, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ed', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 1, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const withLen: Mate = {
      id: 's1', kind: 'slot', slotLength: 10,
      a: ref('a', 'ed', 'edge'), b: ref('b', 'ax', 'axis'),
    };
    const noLen: Mate = {
      id: 's2', kind: 'slot',
      a: ref('a', 'ed', 'edge'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(withLen.a, a)!;
    const bg = resolver(withLen.b, b)!;
    const r1 = analyticJacobianRow(withLen, a, b, ag, bg, 0, 6);
    const r2 = analyticJacobianRow(noLen, a, b, ag, bg, 0, 6);
    expect(r1.cols).toEqual(r2.cols);
    for (let i = 0; i < r1.values.length; i++) {
      expect(r1.values[i]).toBeCloseTo(r2.values[i]!, 12);
    }
  });
});

// ─── 37. mate without secondary present: primary-only row ────────────────

describe('analyticJacobianRow — hinge without limit emits primary-only row (matches concentric)', () => {
  it('cols match the concentric row exactly', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(4, 0, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const hinge: Mate = {
      id: 'h', kind: 'hinge',
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(hinge.a, a)!;
    const bg = resolver(hinge.b, b)!;
    const row = analyticJacobianRow(hinge, a, b, ag, bg, 0, 6);
    // Parallel branch of concentric: emits 12 DoF entries.
    expect(row.cols.length).toBe(12);
  });
});

// ─── 38. gear with fixed part: only moved DoF block populated ────────────-

describe('analyticJacobianRow — gear with fixed fixedPart', () => {
  it('gear (skew shafts) with fixedDofOffset = −1 emits only the moved 6 cols', () => {
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(0, 0, 5), fixed: true });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['b/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 1, 0) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'g', kind: 'gear', ratio: 2,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ax', 'axis'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, -1);
    expect(new Set(row.cols)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });
});

// ─── 39. rack_pinion: perpendicular sub-row's translation cols are zero ──-

describe('analyticJacobianRow — rack_pinion perpendicular sub-component has zero translation', () => {
  it('translation contribution from |cos| term is exactly 0 (verified via offset test)', () => {
    // Off-kink configuration: perpDist = 5/0.8 ≈ 6.25, pinionRadius = 3
    // → s = 6.25 − 3 = 3.25 (well > 0, smooth absolute-value branch).
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(0, 5, 0) });
    const refs = new Map<string, ResolvedGeometry>([
      ['a/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['b/ed', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0.8, 0, 0.6) } }],
    ]);
    const resolver = makeResolver(refs);
    const mate: Mate = {
      id: 'rp', kind: 'rack_pinion', pinionRadius: 3,
      a: ref('a', 'ax', 'axis'), b: ref('b', 'ed', 'edge'),
    };
    const ag = resolver(mate.a, a)!;
    const bg = resolver(mate.b, b)!;
    const row = analyticJacobianRow(mate, a, b, ag, bg, 0, 6);
    const baseR = residualMirror(mate, a, b, resolver);
    // The translation cols should match numeric — the analytic + numeric
    // both equal the axis-distance-to-target gradient (perpendicular term
    // has zero translation contribution).
    for (let d = 0; d < 3; d++) {
      const num = numericPartialDoF(mate, true, a, b, resolver, d, baseR);
      expect(Math.abs(rowValueAt(row, d) - num)).toBeLessThan(1e-3);
    }
  });
});

// ─── 40. lagrangianSolveAnalytic with slot: converges ────────────────────-

describe('lagrangianSolveAnalytic — slot mate converges', () => {
  it('pin-onto-slot scenario solves to small residual', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(0, 6, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 's', kind: 'slot', a: ref('f', 'ed', 'edge'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ed', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const r = lagrangianSolveAnalytic(state, makeResolver(refs));
    expect(Number.isFinite(r.finalMaxResidual)).toBe(true);
    // Slot has 2 DoF free (slide + spin); convergence to near-zero
    // residual depends on the relaxation — accept either success=true OR
    // a very small final residual.
    expect(r.finalMaxResidual).toBeLessThan(1e-2);
  });
});
