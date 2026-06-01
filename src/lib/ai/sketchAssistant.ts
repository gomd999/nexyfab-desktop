/**
 * sketchAssistant — Phase 6 of NexyFab Pro own-CAD (ADR-013).
 *
 * AI helper that takes a natural-language sketch command + current sketch
 * state and returns a list of suggested sketch operations the SolverSketch
 * editor can preview-and-apply.
 *
 * Architecture: this module owns only the IR + a deterministic rule-based
 * stub. The actual LLM integration lives in src/lib/ai/scad-agent/ (already
 * exists, used by shape-chat) — Phase 6.2 wires the LLM caller to the same
 * SuggestedSketchOp output type so the stub and the LLM are interchangeable.
 *
 * Scope (Phase 6 minimal):
 *   - SuggestedSketchOp union covering the 5 most common operations
 *   - Deterministic stub handling 6 canonical patterns (테스트 가능):
 *     "horizontal line", "vertical line", "square 50",
 *     "circle radius 20", "make parallel", "delete last"
 *   - i18n: same prompt phrasing works for KR + EN. Stub matches on
 *     keywords from either language.
 *
 * Out of scope (Phase 6.2+):
 *   - Live LLM call (wire to existing AI provider chain)
 *   - Streaming suggestions
 *   - Multi-turn conversation memory
 *   - Voice input transcription wrapper
 */

import type { PointId, LineId } from '@/lib/sketch/solver';

// ─── op IR ────────────────────────────────────────────────────────────────

export type SuggestedSketchOp =
  | { type: 'add_line'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'add_circle'; center: { x: number; y: number }; radius: number }
  | { type: 'add_rect'; corner: { x: number; y: number }; width: number; height: number }
  | { type: 'add_constraint_horizontal'; lineId: LineId }
  | { type: 'add_constraint_vertical'; lineId: LineId }
  | { type: 'add_constraint_parallel'; line1: LineId; line2: LineId }
  | { type: 'add_constraint_perpendicular'; line1: LineId; line2: LineId }
  | { type: 'add_dimension_distance'; p1: PointId; p2: PointId; distance: number }
  | { type: 'delete_last' };

export interface Suggestion {
  /** The op to apply. */
  op: SuggestedSketchOp;
  /** Confidence in [0, 1]. Stub returns 1.0; LLM returns its self-rating. */
  confidence: number;
  /** Why this op was suggested (shown in the UI). */
  rationale: string;
}

export interface AssistantRequest {
  /** Natural-language command (Korean or English supported by the stub). */
  prompt: string;
  /** Current sketch state (for LLM context; stub uses for default positions). */
  state?: {
    nextPointAt?: { x: number; y: number };
    lastLineId?: LineId;
    lineIds: ReadonlyArray<LineId>;
  };
}

export interface AssistantResponse {
  suggestions: ReadonlyArray<Suggestion>;
  /** True if at least one suggestion was found. */
  matched: boolean;
}

// ─── stub interpreter ────────────────────────────────────────────────────

/**
 * Deterministic stub. Pattern-matches a handful of canonical commands.
 * Production (Phase 6.2): replaced/extended by the LLM caller that returns
 * the same Suggestion type.
 */
export function interpretSketchCommand(req: AssistantRequest): AssistantResponse {
  const text = req.prompt.trim().toLowerCase();
  const origin = req.state?.nextPointAt ?? { x: 0, y: 0 };

  const suggestions: Suggestion[] = [];

  // Horizontal line.
  if (matchAny(text, ['horizontal line', '수평선', '수평 선', '가로선'])) {
    suggestions.push({
      op: { type: 'add_line', from: origin, to: { x: origin.x + 50, y: origin.y } },
      confidence: 1,
      rationale: 'Add a 50mm horizontal line from current cursor.',
    });
    if (req.state?.lastLineId) {
      suggestions.push({
        op: { type: 'add_constraint_horizontal', lineId: req.state.lastLineId },
        confidence: 1,
        rationale: 'Or pin the most recent line as horizontal.',
      });
    }
  }

  // Vertical line.
  if (matchAny(text, ['vertical line', '수직선', '수직 선', '세로선'])) {
    suggestions.push({
      op: { type: 'add_line', from: origin, to: { x: origin.x, y: origin.y + 50 } },
      confidence: 1,
      rationale: 'Add a 50mm vertical line from current cursor.',
    });
    if (req.state?.lastLineId) {
      suggestions.push({
        op: { type: 'add_constraint_vertical', lineId: req.state.lastLineId },
        confidence: 1,
        rationale: 'Or pin the most recent line as vertical.',
      });
    }
  }

  // Square + size.
  const sqMatch = text.match(/(?:square|사각형|정사각형)[ ]*(\d+(?:\.\d+)?)?/);
  if (sqMatch) {
    const size = Number(sqMatch[1] ?? '50');
    suggestions.push({
      op: { type: 'add_rect', corner: origin, width: size, height: size },
      confidence: 1,
      rationale: `Add a ${size}×${size}mm square at the cursor.`,
    });
  }

  // Circle radius N.
  const circleMatch = text.match(/(?:circle|원)[ ]*(?:radius|반지름)?[ ]*(\d+(?:\.\d+)?)/);
  if (circleMatch) {
    const r = Number(circleMatch[1]!);
    suggestions.push({
      op: { type: 'add_circle', center: origin, radius: r },
      confidence: 1,
      rationale: `Add a circle of radius ${r}mm at the cursor.`,
    });
  }

  // Make parallel — requires ≥ 2 lines in scene.
  if (matchAny(text, ['make parallel', '평행하게', '평행으로', 'parallel']) && (req.state?.lineIds.length ?? 0) >= 2) {
    const ids = req.state!.lineIds;
    suggestions.push({
      op: {
        type: 'add_constraint_parallel',
        line1: ids[ids.length - 2]!,
        line2: ids[ids.length - 1]!,
      },
      confidence: 0.8,
      rationale: 'Constrain the last two lines parallel.',
    });
  }

  // Delete last.
  if (matchAny(text, ['delete last', '마지막 삭제', '지우기', 'undo last', '되돌리기'])) {
    suggestions.push({
      op: { type: 'delete_last' },
      confidence: 1,
      rationale: 'Remove the most recently added entity.',
    });
  }

  return { suggestions, matched: suggestions.length > 0 };
}

function matchAny(text: string, patterns: ReadonlyArray<string>): boolean {
  for (const p of patterns) if (text.includes(p)) return true;
  return false;
}
