/**
 * sketchConstraintIntent — NL → SketchConstraintIntent regex-based classifier
 * for *sketch-level* constraint commands (a sibling to
 * `featureTreeIntentDetector`, which targets the *feature-tree* level).
 *
 * Phase A of Sketch AI surfaces (sibling track to Agent-PPP). Where
 * `featureTreeIntentDetector` resolves prompts like "create a box 50x50x30
 * with fillet 5" into multi-step CAD plans, this module resolves prompts
 * like "make all lines horizontal" or "constrain selected points
 * coincident" into a single solver-level constraint intent that the host
 * can route to `SketchSolver.addHorizontal` / `addCoincident` / etc.
 *
 * Why a separate module?
 *   - Different vocabulary domain (geometric/dimensional constraints, not
 *     parametric feature operations).
 *   - Different output shape (one intent → one solver call, not a multi-
 *     step PlanResult).
 *   - Different selection semantics: many sketch constraints take an
 *     *implicit* selection ("selected lines"). The intent only records
 *     "intent says parallel" — the caller (SketchConstraintAiPanel +
 *     editor) supplies the actual selected entity ids on Apply.
 *
 * Vocabulary covered (Phase A — 6 kinds):
 *   1. make_horizontal
 *      - "make all lines horizontal", "horizontal all lines",
 *        "(all|every) lines? horizontal"
 *      - When lineIds is undefined → solver targets every line in scope.
 *   2. make_vertical
 *      - Mirror of make_horizontal.
 *   3. make_parallel
 *      - "make selected lines parallel", "parallel (the )?selected lines"
 *      - line1Id/line2Id are sentinel "selected" placeholders; the panel
 *        substitutes the real ids before calling the solver.
 *   4. make_perpendicular
 *      - "make selected lines perpendicular", "perpendicular selected"
 *   5. fix_distance
 *      - "set distance 50", "fix distance to 12.5", "distance 30"
 *      - Captures the numeric value; pointAId/pointBId are sentinel
 *        "selected" placeholders.
 *   6. coincident_points
 *      - "merge points", "make selected points coincident",
 *        "coincident points"
 *
 * Sentinel placeholder convention:
 *   For intents that need entity ids but rely on UI selection, we emit
 *   the literal string `__SELECTED__` for the missing ids. The panel /
 *   editor is responsible for replacing those before invoking the solver.
 *   This keeps the intent module pure (no DOM / selection access) while
 *   still satisfying the typed contract from the task spec.
 *
 * Fallback policy:
 *   `detectSketchConstraintIntent` returns `null` when nothing matches.
 *   The panel may then either show "could not understand" or fall back
 *   to an LLM (not wired in Phase A — LLM hooks come in Phase B).
 */

/**
 * Sentinel value used in place of an entity id when the intent depends
 * on an external selection. The panel/editor MUST replace these with
 * concrete ids before calling the solver. We export it so callers can
 * write defensive checks like `id === SELECTED_PLACEHOLDER`.
 */
export const SELECTED_PLACEHOLDER = '__SELECTED__';

export type SketchConstraintIntent =
  | { kind: 'make_horizontal'; lineIds?: string[] } // undefined → all lines
  | { kind: 'make_vertical'; lineIds?: string[] }
  | { kind: 'make_parallel'; line1Id: string; line2Id: string }
  | { kind: 'make_perpendicular'; line1Id: string; line2Id: string }
  | {
      kind: 'fix_distance';
      pointAId: string;
      pointBId: string;
      distance: number;
    }
  | { kind: 'coincident_points'; pointIds: string[] };

/** Enumerated for UI dropdowns + LLM fallback prompt templates. */
export const SKETCH_CONSTRAINT_INTENT_KINDS = [
  'make_horizontal',
  'make_vertical',
  'make_parallel',
  'make_perpendicular',
  'fix_distance',
  'coincident_points',
] as const;

export type SketchConstraintIntentKind =
  (typeof SKETCH_CONSTRAINT_INTENT_KINDS)[number];

/**
 * Detect a SketchConstraintIntent from free-form natural-language input.
 * Returns null when no regex matches — caller decides whether to surface
 * a "could not understand" message or attempt LLM fallback.
 */
export function detectSketchConstraintIntent(
  input: string,
): SketchConstraintIntent | null {
  const text = input.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  // Order matters: more specific phrases first. perpendicular/parallel
  // share the "selected lines" frame so try perpendicular before parallel
  // (perpendicular text would otherwise be eaten by the parallel matcher
  // if we ever loosen its regex). coincident_points + fix_distance are
  // domain-specific keywords (points / distance) so order among them
  // doesn't conflict.
  return (
    matchMakePerpendicular(lower) ??
    matchMakeParallel(lower) ??
    matchMakeHorizontal(lower) ??
    matchMakeVertical(lower) ??
    matchFixDistance(lower) ??
    matchCoincidentPoints(lower) ??
    null
  );
}

// ─── Per-intent matchers ─────────────────────────────────────────────────

/**
 * Examples:
 *   "make all lines horizontal"
 *   "horizontal all lines"
 *   "make every line horizontal"
 *   "horizontal" (bare keyword → assume all lines)
 *
 * We accept either ordering of "make X horizontal" / "horizontal X" so
 * the user doesn't have to remember a single sentence frame.
 */
function matchMakeHorizontal(t: string): SketchConstraintIntent | null {
  // Reject if a parallel/perpendicular keyword is present — those win.
  if (/\bperpendicular\b/.test(t)) return null;
  if (/\bparallel\b/.test(t)) return null;
  if (!/\bhorizontal\b/.test(t)) return null;
  // "make all lines horizontal" / "all lines horizontal" / "horizontal all lines"
  // / "make every line horizontal" — all collapse to lineIds: undefined.
  if (/\b(?:all|every)\s+lines?\b/.test(t) || /\blines?\b/.test(t) === false) {
    return { kind: 'make_horizontal' };
  }
  // Default: bare "horizontal" or "make horizontal" → still mean "all lines".
  return { kind: 'make_horizontal' };
}

/** Mirror of matchMakeHorizontal. */
function matchMakeVertical(t: string): SketchConstraintIntent | null {
  if (/\bperpendicular\b/.test(t)) return null;
  if (/\bparallel\b/.test(t)) return null;
  if (!/\bvertical\b/.test(t)) return null;
  if (/\b(?:all|every)\s+lines?\b/.test(t) || /\blines?\b/.test(t) === false) {
    return { kind: 'make_vertical' };
  }
  return { kind: 'make_vertical' };
}

/**
 * Examples:
 *   "make selected lines parallel"
 *   "parallel selected lines"
 *   "parallel the selected lines"
 *   "make the two lines parallel"
 *   "parallel" (bare keyword)
 *
 * `line1Id` + `line2Id` are emitted as SELECTED_PLACEHOLDER — the panel
 * substitutes the actual line ids from the editor's selection state
 * before calling the solver. We refuse to match if the phrase contains
 * "horizontal"/"vertical" (those are 1-line constraints, not parallel).
 */
function matchMakeParallel(t: string): SketchConstraintIntent | null {
  if (!/\bparallel\b/.test(t)) return null;
  // "perpendicular" gets its own matcher.
  if (/\bperpendicular\b/.test(t)) return null;
  return {
    kind: 'make_parallel',
    line1Id: SELECTED_PLACEHOLDER,
    line2Id: SELECTED_PLACEHOLDER,
  };
}

/** Examples mirror parallel — "make selected lines perpendicular". */
function matchMakePerpendicular(t: string): SketchConstraintIntent | null {
  if (!/\bperpendicular\b/.test(t)) return null;
  return {
    kind: 'make_perpendicular',
    line1Id: SELECTED_PLACEHOLDER,
    line2Id: SELECTED_PLACEHOLDER,
  };
}

/**
 * Examples:
 *   "set distance 50"
 *   "fix distance to 12.5"
 *   "distance 30"
 *   "set the distance between selected points to 25"
 *
 * Picks up the first finite positive number after the distance keyword.
 * pointAId/pointBId are SELECTED_PLACEHOLDER (panel substitutes).
 */
function matchFixDistance(t: string): SketchConstraintIntent | null {
  if (!/\bdistance\b/.test(t)) return null;
  // Accept "to <num>" or just "<num>" anywhere after the keyword.
  const m =
    t.match(/distance\s+(?:to\s+)?(\d+(?:\.\d+)?)/) ??
    t.match(/distance.*?(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const distance = Number(m[1]!);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  return {
    kind: 'fix_distance',
    pointAId: SELECTED_PLACEHOLDER,
    pointBId: SELECTED_PLACEHOLDER,
    distance,
  };
}

/**
 * Examples:
 *   "merge points"
 *   "make selected points coincident"
 *   "coincident points"
 *   "merge selected points"
 *   "coincident the selected points"
 *
 * `pointIds` is emitted as an empty array — the panel substitutes the
 * selected point ids (typically 2, but the solver supports chains via
 * pairwise coincident constraints). We accept an empty placeholder
 * rather than the SELECTED_PLACEHOLDER convention so callers can do a
 * simple `intent.pointIds.length === 0` check.
 */
function matchCoincidentPoints(t: string): SketchConstraintIntent | null {
  // "merge points" / "merge selected points"
  if (/\bmerge\b.*\bpoints?\b/.test(t)) {
    return { kind: 'coincident_points', pointIds: [] };
  }
  // "coincident points" / "make ... coincident ... points" / "coincident the points"
  if (/\bcoincident\b/.test(t) && /\bpoints?\b/.test(t)) {
    return { kind: 'coincident_points', pointIds: [] };
  }
  return null;
}
