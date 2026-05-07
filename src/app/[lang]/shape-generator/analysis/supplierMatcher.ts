/**
 * supplierMatcher.ts — Client helper for AI Supplier Matcher (Phase 3).
 *
 * 1. Fetches candidate manufacturers from /api/nexyfab/manufacturers (public).
 * 2. Pre-scores them locally against the shape context.
 * 3. Posts the scored candidates to /api/nexyfab/supplier-matcher where the
 *    server-side LLM picks the Top-3 with reasoning and RFQ talking points.
 */

import type { Manufacturer } from './ManufacturerMatch';

export interface SupplierCandidate extends Manufacturer {
  matchScore: number;
}

export interface RankedSupplier {
  id: string;
  rank: number;
  score: number;
  reasoning: string;
  reasoningKo: string;
  strengths: string[];
  strengthsKo: string[];
  concerns: string[];
  concernsKo: string[];
  rfqTalkingPoints: string[];
  rfqTalkingPointsKo: string[];
}

/** Row combining the manufacturer record with the AI ranking/reasoning. */
export interface SupplierMatchResult {
  manufacturer: SupplierCandidate;
  ranking: RankedSupplier;
}

export interface MatchSuppliersOptions {
  material: string;
  process: string;
  quantity: number;
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  useCase?: 'prototype' | 'production' | 'custom';
  priority?: 'cost' | 'speed' | 'quality';
  lang?: string;
  /** Optional region filter (e.g. 'KR') passed to /manufacturers endpoint */
  region?: string;
  signal?: AbortSignal;
  projectId?: string;
}

// ─── Local scoring (mirrors ManufacturerMatch.computeMatchScore, trimmed) ──

const MATERIAL_AFFINITY: Record<string, string[]> = {
  aluminum:        ['cnc_milling', 'cnc_turning', 'sheet_metal', '3d_printing'],
  steel:           ['cnc_milling', 'cnc_turning', 'casting', 'sheet_metal'],
  stainless_steel: ['cnc_milling', 'cnc_turning', '3d_printing'],
  titanium:        ['3d_printing', 'cnc_milling', 'cnc_turning'],
  copper:          ['cnc_milling', 'cnc_turning', 'casting'],
  brass:           ['cnc_milling', 'cnc_turning'],
  abs:             ['3d_printing', 'injection_molding'],
  pla:             ['3d_printing'],
  nylon:           ['3d_printing', 'injection_molding'],
  pc:              ['3d_printing', 'injection_molding'],
  resin:           ['3d_printing'],
  wood:            ['cnc_milling'],
  default:         ['cnc_milling', 'cnc_turning', '3d_printing'],
};

function scoreCandidate(m: Manufacturer, opts: MatchSuppliersOptions): number {
  const affinities = MATERIAL_AFFINITY[opts.material] ?? MATERIAL_AFFINITY.default;
  const hasAffinity = m.processes.some(p => affinities.includes(p));
  const offersExact = m.processes.includes(opts.process);
  const primary = m.processes[0] === affinities[0];
  const affinityScore = offersExact ? 42 : hasAffinity ? (primary ? 32 : 24) : 8;

  const maxDim = opts.bbox ? Math.max(opts.bbox.w, opts.bbox.h, opts.bbox.d) : 150;
  const sizeFit = maxDim < 50 ? 22 : maxDim < 300 ? 25 : maxDim < 600 ? 18 : 10;

  const rating = Math.round((m.rating / 5) * 20);
  const leadTime = m.minLeadTime <= 5 ? 13 : m.minLeadTime <= 10 ? 9 : m.minLeadTime <= 20 ? 5 : 2;

  // Priority-aware tilt
  let tilt = 0;
  if (opts.priority === 'cost' && ((m.priceLevel as string) === 'low' || (m.priceLevel as string) === 'budget')) tilt += 4;
  if (opts.priority === 'speed' && m.minLeadTime <= 7) tilt += 4;
  if (opts.priority === 'quality' && (m.rating >= 4.5 || m.certifications.length >= 2)) tilt += 4;

  return Math.max(0, Math.min(100, Math.round(affinityScore + sizeFit + rating + leadTime + tilt)));
}

// ─── Entry point ──────────────────────────────────────────────────────────

export async function matchSuppliers(opts: MatchSuppliersOptions): Promise<SupplierMatchResult[]> {
  // 1. Fetch candidates from the public manufacturers listing
  const listUrl = new URL('/api/nexyfab/manufacturers', window.location.origin);
  if (opts.region) listUrl.searchParams.set('region', opts.region);
  if (opts.process) listUrl.searchParams.set('process', opts.process);

  const listRes = await fetch(listUrl.toString(), { signal: opts.signal });
  if (!listRes.ok) throw new Error(`Failed to load manufacturers (HTTP ${listRes.status})`);
  const listData = await listRes.json() as { manufacturers?: Manufacturer[] };
  const all = listData.manufacturers ?? [];
  if (all.length === 0) return [];

  // 2. Pre-score locally
  const scored: SupplierCandidate[] = all.map(m => ({
    ...m,
    matchScore: scoreCandidate(m, opts),
  }));

  // 3. Ask server-side LLM to pick Top 3
  const payload = {
    candidates: scored.map(c => ({
      id: c.id,
      name: c.name,
      nameKo: c.nameKo,
      region: c.region,
      processes: c.processes,
      minLeadTime: c.minLeadTime,
      maxLeadTime: c.maxLeadTime,
      rating: c.rating,
      reviewCount: c.reviewCount,
      priceLevel: c.priceLevel,
      certifications: c.certifications,
      matchScore: c.matchScore,
    })),
    material: opts.material,
    process: opts.process,
    quantity: opts.quantity,
    volume_cm3: opts.volume_cm3,
    bbox: opts.bbox,
    useCase: opts.useCase,
    priority: opts.priority,
    lang: opts.lang ?? 'en',
    projectId: opts.projectId,
  };

  const res = await fetch('/api/nexyfab/supplier-matcher', {
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

  const data = await res.json() as { ranked: RankedSupplier[] };

  // 4. Join rankings with full manufacturer records
  const byId = new Map(scored.map(c => [c.id, c]));
  const results: SupplierMatchResult[] = [];
  for (const r of data.ranked) {
    const mfr = byId.get(r.id);
    if (mfr) results.push({ manufacturer: mfr, ranking: r });
  }
  return results;
}
