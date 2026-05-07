/**
 * processRouter.ts — Client helper for AI Process Router (Phase 2).
 *
 * Builds candidate cost estimates locally via estimateCosts(), then asks the
 * server-side LLM to rank + explain the processes. Returns a unified result
 * combining each process's cost numbers with the AI's ranking & reasoning.
 */

import { estimateCosts, type CostEstimate, type GeometryMetrics, type ProcessType, type CostEstimationContext } from './CostEstimator';

export interface ProcessRouterUseCase {
  useCase?: 'prototype' | 'production' | 'custom';
  priority?: 'cost' | 'speed' | 'quality';
}

export interface RankedProcess {
  process: ProcessType;
  rank: number;
  score: number;
  reasoning: string;
  reasoningKo: string;
  pros: string[];
  prosKo: string[];
  cons: string[];
  consKo: string[];
  bestFor: string[];
}

/** Row combining the raw cost estimate with the LLM ranking/reasoning. */
export interface ProcessRouterResult {
  estimate: CostEstimate;
  ranking: RankedProcess;
}

export interface RouteProcessesOptions extends ProcessRouterUseCase {
  metrics: GeometryMetrics;
  material: string;
  quantity: number;
  ctx?: CostEstimationContext;
  lang?: string;
  signal?: AbortSignal;
  projectId?: string;
}

/**
 * Full pipeline: compute cost estimates locally → send to server for AI ranking
 * → return combined rows, already sorted by rank (best fit first).
 */
export async function routeProcesses(opts: RouteProcessesOptions): Promise<ProcessRouterResult[]> {
  const estimates = estimateCosts(opts.metrics, opts.material, [opts.quantity], opts.ctx ?? {});
  if (estimates.length === 0) return [];

  const candidates = estimates.map(e => ({
    process: e.process,
    processName: e.processName,
    totalCost: e.totalCost,
    unitCost: e.unitCost,
    leadTime: e.leadTime,
    currency: e.currency,
    difficulty: e.difficulty,
    confidence: e.confidence,
  }));

  const payload = {
    metrics: opts.metrics,
    material: opts.material,
    quantity: opts.quantity,
    useCase: opts.useCase,
    priority: opts.priority,
    candidates,
    lang: opts.lang ?? 'en',
    projectId: opts.projectId,
  };

  const res = await fetch('/api/nexyfab/process-router', {
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

  const data = await res.json() as { ranked: RankedProcess[] };

  // Join rankings with their cost estimates, preserve rank order
  const byProcess = new Map(estimates.map(e => [e.process, e]));
  const results: ProcessRouterResult[] = [];
  for (const r of data.ranked) {
    const estimate = byProcess.get(r.process);
    if (estimate) results.push({ estimate, ranking: r });
  }
  return results;
}
