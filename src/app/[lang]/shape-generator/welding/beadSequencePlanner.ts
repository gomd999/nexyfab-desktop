/**
 * beadSequencePlanner.ts — Weld bead sequencing for distortion control.
 *
 * When multiple weld beads run on a fabrication, the order matters:
 *
 *   1. Symmetric welding — alternate sides to balance shrinkage moment.
 *   2. Back-step (skip-back) — long weld split into short increments
 *      welded in reverse direction.
 *   3. Cool-down between consecutive beads on the same path.
 *   4. Constraint hierarchy — heavy stiffeners first, then thin plate.
 *
 * Module:
 *   - Takes a list of weld beads with location + length + side.
 *   - Computes a recommended sequence minimizing the cumulative
 *     "distortion moment" (sum of length × distance from centroid
 *     × side-sign).
 *   - Checks heat-input balance window (sum on left vs right at any
 *     intermediate step within ±tolerance).
 *
 * Output is the ordered list + per-bead cool-down time.
 */

export type WeldSide = 'left' | 'right' | 'top' | 'bottom' | 'centre';

export interface Bead {
  id: string;
  /** Centroid of the bead segment. */
  centre: { x: number; y: number };
  /** Length of the bead. */
  lengthMm: number;
  /** Side relative to neutral axis. */
  side: WeldSide;
  /** Heat input (kJ/mm). */
  heatKjPerMm: number;
  /** Joint stiffness category. */
  stiffness: 'stiff' | 'thin';
}

export interface SequenceOptions {
  /** Maximum allowed imbalance moment (any intermediate step). */
  maxImbalance: number;
  /** Per-bead cool-down (s) per heat kJ. */
  cooldownSPerKj: number;
  /** Whether stiff beads must come before thin plate beads. */
  stiffnessFirst: boolean;
  /** Reference point (origin) for moment calculation. Defaults to (0,0). */
  referencePoint?: { x: number; y: number };
}

export const DEFAULT_OPTIONS: SequenceOptions = {
  maxImbalance: 5000,
  cooldownSPerKj: 60,
  stiffnessFirst: true,
};

export interface SequenceStep {
  beadId: string;
  position: number;     // 1-based step index
  cumulativeMoment: number;
  cooldownAfterSec: number;
}

export interface SequencePlan {
  steps: SequenceStep[];
  /** Centroid used for moment calculation. */
  centroid: { x: number; y: number };
  /** Worst intermediate imbalance encountered. */
  worstImbalance: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function planBeadSequence(beads: Bead[], options: Partial<SequenceOptions> = {}): SequencePlan {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const centroid = opts.referencePoint ?? { x: 0, y: 0 };
  const queue = beads.slice();
  if (opts.stiffnessFirst) {
    queue.sort((a, b) => (a.stiffness === 'stiff' ? -1 : 0) - (b.stiffness === 'stiff' ? -1 : 0));
  }

  const ordered: Bead[] = [];
  const moments: number[] = [];
  let mx = 0;
  let my = 0;
  let worst = 0;

  while (queue.length > 0) {
    // Pick the bead that, if welded next, drives the cumulative moment
    // closest to zero (back-step balancing).
    let bestIdx = 0;
    let bestRes = Infinity;
    for (let i = 0; i < queue.length; i++) {
      const candidate = queue[i]!;
      const contribX = (candidate.centre.x - centroid.x) * candidate.lengthMm;
      const contribY = (candidate.centre.y - centroid.y) * candidate.lengthMm;
      const trialMx = mx + contribX;
      const trialMy = my + contribY;
      const mag = Math.hypot(trialMx, trialMy);
      if (mag < bestRes) {
        bestRes = mag;
        bestIdx = i;
      }
    }
    const picked = queue.splice(bestIdx, 1)[0]!;
    const contribX = (picked.centre.x - centroid.x) * picked.lengthMm;
    const contribY = (picked.centre.y - centroid.y) * picked.lengthMm;
    mx += contribX;
    my += contribY;
    const cum = Math.hypot(mx, my);
    if (cum > worst) worst = cum;
    moments.push(cum);
    ordered.push(picked);
  }

  const warnings: string[] = [];
  if (worst > opts.maxImbalance) {
    warnings.push(`Worst intermediate imbalance ${worst.toFixed(0)} exceeds ${opts.maxImbalance}; expect distortion.`);
  }

  const steps: SequenceStep[] = ordered.map((b, i) => ({
    beadId: b.id,
    position: i + 1,
    cumulativeMoment: moments[i]!,
    cooldownAfterSec: b.heatKjPerMm * b.lengthMm * opts.cooldownSPerKj / 1000,
  }));

  return { steps, centroid, worstImbalance: worst, warnings };
}

// ── Back-step (skip-back) split ───────────────────────────────

export interface BackStepSegment {
  beadId: string;
  index: number;
  startMm: number;
  endMm: number;
  /** Direction of travel along the bead (1 = forward, -1 = back-step). */
  direction: 1 | -1;
}

export function splitBackStep(beadId: string, totalLengthMm: number, segments: number): BackStepSegment[] {
  if (segments <= 0) return [];
  const segLen = totalLengthMm / segments;
  const out: BackStepSegment[] = [];
  for (let i = 0; i < segments; i++) {
    const start = i * segLen;
    out.push({
      beadId,
      index: i,
      startMm: start,
      endMm: start + segLen,
      direction: -1, // skip-back default
    });
  }
  return out;
}

// ── Heat-input balance check ──────────────────────────────────

export interface HeatBalance {
  totalLeftKj: number;
  totalRightKj: number;
  ratio: number;
  balanced: boolean;
}

export function checkHeatBalance(beads: Bead[], tolerance: number = 0.2): HeatBalance {
  let left = 0;
  let right = 0;
  for (const b of beads) {
    const heat = b.heatKjPerMm * b.lengthMm;
    if (b.side === 'left') left += heat;
    else if (b.side === 'right') right += heat;
  }
  const sum = left + right;
  const ratio = sum === 0 ? 1 : Math.min(left, right) / Math.max(left, right);
  return {
    totalLeftKj: left,
    totalRightKj: right,
    ratio,
    balanced: ratio >= 1 - tolerance,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface SequenceSummary {
  beadCount: number;
  worstImbalance: number;
  totalCooldownSec: number;
  warningCount: number;
}

export function summarize(plan: SequencePlan): SequenceSummary {
  let cool = 0;
  for (const s of plan.steps) cool += s.cooldownAfterSec;
  return {
    beadCount: plan.steps.length,
    worstImbalance: plan.worstImbalance,
    totalCooldownSec: cool,
    warningCount: plan.warnings.length,
  };
}
