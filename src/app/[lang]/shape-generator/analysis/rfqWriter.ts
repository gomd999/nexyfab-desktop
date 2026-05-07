/**
 * rfqWriter.ts — Client helper for AI RFQ Writer (Phase 7-1).
 */

export interface RfqSupplierBrief {
  id?: string;
  name?: string;
  nameKo?: string;
  region?: string;
  certifications?: string[];
  processes?: string[];
  rating?: number;
  minLeadTime?: number;
  maxLeadTime?: number;
}

export interface RfqDraft {
  subject: string;
  subjectKo: string;
  body: string;
  bodyKo: string;
  asks: string[];
  asksKo: string[];
  attachmentsChecklist: string[];
  attachmentsChecklistKo: string[];
}

export interface WriteRfqOptions {
  supplier: RfqSupplierBrief;
  partName?: string;
  material: string;
  process: string;
  quantity: number;
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  tolerance?: string;
  surfaceFinish?: string;
  certificationsRequired?: string[];
  talkingPoints?: string[];
  tone?: 'formal' | 'concise' | 'collaborative';
  lang?: string;
  projectId?: string;
  signal?: AbortSignal;
}

export async function writeRfq(opts: WriteRfqOptions): Promise<RfqDraft> {
  const res = await fetch('/api/nexyfab/rfq-writer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      supplier: opts.supplier,
      partName: opts.partName,
      material: opts.material,
      process: opts.process,
      quantity: opts.quantity,
      volume_cm3: opts.volume_cm3,
      bbox: opts.bbox,
      tolerance: opts.tolerance,
      surfaceFinish: opts.surfaceFinish,
      certificationsRequired: opts.certificationsRequired,
      talkingPoints: opts.talkingPoints,
      tone: opts.tone,
      lang: opts.lang ?? 'en',
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

  return await res.json() as RfqDraft;
}
