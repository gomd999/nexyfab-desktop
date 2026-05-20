/**
 * gateSuitability.ts — Mold gate suitability assessment for injection
 * molding.
 *
 * For each candidate gate location, the module checks:
 *
 *   1. Wall-thickness ratio — gate diameter should be ≥ 50-70% of
 *      part wall thickness (otherwise jetting / weak weld).
 *   2. Flow-length ratio — gate position should leave L/T < 200 to
 *      the farthest cavity point (else short-shot).
 *   3. Cosmetic surface — gates on Class-A surfaces lose product.
 *   4. Weld-line prediction — opposing flow fronts produce weld lines;
 *      gate should bias flow away from cosmetic areas.
 *
 * Each candidate is scored 0-100; the highest-scoring set ranked.
 */

export type GateKind = 'sprue' | 'edge' | 'submarine' | 'fan' | 'tab' | 'pinpoint' | 'cashew' | 'hot-tip' | 'valve';

export interface GateCandidate {
  id: string;
  /** Candidate position in part coords (mm). */
  position: { x: number; y: number; z: number };
  /** Gate diameter (mm). */
  diameterMm: number;
  kind: GateKind;
  /** Whether the surface here is cosmetic Class-A. */
  cosmetic: boolean;
}

export interface PartProperties {
  /** Wall thickness at gate (mm). */
  wallThicknessMm: number;
  /** Longest flow path from gate to farthest point (mm). */
  longestFlowMm: number;
  /** Maximum L/T allowed for chosen material. */
  maxFlowLengthRatio: number;
  /** Material grade name (used in recommendation). */
  materialGrade?: string;
}

export interface GateScore {
  id: string;
  totalScore: number;          // 0-100
  thicknessScore: number;      // 0-30
  flowLengthScore: number;     // 0-30
  cosmeticScore: number;       // 0-20
  kindScore: number;           // 0-20
  rationale: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function scoreGates(candidates: GateCandidate[], part: PartProperties): GateScore[] {
  return candidates.map(c => scoreCandidate(c, part));
}

function scoreCandidate(candidate: GateCandidate, part: PartProperties): GateScore {
  const rationale: string[] = [];

  // 1. Diameter / wall ratio.
  const dwRatio = candidate.diameterMm / Math.max(0.01, part.wallThicknessMm);
  let thickness = 0;
  if (dwRatio >= 0.5 && dwRatio <= 0.9) thickness = 30;
  else if (dwRatio >= 0.4 && dwRatio < 0.5) { thickness = 20; rationale.push(`Gate slightly under-sized (d/t=${dwRatio.toFixed(2)}).`); }
  else if (dwRatio > 0.9) { thickness = 15; rationale.push(`Gate over-sized (d/t=${dwRatio.toFixed(2)}); freeze-off delay.`); }
  else { thickness = 5; rationale.push(`Gate too small (d/t=${dwRatio.toFixed(2)}); jetting risk.`); }

  // 2. Flow length ratio.
  const ltRatio = part.longestFlowMm / Math.max(0.01, part.wallThicknessMm);
  let flow = 0;
  if (ltRatio <= part.maxFlowLengthRatio * 0.8) flow = 30;
  else if (ltRatio <= part.maxFlowLengthRatio) { flow = 20; rationale.push(`Flow length tight (L/T=${ltRatio.toFixed(0)}).`); }
  else { flow = 5; rationale.push(`Flow length exceeds material capability (${ltRatio.toFixed(0)} > ${part.maxFlowLengthRatio}). Risk of short-shot.`); }

  // 3. Cosmetic surface.
  let cosmetic = 20;
  if (candidate.cosmetic) {
    cosmetic = candidate.kind === 'submarine' || candidate.kind === 'cashew' || candidate.kind === 'pinpoint' ? 12 : 0;
    rationale.push(candidate.cosmetic && cosmetic > 0 ? 'Gate on cosmetic surface but type is removable.' : 'Gate on cosmetic surface; vestige visible.');
  }

  // 4. Gate kind score.
  const kindScores: Record<GateKind, number> = {
    sprue: 14, edge: 18, submarine: 20, fan: 18, tab: 16, pinpoint: 20, cashew: 16, 'hot-tip': 20, valve: 20,
  };
  const kindScore = kindScores[candidate.kind];

  const total = thickness + flow + cosmetic + kindScore;
  return {
    id: candidate.id,
    totalScore: total,
    thicknessScore: thickness,
    flowLengthScore: flow,
    cosmeticScore: cosmetic,
    kindScore,
    rationale,
  };
}

// ── Ranking ────────────────────────────────────────────────────

export function rankGates(candidates: GateCandidate[], part: PartProperties): GateScore[] {
  return scoreGates(candidates, part).sort((a, b) => b.totalScore - a.totalScore);
}

// ── Recommendation ────────────────────────────────────────────

export interface GateRecommendation {
  bestId?: string;
  acceptable: boolean;
  rationale: string;
}

export function recommendGate(candidates: GateCandidate[], part: PartProperties): GateRecommendation {
  if (candidates.length === 0) {
    return { acceptable: false, rationale: 'No gate candidates provided.' };
  }
  const ranked = rankGates(candidates, part);
  const top = ranked[0]!;
  const acceptable = top.totalScore >= 60;
  const rationale = acceptable
    ? `Top candidate ${top.id} scored ${top.totalScore}/100.`
    : `Best candidate ${top.id} scored only ${top.totalScore}/100; consider adding more candidates or redesigning the part.`;
  return { bestId: top.id, acceptable, rationale };
}

// ── Summary ────────────────────────────────────────────────────

export interface GateSummary {
  candidateCount: number;
  maxScore: number;
  meanScore: number;
  acceptableCount: number;
}

export function summarize(scores: GateScore[]): GateSummary {
  if (scores.length === 0) {
    return { candidateCount: 0, maxScore: 0, meanScore: 0, acceptableCount: 0 };
  }
  let max = 0;
  let sum = 0;
  let acceptable = 0;
  for (const s of scores) {
    if (s.totalScore > max) max = s.totalScore;
    sum += s.totalScore;
    if (s.totalScore >= 60) acceptable++;
  }
  return {
    candidateCount: scores.length,
    maxScore: max,
    meanScore: sum / scores.length,
    acceptableCount: acceptable,
  };
}
