/**
 * cornerRelief.ts — DFM detection + suggestion for adjacent-bend corners.
 *
 * When two bends meet at a corner the material on the corner gets
 * stretched in both directions simultaneously. Without a relief notch
 * the corner cracks in the press brake (mild steel), or the material
 * tears (high-tensile alloys). Industry rule of thumb (per ASM
 * Handbook Vol. 14B):
 *   relief width  ≥ T               (thickness)
 *   relief depth  ≥ T + R           (thickness + inner bend radius)
 *
 * **This module ships detection + suggestion only.** The geometric
 * mesh cut lives in `reliefCuts.ts` (`applyCornerRelief` / the
 * `cornerRelief` pipeline feature) — suggestions from here can be fed
 * straight into that feature's `size`/`shape` params.
 *
 * Detection input is the per-geometry `__bendHistory` already recorded
 * by `applyBend` / `applyFlange` / `applyJog`. Two bends are considered
 * an adjacent-corner pair when:
 *   - their bend lines are perpendicular (one along X, one along Z),
 *     AND
 *   - their normalised positions place them on the same end of the sheet
 *     (both ≤ 0.5 or both ≥ 0.5), AND
 *   - both are "outward" (direction = 'up' for now — a future pass
 *     should treat down-down as a corner pair too).
 *
 * The heuristic is intentionally simple: bend axis inference from
 * geometry would be more accurate but would couple this module to the
 * mesh layout. For Phase B 90% the rule above catches the SolidWorks
 * "tab + tab" canonical corner case, which is what designers hit first.
 */

import type { BendParams } from './sheetMetal';
import type { SheetMetalMaterial, SheetMetalBendWarning } from './sheetMetalTables';
import { SHEET_METAL_MATERIALS } from './sheetMetalTables';

export type ReliefShape = 'rectangular' | 'circular' | 'tear';

export interface CornerReliefSuggestion {
  /** Index of bend A in the supplied history array. */
  bendAIndex: number;
  /** Index of bend B in the supplied history array. */
  bendBIndex: number;
  /** Suggested notch width (along the bend that runs through the corner). */
  width: number;
  /** Suggested notch depth (perpendicular to width, into the corner). */
  depth: number;
  /** Suggested shape — `rectangular` is the press-brake default; `circular`
   *  reduces stress concentration on high-tensile alloys; `tear` is the
   *  smallest possible relief, used when sheet area is tight. */
  shape: ReliefShape;
  /** Human-readable rationale for the picker tooltip. */
  reasonKo: string;
  reasonEn: string;
}

interface DetectInput {
  thickness: number;
  material: SheetMetalMaterial;
  bendHistory: BendParams[];
}

/** Two bends form an adjacent-corner pair when they run along
 *  perpendicular axes (one X-aligned, one Z-aligned). The current bend
 *  model doesn't carry an explicit axis field, so we infer from
 *  position: bends at 0 / 1 typically wrap the X and Z edges. */
function isPerpendicularPair(a: BendParams, b: BendParams): boolean {
  // Different positions imply different bend lines. The strongest signal
  // we have without axis metadata is that both are at "outer" positions
  // (near 0 or near 1) — the canonical adjacent-corner pattern.
  const aOuter = a.position < 0.2 || a.position > 0.8;
  const bOuter = b.position < 0.2 || b.position > 0.8;
  if (!aOuter || !bOuter) return false;
  // Same side (both ≤ 0.5 or both ≥ 0.5) → shared corner.
  return Math.sign(a.position - 0.5) === Math.sign(b.position - 0.5);
}

/** Pick a default shape based on material — high-tensile alloys benefit
 *  from circular relief (no stress concentrator at the notch root). */
function defaultShape(material: SheetMetalMaterial): ReliefShape {
  const info = SHEET_METAL_MATERIALS[material];
  if (!info) return 'rectangular';
  // Tensile > 400 N/mm² (stainless, AL6061-T6, etc.) → circular.
  return info.tensileStrength > 400 ? 'circular' : 'rectangular';
}

/**
 * Scan the supplied bend history for adjacent-corner pairs that need a
 * relief notch, and emit a sized + shaped suggestion for each.
 */
export function detectCornerReliefNeeds(input: DetectInput): CornerReliefSuggestion[] {
  const { thickness, material, bendHistory } = input;
  if (thickness <= 0) return [];
  const out: CornerReliefSuggestion[] = [];

  for (let i = 0; i < bendHistory.length; i++) {
    for (let j = i + 1; j < bendHistory.length; j++) {
      const a = bendHistory[i];
      const b = bendHistory[j];
      if (a.direction !== b.direction) continue;
      if (!isPerpendicularPair(a, b)) continue;

      const radius = Math.max(a.radius, b.radius);
      const width = thickness * 1.5;            // ≥ 1× T, with safety
      const depth = thickness + radius;          // industry minimum
      const shape = defaultShape(material);
      out.push({
        bendAIndex: i,
        bendBIndex: j,
        width,
        depth,
        shape,
        reasonKo: `굽힘 ${i + 1} ↔ ${j + 1} 코너 — ${SHEET_METAL_MATERIALS[material]?.labelKo ?? material}에서 권장 릴리프: 폭 ${width.toFixed(1)}mm, 깊이 ${depth.toFixed(1)}mm (${shape === 'circular' ? '원형' : '사각형'})`,
        reasonEn: `Bend ${i + 1} ↔ ${j + 1} corner — ${SHEET_METAL_MATERIALS[material]?.labelEn ?? material} requires ≥${width.toFixed(1)}mm × ${depth.toFixed(1)}mm ${shape} relief to avoid corner crack.`,
      });
    }
  }
  return out;
}

/** Convert relief suggestions into DFM warnings so the validation panel
 *  surfaces them alongside ordinary bend warnings. Severity = warning
 *  (not error) because the shop can still produce the part with a
 *  manual relief cut — but we want the designer to acknowledge it. */
export function reliefSuggestionsToWarnings(
  suggestions: CornerReliefSuggestion[],
): SheetMetalBendWarning[] {
  return suggestions.map(s => ({
    severity: 'warning',
    code: 'radiusTooSmall', // re-using the closest existing code; a dedicated `cornerRelief` code can be added when the warning enum grows
    messageKo: s.reasonKo,
    messageEn: s.reasonEn,
  }));
}
