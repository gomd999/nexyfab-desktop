/**
 * supplierMatchingStage2.ts — Multi-criteria supplier scoring.
 *
 * Stage 1 (`supplierData.matchSuppliers`) filters by process/material
 * and sorts by star rating. That single-score approach hides why a
 * supplier wins or loses, and conflates very different evaluation
 * dimensions. Per the project's "평가는 단일 신용점수 ❌" rule
 * (`feedback_metric_design`), Stage 2 splits the match into
 * independent dimensions and exposes each one in the result.
 *
 * Dimensions (0..100):
 *   - **capability**: process + material + tolerance fit
 *   - **leadTime**: how well their lead-time range matches the deadline
 *   - **cost**: relative position in market cost (cheaper = higher score)
 *   - **proximity**: same region / same metro / national / international
 *   - **certifications**: must-have certs covered + extras as bonus
 *   - **quality**: past star rating × review-count confidence
 *   - **capacity**: estimated free capacity vs request size
 *
 * UI presents these as a radar / bar group, not a single ranked score.
 * For convenience the function does compute a weighted aggregate too,
 * but callers should display the per-dimension breakdown alongside.
 */

import type { Supplier, ProcessType } from './supplierData';

export interface MatchRequest {
  process: ProcessType;
  materialId: string;
  /** Required certifications. Hard filter — supplier must have all of these. */
  requiredCertifications?: string[];
  /** Soft preference for these certifications. Bonus, not filter. */
  preferredCertifications?: string[];
  /** Deadline in days. */
  deadlineDays?: number;
  /** Customer region (for proximity scoring). */
  customerRegion?: string;
  /** Order budget per unit (KRW). */
  unitBudgetKrw?: number;
  /** Quantity. */
  quantity?: number;
  /** Tolerance grade requested. */
  toleranceGrade?: 'iso2768-m' | 'iso2768-f' | 'precision' | 'high-precision';
  /** Custom dimension weights — default equal. */
  weights?: Partial<Record<MatchDimension, number>>;
}

export type MatchDimension =
  | 'capability'
  | 'leadTime'
  | 'cost'
  | 'proximity'
  | 'certifications'
  | 'quality'
  | 'capacity';

export interface DimensionScore {
  dimension: MatchDimension;
  /** 0..100 raw score. */
  score: number;
  /** Short human-readable reason. */
  reason: string;
}

export interface SupplierMatchResult {
  supplier: Supplier;
  /** Per-dimension breakdown — always emitted, regardless of weights. */
  dimensions: DimensionScore[];
  /** Optional weighted aggregate. Callers should NOT display this in
   *  isolation — show dimensions alongside. */
  weightedScore: number;
  /** Whether this supplier passed all hard filters. */
  qualified: boolean;
  /** Reasons the supplier was disqualified, if any. */
  disqualifiers: string[];
}

const DEFAULT_WEIGHTS: Record<MatchDimension, number> = {
  capability: 1.0,
  leadTime: 1.0,
  cost: 1.0,
  proximity: 0.5,
  certifications: 1.0,
  quality: 1.0,
  capacity: 0.5,
};

// ── Per-dimension scorers ────────────────────────────────────────

function scoreCapability(s: Supplier, req: MatchRequest): DimensionScore {
  const matchProcess = s.processes.includes(req.process);
  const baseMat = req.materialId.split('_')[0]!;
  const matchMaterial = s.materials.includes(req.materialId) || s.materials.includes(baseMat);
  if (!matchProcess) {
    return { dimension: 'capability', score: 0, reason: `process ${req.process} not offered` };
  }
  if (!matchMaterial) {
    return { dimension: 'capability', score: 0, reason: `material ${req.materialId} not stocked` };
  }
  // Tolerance grade match — if tighter than typical, dock points.
  let score = 90;
  if (req.toleranceGrade === 'high-precision') {
    if (!s.certifications.some(c => c === 'IATF16949' || c === 'AS9100')) score -= 30;
  } else if (req.toleranceGrade === 'precision') {
    if (!s.certifications.includes('ISO9001')) score -= 15;
  }
  return { dimension: 'capability', score: Math.max(0, Math.min(100, score)), reason: 'process + material covered' };
}

function scoreLeadTime(s: Supplier, req: MatchRequest): DimensionScore {
  if (req.deadlineDays == null) {
    return { dimension: 'leadTime', score: 70, reason: 'no deadline given' };
  }
  const offered = (s.leadTimeDays.min + s.leadTimeDays.max) / 2;
  const slack = req.deadlineDays - offered;
  if (slack < 0) {
    return { dimension: 'leadTime', score: 0, reason: `late by ${(-slack).toFixed(0)} days` };
  }
  // Score grows with slack but plateaus.
  const score = Math.min(100, 50 + slack * 5);
  return { dimension: 'leadTime', score, reason: `${offered.toFixed(0)}d offered vs ${req.deadlineDays}d deadline` };
}

function scoreCost(s: Supplier, req: MatchRequest): DimensionScore {
  if (req.unitBudgetKrw == null || req.quantity == null) {
    return { dimension: 'cost', score: 60, reason: 'no budget given' };
  }
  const orderTotal = req.unitBudgetKrw * req.quantity;
  if (orderTotal < s.minOrderKRW) {
    return {
      dimension: 'cost',
      score: 10,
      reason: `order ${orderTotal.toLocaleString()}원 below min ${s.minOrderKRW.toLocaleString()}원`,
    };
  }
  const headroom = orderTotal / s.minOrderKRW;
  // 1.0 = at minimum, 5+ = well within budget.
  const score = Math.min(100, 40 + headroom * 12);
  return { dimension: 'cost', score, reason: `${(headroom).toFixed(1)}× min-order` };
}

function scoreProximity(s: Supplier, req: MatchRequest): DimensionScore {
  if (!req.customerRegion) {
    return { dimension: 'proximity', score: 60, reason: 'no region preference' };
  }
  if (s.region === req.customerRegion) {
    return { dimension: 'proximity', score: 100, reason: `same region (${s.regionLabel})` };
  }
  // Capital metro (Seoul + Gyeonggi + Incheon) treated as one bloc.
  const metroCapital = new Set(['seoul', 'gyeonggi', 'incheon']);
  if (metroCapital.has(s.region) && metroCapital.has(req.customerRegion)) {
    return { dimension: 'proximity', score: 80, reason: 'within capital metro' };
  }
  return { dimension: 'proximity', score: 40, reason: `different region (${s.regionLabel})` };
}

function scoreCertifications(s: Supplier, req: MatchRequest): DimensionScore {
  const required = req.requiredCertifications ?? [];
  const preferred = req.preferredCertifications ?? [];
  const missing = required.filter(c => !s.certifications.includes(c));
  if (missing.length > 0) {
    return {
      dimension: 'certifications',
      score: 0,
      reason: `missing: ${missing.join(', ')}`,
    };
  }
  if (required.length === 0 && preferred.length === 0) {
    return { dimension: 'certifications', score: 70, reason: 'no certifications requested' };
  }
  // Bonus for each preferred cert held.
  const preferredHeld = preferred.filter(c => s.certifications.includes(c)).length;
  const base = required.length > 0 ? 80 : 70;
  const score = Math.min(100, base + preferredHeld * 5);
  return { dimension: 'certifications', score, reason: `${preferredHeld}/${preferred.length} preferred held` };
}

function scoreQuality(s: Supplier): DimensionScore {
  // Bayesian-flavour weighting — few reviews shrink toward neutral 3 stars.
  const reviewWeight = Math.min(1, s.reviewCount / 50);
  const effectiveStars = s.ratingStars * reviewWeight + 3 * (1 - reviewWeight);
  const score = (effectiveStars / 5) * 100;
  return {
    dimension: 'quality',
    score,
    reason: `${s.ratingStars.toFixed(1)}★ from ${s.reviewCount} reviews`,
  };
}

function scoreCapacity(s: Supplier, req: MatchRequest): DimensionScore {
  // Without real-time capacity data, use review count as a rough proxy
  // — busier shops are more capacity-constrained.
  // Quantity matters too: tiny orders fit anywhere.
  const qty = req.quantity ?? 1;
  if (qty < 10) {
    return { dimension: 'capacity', score: 90, reason: 'small order — easy fit' };
  }
  if (s.reviewCount > 200) {
    return { dimension: 'capacity', score: 60, reason: 'busy shop — queue likely' };
  }
  return { dimension: 'capacity', score: 75, reason: 'available' };
}

// ── Main entry point ─────────────────────────────────────────────

export function matchSuppliersStage2(
  suppliers: Supplier[],
  request: MatchRequest,
): SupplierMatchResult[] {
  const weights: Record<MatchDimension, number> = { ...DEFAULT_WEIGHTS, ...request.weights };
  const weightSum = Object.values(weights).reduce((s, w) => s + w, 0);

  const results: SupplierMatchResult[] = suppliers.map(s => {
    const dims: DimensionScore[] = [
      scoreCapability(s, request),
      scoreLeadTime(s, request),
      scoreCost(s, request),
      scoreProximity(s, request),
      scoreCertifications(s, request),
      scoreQuality(s),
      scoreCapacity(s, request),
    ];

    // Hard filters — capability=0 or certifications=0 disqualifies.
    const disqualifiers: string[] = [];
    for (const d of dims) {
      if (d.dimension === 'capability' && d.score === 0) disqualifiers.push(`capability: ${d.reason}`);
      if (d.dimension === 'certifications' && d.score === 0) disqualifiers.push(`certifications: ${d.reason}`);
    }
    const qualified = disqualifiers.length === 0;

    const weighted = dims.reduce((acc, d) => acc + d.score * weights[d.dimension], 0) / weightSum;

    return { supplier: s, dimensions: dims, weightedScore: weighted, qualified, disqualifiers };
  });

  // Sort: qualified first, then by weighted score within each group.
  results.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    return b.weightedScore - a.weightedScore;
  });

  return results;
}

/** Pareto-front filter — given the per-dimension scores, return only
 *  the suppliers that aren't dominated by another on every dimension.
 *  Useful when you want to *avoid* collapsing into one score: show all
 *  non-dominated options and let the user pick which trade-off they
 *  prefer. */
export function paretoFront(results: SupplierMatchResult[]): SupplierMatchResult[] {
  const out: SupplierMatchResult[] = [];
  for (const r of results) {
    let dominated = false;
    for (const other of results) {
      if (other === r) continue;
      const dominates = r.dimensions.every((d, i) => other.dimensions[i]!.score >= d.score)
        && r.dimensions.some((d, i) => other.dimensions[i]!.score > d.score);
      if (dominates) { dominated = true; break; }
    }
    if (!dominated) out.push(r);
  }
  return out;
}
