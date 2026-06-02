/**
 * llmPrompt — Phase 3.AI.2 prompt templates for the FeatureTree intent LLM.
 *
 * This module is the single source of truth for the LLM prompt used by the
 * `/api/featureTree-intent` route. It is intentionally split out from the
 * route so:
 *   - The template can be unit-tested without spinning up Next.js / network.
 *   - The route stays narrow (env-var routing + provider HTTP + JSON parse).
 *   - Other surfaces (CLI tooling, evals) can reuse the exact same prompt.
 *
 * Design goals:
 *   1. Enumerate ALL 12 PlanIntent kinds with at least one worked example
 *      each, so the LLM never has to guess the field names.
 *   2. Provide an explicit JSON schema sketch (informal but unambiguous) so
 *      the LLM emits validatable output.
 *   3. Cover error cases — when the user prompt doesn't map to any kind, the
 *      LLM should emit the literal string `null` (not an empty object, not
 *      "I cannot determine…", not a JSON-wrapped error). The route's
 *      `parseJsonOrNull` already accepts the literal `null`; this prompt
 *      keeps the contract explicit.
 *   4. Strict output: NO prose, NO markdown fences. The parse step tolerates
 *      both, but every wasted token is wasted latency + cost.
 *
 * Why not just hard-code the prompt in the route file?
 *   - The old hard-coded version only carried 4 of 6 kinds in its example
 *     list, so the LLM frequently picked the wrong `kind` when none of the
 *     examples matched. With 12 kinds we need a structured, exhaustive
 *     template — easier to keep in sync with `INTENT_KINDS` from a
 *     dedicated module.
 */

import { INTENT_KINDS } from './featureTreeIntentDetector';
import type { IntentKind } from './featureTreeIntentDetector';

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Build the LLM prompt body for converting `text` into a PlanIntent JSON
 * value. `intentKinds` defaults to the canonical INTENT_KINDS export but is
 * injectable so:
 *   - Future routes can restrict the set (e.g., "only modifier kinds" for
 *     an in-canvas quick-action menu).
 *   - Unit tests can verify the template handles the full 12-kind list.
 */
export function BUILD_INTENT_PROMPT(
  text: string,
  intentKinds: ReadonlyArray<IntentKind> = INTENT_KINDS,
): string {
  const kindsLine = intentKinds.join(', ');
  const exampleBlock = buildExampleBlock(intentKinds);
  const escapedText = text.replace(/"/g, '\\"');
  return [
    `You are a CAD design assistant. Your job is to convert the user's natural language CAD request into a structured JSON intent.`,
    ``,
    `## Allowed intent kinds`,
    `[${kindsLine}]`,
    ``,
    `## Output contract`,
    `- Emit EXACTLY ONE JSON object matching the schema for one of the allowed kinds.`,
    `- If the user prompt does NOT clearly map to any kind, emit the literal string: null`,
    `- Do NOT wrap output in markdown code fences (\`\`\`json …\`\`\`).`,
    `- Do NOT include any prose, explanation, or apology.`,
    `- All numeric fields are millimetres (mm). Angles are degrees.`,
    `- Reject (emit null) requests that require unsupported features such as`,
    `  threads, gears, sheet-metal, or freeform surfaces.`,
    ``,
    `## JSON schema sketch`,
    SCHEMA_SKETCH,
    ``,
    `## Examples`,
    exampleBlock,
    ``,
    `## Error / ambiguity cases (return null)`,
    `- "please help me" → null`,
    `- "make something cool" → null`,
    `- "box 50" (incomplete dimensions) → null`,
    `- "design a transmission gearbox" (unsupported features) → null`,
    ``,
    `## User request`,
    `"${escapedText}"`,
    ``,
    `## Your output (JSON or null, nothing else)`,
  ].join('\n');
}

// ─── Schema + examples ──────────────────────────────────────────────────

/**
 * Informal JSON schema sketch. Kept as a typed string constant so tests can
 * assert on its presence and downstream tooling can render it for humans.
 * (Not JSON Schema spec compliant — that level of formality is overkill for
 * a 12-kind tagged union and harms LLM compliance vs. a worked example.)
 */
export const SCHEMA_SKETCH = `// Vec3 = { "x": number, "y": number, "z": number }   (all > 0, mm)

create_box_with_holes:    { "kind": "create_box_with_holes",
                            "size": Vec3,
                            "holes": [{ "x": number, "y": number, "diameter": number }, …] }

create_box_with_fillet:   { "kind": "create_box_with_fillet",
                            "size": Vec3, "filletRadius": number }

create_cylinder:          { "kind": "create_cylinder",
                            "radius": number, "height": number }

add_fillet_to_last:       { "kind": "add_fillet_to_last", "radius": number }

add_chamfer_to_last:      { "kind": "add_chamfer_to_last", "distance": number }

create_assembly_stack:    { "kind": "create_assembly_stack",
                            "partCount": int>0, "spacing": number≥0 }

create_box_with_chamfer:  { "kind": "create_box_with_chamfer",
                            "size": Vec3, "chamferDistance": number }

create_box_with_pocket:   { "kind": "create_box_with_pocket",
                            "size": Vec3,
                            "pocketDepth": number, "pocketRadius": number }

create_cylinder_with_hole:{ "kind": "create_cylinder_with_hole",
                            "radius": number, "height": number,
                            "holeRadius": number }

create_pattern_grid:      { "kind": "create_pattern_grid",
                            "baseFeature": "extrude_box" | "cylinder",
                            "count": { "x": int>0, "y": int>0 },
                            "spacing": number>0 }

create_revolve_axis:      { "kind": "create_revolve_axis",
                            "profile": "rectangle" | "triangle",
                            "radius": number, "height": number }

add_pattern_to_last:      { "kind": "add_pattern_to_last",
                            "patternKind": "linear" | "circular",
                            "count": int≥2,
                            "spacing"?: number,   // required when patternKind="linear"
                            "angle"?:   number }  // optional for "circular" (default 360, range (0,360])`;

/**
 * Worked NL→JSON examples, one (and occasionally two) per kind. The LLM
 * gets the best compliance when both common phrasings and edge phrasings
 * are present.
 */
export const INTENT_EXAMPLES: Record<IntentKind, ReadonlyArray<{ in: string; out: string }>> = {
  create_box_with_holes: [
    {
      in: 'box 50x50x30 with 4 holes diameter 6',
      out: '{"kind":"create_box_with_holes","size":{"x":50,"y":50,"z":30},"holes":[{"x":12.5,"y":25,"diameter":6},{"x":25,"y":25,"diameter":6},{"x":37.5,"y":25,"diameter":6},{"x":50,"y":25,"diameter":6}]}',
    },
    {
      in: 'plate 100x60x5 with one hole diameter 10 in the centre',
      out: '{"kind":"create_box_with_holes","size":{"x":100,"y":60,"z":5},"holes":[{"x":50,"y":30,"diameter":10}]}',
    },
  ],
  create_box_with_fillet: [
    {
      in: 'box 50x50x30 with rounded edges radius 5',
      out: '{"kind":"create_box_with_fillet","size":{"x":50,"y":50,"z":30},"filletRadius":5}',
    },
  ],
  create_cylinder: [
    {
      in: 'cylinder r 10 h 20',
      out: '{"kind":"create_cylinder","radius":10,"height":20}',
    },
    {
      in: 'make a cylinder of radius 25 height 60',
      out: '{"kind":"create_cylinder","radius":25,"height":60}',
    },
  ],
  add_fillet_to_last: [
    {
      in: 'add fillet 3',
      out: '{"kind":"add_fillet_to_last","radius":3}',
    },
  ],
  add_chamfer_to_last: [
    {
      in: 'chamfer 2',
      out: '{"kind":"add_chamfer_to_last","distance":2}',
    },
  ],
  create_assembly_stack: [
    {
      in: 'stack 4 parts spaced 10',
      out: '{"kind":"create_assembly_stack","partCount":4,"spacing":10}',
    },
  ],
  create_box_with_chamfer: [
    {
      in: 'box 50x50x30 chamfer 2',
      out: '{"kind":"create_box_with_chamfer","size":{"x":50,"y":50,"z":30},"chamferDistance":2}',
    },
  ],
  create_box_with_pocket: [
    {
      in: 'box 50x50x30 with pocket depth 10 radius 5',
      out: '{"kind":"create_box_with_pocket","size":{"x":50,"y":50,"z":30},"pocketDepth":10,"pocketRadius":5}',
    },
  ],
  create_cylinder_with_hole: [
    {
      in: 'cylinder 25 60 with hole 10',
      out: '{"kind":"create_cylinder_with_hole","radius":25,"height":60,"holeRadius":10}',
    },
  ],
  create_pattern_grid: [
    {
      in: 'grid 3x3 cubes spacing 100',
      out: '{"kind":"create_pattern_grid","baseFeature":"extrude_box","count":{"x":3,"y":3},"spacing":100}',
    },
    {
      in: '4x2 grid of cylinders spacing 50',
      out: '{"kind":"create_pattern_grid","baseFeature":"cylinder","count":{"x":4,"y":2},"spacing":50}',
    },
  ],
  create_revolve_axis: [
    {
      in: 'revolve triangle 25 60',
      out: '{"kind":"create_revolve_axis","profile":"triangle","radius":25,"height":60}',
    },
    {
      in: 'revolve rectangle radius 10 height 40',
      out: '{"kind":"create_revolve_axis","profile":"rectangle","radius":10,"height":40}',
    },
  ],
  add_pattern_to_last: [
    {
      in: 'linear pattern 5 spacing 50',
      out: '{"kind":"add_pattern_to_last","patternKind":"linear","count":5,"spacing":50}',
    },
    {
      in: 'circular pattern 8 around 360',
      out: '{"kind":"add_pattern_to_last","patternKind":"circular","count":8,"angle":360}',
    },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function buildExampleBlock(kinds: ReadonlyArray<IntentKind>): string {
  const lines: string[] = [];
  for (const kind of kinds) {
    const examples = INTENT_EXAMPLES[kind];
    if (!examples) continue;
    for (const ex of examples) {
      lines.push(`User: "${ex.in}"`);
      lines.push(`Output: ${ex.out}`);
    }
  }
  return lines.join('\n');
}
