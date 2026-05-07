/**
 * costCopilot.ts — Client helper for the Design-for-Cost Copilot (Phase 4).
 *
 * Sends the current design state + user message to /api/nexyfab/cost-copilot,
 * gets back LLM-authored suggestions (paramDeltas / materialSwap / processSwap),
 * and attaches a *real* cost delta to each suggestion using the local
 * `estimateCosts()` pipeline — so the UI can show actual numbers instead of
 * the model's rough `estimatedSavingsPercent` guess.
 */

import {
  estimateCosts,
  type GeometryMetrics,
  type CostEstimate,
  type CostEstimationContext,
} from '../estimation/CostEstimator';
import { approximateMetricsAfterHint, type CostDelta } from './dfmExplainer';

export interface CopilotSuggestion {
  id: string;
  title: string;
  titleKo: string;
  rationale: string;
  rationaleKo: string;
  paramDeltas?: Record<string, number>;
  materialSwap?: string;
  processSwap?: string;
  estimatedSavingsPercent: number;
  caveat?: string;
  caveatKo?: string;
}

export interface CopilotResponse {
  reply: string;
  replyKo: string;
  suggestions: CopilotSuggestion[];
}

/** Server suggestion plus locally-computed real cost delta. */
export interface CopilotSuggestionWithDelta extends CopilotSuggestion {
  /** Real cost delta computed via estimateCosts(); null if geometry/material info missing. */
  costDelta: CostDelta | null;
}

export interface AskCopilotOptions {
  userMessage: string;
  params: Record<string, number>;
  materialId: string;
  process: string;
  quantity: number;
  /** Optional local metrics — enables real cost-delta computation per suggestion. */
  metrics?: GeometryMetrics | null;
  ctx?: CostEstimationContext;
  lang?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
  projectId?: string;
}

export interface AskCopilotResult {
  reply: string;
  replyKo: string;
  suggestions: CopilotSuggestionWithDelta[];
}

// ─── POST wrapper ─────────────────────────────────────────────────────────

export async function askCostCopilot(opts: AskCopilotOptions): Promise<AskCopilotResult> {
  const payload = {
    userMessage: opts.userMessage,
    params: opts.params,
    materialId: opts.materialId,
    process: opts.process,
    quantity: opts.quantity,
    lang: opts.lang ?? 'en',
    history: opts.history,
    projectId: opts.projectId,
  };

  const res = await fetch('/api/nexyfab/cost-copilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string; requiresPro?: boolean };
    const wrapped = new Error(err.error ?? `HTTP ${res.status}`) as Error & { requiresPro?: boolean; status?: number };
    wrapped.requiresPro = err.requiresPro;
    wrapped.status = res.status;
    throw wrapped;
  }

  const data = await res.json() as CopilotResponse;

  // Attach real cost deltas locally.
  const suggestions: CopilotSuggestionWithDelta[] = data.suggestions.map(s => ({
    ...s,
    costDelta: opts.metrics ? computeSuggestionDelta(s, opts) : null,
  }));

  return { reply: data.reply, replyKo: data.replyKo, suggestions };
}

// ─── Per-suggestion cost delta ────────────────────────────────────────────

function pickCheapest(list: CostEstimate[]): CostEstimate | null {
  if (list.length === 0) return null;
  return list.reduce((a, b) => (a.totalCost < b.totalCost ? a : b));
}

/**
 * Re-runs estimateCosts for the suggestion's proposed change.
 * - `paramDeltas` adjust geometry via `approximateMetricsAfterHint`.
 * - `materialSwap` swaps the material id.
 * - `processSwap` is only informational here (estimateCosts returns all processes;
 *   we still compare totals of the cheapest matching process family when possible).
 */
function computeSuggestionDelta(s: CopilotSuggestion, opts: AskCopilotOptions): CostDelta | null {
  if (!opts.metrics) return null;

  const before = estimateCosts(opts.metrics, opts.materialId, [opts.quantity], opts.ctx ?? {});
  if (before.length === 0) return null;

  // Apply paramDeltas one key at a time (heuristic).
  let afterMetrics = opts.metrics;
  if (s.paramDeltas) {
    for (const [key, delta] of Object.entries(s.paramDeltas)) {
      if (typeof delta !== 'number' || delta === 0) continue;
      afterMetrics = approximateMetricsAfterHint(afterMetrics, opts.params, { key, delta });
    }
  }

  const afterMaterial = s.materialSwap ?? opts.materialId;
  const after = estimateCosts(afterMetrics, afterMaterial, [opts.quantity], opts.ctx ?? {});
  if (after.length === 0) return null;

  const b = pickCheapest(before);
  const a = pickCheapest(after);
  if (!a || !b) return null;

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
