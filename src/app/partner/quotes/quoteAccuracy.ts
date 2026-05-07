export interface QuoteEntry {
  entryId?: string;
  process?: string;
  material?: string;
  draftAmount: number;
  acceptedAmount?: number | null;
  actualCost?: number | null;
  quantity?: number;
  deadlineDays?: number;
}

export interface ProcessBias {
  process: string;
  biasPercent: number;
  avgAccuracy: number;
  sampleCount: number;
  recommendation: string;
  recommendationKo: string;
}

export interface AccuracySuggestion {
  title: string;
  titleKo: string;
  detail: string;
  detailKo: string;
  adjustmentPercent: number;
}

export interface QuoteAccuracyResult {
  overallAccuracy: number;
  overallBiasPercent: number;
  processBias: ProcessBias[];
  suggestions: AccuracySuggestion[];
  summary: string;
  summaryKo: string;
  entriesAnalysed: number;
}

export async function analyzeQuoteAccuracy(opts: {
  entries: QuoteEntry[];
  partner?: { hourlyRateKrw?: number; processes?: string[] };
  lang?: string;
  projectId?: string;
}): Promise<QuoteAccuracyResult> {
  const res = await fetch('/api/nexyfab/quote-accuracy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error ?? 'Quote accuracy analysis failed') as Error & { requiresPro?: boolean };
    err.requiresPro = data.requiresPro;
    throw err;
  }
  return data as QuoteAccuracyResult;
}
