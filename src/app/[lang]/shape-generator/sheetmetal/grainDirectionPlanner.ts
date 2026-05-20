/**
 * grainDirectionPlanner.ts — Track sheet metal grain direction for
 * proper bend placement.
 *
 * Rolled sheet metal has a *grain direction* parallel to the rolling
 * axis. Bends made *across* the grain are stronger and have less
 * tendency to crack; bends *along* the grain are weaker. The
 * stamping shop needs to orient parts during nesting so critical
 * bends are across the grain.
 *
 * Module:
 *
 *   - Tracks grain direction on the sheet stock.
 *   - For each bend in the part, computes the angle between the
 *     bend line and the grain.
 *   - Classifies as "favorable" (perpendicular ±15°), "marginal"
 *     (30-60°), or "unfavorable" (parallel ±15°).
 *   - Suggests part rotation to maximize favorable bends.
 */

export interface Vec2 { x: number; y: number }

export interface BendLine {
  id: string;
  /** Direction of bend line (unit vector). */
  direction: Vec2;
  /** Bend severity / criticality. */
  criticality: 'critical' | 'standard' | 'cosmetic';
}

export interface GrainClassification {
  bendId: string;
  /** Angle to grain in degrees [0..90]. */
  angleToGrainDeg: number;
  rating: 'favorable' | 'marginal' | 'unfavorable';
  /** For critical bends in unfavorable orientation, flag. */
  riskFlag: boolean;
}

export interface PlanResult {
  /** Per-bend classification. */
  classifications: GrainClassification[];
  /** Suggested rotation angle (degrees) to maximize favorable critical bends. */
  suggestedRotationDeg: number;
  /** Score (0..1) — higher means more critical bends are favorable. */
  optimalityScore: number;
}

export interface PlanOptions {
  /** Grain direction on the sheet (unit vector). Default = +X. */
  grainDirection: Vec2;
  /** Test N candidate rotation angles. */
  rotationCandidates: number;
  /** Tolerance for favorable rating (within this many degrees of 90°). */
  favorableToleranceDeg: number;
}

export const DEFAULT_OPTIONS: PlanOptions = {
  grainDirection: { x: 1, y: 0 },
  rotationCandidates: 36, // every 5°
  favorableToleranceDeg: 15,
};

// ── Top-level entry ────────────────────────────────────────────

export function planGrainOrientation(bends: BendLine[], options: Partial<PlanOptions> = {}): PlanResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (bends.length === 0) {
    return { classifications: [], suggestedRotationDeg: 0, optimalityScore: 0 };
  }

  // Classify at zero rotation.
  const classifications = bends.map(b => classifyBend(b, opts.grainDirection, opts.favorableToleranceDeg));

  // Try N rotations to find the orientation that maximizes critical-favorable count.
  let bestRotation = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < opts.rotationCandidates; i++) {
    const rotDeg = (i * 360) / opts.rotationCandidates;
    const rotRad = (rotDeg * Math.PI) / 180;
    const rotatedGrain = rotateVec(opts.grainDirection, -rotRad);
    let score = 0;
    for (const b of bends) {
      const cls = classifyBend(b, rotatedGrain, opts.favorableToleranceDeg);
      if (cls.rating === 'favorable') {
        score += b.criticality === 'critical' ? 3 : b.criticality === 'standard' ? 1 : 0.5;
      } else if (cls.rating === 'marginal') {
        score += 0.5;
      } else {
        if (b.criticality === 'critical') score -= 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRotation = rotDeg;
    }
  }

  // Normalize score to [0, 1].
  const maxScore = bends.reduce((s, b) => s + (b.criticality === 'critical' ? 3 : b.criticality === 'standard' ? 1 : 0.5), 0);
  const optimality = maxScore > 0 ? Math.max(0, Math.min(1, bestScore / maxScore)) : 0;

  return {
    classifications,
    suggestedRotationDeg: bestRotation,
    optimalityScore: optimality,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function classifyBend(bend: BendLine, grain: Vec2, favTol: number): GrainClassification {
  const grainUnit = normalize(grain);
  const bendUnit = normalize(bend.direction);
  const dot = Math.abs(grainUnit.x * bendUnit.x + grainUnit.y * bendUnit.y);
  const angleRad = Math.acos(Math.max(-1, Math.min(1, dot)));
  const angleDeg = (angleRad * 180) / Math.PI;
  // Perpendicular (90°) is favorable.
  const distFromPerp = Math.abs(90 - angleDeg);
  const distFromParallel = Math.min(angleDeg, 180 - angleDeg);
  let rating: GrainClassification['rating'];
  if (distFromPerp <= favTol) rating = 'favorable';
  else if (distFromParallel <= favTol) rating = 'unfavorable';
  else rating = 'marginal';
  return {
    bendId: bend.id,
    angleToGrainDeg: angleDeg,
    rating,
    riskFlag: bend.criticality === 'critical' && rating === 'unfavorable',
  };
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function rotateVec(v: Vec2, angleRad: number): Vec2 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// ── Summary ────────────────────────────────────────────────────

export interface PlanSummary {
  bendCount: number;
  favorableCount: number;
  marginalCount: number;
  unfavorableCount: number;
  criticalAtRiskCount: number;
  suggestedRotationDeg: number;
  optimalityScore: number;
}

export function summarize(result: PlanResult): PlanSummary {
  const counts = { favorable: 0, marginal: 0, unfavorable: 0 };
  let atRisk = 0;
  for (const c of result.classifications) {
    counts[c.rating]++;
    if (c.riskFlag) atRisk++;
  }
  return {
    bendCount: result.classifications.length,
    favorableCount: counts.favorable,
    marginalCount: counts.marginal,
    unfavorableCount: counts.unfavorable,
    criticalAtRiskCount: atRisk,
    suggestedRotationDeg: result.suggestedRotationDeg,
    optimalityScore: result.optimalityScore,
  };
}
