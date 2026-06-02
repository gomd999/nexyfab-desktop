/**
 * assemblyNlParser — Assembly-level natural-language → AssemblyPlan classifier
 * with a regex-first / LLM-fallback contract.
 *
 * Purpose: the assembly modal (AssemblyBrowserModal.tsx, Agent-NNNN) already
 * carries a tiny inline `parseAssemblyNl` that recognises just two patterns
 * ("N stacked" / "N x M grid"). This module is the standalone, route-ready
 * superset that:
 *
 *   1. Recognises four canonical assembly intents:
 *        - stacked  : N parts in a Z stack with optional spacing
 *        - grid     : R × C parts in a 2-D grid with optional spacing
 *        - ring     : N parts around a circle with optional radius
 *        - pair     : 2 parts joined by one mate (concentric / coincident / hinge)
 *      Anything else returns `{ kind: 'unparsed' }`.
 *   2. Provides BUILD_ASSEMBLY_PROMPT(text) — an LLM prompt template that
 *      mirrors `llmPrompt.ts`'s BUILD_INTENT_PROMPT shape (enumerate kinds,
 *      worked examples, "emit null on ambiguity"). The prompt is exported so
 *      the route can use the exact same string the tests assert against and
 *      so it can be re-used by evals / CLI tooling.
 *
 * Design choices:
 *   - We intentionally do NOT depend on `parseAssemblyNl` from the modal
 *     (DO NOT modify constraint). The two regexes (`stacked` / `grid`) are
 *     re-implemented here with additive support for optional `spacing N`.
 *   - The `pair` regex matches very loose phrasings ("pair concentric",
 *     "two parts hinge", "pair with coincident mate") because the LLM
 *     fallback handles anything more complex.
 *   - All numeric fields are MILLIMETRES (mm); radius for `ring` is mm.
 *   - Returning `unparsed` (not null) keeps the function total — callers
 *     pattern-match the discriminant without dealing with nullish chains.
 *
 * Why a separate module instead of extending the modal's helper?
 *   - The modal's helper is part of a 3614-line client component; pulling
 *     parsing into a module makes it testable in isolation and reusable
 *     from the new `/api/assembly-intent` route.
 *   - Future agents can integrate this back into the modal in a separate
 *     batch (NNNN integration is explicitly out-of-scope here).
 */

// ─── Public types ────────────────────────────────────────────────────────

/**
 * Output of the assembly-level NL parser. Discriminated union on `kind` so
 * downstream code (planner, modal, tests) can switch exhaustively without
 * worrying about `unknown` shapes. Numeric fields are mm (radius / spacing).
 *
 * `unparsed` is the "couldn't classify" sentinel — both the regex pass and
 * the LLM pass surface it the same way so the route's source-tagging stays
 * the single source of truth for "where did this result come from".
 */
export type AssemblyPlan =
  | {
      kind: 'stacked';
      /** Count of parts to stack along +Z. Must be a positive integer ≥ 1. */
      count: number;
      /** Optional inter-part spacing in mm. Defaulted by downstream planner. */
      spacing?: number;
    }
  | {
      kind: 'grid';
      /** Number of rows in the planar grid (Y direction). Positive integer ≥ 1. */
      rows: number;
      /** Number of columns in the planar grid (X direction). Positive integer ≥ 1. */
      cols: number;
      /** Optional inter-part spacing in mm shared across both axes. */
      spacing?: number;
    }
  | {
      kind: 'ring';
      /** Count of parts evenly distributed around a circle. Positive integer ≥ 2. */
      count: number;
      /** Optional ring radius in mm. Defaulted by downstream planner. */
      radius?: number;
    }
  | {
      kind: 'pair';
      /**
       * Which mate kind to apply between the two parts. Limited to the three
       * most common pair mates so the regex stays unambiguous; richer
       * vocabulary should go through the LLM path with a strict JSON shape.
       */
      mate: 'concentric' | 'coincident' | 'hinge';
    }
  | { kind: 'unparsed' };

/** Stable enumeration of the recognised kinds — used by the prompt builder. */
export const ASSEMBLY_PLAN_KINDS = ['stacked', 'grid', 'ring', 'pair'] as const;

/** Allowed pair mate kinds — kept in one place for the prompt + validator. */
export const PAIR_MATE_KINDS = ['concentric', 'coincident', 'hinge'] as const;

// ─── Regex pass ──────────────────────────────────────────────────────────

/**
 * "3 stacked" / "3 stacked plates" / "stack 4 parts" / "4 stacked spacing 10"
 * Captures: (1) count, (2?) spacing-after-`spacing` keyword.
 * The leading-number form takes precedence; "stack N parts" is the second
 * shape. Optional "spacing K" tail is allowed on either form.
 */
const STACKED_LEADING_RE =
  /^\s*(\d+)\s+stacked\b(?:[^]*?\bspacing\s+(\d+(?:\.\d+)?))?/i;
const STACKED_VERB_RE =
  /^\s*stack(?:ed)?\s+(\d+)\s+parts?\b(?:[^]*?\bspacing\s+(\d+(?:\.\d+)?))?/i;

/**
 * "2 x 3 grid" / "4×2 grid of cylinders" / "3 x 3 grid spacing 50".
 * Accepts x, X, or × as the separator. Trailing "spacing K" is optional.
 */
const GRID_RE =
  /^\s*(\d+)\s*[x×X]\s*(\d+)\s+grid\b(?:[^]*?\bspacing\s+(\d+(?:\.\d+)?))?/i;

/**
 * "ring of 6" / "6 in a ring" / "ring of 8 radius 25" / "6 ring radius 30".
 * The radius keyword is mandatory before the number when present, so we
 * never accidentally consume an unrelated trailing number.
 */
const RING_OF_RE =
  /^\s*ring\s+of\s+(\d+)\b(?:[^]*?\bradius\s+(\d+(?:\.\d+)?))?/i;
const RING_TRAIL_RE =
  /^\s*(\d+)\s+(?:in\s+a\s+ring|ring)\b(?:[^]*?\bradius\s+(\d+(?:\.\d+)?))?/i;

/**
 * "pair concentric" / "pair with hinge" / "pair coincident mate" /
 * "two parts hinge". The mate keyword is one of the three known kinds.
 */
const PAIR_RE =
  /^\s*(?:pair|two\s+parts)\b[^]*?\b(concentric|coincident|hinge)\b/i;

/**
 * Run all four matchers in priority order and return the first hit, or
 * `{ kind: 'unparsed' }` if nothing matches. Priority is:
 *   grid → stacked → ring → pair
 * because the grid pattern is the most distinctive (contains `x` digit-pair)
 * and we want it to win over a hypothetical "3 stacked grid …" sentence.
 */
export function detectAssemblyIntent(text: string): AssemblyPlan {
  if (typeof text !== 'string') return { kind: 'unparsed' };
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: 'unparsed' };

  // 1. grid
  const grid = GRID_RE.exec(trimmed);
  if (grid) {
    const rows = Number(grid[1]);
    const cols = Number(grid[2]);
    const spacingRaw = grid[3];
    if (isPositiveInt(rows) && isPositiveInt(cols)) {
      const out: AssemblyPlan = { kind: 'grid', rows, cols };
      const spacing = spacingRaw === undefined ? undefined : Number(spacingRaw);
      if (spacing !== undefined && Number.isFinite(spacing) && spacing >= 0) {
        out.spacing = spacing;
      }
      return out;
    }
  }

  // 2. stacked (either leading "N stacked …" or verb "stack N parts")
  const stackedLeading = STACKED_LEADING_RE.exec(trimmed);
  const stackedVerb = stackedLeading ? null : STACKED_VERB_RE.exec(trimmed);
  const stacked = stackedLeading ?? stackedVerb;
  if (stacked) {
    const count = Number(stacked[1]);
    const spacingRaw = stacked[2];
    if (isPositiveInt(count)) {
      const out: AssemblyPlan = { kind: 'stacked', count };
      const spacing = spacingRaw === undefined ? undefined : Number(spacingRaw);
      if (spacing !== undefined && Number.isFinite(spacing) && spacing >= 0) {
        out.spacing = spacing;
      }
      return out;
    }
  }

  // 3. ring
  const ringOf = RING_OF_RE.exec(trimmed);
  const ringTrail = ringOf ? null : RING_TRAIL_RE.exec(trimmed);
  const ring = ringOf ?? ringTrail;
  if (ring) {
    const count = Number(ring[1]);
    const radiusRaw = ring[2];
    // ring needs at least 2 parts to make geometric sense; 1 collapses to a
    // single point and the planner would have to special-case it. Reject
    // here so the LLM gets a chance to interpret "ring of 1" as something
    // else (e.g., a single hoop).
    if (isPositiveInt(count) && count >= 2) {
      const out: AssemblyPlan = { kind: 'ring', count };
      const radius = radiusRaw === undefined ? undefined : Number(radiusRaw);
      if (radius !== undefined && Number.isFinite(radius) && radius > 0) {
        out.radius = radius;
      }
      return out;
    }
  }

  // 4. pair
  const pair = PAIR_RE.exec(trimmed);
  if (pair) {
    const mate = pair[1]?.toLowerCase();
    if (mate === 'concentric' || mate === 'coincident' || mate === 'hinge') {
      return { kind: 'pair', mate };
    }
  }

  return { kind: 'unparsed' };
}

function isPositiveInt(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

// ─── LLM prompt builder ──────────────────────────────────────────────────

/**
 * Build the LLM prompt body for converting `text` into an AssemblyPlan JSON
 * value. Mirrors the shape of `BUILD_INTENT_PROMPT` from `llmPrompt.ts`:
 *
 *   1. Enumerate ALL recognised kinds up-front so the LLM never has to
 *      guess field names.
 *   2. Provide an explicit (informal) JSON schema sketch.
 *   3. Show one worked example per kind + the "unparsed" path.
 *   4. Strict output: NO markdown fences, NO prose, NO apology — emit the
 *      JSON object or the literal string `null`.
 *
 * The return shape mirrors the AssemblyPlan discriminated union, with the
 * one exception that `null` from the LLM maps to `{ kind: 'unparsed' }` in
 * the route — the prompt asks for `null` because that's what the existing
 * intent-extraction infrastructure already accepts.
 */
export function BUILD_ASSEMBLY_PROMPT(text: string): string {
  const kindsLine = ASSEMBLY_PLAN_KINDS.join(', ');
  const escapedText = text.replace(/"/g, '\\"');
  return [
    `You are a CAD assembly assistant. Your job is to convert the user's natural language assembly request into a structured JSON intent.`,
    ``,
    `## Allowed intent kinds`,
    `[${kindsLine}]`,
    ``,
    `## Output contract`,
    `- Emit EXACTLY ONE JSON object matching the schema for one of the allowed kinds.`,
    `- If the user prompt does NOT clearly map to any kind, emit the literal string: null`,
    `- Do NOT wrap output in markdown code fences (\`\`\`json …\`\`\`).`,
    `- Do NOT include any prose, explanation, or apology.`,
    `- All numeric fields are millimetres (mm). Counts are positive integers.`,
    `- Reject (emit null) requests that need more than one mate, sub-assemblies,`,
    `  or features outside the four kinds below.`,
    ``,
    `## JSON schema sketch`,
    ASSEMBLY_SCHEMA_SKETCH,
    ``,
    `## Examples`,
    ASSEMBLY_EXAMPLES_BLOCK,
    ``,
    `## Error / ambiguity cases (return null)`,
    `- "please help me" → null`,
    `- "make something cool" → null`,
    `- "assembly" (no count, no shape) → null`,
    `- "stacked" (missing count) → null`,
    `- "design a transmission gearbox" (unsupported scope) → null`,
    ``,
    `## User request`,
    `"${escapedText}"`,
    ``,
    `## Your output (JSON or null, nothing else)`,
  ].join('\n');
}

/**
 * Informal schema sketch — exported so tests can assert the prompt carries
 * every required field name without re-stringifying.
 */
export const ASSEMBLY_SCHEMA_SKETCH = `stacked:  { "kind": "stacked",  "count": int>0, "spacing"?: number≥0 }
grid:     { "kind": "grid",     "rows":  int>0, "cols": int>0, "spacing"?: number≥0 }
ring:     { "kind": "ring",     "count": int≥2, "radius"?: number>0 }
pair:     { "kind": "pair",     "mate":  "concentric" | "coincident" | "hinge" }`;

/**
 * One worked example per kind, exported so tests can assert the prompt is
 * exhaustive. Examples deliberately use phrasings the regex does NOT cover
 * to teach the LLM where it's expected to add value.
 */
export const ASSEMBLY_EXAMPLES_BLOCK = [
  `User: "three plates stacked on top of each other"`,
  `Output: {"kind":"stacked","count":3}`,
  `User: "a 4 by 5 array of bolts spaced 20mm apart"`,
  `Output: {"kind":"grid","rows":4,"cols":5,"spacing":20}`,
  `User: "arrange six bolts around a 30mm circle"`,
  `Output: {"kind":"ring","count":6,"radius":30}`,
  `User: "two shafts joined concentrically"`,
  `Output: {"kind":"pair","mate":"concentric"}`,
].join('\n');
