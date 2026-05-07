/**
 * quoteNegotiator.ts — Client helper for Phase 8-1 Quote Negotiation Assistant.
 */

export interface QuoteInput {
  id: string;
  factoryName: string;
  estimatedAmount: number;
  estimatedDays: number | null;
  note?: string | null;
  validUntil?: string | null;
}

export interface RfqContext {
  rfqId?: string;
  projectName?: string;
  material?: string;
  process?: string;
  quantity?: number;
  targetBudgetKrw?: number;
  targetLeadDays?: number;
}

export interface RankedQuote {
  id: string;
  factoryName: string;
  estimatedAmount: number;
  estimatedDays: number | null;
  tag: 'best_price' | 'fastest' | 'balanced' | 'expensive' | null;
  vsLowest: number;
  score: number;
}

export interface NegotiationDraft {
  supplierId: string;
  supplierName: string;
  subject: string;
  subjectKo: string;
  body: string;
  bodyKo: string;
  asks: string[];
  asksKo: string[];
}

export interface NegotiatorResult {
  ranked: RankedQuote[];
  recommendation: string;
  recommendationKo: string;
  negotiations: NegotiationDraft[];
  summary: string;
  summaryKo: string;
}

export interface NegotiatorOptions {
  rfq: RfqContext;
  quotes: QuoteInput[];
  negotiateWith?: string[];
  goal?: 'price' | 'leadtime' | 'both';
  lang?: string;
  projectId?: string;
  signal?: AbortSignal;
}

export async function negotiateQuotes(opts: NegotiatorOptions): Promise<NegotiatorResult> {
  const res = await fetch('/api/nexyfab/quote-negotiator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rfq: opts.rfq,
      quotes: opts.quotes,
      negotiateWith: opts.negotiateWith,
      goal: opts.goal ?? 'both',
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

  return await res.json() as NegotiatorResult;
}
