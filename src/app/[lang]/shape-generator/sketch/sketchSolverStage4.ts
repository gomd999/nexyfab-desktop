/**
 * sketchSolverStage4.ts — Block coordinate descent solver for large sketches.
 *
 * Stage 1 (Newton) handles small sketches. Stage 3 added higher-order
 * constraints + drag propagation. Stage 4 is for the *large* case —
 * sketches with thousands of entities (e.g. PCB-like routing pads,
 * complex panel layouts) where global Newton becomes O(n³) per
 * iteration.
 *
 * Algorithm:
 *
 *   1. **Partition** entities into connected components via the
 *      constraint graph. Each component is solved independently.
 *   2. **Block coordinate descent**: in each component, group entities
 *      into blocks (≤ ~50 entities) and Gauss-Seidel iterate — solve
 *      block A, then B with A fixed, ..., wrap until residuals settle.
 *   3. **Adaptive damping** — Levenberg-Marquardt style damping when
 *      a block's residual stops decreasing.
 *   4. **Constraint priority** — drives ordering of block updates;
 *      tight constraints (small slack) get solved first.
 *
 * Output: per-component convergence trace + final residual.
 */

export interface ConstraintEntity {
  id: string;
  /** Positions for Point entities, otherwise empty. */
  positions: number[];
  /** Pinned/locked? */
  pinned: boolean;
}

export interface Constraint {
  id: string;
  /** Entity IDs. */
  entityIds: string[];
  /** Weight (higher = stiffer). */
  weight: number;
  /** Residual function: produce a numeric error from current positions. */
  residual: (entities: Map<string, ConstraintEntity>) => number;
  /** Optional priority (higher = solve first). */
  priority?: number;
}

export interface SolverOptions {
  /** Max passes over all blocks. */
  maxIterations: number;
  /** Residual stopping threshold. */
  toleranceMm: number;
  /** Block size for coordinate descent. */
  blockSize: number;
  /** Initial damping factor (Levenberg-Marquardt). */
  initialDamping: number;
}

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  maxIterations: 100,
  toleranceMm: 1e-4,
  blockSize: 50,
  initialDamping: 0.01,
};

export interface SolverResult {
  /** Final positions (cloned from input). */
  entities: Map<string, ConstraintEntity>;
  /** Residual per iteration. */
  residualHistory: number[];
  /** Did the solver converge? */
  converged: boolean;
  /** Per-component connected-set size. */
  componentSizes: number[];
}

// ── Top-level entry ─────────────────────────────────────────────

export function solveLarge(
  entities: ConstraintEntity[],
  constraints: Constraint[],
  options: Partial<SolverOptions> = {},
): SolverResult {
  const opts = { ...DEFAULT_SOLVER_OPTIONS, ...options };
  const entMap = new Map<string, ConstraintEntity>();
  for (const e of entities) {
    entMap.set(e.id, { ...e, positions: e.positions.slice() });
  }

  // Partition into connected components.
  const components = findConnectedComponents(entities, constraints);

  const history: number[] = [];
  let damping = opts.initialDamping;
  for (let iter = 0; iter < opts.maxIterations; iter++) {
    let totalResidual = 0;
    for (const comp of components) {
      // Build blocks within this component.
      const blocks = chunk(comp.entities, opts.blockSize);
      for (const block of blocks) {
        const blockResidual = relaxBlock(block, entMap, comp.constraints, damping);
        totalResidual += blockResidual;
      }
    }
    history.push(totalResidual);
    if (totalResidual < opts.toleranceMm) break;
    // Adaptive damping.
    if (history.length > 2) {
      const last = history[history.length - 1]!;
      const prev = history[history.length - 2]!;
      damping = last >= prev ? damping * 2 : Math.max(opts.initialDamping, damping * 0.5);
    }
  }

  return {
    entities: entMap,
    residualHistory: history,
    converged: history.length > 0 && history[history.length - 1]! < opts.toleranceMm,
    componentSizes: components.map(c => c.entities.length),
  };
}

// ── Connected-component partition ─────────────────────────────

interface Component {
  entities: string[];
  constraints: Constraint[];
}

function findConnectedComponents(entities: ConstraintEntity[], constraints: Constraint[]): Component[] {
  const adj = new Map<string, Set<string>>();
  const constraintsOf = new Map<string, Constraint[]>();
  for (const e of entities) {
    adj.set(e.id, new Set());
    constraintsOf.set(e.id, []);
  }
  for (const c of constraints) {
    for (const a of c.entityIds) {
      for (const b of c.entityIds) {
        if (a !== b) adj.get(a)?.add(b);
      }
      constraintsOf.get(a)?.push(c);
    }
  }
  const visited = new Set<string>();
  const components: Component[] = [];
  for (const e of entities) {
    if (visited.has(e.id)) continue;
    const compEntities: string[] = [];
    const compConstraints = new Set<Constraint>();
    const stack: string[] = [e.id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      compEntities.push(cur);
      for (const c of constraintsOf.get(cur) ?? []) compConstraints.add(c);
      for (const n of adj.get(cur) ?? []) if (!visited.has(n)) stack.push(n);
    }
    components.push({ entities: compEntities, constraints: [...compConstraints] });
  }
  return components;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Block relaxation ──────────────────────────────────────────

function relaxBlock(
  blockEntityIds: string[],
  entities: Map<string, ConstraintEntity>,
  constraints: Constraint[],
  damping: number,
): number {
  const blockSet = new Set(blockEntityIds);
  const blockConstraints = constraints.filter(c => c.entityIds.some(id => blockSet.has(id)));
  blockConstraints.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  let totalResidual = 0;
  for (const c of blockConstraints) {
    const r = c.residual(entities);
    totalResidual += Math.abs(r) * c.weight;
    if (Math.abs(r) < 1e-6) continue;
    // Gradient via finite differences on entities involved.
    for (const eid of c.entityIds) {
      const ent = entities.get(eid);
      if (!ent || ent.pinned) continue;
      for (let dim = 0; dim < ent.positions.length; dim++) {
        const old = ent.positions[dim]!;
        const eps = 1e-3;
        ent.positions[dim] = old + eps;
        const rPlus = c.residual(entities);
        ent.positions[dim] = old;
        const grad = (rPlus - r) / eps;
        // Levenberg-Marquardt step.
        const step = -c.weight * grad * r / (c.weight * grad * grad + damping);
        ent.positions[dim] = old + step;
      }
    }
  }
  return totalResidual;
}

// ── Convergence diagnostics ────────────────────────────────────

export interface ConvergenceStats {
  iterationsRun: number;
  initialResidual: number;
  finalResidual: number;
  reductionFraction: number;
  monotonic: boolean;
}

export function analyzeConvergence(result: SolverResult): ConvergenceStats {
  const history = result.residualHistory;
  if (history.length === 0) return { iterationsRun: 0, initialResidual: 0, finalResidual: 0, reductionFraction: 0, monotonic: true };
  const initial = history[0]!;
  const final = history[history.length - 1]!;
  let monotonic = true;
  for (let i = 1; i < history.length; i++) {
    if (history[i]! > history[i - 1]!) {
      monotonic = false;
      break;
    }
  }
  return {
    iterationsRun: history.length,
    initialResidual: initial,
    finalResidual: final,
    reductionFraction: initial > 0 ? 1 - final / initial : 0,
    monotonic,
  };
}

// ── Built-in constraint helpers ───────────────────────────────

export function makeDistanceConstraint(idA: string, idB: string, distanceMm: number, weight: number = 1): Constraint {
  return {
    id: `dist-${idA}-${idB}`,
    entityIds: [idA, idB],
    weight,
    residual: (entities) => {
      const a = entities.get(idA);
      const b = entities.get(idB);
      if (!a || !b) return 0;
      const dx = b.positions[0]! - a.positions[0]!;
      const dy = (b.positions[1] ?? 0) - (a.positions[1] ?? 0);
      const observed = Math.hypot(dx, dy);
      return observed - distanceMm;
    },
  };
}

export function makeHorizontalConstraint(idA: string, idB: string, weight: number = 1): Constraint {
  return {
    id: `h-${idA}-${idB}`,
    entityIds: [idA, idB],
    weight,
    residual: (entities) => {
      const a = entities.get(idA);
      const b = entities.get(idB);
      if (!a || !b) return 0;
      return (b.positions[1] ?? 0) - (a.positions[1] ?? 0);
    },
  };
}

export function makeVerticalConstraint(idA: string, idB: string, weight: number = 1): Constraint {
  return {
    id: `v-${idA}-${idB}`,
    entityIds: [idA, idB],
    weight,
    residual: (entities) => {
      const a = entities.get(idA);
      const b = entities.get(idB);
      if (!a || !b) return 0;
      return (b.positions[0] ?? 0) - (a.positions[0] ?? 0);
    },
  };
}
