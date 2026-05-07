/**
 * changeDetector.ts — Client helper for Phase 9-1 Design Change Detector.
 */

export interface DesignSpec {
  label?: string;
  material?: string;
  process?: string;
  quantity?: number;
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  tolerance?: string;
  surfaceFinish?: string;
  dfmScore?: number | null;
  certifications?: string[];
  note?: string;
}

export interface ActiveRfq {
  rfqId: string;
  status: string;
  assignedFactory?: string;
}

export interface SpecDiff {
  field: string;
  fieldKo: string;
  prev: string;
  next: string;
  impact: 'high' | 'medium' | 'low';
  impactKo: string;
}

export interface ChangeDetectorResult {
  diffs: SpecDiff[];
  costImpact: 'increase' | 'decrease' | 'neutral' | 'unknown';
  costImpactKo: string;
  leadImpact: 'increase' | 'decrease' | 'neutral' | 'unknown';
  leadImpactKo: string;
  reRfqRequired: boolean;
  reRfqReason: string;
  reRfqReasonKo: string;
  actions: string[];
  actionsKo: string[];
  summary: string;
  summaryKo: string;
  affectedRfqs: string[];
}

export interface ChangeDetectorOptions {
  prev: DesignSpec;
  next: DesignSpec;
  activeRfqs?: ActiveRfq[];
  lang?: string;
  projectId?: string;
  signal?: AbortSignal;
}

export async function detectChanges(opts: ChangeDetectorOptions): Promise<ChangeDetectorResult> {
  const res = await fetch('/api/nexyfab/change-detector', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prev: opts.prev,
      next: opts.next,
      activeRfqs: opts.activeRfqs,
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

  return await res.json() as ChangeDetectorResult;
}
