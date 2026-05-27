/**
 * grainFlowOptimizer.ts — Sheet metal blank orientation / nesting
 * optimization considering grain direction.
 *
 * Rolled sheet metal has anisotropic mechanical properties:
 *
 *   - Bending across grain (perpendicular to rolling direction):
 *     larger minimum bend radius needed; prone to fracture.
 *   - Bending with grain: smaller r/t allowed.
 *   - Forming limit (FLD) is also anisotropic.
 *
 * Module evaluates a flat blank for a part with multiple bends:
 *
 *   - For each candidate orientation (0°, 45°, 90°, 135°), compute a
 *     "bend goodness" score = sum of cos²(bend angle vs grain) ·
 *     length penalty.
 *   - The optimal orientation places the most critical bends parallel
 *     to grain.
 *   - Apply nesting-aware override if the part must be laid out a
 *     specific way on the coil.
 */

export interface BendInBlank {
  id: string;
  /** Direction of the bend line in flat pattern (degrees, 0-180). */
  directionDeg: number;
  /** Bend length (mm). */
  lengthMm: number;
  /** Criticality (1.0 = standard, 2.0 = tight radius / fracture-risk). */
  criticality: number;
}

export interface OrientationCandidate {
  rotationDeg: number;
  /** Score: higher = better (bends more parallel to grain). */
  score: number;
  /** Worst bend (most across-grain). */
  worstBend: { id: string; relativeAngleDeg: number };
  /** Per-bend angle relative to grain. */
  perBendAngles: { id: string; relativeAngleDeg: number }[];
}

export interface GrainOptions {
  /** Candidate rotations to evaluate. */
  candidateRotationsDeg: number[];
  /** Maximum allowable bend-vs-grain angle for warn. */
  warnAngleDeg: number;
}

export const DEFAULT_OPTIONS: GrainOptions = {
  candidateRotationsDeg: [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165],
  warnAngleDeg: 60,
};

// ── Top-level entry ────────────────────────────────────────────

export function optimizeOrientation(
  bends: BendInBlank[],
  options: Partial<GrainOptions> = {},
): OrientationCandidate[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return opts.candidateRotationsDeg.map(rot => scoreOrientation(bends, rot));
}

function scoreOrientation(bends: BendInBlank[], rotationDeg: number): OrientationCandidate {
  let score = 0;
  let worstAngle = 0;
  let worstId = '';
  const perBendAngles: { id: string; relativeAngleDeg: number }[] = [];

  // Grain is at rotationDeg in the rotated blank.
  for (const bend of bends) {
    // Rotated bend direction relative to grain.
    const rel = Math.abs(((bend.directionDeg - rotationDeg) % 180 + 180) % 180);
    // Wrap > 90 → mirror.
    const wrapped = rel > 90 ? 180 - rel : rel;
    // Score: bend parallel to grain (0°) is BAD because bend axis ⊥ to fold direction.
    // Bend axis parallel to grain (wrapped = 0) means fold direction perpendicular to grain.
    // Convention: bend axis parallel to grain → BEST.
    const cos = Math.cos((wrapped * Math.PI) / 180);
    score += bend.lengthMm * bend.criticality * cos * cos;
    perBendAngles.push({ id: bend.id, relativeAngleDeg: wrapped });
    if (wrapped > worstAngle) {
      worstAngle = wrapped;
      worstId = bend.id;
    }
  }

  return {
    rotationDeg,
    score,
    worstBend: { id: worstId, relativeAngleDeg: worstAngle },
    perBendAngles,
  };
}

// ── Pick best ──────────────────────────────────────────────────

export interface OrientationResult {
  bestRotationDeg: number;
  bestScore: number;
  bestWorstAngle: number;
  acceptable: boolean;
  rationale: string;
}

export function pickBestOrientation(
  bends: BendInBlank[],
  options: Partial<GrainOptions> = {},
): OrientationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const candidates = optimizeOrientation(bends, options);
  let best = candidates[0]!;
  for (const c of candidates) {
    if (c.score > best.score) best = c;
  }
  const acceptable = best.worstBend.relativeAngleDeg <= opts.warnAngleDeg;
  const rationale = acceptable
    ? `Best rotation ${best.rotationDeg}°; worst bend ${best.worstBend.relativeAngleDeg.toFixed(1)}° to grain — safe.`
    : `Best rotation ${best.rotationDeg}° but worst bend at ${best.worstBend.relativeAngleDeg.toFixed(1)}° to grain (> ${opts.warnAngleDeg}°); consider stress relief or larger bend radius.`;
  return {
    bestRotationDeg: best.rotationDeg,
    bestScore: best.score,
    bestWorstAngle: best.worstBend.relativeAngleDeg,
    acceptable,
    rationale,
  };
}

// ── Per-bend assessment under fixed orientation ───────────────

export interface BendGrainAssessment {
  bendId: string;
  relativeAngleDeg: number;
  status: 'with-grain' | 'mixed' | 'across-grain';
  recommendedRadiusFactor: number;
}

export function assessBends(bends: BendInBlank[], grainRotationDeg: number): BendGrainAssessment[] {
  return bends.map(bend => {
    const rel = Math.abs(((bend.directionDeg - grainRotationDeg) % 180 + 180) % 180);
    const wrapped = rel > 90 ? 180 - rel : rel;
    let status: BendGrainAssessment['status'];
    let factor: number;
    if (wrapped <= 30) {
      status = 'with-grain';
      factor = 1.0;
    } else if (wrapped <= 60) {
      status = 'mixed';
      factor = 1.3;
    } else {
      status = 'across-grain';
      factor = 1.8;
    }
    return { bendId: bend.id, relativeAngleDeg: wrapped, status, recommendedRadiusFactor: factor };
  });
}

// ── Summary ────────────────────────────────────────────────────

export interface GrainSummary {
  bestRotationDeg: number;
  bestScore: number;
  worstAngleDeg: number;
  acceptable: boolean;
}

export function summarize(bends: BendInBlank[], options: Partial<GrainOptions> = {}): GrainSummary {
  const result = pickBestOrientation(bends, options);
  return {
    bestRotationDeg: result.bestRotationDeg,
    bestScore: result.bestScore,
    worstAngleDeg: result.bestWorstAngle,
    acceptable: result.acceptable,
  };
}
