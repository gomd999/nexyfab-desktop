/**
 * rfqResponder.ts — Partner-side client helper for AI RFQ Response Assistant (Phase 7-3).
 */

export interface RfqBrief {
  quoteId?: string;
  partName?: string;
  projectName?: string;
  material?: string;
  process?: string;
  quantity?: number;
  budgetKrw?: number;
  dfmScore?: number | null;
  customerNote?: string;
  bbox?: { w: number; h: number; d: number } | null;
  certificationsRequired?: string[];
  deadline?: string;
}

export interface PartnerCapacity {
  hourlyRateKrw?: number;
  materialMargin?: number;
  currentBacklog?: number;
  leadCapacityDays?: number;
  certifications?: string[];
  processes?: string[];
}

export interface BreakdownLine {
  label: string;
  labelKo: string;
  amountKrw: number;
}

export interface RfqResponseDraft {
  estimatedAmount: number;
  estimatedAmountKrw: number;
  estimatedDays: number;
  note: string;
  noteKo: string;
  breakdown: BreakdownLine[];
  confidence: number;
  caveats: string[];
  caveatsKo: string[];
}

export interface RfqResponderOptions {
  rfq: RfqBrief;
  partner?: PartnerCapacity;
  lang?: string;
  projectId?: string;
  signal?: AbortSignal;
}

export async function draftRfqResponse(opts: RfqResponderOptions): Promise<RfqResponseDraft> {
  const res = await fetch('/api/nexyfab/rfq-responder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rfq: opts.rfq,
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

  return await res.json() as RfqResponseDraft;
}
