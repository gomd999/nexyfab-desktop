/**
 * sheetMetalFlatPattern.ts — Flat-pattern (blank) development.
 *
 * Press-brake operators need the flat developed length BEFORE bending
 * so they can cut the blank to the right size. The math:
 *
 *   Flat length = Σ straight segments
 *               + Σ bend allowances
 *
 *   Bend allowance = (π/180) · θ · (r + K·t)
 *
 *     θ = bend angle (deg) — included angle, not the complementary
 *         "outside" angle.
 *     r = inner bend radius
 *     t = material thickness
 *     K = K-factor (neutral axis position, 0..0.5)
 *
 * Two common alternative metrics:
 *   - **Bend deduction** = 2 · OSSB − BA, where OSSB = outside-setback
 *     OSSB = (r + t) · tan(θ/2)
 *     Sometimes shops measure leg-from-mold-line; flat = sum of mold-line
 *     legs minus the bend deductions.
 *
 *   - **Bend angle compensation** — bend deduction subtracted from each
 *     flange's mold-line length to get the "true" flange length.
 *
 * Stage-2 features here:
 *   1. Per-bend flat-pattern math with K, BA, BD.
 *   2. Multi-bend chain development (correct cumulative length).
 *   3. Springback-corrected overbend angle (Stage-1 had constant K).
 *   4. Bend-tool position constraints (minimum die-shoulder distance).
 *   5. Notch + relief slot allowance (corner clearance).
 */

export interface BendDescriptor {
  /** Inner bend radius (mm). */
  innerRadiusMm: number;
  /** Included bend angle (deg). For a 90° L-bend this is 90. */
  angleDeg: number;
  /** Length of the straight segment BEFORE this bend (mm). */
  precedingFlangeMm: number;
  /** K-factor — neutral axis fraction (0..0.5). */
  kFactor: number;
  /** Material thickness (mm). */
  thicknessMm: number;
}

export interface FlatPatternResult {
  /** Total flat blank length (mm). */
  flatLengthMm: number;
  /** Per-bend computed values. */
  bendDetails: Array<{
    bendAllowanceMm: number;
    outsideSetbackMm: number;
    bendDeductionMm: number;
    moldLineLengthMm: number;
  }>;
  /** Tail flange length added after the last bend (mm). */
  tailFlangeMm: number;
}

/** Bend allowance — neutral-axis arc length. */
export function bendAllowance(angleDeg: number, innerR: number, k: number, t: number): number {
  return (Math.PI / 180) * angleDeg * (innerR + k * t);
}

/** Outside setback — distance from bend tangent point to mold line. */
export function outsideSetback(angleDeg: number, innerR: number, t: number): number {
  return (innerR + t) * Math.tan((angleDeg / 2) * Math.PI / 180);
}

/** Bend deduction — mold-line legs minus the deduction = flat. */
export function bendDeduction(angleDeg: number, innerR: number, k: number, t: number): number {
  const ossb = outsideSetback(angleDeg, innerR, t);
  return 2 * ossb - bendAllowance(angleDeg, innerR, k, t);
}

/** Develop the flat-pattern length for a chain of bends + a final tail. */
export function developFlatPattern(
  bends: BendDescriptor[],
  tailFlangeMm: number,
): FlatPatternResult {
  let total = 0;
  const details: FlatPatternResult['bendDetails'] = [];
  for (const b of bends) {
    const ba = bendAllowance(b.angleDeg, b.innerRadiusMm, b.kFactor, b.thicknessMm);
    const ossb = outsideSetback(b.angleDeg, b.innerRadiusMm, b.thicknessMm);
    const bd = 2 * ossb - ba;
    total += b.precedingFlangeMm + ba;
    details.push({
      bendAllowanceMm: ba,
      outsideSetbackMm: ossb,
      bendDeductionMm: bd,
      moldLineLengthMm: b.precedingFlangeMm + ossb,
    });
  }
  total += tailFlangeMm;
  return { flatLengthMm: total, bendDetails: details, tailFlangeMm };
}

// ── Springback compensation ───────────────────────────────────────

export interface SpringbackInput {
  /** Target bend angle after release (deg). */
  targetAngleDeg: number;
  /** Material yield strength (MPa). */
  yieldStrengthMpa: number;
  /** Elastic modulus (MPa). */
  elasticModulusMpa: number;
  /** Material thickness (mm). */
  thicknessMm: number;
  /** Inner bend radius (mm). */
  innerRadiusMm: number;
}

/** Springback K-factor — ratio of final to initial bend angle.
 *  Approximation (Gardiner / Wood):
 *    K_s = 4·R·σy / (E·t) · ...
 *  We use a simplified industry approximation:
 *    K_s = 1 - (3 · R / t)·(σy / E)·(2 - σy / E) — clamped to [0.85, 1.0].
 *  Result: spring-back factor = final / initial. Need to overbend by 1/K_s. */
export function springbackFactor(input: SpringbackInput): number {
  const ratio = input.innerRadiusMm / input.thicknessMm;
  const sigmaOverE = input.yieldStrengthMpa / input.elasticModulusMpa;
  const raw = 1 - 3 * ratio * sigmaOverE * (2 - sigmaOverE);
  return Math.max(0.85, Math.min(1.0, raw));
}

/** Overbend angle needed so springback returns to the target. */
export function overbendAngle(input: SpringbackInput): number {
  const ks = springbackFactor(input);
  return input.targetAngleDeg / ks;
}

// ── Die-shoulder constraint ─────────────────────────────────────

/** Minimum flange length the press-brake die can accommodate
 *  depends on the V-die width. Rule of thumb: flange ≥ V/2 + r + t. */
export function minimumFlangeLength(
  vDieWidthMm: number,
  innerRadiusMm: number,
  thicknessMm: number,
): number {
  return vDieWidthMm / 2 + innerRadiusMm + thicknessMm;
}

/** Suggest a V-die width for a given thickness — typical 8t. */
export function suggestVDie(thicknessMm: number): number {
  return Math.max(6, Math.round(thicknessMm * 8));
}

// ── Corner relief / notch allowance ──────────────────────────────

export interface CornerReliefSpec {
  /** Relief slot width (mm) — between adjacent bend lines. */
  widthMm: number;
  /** Slot depth (mm). */
  depthMm: number;
  /** True when slot extends into the inner bend zone (recommended). */
  intersectsBend: boolean;
}

/** Suggest a corner-relief slot when two perpendicular bends meet,
 *  to prevent tearing. Typical rule: slot ≥ 1.5 × t in width and
 *  ≥ bend radius + thickness in depth. */
export function suggestCornerRelief(thicknessMm: number, innerRadiusMm: number): CornerReliefSpec {
  return {
    widthMm: Math.max(1.5, thicknessMm * 1.5),
    depthMm: innerRadiusMm + thicknessMm,
    intersectsBend: true,
  };
}
