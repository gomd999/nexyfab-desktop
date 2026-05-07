/**
 * orderPriority.ts — Partner-side client helper for Phase 8-2 Order Priority Scorer.
 */

export interface IncomingQuote {
  id: string;
  projectName: string;
  estimatedAmount: number;
  status: string;
  dfmScore?: number | null;
  dfmProcess?: string | null;
  validUntil?: string | null;
  details?: string | null;
  bbox?: { w: number; h: number; d: number } | null;
}

export interface PartnerProfile {
  hourlyRateKrw?: number;
  materialMargin?: number;
  processes?: string[];
  certifications?: string[];
  currentBacklogDays?: number;
  leadCapacityDays?: number;
}

export interface RankedQuote {
  id: string;
  projectName: string;
  estimatedAmount: number;
  score: number;
  tag: 'priority' | 'good_fit' | 'consider' | 'pass';
  estimatedMarginKrw: number;
  marginPct: number;
  reasons: string[];
  reasonsKo: string[];
  riskFlags: string[];
  riskFlagsKo: string[];
}

export interface PriorityResult {
  ranked: RankedQuote[];
  summary: string;
  summaryKo: string;
  topPick?: string;
  topPickKo?: string;
}

export interface OrderPriorityOptions {
  quotes: IncomingQuote[];
  partner?: PartnerProfile;
  lang?: string;
  projectId?: string;
  signal?: AbortSignal;
}

export async function scoreOrderPriority(opts: OrderPriorityOptions): Promise<PriorityResult> {
  const res = await fetch('/api/nexyfab/order-priority', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quotes: opts.quotes,
      partner: opts.partner,
      lang: opts.lang ?? 'ko',
      projectId: opts.projectId,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string; requiresPro?: boolean };
    const wrapped = new Error(err.error ?? `HTTP ${res.status}`) as Error & { requiresPro?: boolean; status?: number };
    wrapped.requiresPro = err.requiresPro;
    wrapped.status = res.status;
    throw wrapped;
  }

  return await res.json() as PriorityResult;
}
