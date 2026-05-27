/**
 * boundaryConditionConsistency.ts — Validate FEA boundary condition
 * consistency before solving.
 *
 * Common BC mistakes that prevent or invalidate FEA solutions:
 *
 *   - No supports at all → singular system, no solution.
 *   - Over-constrained → false stiffness, lock-up.
 *   - Inconsistent loads (e.g., total Z force ≠ Z reaction).
 *   - Free-floating bodies (rigid body modes).
 *   - Symmetric model loaded asymmetrically.
 *
 * Module:
 *   - Counts supports per DOF.
 *   - Checks net load = reactions (equilibrium).
 *   - Reports rigid-body modes likely.
 */

export type DOF = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz';

export interface SupportConstraint {
  id: string;
  nodeId: string;
  constrainedDofs: DOF[];
}

export interface AppliedLoad {
  id: string;
  nodeId: string;
  /** Force vector (N). */
  force: { x: number; y: number; z: number };
  /** Moment vector (N·mm). */
  moment?: { x: number; y: number; z: number };
}

export interface ConsistencyResult {
  /** DOFs constrained at least once across all supports. */
  constrainedDofs: Set<DOF>;
  /** Free DOFs not constrained anywhere. */
  freeDofs: Set<DOF>;
  netForce: { x: number; y: number; z: number };
  netMoment: { x: number; y: number; z: number };
  hasRigidBodyModes: boolean;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function checkConsistency(supports: SupportConstraint[], loads: AppliedLoad[]): ConsistencyResult {
  const warnings: string[] = [];
  const constrained = new Set<DOF>();
  for (const s of supports) {
    for (const dof of s.constrainedDofs) constrained.add(dof);
  }
  const allDofs: DOF[] = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
  const free = new Set<DOF>(allDofs.filter(d => !constrained.has(d)));

  // Net load.
  let nfx = 0, nfy = 0, nfz = 0, nmx = 0, nmy = 0, nmz = 0;
  for (const load of loads) {
    nfx += load.force.x;
    nfy += load.force.y;
    nfz += load.force.z;
    if (load.moment) {
      nmx += load.moment.x;
      nmy += load.moment.y;
      nmz += load.moment.z;
    }
  }

  const hasRbm = free.size > 0;

  if (supports.length === 0) {
    warnings.push('No supports defined: system is singular, will not solve.');
  }
  if (hasRbm) {
    warnings.push(`${free.size} DOF(s) unconstrained: ${Array.from(free).join(', ')} — rigid body modes possible.`);
  }
  if (Math.abs(nfx) + Math.abs(nfy) + Math.abs(nfz) > 0 && free.has('x') && Math.abs(nfx) > 0.001) {
    warnings.push('Net X load with no X constraint will produce rigid translation.');
  }

  return {
    constrainedDofs: constrained,
    freeDofs: free,
    netForce: { x: nfx, y: nfy, z: nfz },
    netMoment: { x: nmx, y: nmy, z: nmz },
    hasRigidBodyModes: hasRbm,
    warnings,
  };
}

// ── Equilibrium check ────────────────────────────────────────

export interface EquilibriumReport {
  forceImbalanceN: number;
  momentImbalanceNmm: number;
  /** True if within tolerance. */
  inEquilibrium: boolean;
}

/**
 * Compare net applied load to total reaction (sum of reactions
 * computed externally). Returns absolute imbalance magnitudes.
 */
export function checkEquilibrium(result: ConsistencyResult, totalReaction: { force: { x: number; y: number; z: number }; moment?: { x: number; y: number; z: number } }, toleranceN: number = 0.1): EquilibriumReport {
  const forceImbalance = Math.hypot(
    result.netForce.x + totalReaction.force.x,
    result.netForce.y + totalReaction.force.y,
    result.netForce.z + totalReaction.force.z,
  );
  const tm = totalReaction.moment ?? { x: 0, y: 0, z: 0 };
  const momentImbalance = Math.hypot(
    result.netMoment.x + tm.x,
    result.netMoment.y + tm.y,
    result.netMoment.z + tm.z,
  );
  return {
    forceImbalanceN: forceImbalance,
    momentImbalanceNmm: momentImbalance,
    inEquilibrium: forceImbalance < toleranceN,
  };
}

// ── Symmetry check ───────────────────────────────────────────

export interface SymmetryCheck {
  expectedSymmetric: boolean;
  actuallySymmetric: boolean;
  asymmetryReason?: string;
}

export function checkSymmetry(loads: AppliedLoad[], symmetryPlane: 'xy' | 'xz' | 'yz'): SymmetryCheck {
  // Look for matching pairs in the symmetry plane.
  let asymmetric = false;
  let reason: string | undefined;
  for (const load of loads) {
    let mirrored;
    if (symmetryPlane === 'xy') {
      mirrored = { x: load.force.x, y: load.force.y, z: -load.force.z };
    } else if (symmetryPlane === 'xz') {
      mirrored = { x: load.force.x, y: -load.force.y, z: load.force.z };
    } else {
      mirrored = { x: -load.force.x, y: load.force.y, z: load.force.z };
    }
    const symmetric = loads.some(l =>
      Math.abs(l.force.x - mirrored.x) < 0.001
      && Math.abs(l.force.y - mirrored.y) < 0.001
      && Math.abs(l.force.z - mirrored.z) < 0.001,
    );
    if (!symmetric) {
      asymmetric = true;
      reason = `Load ${load.id} has no symmetric counterpart.`;
      break;
    }
  }
  return { expectedSymmetric: true, actuallySymmetric: !asymmetric, asymmetryReason: reason };
}

// ── Summary ────────────────────────────────────────────────────

export interface ConsistencySummary {
  supportCount: number;
  loadCount: number;
  freeDofCount: number;
  hasRigidBodyModes: boolean;
  warningCount: number;
}

export function summarize(supports: SupportConstraint[], loads: AppliedLoad[], result: ConsistencyResult): ConsistencySummary {
  return {
    supportCount: supports.length,
    loadCount: loads.length,
    freeDofCount: result.freeDofs.size,
    hasRigidBodyModes: result.hasRigidBodyModes,
    warningCount: result.warnings.length,
  };
}
