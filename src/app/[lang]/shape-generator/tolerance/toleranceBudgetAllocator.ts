/**
 * toleranceBudgetAllocator.ts — Distribute a total tolerance budget
 * across stack-up contributors weighted by cost / sensitivity.
 *
 * Problem: a gap must stay within ±0.10 mm, and it depends on
 * 5 dimensions in series. Naive allocation: 0.02 each. Smart
 * allocation: tight tolerances on the cheap-to-make dimensions,
 * loose on the expensive ones, scaling by cost-of-tolerance curve:
 *
 *   cost(T) ≈ A / T^k
 *
 * with k ≈ 1.5 for milled features, 0.7 for sheet-metal, 2.0 for
 * fine ground bearings.
 *
 * Lagrange-optimized allocation (Spotts 1973):
 *   T_i = T_total · w_i / Σw   where w_i = (A_i / k_i)^(1/(k_i+1))
 *
 * For RSS (root-sum-square) stack, the budget is split by
 *   T_i² = T_total² · w_i / Σw.
 */

export interface ToleranceContributor {
  id: string;
  /** Cost coefficient A (relative). */
  costCoefficient: number;
  /** Cost exponent k (k=1.5 typical milled). */
  costExponent: number;
  /** Sensitivity coefficient |∂Y/∂X_i|; 1.0 for direct stack. */
  sensitivity: number;
  /** Hard minimum tolerance the process can achieve. */
  minimumTolerance: number;
  /** Hard maximum tolerance (often imposed by datum chain). */
  maximumTolerance?: number;
}

export type StackKind = 'worst-case' | 'rss';

export interface AllocationOptions {
  /** Total budget T_total (full bilateral tolerance). */
  budget: number;
  stackKind: StackKind;
}

export interface Allocation {
  id: string;
  tolerance: number;
  /** Estimated relative cost (cost ∝ A/T^k). */
  estimatedCost: number;
  /** True if hit floor (process limit). */
  atFloor: boolean;
  /** True if hit ceiling. */
  atCeiling: boolean;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Achieved stack tolerance (worst-case or RSS). */
  achievedStack: number;
  /** Whether the budget was met. */
  budgetMet: boolean;
  /** Sum of estimated costs. */
  totalEstimatedCost: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function allocateBudget(
  contributors: ToleranceContributor[],
  options: AllocationOptions,
): AllocationResult {
  if (contributors.length === 0) {
    return { allocations: [], achievedStack: 0, budgetMet: true, totalEstimatedCost: 0 };
  }

  // Spotts weighting — Lagrangian gives T_i ∝ (k_i·A_i / |s_i|)^(1/(k_i+1))
  // so higher sensitivity (s) shrinks weight → tighter individual tolerance.
  const weights = contributors.map(c => Math.pow(
    c.costExponent * c.costCoefficient / Math.max(0.0001, Math.abs(c.sensitivity)),
    1 / (c.costExponent + 1),
  ));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  let allocations: Allocation[];
  if (options.stackKind === 'worst-case') {
    // Worst-case: T_total = Σ |s_i| · T_i → T_i = T_total · w_i / (Σ |s_i| · w_i).
    const denom = contributors.reduce((s, c, i) => s + Math.abs(c.sensitivity) * weights[i]!, 0);
    allocations = contributors.map((c, i) => buildAlloc(c, weights[i]! * options.budget / Math.max(0.0001, denom)));
  } else {
    // RSS: T_total² = Σ (s_i · T_i)² → solve for T_i = w_i^0.5 · scale.
    // We allocate T_i = scale · (w_i / |s_i|)^0.5, with scale set so Σ (s_i T_i)² = budget².
    const proportional = contributors.map((c, i) => Math.sqrt(weights[i]! / Math.max(0.0001, Math.abs(c.sensitivity))));
    const sumSquares = contributors.reduce((s, c, i) => s + Math.pow(c.sensitivity * proportional[i]!, 2), 0);
    const scale = options.budget / Math.sqrt(Math.max(0.0001, sumSquares));
    allocations = contributors.map((c, i) => buildAlloc(c, proportional[i]! * scale));
  }

  // Enforce process limits.
  for (const a of allocations) {
    const c = contributors.find(x => x.id === a.id)!;
    if (a.tolerance < c.minimumTolerance) {
      a.tolerance = c.minimumTolerance;
      a.atFloor = true;
    }
    if (c.maximumTolerance !== undefined && a.tolerance > c.maximumTolerance) {
      a.tolerance = c.maximumTolerance;
      a.atCeiling = true;
    }
    a.estimatedCost = c.costCoefficient / Math.pow(Math.max(0.0001, a.tolerance), c.costExponent);
  }

  // Re-compute achieved stack.
  let achieved: number;
  if (options.stackKind === 'worst-case') {
    achieved = contributors.reduce((s, c) => {
      const a = allocations.find(x => x.id === c.id)!;
      return s + Math.abs(c.sensitivity) * a.tolerance;
    }, 0);
  } else {
    achieved = Math.sqrt(contributors.reduce((s, c) => {
      const a = allocations.find(x => x.id === c.id)!;
      return s + Math.pow(c.sensitivity * a.tolerance, 2);
    }, 0));
  }

  const totalCost = allocations.reduce((s, a) => s + a.estimatedCost, 0);
  return {
    allocations,
    achievedStack: achieved,
    budgetMet: achieved <= options.budget * 1.01,
    totalEstimatedCost: totalCost,
  };
}

function buildAlloc(c: ToleranceContributor, tolerance: number): Allocation {
  return {
    id: c.id,
    tolerance,
    estimatedCost: c.costCoefficient / Math.pow(Math.max(0.0001, tolerance), c.costExponent),
    atFloor: false,
    atCeiling: false,
  };
}

// ── Re-balance helper ─────────────────────────────────────────

/**
 * Re-distribute the slack from any contributor pinned at the floor
 * onto the remaining ones (preserves the total budget).
 */
export function redistributeSlack(result: AllocationResult, options: AllocationOptions): AllocationResult {
  const fixed = result.allocations.filter(a => a.atFloor || a.atCeiling);
  const free = result.allocations.filter(a => !a.atFloor && !a.atCeiling);
  if (free.length === 0 || fixed.length === 0) return result;

  // Recompute remaining budget assuming worst-case.
  const consumedByFixed = fixed.reduce((s, a) => s + a.tolerance, 0);
  const remaining = Math.max(0, options.budget - consumedByFixed);
  const perFree = remaining / free.length;
  for (const a of free) a.tolerance = perFree;

  return result;
}

// ── Sensitivity analysis ──────────────────────────────────────

export interface SensitivityRow {
  id: string;
  contribution: number;
  contributionFraction: number;
}

export function sensitivityReport(
  contributors: ToleranceContributor[],
  allocations: Allocation[],
  stackKind: StackKind,
): SensitivityRow[] {
  const rows = contributors.map(c => {
    const a = allocations.find(x => x.id === c.id)!;
    const contrib = stackKind === 'worst-case'
      ? Math.abs(c.sensitivity) * a.tolerance
      : Math.pow(c.sensitivity * a.tolerance, 2);
    return { id: c.id, contribution: contrib, contributionFraction: 0 };
  });
  const total = rows.reduce((s, r) => s + r.contribution, 0);
  for (const r of rows) r.contributionFraction = total === 0 ? 0 : r.contribution / total;
  rows.sort((a, b) => b.contributionFraction - a.contributionFraction);
  return rows;
}

// ── Summary ────────────────────────────────────────────────────

export interface BudgetSummary {
  contributorCount: number;
  achievedStack: number;
  budgetMet: boolean;
  flooredCount: number;
  totalEstimatedCost: number;
}

export function summarize(result: AllocationResult): BudgetSummary {
  return {
    contributorCount: result.allocations.length,
    achievedStack: result.achievedStack,
    budgetMet: result.budgetMet,
    flooredCount: result.allocations.filter(a => a.atFloor).length,
    totalEstimatedCost: result.totalEstimatedCost,
  };
}
