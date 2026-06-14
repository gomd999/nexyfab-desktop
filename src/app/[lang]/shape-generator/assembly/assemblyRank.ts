/**
 * assemblyRank — rank-based assembly DOF / over-constraint analysis (#5 inc 2).
 *
 * `calculateDOF` is a naive Grübler count (Σ DOF_PER_MATE) — it can't tell an
 * independent set of mates from a redundant one (e.g. the same coincident added
 * twice). This module builds the constraint Jacobian numerically and uses its
 * rank to get:
 *
 *   - effectiveConstrainedDOF = rank(J)  → accurate remaining DOF (6·freeBodies
 *     − rank), which the Grübler count over/under-estimates.
 *   - redundant mates via LEAVE-ONE-OUT: a mate is over-defining iff removing it
 *     does NOT lower the rank (its constraints are already implied by the rest).
 *     This is the precise "this mate over-defines the assembly" test and avoids
 *     the false positives of `Σ DOF − rank` (two coincidences on *distinct*
 *     points share a rotational subspace but are NOT redundant).
 *
 * Pure + synchronous → unit-testable without a solver. Covers the mate types
 * with an unambiguous residual vectorization (coincident, distance, parallel,
 * perpendicular, angle, concentric); other types are ignored by the rank pass
 * (reported via `unsupportedMates`) so we never emit a false redundancy on a
 * mate we can't model.
 */
import * as THREE from 'three';
import type { AssemblyBody, AssemblyState, Mate, MateType } from './matesSolver';

const RANK_MATE_TYPES = new Set<MateType>([
  'coincident', 'distance', 'parallel', 'perpendicular', 'angle', 'concentric',
]);

export interface AssemblyRankAnalysis {
  /** Independent constraint DOF = rank(J). */
  effectiveConstrainedDOF: number;
  /** 6·freeBodies − rank(J) (clamped ≥ 0). */
  remainingDOF: number;
  /** Mate ids whose removal does not lower the rank (over-defining). */
  redundantMateIds: string[];
  overConstrained: boolean;
  /** Enabled mates whose type isn't modelled by the rank pass. */
  unsupportedMates: string[];
}

function worldPoint(b: AssemblyBody, local: THREE.Vector3): THREE.Vector3 {
  const m = new THREE.Matrix4().compose(b.position, new THREE.Quaternion().setFromEuler(b.rotation), ONE);
  return local.clone().applyMatrix4(m);
}
function worldDir(b: AssemblyBody, local: THREE.Vector3): THREE.Vector3 {
  return local.clone().applyQuaternion(new THREE.Quaternion().setFromEuler(b.rotation)).normalize();
}
const ONE = new THREE.Vector3(1, 1, 1);

/** Constraint residual vector for one mate (0 when satisfied). null if unmodelled. */
function mateResidual(bodies: AssemblyBody[], mate: Mate): number[] | null {
  const [s0, s1] = mate.selections;
  const b0 = bodies[s0.bodyIndex];
  const b1 = bodies[s1.bodyIndex];
  if (!b0 || !b1) return null;
  const p0 = worldPoint(b0, s0.localPoint);
  const p1 = worldPoint(b1, s1.localPoint);
  const d = p1.clone().sub(p0);
  const ax0 = worldDir(b0, s0.localAxis ?? s0.localNormal);
  const ax1 = worldDir(b1, s1.localAxis ?? s1.localNormal);
  switch (mate.type) {
    case 'coincident':
      return [d.x, d.y, d.z];
    case 'distance':
      return [d.length() - (mate.distance ?? 0)];
    case 'perpendicular':
      return [ax0.dot(ax1)];
    case 'parallel': {
      const c = ax0.clone().cross(ax1); // 0 ⇔ parallel (rank ≤ 2)
      return [c.x, c.y, c.z];
    }
    case 'angle': {
      const dot = Math.min(1, Math.max(-1, ax0.dot(ax1)));
      return [Math.acos(dot) - ((mate.angle ?? 0) * Math.PI) / 180];
    }
    case 'concentric': {
      // Position residual perpendicular to the axis (axial slide is free), plus
      // axis-parallel. perpendicular part has rank ≤ 2; cross has rank ≤ 2.
      const perp = d.clone().sub(ax0.clone().multiplyScalar(d.dot(ax0)));
      const c = ax0.clone().cross(ax1);
      return [perp.x, perp.y, perp.z, c.x, c.y, c.z];
    }
    default:
      return null;
  }
}

/** Perturb a free body's DOF index (0-2 = translate x/y/z, 3-5 = rotate x/y/z). */
function perturb(b: AssemblyBody, dof: number, eps: number): AssemblyBody {
  const nb: AssemblyBody = { ...b, position: b.position.clone(), rotation: b.rotation.clone() };
  if (dof < 3) {
    nb.position.setComponent(dof, nb.position.getComponent(dof) + eps);
  } else {
    const axis = new THREE.Vector3(dof === 3 ? 1 : 0, dof === 4 ? 1 : 0, dof === 5 ? 1 : 0);
    const dq = new THREE.Quaternion().setFromAxisAngle(axis, eps);
    const q = dq.multiply(new THREE.Quaternion().setFromEuler(nb.rotation));
    nb.rotation.setFromQuaternion(q);
  }
  return nb;
}

/** Row-echelon rank with partial pivoting (rows = constraints, cols = DOF). */
function matrixRank(rows: number[][], tol = 1e-7): number {
  const M = rows.map(r => r.slice());
  const m = M.length;
  if (m === 0) return 0;
  const n = M[0].length;
  let rank = 0;
  for (let col = 0; col < n && rank < m; col++) {
    let piv = rank;
    for (let r = rank + 1; r < m; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < tol) continue;
    [M[rank], M[piv]] = [M[piv], M[rank]];
    const pv = M[rank][col];
    for (let r = 0; r < m; r++) {
      if (r === rank) continue;
      const f = M[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c < n; c++) M[r][c] -= f * M[rank][c];
    }
    rank++;
  }
  return rank;
}

/** Numerical constraint Jacobian (m residual rows × 6·freeBodies cols) for the
 *  given supported mates, then its rank. */
function jacobianRank(state: AssemblyState, mates: Mate[], eps = 1e-5): number {
  const free: number[] = [];
  state.bodies.forEach((b, i) => { if (!b.fixed) free.push(i); });
  const n = free.length * 6;
  if (n === 0 || mates.length === 0) return 0;

  const base: number[] = [];
  for (const mate of mates) { const r = mateResidual(state.bodies, mate); if (r) base.push(...r); }
  const m = base.length;
  if (m === 0) return 0;

  // J[row][col] = d residual_row / d dof_col
  const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  free.forEach((bodyIdx, fi) => {
    for (let dof = 0; dof < 6; dof++) {
      const col = fi * 6 + dof;
      const bodies = state.bodies.slice();
      bodies[bodyIdx] = perturb(state.bodies[bodyIdx], dof, eps);
      let row = 0;
      for (const mate of mates) {
        const r = mateResidual(bodies, mate);
        if (!r) continue;
        for (let k = 0; k < r.length; k++) { J[row][col] = (r[k] - base[row]) / eps; row++; }
      }
    }
  });
  return matrixRank(J);
}

export function analyzeAssemblyRank(state: AssemblyState): AssemblyRankAnalysis {
  const enabled = state.mates.filter(m => m.enabled);
  const supported = enabled.filter(m => RANK_MATE_TYPES.has(m.type));
  const unsupportedMates = enabled.filter(m => !RANK_MATE_TYPES.has(m.type)).map(m => m.id);
  const freeBodies = state.bodies.filter(b => !b.fixed).length;

  const fullRank = jacobianRank(state, supported);

  // Leave-one-out: a mate is redundant iff dropping it keeps the rank.
  const redundantMateIds: string[] = [];
  if (supported.length > 1) {
    for (const mate of supported) {
      const without = supported.filter(m => m.id !== mate.id);
      if (jacobianRank(state, without) === fullRank) redundantMateIds.push(mate.id);
    }
  }

  return {
    effectiveConstrainedDOF: fullRank,
    remainingDOF: Math.max(0, freeBodies * 6 - fullRank),
    redundantMateIds,
    overConstrained: redundantMateIds.length > 0,
    unsupportedMates,
  };
}
