/**
 * certFilter.ts — Client helper for AI Cert/Reg Filter (Phase 7-2).
 */

export interface CertEntry {
  code: string;
  name: string;
  nameKo: string;
  required: boolean;
  reason: string;
  reasonKo: string;
  region?: string;
}

export interface SupplierCertScore {
  id?: string;
  have: string[];
  missing: string[];
  score: number;
}

export interface CertFilterResult {
  industry: string;
  required: CertEntry[];
  recommended: CertEntry[];
  supplierScores?: SupplierCertScore[];
  summary: string;
  summaryKo: string;
}

export interface CertFilterOptions {
  industry: string;
  region?: 'KR' | 'US' | 'EU' | 'global';
  useCase?: string;
  material?: string;
  process?: string;
  suppliers?: Array<{ id?: string; certifications?: string[] }>;
  lang?: string;
  projectId?: string;
  signal?: AbortSignal;
}

export async function filterCerts(opts: CertFilterOptions): Promise<CertFilterResult> {
  const res = await fetch('/api/nexyfab/cert-filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      industry: opts.industry,
      region: opts.region,
      useCase: opts.useCase,
      material: opts.material,
      process: opts.process,
      suppliers: opts.suppliers,
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

  return await res.json() as CertFilterResult;
}
