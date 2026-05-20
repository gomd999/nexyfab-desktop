/**
 * multiStepRouting.ts — Multi-step manufacturing routing.
 *
 * Stage-1 `processRouter` picks one process to make the whole part.
 * Many real parts need a *sequence*:
 *
 *   - 7075-T6 aero bracket: CNC rough → wire-EDM detail → anodize
 *   - Stainless valve body: investment cast → CNC finish → passivation
 *   - Bent steel chassis: laser cut → press-brake bend → MIG weld → paint
 *
 * Stage 2 (here) searches the graph of valid process transitions,
 * scores feasible sequences on time + cost + quality + risk, and
 * returns a ranked list of operation chains.
 *
 * Capability model: each step has
 *   - inputs   (state of the part it expects)
 *   - outputs  (state after the step runs)
 *   - cost / time / quality contribution
 *
 * Tolerance, surface-finish, and dimensional state are tracked as
 * a "PartState" snapshot. A transition is valid when the step's
 * input requirement is met.
 */

export type OperationKind =
  | 'cast'
  | 'forge'
  | 'cnc-rough'
  | 'cnc-finish'
  | 'wire-edm'
  | 'sinker-edm'
  | 'turning'
  | 'grinding'
  | 'polishing'
  | 'sheet-cut'
  | 'press-brake'
  | 'welding'
  | 'heat-treat'
  | 'anodizing'
  | 'plating'
  | 'painting'
  | 'passivation'
  | 'inspection'
  | 'assembly';

export type PartFormState = 'raw-stock' | 'rough-near-net' | 'machined' | 'finished';
export type SurfaceFinishState = 'as-cast' | 'mill-finish' | 'fine' | 'polished';

export interface PartState {
  form: PartFormState;
  toleranceUm: number;       // current tolerance in micrometers
  surfaceFinish: SurfaceFinishState;
  /** Coatings applied (cumulative). */
  coatings: string[];
  /** True after heat treatment. */
  heatTreated: boolean;
}

export interface OperationStep {
  kind: OperationKind;
  name: string;
  /** Required input state. Unspecified fields accept any value. */
  requires: Partial<PartState>;
  /** Output state — only the fields this step changes. */
  produces: Partial<PartState>;
  /** Cost contribution (USD per unit). */
  costPerUnitUsd: number;
  /** Time contribution (hours per unit). */
  timePerUnitHr: number;
  /** Quality contribution (0..100 — how much it improves final QC pass rate). */
  qualityImpact: number;
  /** Risk level (0..1, higher = more rework probability). */
  riskFactor: number;
  /** Disallowed predecessors. */
  cannotFollow?: OperationKind[];
}

// ── Library of standard ops ──────────────────────────────────────

export const OP_LIBRARY: OperationStep[] = [
  {
    kind: 'cast', name: 'Investment Casting',
    requires: { form: 'raw-stock' },
    produces: { form: 'rough-near-net', toleranceUm: 250, surfaceFinish: 'as-cast' },
    costPerUnitUsd: 30, timePerUnitHr: 0.5, qualityImpact: 50, riskFactor: 0.15,
  },
  {
    kind: 'forge', name: 'Closed-Die Forging',
    requires: { form: 'raw-stock' },
    produces: { form: 'rough-near-net', toleranceUm: 500, surfaceFinish: 'as-cast' },
    costPerUnitUsd: 40, timePerUnitHr: 0.3, qualityImpact: 60, riskFactor: 0.10,
  },
  {
    kind: 'cnc-rough', name: 'CNC Roughing',
    requires: {},
    produces: { form: 'machined', toleranceUm: 100, surfaceFinish: 'mill-finish' },
    costPerUnitUsd: 25, timePerUnitHr: 0.4, qualityImpact: 65, riskFactor: 0.05,
  },
  {
    kind: 'cnc-finish', name: 'CNC Finishing',
    requires: { form: 'machined' },
    produces: { toleranceUm: 25, surfaceFinish: 'fine' },
    costPerUnitUsd: 18, timePerUnitHr: 0.3, qualityImpact: 80, riskFactor: 0.04,
  },
  {
    kind: 'wire-edm', name: 'Wire EDM',
    requires: { form: 'machined' },
    produces: { toleranceUm: 5, surfaceFinish: 'fine' },
    costPerUnitUsd: 35, timePerUnitHr: 1.0, qualityImpact: 90, riskFactor: 0.05,
    cannotFollow: ['anodizing', 'plating', 'painting'],
  },
  {
    kind: 'sinker-edm', name: 'Sinker EDM',
    requires: { form: 'machined' },
    produces: { toleranceUm: 10, surfaceFinish: 'fine' },
    costPerUnitUsd: 45, timePerUnitHr: 1.5, qualityImpact: 85, riskFactor: 0.07,
  },
  {
    kind: 'grinding', name: 'Surface Grinding',
    requires: { form: 'machined' },
    produces: { toleranceUm: 5, surfaceFinish: 'fine' },
    costPerUnitUsd: 15, timePerUnitHr: 0.3, qualityImpact: 80, riskFactor: 0.03,
  },
  {
    kind: 'polishing', name: 'Hand Polishing',
    requires: { form: 'machined' },
    produces: { surfaceFinish: 'polished' },
    costPerUnitUsd: 12, timePerUnitHr: 0.5, qualityImpact: 50, riskFactor: 0.02,
  },
  {
    kind: 'heat-treat', name: 'Heat Treatment',
    requires: { form: 'machined' },
    produces: { heatTreated: true },
    costPerUnitUsd: 8, timePerUnitHr: 4, qualityImpact: 70, riskFactor: 0.08,
    cannotFollow: ['anodizing', 'plating', 'painting'],
  },
  {
    kind: 'anodizing', name: 'Anodizing',
    requires: { form: 'machined' },
    produces: { coatings: ['anodize'] },
    costPerUnitUsd: 5, timePerUnitHr: 1, qualityImpact: 40, riskFactor: 0.03,
  },
  {
    kind: 'plating', name: 'Electroplating',
    requires: { form: 'machined' },
    produces: { coatings: ['plating'] },
    costPerUnitUsd: 10, timePerUnitHr: 1.5, qualityImpact: 45, riskFactor: 0.05,
  },
  {
    kind: 'painting', name: 'Powder Coat / Paint',
    requires: { form: 'machined' },
    produces: { coatings: ['paint'] },
    costPerUnitUsd: 7, timePerUnitHr: 0.5, qualityImpact: 35, riskFactor: 0.04,
  },
  {
    kind: 'passivation', name: 'Passivation',
    requires: { form: 'machined' },
    produces: { coatings: ['passivation'] },
    costPerUnitUsd: 4, timePerUnitHr: 0.4, qualityImpact: 30, riskFactor: 0.02,
  },
  {
    kind: 'inspection', name: 'CMM Inspection',
    requires: {},
    produces: {},
    costPerUnitUsd: 6, timePerUnitHr: 0.2, qualityImpact: 95, riskFactor: 0.01,
  },
];

const INITIAL_STATE: PartState = {
  form: 'raw-stock',
  toleranceUm: 1000,
  surfaceFinish: 'as-cast',
  coatings: [],
  heatTreated: false,
};

// ── Compatibility ────────────────────────────────────────────────

function isCompatible(state: PartState, step: OperationStep, prevKind: OperationKind | null): boolean {
  const r = step.requires;
  if (r.form && state.form !== r.form) {
    // We allow rough-near-net + machined for "machined" requirements.
    if (r.form === 'machined' && state.form !== 'machined') return false;
    if (r.form === 'raw-stock' && state.form !== 'raw-stock') return false;
  }
  if (r.heatTreated != null && state.heatTreated !== r.heatTreated) return false;
  if (step.cannotFollow && prevKind && step.cannotFollow.includes(prevKind)) return false;
  return true;
}

function applyStep(state: PartState, step: OperationStep): PartState {
  const p = step.produces;
  return {
    form: p.form ?? state.form,
    toleranceUm: p.toleranceUm != null && p.toleranceUm < state.toleranceUm
      ? p.toleranceUm
      : state.toleranceUm,
    surfaceFinish: p.surfaceFinish ?? state.surfaceFinish,
    coatings: p.coatings ? [...state.coatings, ...p.coatings] : state.coatings,
    heatTreated: p.heatTreated ?? state.heatTreated,
  };
}

// ── Routing search ───────────────────────────────────────────────

export interface RouteRequirements {
  /** Target tolerance (μm). The chain must reach ≤ this. */
  toleranceUm: number;
  /** Required surface finish. */
  surfaceFinish: SurfaceFinishState;
  /** Required coatings (any subset of: 'anodize', 'plating', 'paint', 'passivation'). */
  requiredCoatings?: string[];
  /** Required heat treatment? */
  heatTreated?: boolean;
}

export interface Route {
  steps: OperationStep[];
  /** Total cost / time / risk. */
  totalCostUsd: number;
  totalTimeHr: number;
  /** Mean quality impact. */
  meanQualityImpact: number;
  /** Cumulative risk (1 - Π(1 - risk)). */
  cumulativeRisk: number;
  /** Per-dimension scores for UI display. */
  dimensions: { cost: number; time: number; quality: number; risk: number };
}

function meetsRequirements(state: PartState, req: RouteRequirements): boolean {
  if (state.toleranceUm > req.toleranceUm) return false;
  const finishRank = ['as-cast', 'mill-finish', 'fine', 'polished'];
  if (finishRank.indexOf(state.surfaceFinish) < finishRank.indexOf(req.surfaceFinish)) return false;
  if (req.requiredCoatings) {
    for (const c of req.requiredCoatings) {
      if (!state.coatings.includes(c)) return false;
    }
  }
  if (req.heatTreated != null && state.heatTreated !== req.heatTreated) return false;
  return true;
}

/** DFS search up to maxDepth steps for valid routes. */
export function findRoutes(
  requirements: RouteRequirements,
  ops: OperationStep[] = OP_LIBRARY,
  maxDepth: number = 6,
  maxRoutes: number = 50,
): Route[] {
  const results: Route[] = [];
  const initialState = { ...INITIAL_STATE };

  function dfs(state: PartState, taken: OperationStep[], prevKind: OperationKind | null): void {
    if (results.length >= maxRoutes) return;
    if (meetsRequirements(state, requirements) && taken.length > 0) {
      results.push(buildRoute(taken));
      return;
    }
    if (taken.length >= maxDepth) return;
    for (const op of ops) {
      // Don't repeat the same op back-to-back.
      if (prevKind === op.kind) continue;
      if (!isCompatible(state, op, prevKind)) continue;
      const next = applyStep(state, op);
      taken.push(op);
      dfs(next, taken, op.kind);
      taken.pop();
    }
  }

  dfs(initialState, [], null);
  // Sort by weighted score: cost (0.3) + time (0.2) + quality (0.3) + risk (0.2).
  results.sort((a, b) => {
    const aS = a.dimensions.cost * 0.3 + a.dimensions.time * 0.2 + a.dimensions.quality * 0.3 + a.dimensions.risk * 0.2;
    const bS = b.dimensions.cost * 0.3 + b.dimensions.time * 0.2 + b.dimensions.quality * 0.3 + b.dimensions.risk * 0.2;
    return bS - aS;
  });
  return results;
}

function buildRoute(steps: OperationStep[]): Route {
  const totalCost = steps.reduce((s, op) => s + op.costPerUnitUsd, 0);
  const totalTime = steps.reduce((s, op) => s + op.timePerUnitHr, 0);
  const meanQ = steps.length > 0 ? steps.reduce((s, op) => s + op.qualityImpact, 0) / steps.length : 0;
  const cumRisk = 1 - steps.reduce((acc, op) => acc * (1 - op.riskFactor), 1);
  // Dimension scores (0..100). Lower cost / time / risk = higher score.
  return {
    steps: steps.slice(),
    totalCostUsd: totalCost,
    totalTimeHr: totalTime,
    meanQualityImpact: meanQ,
    cumulativeRisk: cumRisk,
    dimensions: {
      cost: Math.max(0, 100 - totalCost),
      time: Math.max(0, 100 - totalTime * 10),
      quality: meanQ,
      risk: Math.max(0, 100 * (1 - cumRisk)),
    },
  };
}
