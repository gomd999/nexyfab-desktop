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
 * ## Phase 2 Track B Week 1 — K-factor delegation
 *
 * Before consolidation, this module shipped its own flat K_FACTOR_TABLE plus a
 * hand-rolled r/t adjustment that drifted up to 0.07 from the canonical Schema
 * A table at R/T=1.0. That drift fails the ±0.1mm unfold tolerance on a 5-bend
 * hat section.
 *
 * After consolidation, K-factor lookup delegates to `getKFactor` in
 * `features/sheetMetalTables.ts` (Schema A canonical). Material ids written
 * under the dashed Schema C names (`mild-steel`, `aluminum-6061`, ...) are
 * aliased to Schema A camelCase ids via `aliasSheetMetalMaterialId` so any
 * `.nfab` file or call site that still uses the old strings continues to work
 * with zero re-saving.
 *
 * The exported `K_FACTOR_TABLE` constant is kept as a documentation-only
 * snapshot of typical K values at R/T = 2.0 (the canonical-display ratio used
 * in shop tickets) and is no longer the source of truth.
 */

import { aliasSheetMetalMaterialId } from '@/lib/migrations/sheetMetalMaterialId';
import { getKFactor, SHEET_METAL_MATERIALS } from '../features/sheetMetalTables';

export type BendType = 'air-bend' | 'coined' | 'bottom-bend';
export type MaterialName = 'mild-steel' | 'stainless-304' | 'aluminum-5052' | 'aluminum-6061' | 'copper' | 'brass';

/**
 * Bend-type adjustment to the baseline (air-bend) K-factor. Pressing the bend
 * harder shifts the neutral axis TOWARD the inside surface, lowering K → a
 * smaller bend allowance → a LARGER bend deduction (a tighter, shorter blank):
 *   - air-bend    — baseline (the die only contacts the punch tip).
 *   - bottom-bend — the bend is set against the die: more consistent, K a touch
 *     lower (~5%).
 *   - coined      — the punch presses the zone past yield into the die: the
 *     neutral axis is driven inward, K ~15% lower (shop K ≈ 0.33–0.42).
 * Multipliers are applied to the canonical Schema-A K. air-bend = 1.0 keeps the
 * default behaviour byte-identical (back-compatible).
 */
export const BEND_TYPE_K_MULTIPLIER: Record<BendType, number> = {
  'air-bend': 1.0,
  'bottom-bend': 0.95,
  'coined': 0.85,
};

/**
 * Typical K-factor by material at R/T = 2.0, sampled from the canonical Schema
 * A table. This is a *display snapshot* for shop tickets — the live K-factor
 * lookup that drives `computeBend()` always goes through `getKFactor()` so r/t
 * is honoured. Do not import this for math; use `getKFactor` directly.
 */
export const K_FACTOR_TABLE: Record<MaterialName, number> = {
  'mild-steel': getKFactor(aliasSheetMetalMaterialId('mild-steel'), 2, 1),
  'stainless-304': getKFactor(aliasSheetMetalMaterialId('stainless-304'), 2, 1),
  'aluminum-5052': getKFactor(aliasSheetMetalMaterialId('aluminum-5052'), 2, 1),
  'aluminum-6061': getKFactor(aliasSheetMetalMaterialId('aluminum-6061'), 2, 1),
  'copper': getKFactor(aliasSheetMetalMaterialId('copper'), 2, 1),
  'brass': getKFactor(aliasSheetMetalMaterialId('brass'), 2, 1),
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
  // An explicit override is the user's exact K — never adjust it.
  if (params.kFactorOverride !== undefined) return params.kFactorOverride;
  // Baseline (air-bend) K from the canonical Schema-A r/t curve, or the
  // mild-steel default at R/T = 2.
  const baseK = params.material !== undefined
    ? getKFactor(aliasSheetMetalMaterialId(params.material), params.insideRadiusMm, params.thicknessMm)
    : 0.44;
  // Process correction: coining/bottom-bending shift the neutral axis inward.
  return baseK * BEND_TYPE_K_MULTIPLIER[params.bendType ?? 'air-bend'];
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

// ── Minimum bend radius (DFM manufacturability check) ──────────

export interface MinBendRadiusCheck {
  /** Minimum allowed inside radius = factor · thickness (mm). */
  minRadiusMm: number;
  /** Material's min-radius factor (× thickness). */
  factor: number;
  /** insideRadius − minRadius (negative ⇒ too tight, cracking risk). */
  marginMm: number;
  ok: boolean;
}

function minRadiusFactor(material: MaterialName): number {
  const info = SHEET_METAL_MATERIALS[aliasSheetMetalMaterialId(material)];
  return info?.minBendRadiusFactor ?? 1.0;
}

/** Minimum bendable inside radius for a material + thickness (mm). */
export function minBendRadiusMm(material: MaterialName, thicknessMm: number): number {
  return minRadiusFactor(material) * thicknessMm;
}

/**
 * DFM check: bending tighter than R_min = factor·t cracks the outer fibre. The
 * factor was in the material table but never validated against geometry — this
 * closes that gap. `ok=false` (negative margin) means the bend is too tight.
 */
export function checkMinBendRadius(
  insideRadiusMm: number,
  thicknessMm: number,
  material: MaterialName,
): MinBendRadiusCheck {
  const factor = minRadiusFactor(material);
  const minRadiusMm = factor * thicknessMm;
  const marginMm = insideRadiusMm - minRadiusMm;
  return { minRadiusMm, factor, marginMm, ok: marginMm >= -1e-9 };
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
