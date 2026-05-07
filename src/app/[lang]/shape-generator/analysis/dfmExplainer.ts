/**
 * dfmExplainer.ts — Client helper for AI DFM Explainer (Phase 1).
 *
 * Given a detected DFMIssue, fetches a natural-language explanation from the
 * server-side /api/nexyfab/dfm-explainer endpoint. When a fix suggestion has a
 * `paramHint`, the caller can use `calculateCostDelta()` to compute the
 * before/after cost impact locally via the existing CostEstimator.
 */

import type { DFMIssue, ManufacturingProcess } from './dfmAnalysis';
import type { CostEstimate, GeometryMetrics, CostEstimationContext } from '../estimation/CostEstimator';
import { estimateCosts } from '../estimation/CostEstimator';

export interface DFMAlternative {
  label: string;
  labelKo: string;
  rationale: string;
  rationaleKo: string;
  paramHint?: { key: string; delta: number };
}

export interface DFMExplanation {
  rootCause: string;
  rootCauseKo: string;
  processImpact: string;
  processImpactKo: string;
  alternatives: DFMAlternative[];
  costNote: string;
  costNoteKo: string;
}

export interface CostDelta {
  before: number;
  after: number;
  delta: number;
  percentChange: number;
  currency: string;
}

export interface ExplainOptions {
  process: ManufacturingProcess;
  material?: string;
  params?: Record<string, number>;
  lang?: string;
  signal?: AbortSignal;
  projectId?: string;
}

// ─── API call ────────────────────────────────────────────────────────────

export async function explainDFMIssue(
  issue: DFMIssue,
  opts: ExplainOptions,
): Promise<DFMExplanation> {
  const payload = {
    issue: {
      type: issue.type,
      severity: issue.severity,
      description: issue.description,
      suggestion: issue.suggestion,
    },
    process: opts.process,
    material: opts.material,
    params: opts.params,
    lang: opts.lang ?? 'en',
    projectId: opts.projectId,
  };

  const res = await fetch('/api/nexyfab/dfm-explainer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string; requiresPro?: boolean };
    const wrapped = new Error(err.error ?? `HTTP ${res.status}`) as Error & { requiresPro?: boolean; status?: number };
    wrapped.requiresPro = err.requiresPro;
    wrapped.status = res.status;
    throw wrapped;
  }

  const data = await res.json() as { explanation: DFMExplanation };
  return data.explanation;
}

// ─── Local cost-delta calculator ─────────────────────────────────────────

/**
 * Computes the before/after cost delta for a given parameter change, using the
 * existing `estimateCosts()` pipeline. Both calls share identical metrics +
 * material + context — only the parameter override differs.
 *
 * For DFM fixes the common case is "add 1mm to thickness" or "add draft angle"
 * which primarily affects material volume. Callers provide the *recomputed*
 * metrics after applying the change — this function does not mutate geometry.
 */
export function calculateCostDelta(
  metricsBefore: GeometryMetrics,
  metricsAfter: GeometryMetrics,
  materialId: string,
  quantity: number,
  ctx: CostEstimationContext = {},
): CostDelta | null {
  const before = estimateCosts(metricsBefore, materialId, [quantity], ctx);
  const after = estimateCosts(metricsAfter, materialId, [quantity], ctx);
  if (before.length === 0 || after.length === 0) return null;

  // Pick the cheapest process in each set as the reference (same process family
  // for before/after — the estimator orders consistently for identical inputs).
  const pickCheapest = (list: CostEstimate[]) => list.reduce((a, b) => (a.totalCost < b.totalCost ? a : b));
  const b = pickCheapest(before);
  const a = pickCheapest(after);

  const delta = a.totalCost - b.totalCost;
  const pct = b.totalCost > 0 ? (delta / b.totalCost) * 100 : 0;

  return {
    before: b.totalCost,
    after: a.totalCost,
    delta,
    percentChange: Math.round(pct * 10) / 10,
    currency: a.currency,
  };
}

/**
 * Rough volume estimate for a parameter hint like `{ key: 'thickness', delta: +1 }`.
 * Used when the caller wants a quick cost-delta preview without re-meshing geometry.
 *
 * Returns an adjusted GeometryMetrics where `volume_cm3` is scaled by the ratio of
 * new/old thickness (assuming thickness is a first-order multiplier on volume).
 * This is deliberately approximate — good enough for the DFM panel's preview UX.
 */
export function approximateMetricsAfterHint(
  metrics: GeometryMetrics,
  currentParams: Record<string, number>,
  hint: { key: string; delta: number },
): GeometryMetrics {
  const current = currentParams[hint.key];
  if (typeof current !== 'number' || current <= 0) return metrics;
  const next = Math.max(0.1, current + hint.delta);

  // Heuristic: thickness/diameter-like params scale volume roughly linearly;
  // angular params (draft, angle) barely change volume.
  const isLinear = /thickness|wall|diameter|depth|height/i.test(hint.key);
  if (!isLinear) return metrics;

  const ratio = next / current;
  return {
    ...metrics,
    volume_cm3: metrics.volume_cm3 * ratio,
    surfaceArea_cm2: metrics.surfaceArea_cm2 * Math.pow(ratio, 2 / 3),
  };
}
