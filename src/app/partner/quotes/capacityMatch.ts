export interface PartnerProfile {
  processes: string[];
  certifications?: string[];
  idleWindowDays: number;
  hourlyRateKrw?: number;
  leadCapacityDays?: number;
  company?: string;
}

export interface OpenRfqInput {
  rfqId: string;
  projectName: string;
  process?: string;
  material?: string;
  quantity?: number;
  dfmScore?: number | null;
  certifications?: string[];
  deadlineDate?: string;
  budgetKrw?: number;
}

export interface MatchedRfq {
  rfqId: string;
  projectName: string;
  matchScore: number;
  matchReasons: string[];
  matchReasonsKo: string[];
  estimatedMarginKrw: number | null;
  urgency: 'high' | 'medium' | 'low';
  urgencyKo: string;
  pitchSubject: string;
  pitchBody: string;
  pitchSubjectKo: string;
  pitchBodyKo: string;
}

export interface CapacityMatchResult {
  matches: MatchedRfq[];
  summary: string;
  summaryKo: string;
  idleWindowDays: number;
  totalMatched: number;
}

export async function matchCapacity(opts: {
  partner: PartnerProfile;
  openRfqs?: OpenRfqInput[];
  lang?: string;
  projectId?: string;
}): Promise<CapacityMatchResult> {
  const res = await fetch('/api/nexyfab/capacity-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error ?? 'Capacity match failed') as Error & { requiresPro?: boolean };
    err.requiresPro = data.requiresPro;
    throw err;
  }
  return data as CapacityMatchResult;
}
