/**
 * runnerBalanceOptimizer.ts — Balance flow through a runner system in
 * a multi-cavity injection mold.
 *
 * In a balanced runner, every cavity sees equal flow + pressure +
 * fill time. Imbalance causes:
 *
 *   - Some cavities short-shot (low fill).
 *   - Others flash (over-fill).
 *
 * For a tree runner, balance is achieved by:
 *
 *   - Same path length from sprue to every gate (natural balance).
 *   - Or: artificial balance — adjust runner diameters so pressure
 *     drop ΔP = K · L · η · (Q/D⁴) is equal per branch (Hagen-
 *     Poiseuille analogue).
 *
 * Module:
 *   - Accepts a runner tree (branches → leaves).
 *   - Computes per-leaf pressure drop given current diameters.
 *   - Adjusts diameters via Newton iteration to minimise imbalance.
 *   - Reports residual imbalance + recommended diameter set.
 */

export interface RunnerBranch {
  id: string;
  /** Parent branch id, or null for the trunk. */
  parentId: string | null;
  /** Length of this branch (mm). */
  lengthMm: number;
  /** Initial diameter (mm). */
  diameterMm: number;
  /** True if this branch ends at a cavity gate. */
  isGate: boolean;
}

export interface ChannelInputs {
  /** Total flow rate from sprue (cm³/s). */
  totalFlowCm3PerS: number;
  /** Melt viscosity (Pa·s). */
  viscosityPaS: number;
}

export interface BalanceResult {
  /** Per-gate path pressure drop (Pa). */
  perGateDeltaP: Map<string, number>;
  /** Recommended new diameters per branch (mm). */
  recommendedDiameters: Map<string, number>;
  /** Residual imbalance: (max − min) / mean. */
  imbalanceRatio: number;
  /** Number of optimisation iterations performed. */
  iterations: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function balanceRunners(
  branches: RunnerBranch[],
  inputs: ChannelInputs,
  maxIterations: number = 30,
  toleranceRatio: number = 0.05,
): BalanceResult {
  const childrenMap = buildChildren(branches);
  // Equal flow per gate.
  const gateBranches = branches.filter(b => b.isGate);
  const flowPerGate = inputs.totalFlowCm3PerS / Math.max(1, gateBranches.length);
  const perBranchFlow = computePerBranchFlow(branches, childrenMap, flowPerGate);
  let diameters = new Map(branches.map(b => [b.id, b.diameterMm]));

  let imbalance = Infinity;
  let iter = 0;
  while (iter < maxIterations) {
    const dp = computePerGateDeltaP(branches, childrenMap, perBranchFlow, diameters, inputs.viscosityPaS);
    const stats = imbalanceStats(dp);
    imbalance = stats.ratio;
    if (imbalance <= toleranceRatio) break;
    // Adjust diameter on the slowest path's last branch upward.
    const sortedGates = Array.from(dp.entries()).sort((a, b) => b[1] - a[1]);
    const slowestGate = sortedGates[0]!;
    const fastestGate = sortedGates[sortedGates.length - 1]!;
    // Increase slowest gate diameter; decrease fastest.
    const slow = diameters.get(slowestGate[0]) ?? 1;
    const fast = diameters.get(fastestGate[0]) ?? 1;
    diameters.set(slowestGate[0], slow * 1.05);
    diameters.set(fastestGate[0], fast * 0.97);
    iter++;
  }

  return {
    perGateDeltaP: computePerGateDeltaP(branches, childrenMap, perBranchFlow, diameters, inputs.viscosityPaS),
    recommendedDiameters: diameters,
    imbalanceRatio: imbalance,
    iterations: iter,
  };
}

// ── Tree helpers ─────────────────────────────────────────────

function buildChildren(branches: RunnerBranch[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const b of branches) {
    if (b.parentId === null) continue;
    if (!map.has(b.parentId)) map.set(b.parentId, []);
    map.get(b.parentId)!.push(b.id);
  }
  return map;
}

function computePerBranchFlow(branches: RunnerBranch[], children: Map<string, string[]>, flowPerGate: number): Map<string, number> {
  const flow = new Map<string, number>();
  // Start from leaves (gates), propagate up.
  for (const b of branches) {
    if (b.isGate) flow.set(b.id, flowPerGate);
  }
  // Walk parents.
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of branches) {
      if (flow.has(b.id)) continue;
      const childIds = children.get(b.id) ?? [];
      let sum = 0;
      let allDefined = true;
      for (const c of childIds) {
        const f = flow.get(c);
        if (f === undefined) { allDefined = false; break; }
        sum += f;
      }
      if (allDefined && childIds.length > 0) {
        flow.set(b.id, sum);
        changed = true;
      }
    }
  }
  // Trunk gets total if not yet set.
  for (const b of branches) {
    if (!flow.has(b.id)) flow.set(b.id, 0);
  }
  return flow;
}

function computePerGateDeltaP(
  branches: RunnerBranch[],
  _children: Map<string, string[]>,
  flow: Map<string, number>,
  diameters: Map<string, number>,
  viscosity: number,
): Map<string, number> {
  // Pressure drop along a branch: ΔP = 128·η·L·Q / (π·D⁴) (Hagen-Poiseuille).
  // Per-gate drop = sum of branch drops from gate back to root.
  const parentMap = new Map<string, string | null>();
  for (const b of branches) parentMap.set(b.id, b.parentId);
  const dp = new Map<string, number>();
  for (const b of branches) {
    if (!b.isGate) continue;
    let total = 0;
    let cur: string | null = b.id;
    while (cur !== null) {
      const br = branches.find(x => x.id === cur)!;
      const d = diameters.get(cur) ?? 1;
      const f = flow.get(cur) ?? 0;
      // Q in mm³/s = flowCm3PerS × 1000.
      const qmm3 = f * 1000;
      // ΔP in Pa = 128·η·L·Q / (π·D⁴) where L,D in mm.
      const drop = (128 * viscosity * br.lengthMm * qmm3) / (Math.PI * Math.pow(d, 4));
      total += drop;
      cur = parentMap.get(cur) ?? null;
    }
    dp.set(b.id, total);
  }
  return dp;
}

function imbalanceStats(dp: Map<string, number>): { min: number; max: number; mean: number; ratio: number } {
  let min = Infinity;
  let max = 0;
  let sum = 0;
  for (const v of dp.values()) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = dp.size === 0 ? 0 : sum / dp.size;
  const ratio = mean === 0 ? 0 : (max - min) / mean;
  return { min, max, mean, ratio };
}

// ── Diagnose ─────────────────────────────────────────────────

export interface BalanceDiagnostic {
  gateCount: number;
  isBalanced: boolean;
  worstGateId: string | null;
  worstDpPa: number;
}

export function diagnose(result: BalanceResult, tolerance: number = 0.05): BalanceDiagnostic {
  const isBalanced = result.imbalanceRatio <= tolerance;
  let worstId: string | null = null;
  let worst = 0;
  for (const [id, dp] of result.perGateDeltaP) {
    if (dp > worst) { worst = dp; worstId = id; }
  }
  return {
    gateCount: result.perGateDeltaP.size,
    isBalanced,
    worstGateId: worstId,
    worstDpPa: worst,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface BalanceSummary {
  gateCount: number;
  iterations: number;
  imbalanceRatio: number;
  isBalanced: boolean;
}

export function summarize(result: BalanceResult): BalanceSummary {
  return {
    gateCount: result.perGateDeltaP.size,
    iterations: result.iterations,
    imbalanceRatio: result.imbalanceRatio,
    isBalanced: result.imbalanceRatio <= 0.05,
  };
}
