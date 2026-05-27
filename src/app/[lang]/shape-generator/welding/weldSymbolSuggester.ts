/**
 * weldSymbolSuggester.ts — Suggest the appropriate weld symbol from
 * joint geometry.
 *
 * Given two plates meeting at a joint, the welder needs to know
 * which type of weld is required. Standard AWS A2.4 weld types:
 *
 *   - **Fillet**: at a T-joint or corner. Triangular cross-section.
 *   - **Square butt**: thin plates (≤ 3 mm) butt-joined with no prep.
 *   - **V-groove**: thicker plates (3-20 mm) beveled to 60° V.
 *   - **U-groove**: very thick plates (> 20 mm) with rounded prep.
 *   - **J-groove**: one plate beveled (asymmetric joint).
 *   - **Edge**: thin edge-to-edge.
 *   - **Spot/Seam**: lap joint, sheet metal.
 *
 * Module emits a *suggestion list* with confidence per candidate;
 * the caller picks the top or surfaces all in a UI.
 */

export type JointType = 'butt' | 'tee' | 'corner' | 'lap' | 'edge';

export type WeldSymbol = 'fillet' | 'square-butt' | 'v-groove' | 'u-groove' | 'j-groove' | 'edge' | 'spot' | 'seam';

export interface JointGeometry {
  jointType: JointType;
  /** Thickness of plate A, mm. */
  plateAThicknessMm: number;
  /** Thickness of plate B, mm. */
  plateBThicknessMm: number;
  /** Plate A grade (e.g., A36 / S275 / 6061). */
  materialA?: string;
  /** Optional access constraint (single-sided vs both-sided). */
  singleSidedAccess?: boolean;
}

export interface WeldSuggestion {
  symbol: WeldSymbol;
  confidence: number;
  /** Suggested groove angle (degrees) if a groove weld. */
  grooveAngleDeg?: number;
  /** Suggested fillet leg length (mm) if a fillet. */
  filletLegMm?: number;
  reasoning: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function suggestWeldSymbols(joint: JointGeometry): WeldSuggestion[] {
  const suggestions: WeldSuggestion[] = [];
  const minT = Math.min(joint.plateAThicknessMm, joint.plateBThicknessMm);
  const maxT = Math.max(joint.plateAThicknessMm, joint.plateBThicknessMm);

  switch (joint.jointType) {
    case 'tee':
      suggestions.push({
        symbol: 'fillet',
        confidence: 0.95,
        filletLegMm: pickFilletLeg(minT),
        reasoning: 'T-joint → fillet weld with leg ≈ thickness.',
      });
      break;
    case 'corner':
      suggestions.push({
        symbol: 'fillet',
        confidence: 0.7,
        filletLegMm: pickFilletLeg(minT),
        reasoning: 'Corner joint accepts a single-fillet weld.',
      });
      if (maxT > 6) {
        suggestions.push({
          symbol: 'v-groove',
          confidence: 0.6,
          grooveAngleDeg: 60,
          reasoning: 'Thick corner can also use V-groove for full penetration.',
        });
      }
      break;
    case 'butt': {
      if (maxT <= 3) {
        suggestions.push({
          symbol: 'square-butt',
          confidence: 0.9,
          reasoning: 'Thin plate (≤ 3 mm) butt → square butt, no edge prep.',
        });
      } else if (maxT <= 20) {
        suggestions.push({
          symbol: 'v-groove',
          confidence: 0.9,
          grooveAngleDeg: 60,
          reasoning: 'Medium thickness butt → V-groove, 60° included angle.',
        });
      } else {
        suggestions.push({
          symbol: 'u-groove',
          confidence: 0.85,
          grooveAngleDeg: 30,
          reasoning: 'Thick butt (> 20 mm) → U-groove minimizes weld volume.',
        });
        suggestions.push({
          symbol: 'v-groove',
          confidence: 0.7,
          grooveAngleDeg: 60,
          reasoning: 'V-groove also feasible at higher cost.',
        });
      }
      if (joint.singleSidedAccess) {
        suggestions.push({
          symbol: 'j-groove',
          confidence: 0.75,
          grooveAngleDeg: 30,
          reasoning: 'Single-sided access → J-groove on accessible side.',
        });
      }
      break;
    }
    case 'lap':
      suggestions.push({
        symbol: 'fillet',
        confidence: 0.9,
        filletLegMm: pickFilletLeg(minT),
        reasoning: 'Lap joint → fillet on edge.',
      });
      if (minT < 1.5) {
        suggestions.push({
          symbol: 'spot',
          confidence: 0.8,
          reasoning: 'Thin sheet lap → spot weld.',
        });
        suggestions.push({
          symbol: 'seam',
          confidence: 0.6,
          reasoning: 'Continuous lap → seam weld.',
        });
      }
      break;
    case 'edge':
      suggestions.push({
        symbol: 'edge',
        confidence: 0.9,
        reasoning: 'Edge joint → edge weld.',
      });
      break;
  }

  // Sort by confidence desc.
  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions;
}

// ── Helpers ────────────────────────────────────────────────────

function pickFilletLeg(thicknessMm: number): number {
  // Common rule: leg length = thickness, rounded to nearest 1 mm.
  return Math.max(3, Math.round(thicknessMm));
}

// ── Reverse query: weld volume estimate ───────────────────────

/** Estimate weld bead volume per meter for cost / time. */
export function estimateBeadVolumeMm3PerM(suggestion: WeldSuggestion): number {
  if (suggestion.symbol === 'fillet') {
    const leg = suggestion.filletLegMm ?? 5;
    return 0.5 * leg * leg * 1000; // triangular cross-section × 1 m
  }
  if (suggestion.symbol === 'square-butt') {
    return 3 * 3 * 1000;
  }
  if (suggestion.symbol === 'v-groove') {
    const angle = (suggestion.grooveAngleDeg ?? 60) * Math.PI / 180;
    // 10 mm depth assumed × tan(angle/2) base = triangle.
    const depth = 10;
    const base = 2 * depth * Math.tan(angle / 2);
    return 0.5 * base * depth * 1000;
  }
  if (suggestion.symbol === 'u-groove') {
    return 8 * 4 * 1000;
  }
  if (suggestion.symbol === 'j-groove') {
    return 6 * 4 * 1000;
  }
  if (suggestion.symbol === 'edge') return 5 * 2 * 1000;
  if (suggestion.symbol === 'spot') return 50;
  if (suggestion.symbol === 'seam') return 5 * 1000;
  return 0;
}

// ── Summary ────────────────────────────────────────────────────

export interface SuggestionSummary {
  count: number;
  primarySymbol: WeldSymbol | null;
  averageConfidence: number;
  hasGrooveOption: boolean;
}

export function summarize(suggestions: WeldSuggestion[]): SuggestionSummary {
  if (suggestions.length === 0) {
    return { count: 0, primarySymbol: null, averageConfidence: 0, hasGrooveOption: false };
  }
  const avg = suggestions.reduce((s, x) => s + x.confidence, 0) / suggestions.length;
  const hasGroove = suggestions.some(s => s.symbol.includes('groove'));
  return {
    count: suggestions.length,
    primarySymbol: suggestions[0]!.symbol,
    averageConfidence: avg,
    hasGrooveOption: hasGroove,
  };
}
