/**
 * toolLifeRemaining.ts — Estimate remaining tool life under
 * candidate cutting parameters.
 *
 * Taylor tool-life equation:
 *
 *   V · T^n = C
 *
 * where V is cutting speed (m/min), T is tool life (min), and
 * (n, C) are empirical constants for the (tool, material) pair.
 *
 * Module extends:
 *   - Modified Taylor with feed + DOC corrections (Kronenberg):
 *     V · T^n · f^a · ap^b = C'
 *   - Accumulated wear: T_remaining = T_full - sum(t_used / T(V_i)).
 *   - Confidence interval based on parameter scatter.
 *
 * Used during shop-floor cutting parameter selection: do I have
 * enough tool life left to finish this batch?
 */

export interface ToolMaterial {
  /** Taylor exponent n (typ 0.10-0.30 for carbide). */
  n: number;
  /** Taylor constant C at reference feed + DOC (m/min·min^n). */
  c: number;
  /** Feed-rate exponent a in modified Taylor. */
  feedExponent: number;
  /** DOC exponent b in modified Taylor. */
  docExponent: number;
  /** Reference feed (mm/rev). */
  refFeedMmRev: number;
  /** Reference depth of cut (mm). */
  refDocMm: number;
}

export interface CuttingPass {
  /** Cutting speed for this pass (m/min). */
  speedMpm: number;
  /** Feed (mm/rev). */
  feedMmRev: number;
  /** Depth of cut (mm). */
  docMm: number;
  /** Time spent (min). */
  durationMin: number;
}

export interface RemainingLifeResult {
  /** Cumulative fraction of tool life consumed (0-1+). */
  usedFraction: number;
  /** Estimated remaining life at the next candidate speed (min). */
  remainingMinAtCandidate: number;
  /** Whether candidate is feasible (>= job duration). */
  feasible: boolean;
  /** Confidence band ±. */
  confidenceMin: number;
}

// ── Tool-life at given conditions ─────────────────────────────

export function predictLifeMin(
  tool: ToolMaterial,
  speedMpm: number,
  feedMmRev: number,
  docMm: number,
): number {
  if (speedMpm <= 0) return Infinity;
  // V^(1/n) · T = (C/(f^a · ap^b))^(1/n).
  const correctedC = tool.c
    * Math.pow(tool.refFeedMmRev / Math.max(0.0001, feedMmRev), tool.feedExponent / tool.n)
    * Math.pow(tool.refDocMm / Math.max(0.0001, docMm), tool.docExponent / tool.n);
  const lifeMin = Math.pow(correctedC / speedMpm, 1 / tool.n);
  return lifeMin;
}

// ── Accumulated wear ──────────────────────────────────────────

export function accumulatedFraction(history: CuttingPass[], tool: ToolMaterial): number {
  let used = 0;
  for (const pass of history) {
    const life = predictLifeMin(tool, pass.speedMpm, pass.feedMmRev, pass.docMm);
    if (life <= 0 || !Number.isFinite(life)) continue;
    used += pass.durationMin / life;
  }
  return used;
}

// ── Remaining life under candidate conditions ────────────────

export interface CandidatePass {
  speedMpm: number;
  feedMmRev: number;
  docMm: number;
  /** Required job duration (min). */
  jobDurationMin: number;
}

export function estimateRemaining(
  history: CuttingPass[],
  tool: ToolMaterial,
  candidate: CandidatePass,
  options: { confidencePercent?: number } = {},
): RemainingLifeResult {
  const used = accumulatedFraction(history, tool);
  const candidateLife = predictLifeMin(tool, candidate.speedMpm, candidate.feedMmRev, candidate.docMm);
  const remainingFraction = Math.max(0, 1 - used);
  const remaining = remainingFraction * candidateLife;
  const cb = (options.confidencePercent ?? 15) / 100;
  return {
    usedFraction: used,
    remainingMinAtCandidate: remaining,
    feasible: remaining >= candidate.jobDurationMin,
    confidenceMin: remaining * cb,
  };
}

// ── Iso-life speed (target life at given feed/DOC) ────────────

export function isoLifeSpeed(
  tool: ToolMaterial,
  targetLifeMin: number,
  feedMmRev: number,
  docMm: number,
): number {
  if (targetLifeMin <= 0) return Infinity;
  const correctedC = tool.c
    * Math.pow(tool.refFeedMmRev / Math.max(0.0001, feedMmRev), tool.feedExponent / tool.n)
    * Math.pow(tool.refDocMm / Math.max(0.0001, docMm), tool.docExponent / tool.n);
  // V = C / T^n  →  iso-life speed.
  return correctedC / Math.pow(targetLifeMin, tool.n);
}

// ── Sweet-spot search ─────────────────────────────────────────

export interface SweetSpot {
  speedMpm: number;
  lifeMin: number;
  /** MRR proxy = V · f · ap. */
  metalRemovalRate: number;
  /** Cost score: lower is better (cost per minute of removal). */
  costScore: number;
}

export function findSweetSpot(
  tool: ToolMaterial,
  feedMmRev: number,
  docMm: number,
  options: { minSpeed: number; maxSpeed: number; steps: number; targetLifeMin: number },
): SweetSpot {
  const { minSpeed, maxSpeed, steps, targetLifeMin } = options;
  let best: SweetSpot = { speedMpm: minSpeed, lifeMin: 0, metalRemovalRate: 0, costScore: Infinity };
  for (let i = 0; i <= steps; i++) {
    const v = minSpeed + (maxSpeed - minSpeed) * (i / Math.max(1, steps));
    const life = predictLifeMin(tool, v, feedMmRev, docMm);
    const mrr = v * feedMmRev * docMm;
    // Penalty if life falls short of target.
    const lifeDeficit = Math.max(0, (targetLifeMin - life) / targetLifeMin);
    const cost = (1 / Math.max(0.001, mrr)) * (1 + lifeDeficit);
    if (cost < best.costScore) {
      best = { speedMpm: v, lifeMin: life, metalRemovalRate: mrr, costScore: cost };
    }
  }
  return best;
}

// ── Summary ────────────────────────────────────────────────────

export interface ToolLifeSummary {
  usedFraction: number;
  candidateLifeMin: number;
  feasible: boolean;
  marginMin: number;
}

export function summarize(result: RemainingLifeResult, candidate: CandidatePass): ToolLifeSummary {
  return {
    usedFraction: result.usedFraction,
    candidateLifeMin: result.remainingMinAtCandidate / Math.max(0.001, 1 - result.usedFraction),
    feasible: result.feasible,
    marginMin: result.remainingMinAtCandidate - candidate.jobDurationMin,
  };
}
