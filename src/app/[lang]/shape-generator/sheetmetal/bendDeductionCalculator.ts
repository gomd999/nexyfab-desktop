/**
 * bendDeductionCalculator.ts — Compute bend deduction (BD), bend
 * allowance (BA), and outside setback for sheet metal flat patterns.
 *
 * Definitions (per Pro/E / SolidWorks convention):
 *
 *   - Outside setback (OSSB) = (R + t) · tan(α / 2)
 *     where R = inside bend radius, t = sheet thickness, α = bend
 *     angle (acute = formed angle measured from the original flat).
 *   - Bend allowance (BA) = (π / 180) · α · (R + K·t)
 *     where K = K-factor (neutral axis factor, 0.33-0.5 typical).
 *   - Bend deduction (BD) = 2·OSSB − BA.
 *
 * Flat length:
 *   L_flat = L1 + L2 − BD     (two-segment bend at angle α)
 *
 * Module:
 *   - Computes BD/BA/OSSB given inputs.
 *   - Provides K-factor lookup by material + thickness.
 *   - Computes flat length for a chain of bends.
 *   - Supports air-bend (radius computed from die width) vs coined.
 */

export type BendType = 'air-bend' | 'coined' | 'bottom-bend';
export type MaterialName = 'mild-steel' | 'stainless-304' | 'aluminum-5052' | 'aluminum-6061' | 'copper' | 'brass';

/** Typical K-factor by material at typical r/t ratio. */
export const K_FACTOR_TABLE: Record<MaterialName, number> = {
  'mild-steel': 0.44,
  'stainless-304': 0.40,
  'aluminum-5052': 0.43,
  'aluminum-6061': 0.40,
  'copper': 0.42,
  'brass': 0.42,
};

export interface BendParams {
  /** Inside bend radius (mm). */
  insideRadiusMm: number;
  /** Sheet thickness (mm). */
  thicknessMm: number;
  /** Bend angle (deg, 0..180). */
  angleDeg: number;
  /** Material (for K-factor lookup) or override. */
  material?: MaterialName;
  /** Override K-factor directly. */
  kFactorOverride?: number;
  bendType?: BendType;
}

export interface BendResult {
  outsideSetbackMm: number;
  bendAllowanceMm: number;
  bendDeductionMm: number;
  kFactor: number;
  /** Helper: ratio of inside radius to thickness. */
  rTRatio: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function computeBend(params: BendParams): BendResult {
  const r = params.insideRadiusMm;
  const t = params.thicknessMm;
  const a = params.angleDeg;
  const k = pickKFactor(params);
  const angleRad = (a * Math.PI) / 180;
  const halfAngleRad = angleRad / 2;
  const ossb = (r + t) * Math.tan(halfAngleRad);
  const ba = angleRad * (r + k * t);
  const bd = 2 * ossb - ba;
  return {
    outsideSetbackMm: ossb,
    bendAllowanceMm: ba,
    bendDeductionMm: bd,
    kFactor: k,
    rTRatio: t === 0 ? Infinity : r / t,
  };
}

function pickKFactor(params: BendParams): number {
  if (params.kFactorOverride !== undefined) return params.kFactorOverride;
  if (params.material !== undefined) {
    const base = K_FACTOR_TABLE[params.material];
    // Adjust for r/t ratio (Pro/E rule): K_low for r/t < 1, K_high for r/t > 3.
    if (params.thicknessMm > 0) {
      const rt = params.insideRadiusMm / params.thicknessMm;
      if (rt < 1) return Math.max(0.33, base - 0.05);
      if (rt > 3) return Math.min(0.5, base + 0.05);
    }
    return base;
  }
  return 0.44; // mild-steel default
}

// ── Flat length for a chain of bends ──────────────────────────

export interface BendSegment {
  /** Length of the flat segment leading into the bend (mm). */
  segmentLengthMm: number;
  /** Bend that follows this segment, or undefined for terminal. */
  bend?: BendParams;
}

export function computeFlatLength(segments: BendSegment[]): number {
  let total = 0;
  for (const s of segments) {
    total += s.segmentLengthMm;
    if (s.bend) {
      const r = computeBend(s.bend);
      total -= r.bendDeductionMm;
    }
  }
  return total;
}

// ── Air-bend radius estimate from die width ───────────────────

/**
 * For air-bending, the actual inside radius is determined by the
 * die opening width V and the punch tip. Common rule (Tom Bend):
 *   R_inside ≈ V × 0.16   (steel)
 *   R_inside ≈ V × 0.20   (aluminum)
 */
export function estimateAirBendRadius(dieWidthMm: number, material: MaterialName): number {
  if (material === 'aluminum-5052' || material === 'aluminum-6061') return dieWidthMm * 0.20;
  if (material === 'copper' || material === 'brass') return dieWidthMm * 0.18;
  return dieWidthMm * 0.16;
}

// ── Springback compensation ───────────────────────────────────

export const SPRINGBACK_DEG: Record<MaterialName, number> = {
  'mild-steel': 1.5,
  'stainless-304': 3.5,
  'aluminum-5052': 1.0,
  'aluminum-6061': 1.5,
  'copper': 1.0,
  'brass': 1.2,
};

export function compensateForSpringback(targetAngleDeg: number, material: MaterialName): number {
  return targetAngleDeg + SPRINGBACK_DEG[material];
}

// ── Summary ────────────────────────────────────────────────────

export interface BendSummary {
  bendDeductionMm: number;
  bendAllowanceMm: number;
  kFactor: number;
  rTRatio: number;
}

export function summarize(result: BendResult): BendSummary {
  return {
    bendDeductionMm: result.bendDeductionMm,
    bendAllowanceMm: result.bendAllowanceMm,
    kFactor: result.kFactor,
    rTRatio: result.rTRatio,
  };
}
