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
import { ADDABLE_FEATURES } from './addableFeatureTypes';
import { renderModelContext, type AiModelContext } from './modelContext';

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
  context?: AiModelContext,
): string {
  const kindsLine = intentKinds.join(', ');
  const exampleBlock = buildExampleBlock(intentKinds);
  const escapedText = text.replace(/"/g, '\\"');
  const contextBlock = renderModelContext(context);
  return [
    `You are a CAD design assistant. Your job is to convert the user's natural language CAD request into a structured JSON intent.`,
    ``,
    ...(contextBlock
      ? [
          `## Current model (use it to resolve "it", "the last feature", "this face", "the fillet", etc.)`,
          contextBlock,
          ``,
        ]
      : []),
    `## Allowed intent kinds`,
    `[${kindsLine}]`,
    ``,
    `## Output contract`,
    `- Emit EXACTLY ONE JSON object matching the schema for one of the allowed kinds.`,
    `- If the user prompt does NOT clearly map to any kind, emit the literal string: null`,
    `- Do NOT wrap output in markdown code fences (\`\`\`json …\`\`\`).`,
    `- Do NOT include any prose, explanation, or apology.`,
    `- All numeric fields are millimetres (mm). Angles are degrees.`,
    `- To add a dress-up / modifier feature to the current part (thread, draft,`,
    `  shell, helix, scale, fillet, chamfer, hole, …), use "add_feature_to_last".`,
    `- For a CUSTOM shape the catalog can't express (L-bracket, T-profile, star,`,
    `  gusset, arbitrary outline), use "create_sketch_extrude": emit the 2D`,
    `  outline as a closed list of {x,y} points (mm) plus an extrude depth.`,
    `- For a part that is a base shape PLUS several features ("a plate with 4`,
    `  holes and rounded edges"), use "build_part": one base primitive + an`,
    `  ordered list of features. Prefer this over emitting features one at a time.`,
    `- For an ASSEMBLY of several DIFFERENT parts positioned in space ("a base`,
    `  plate with 4 cylindrical legs at the corners", "a bolt through two plates"),`,
    `  use "assemble_parts": list each part with its own shapeId, params, and`,
    `  position (mm). Compute sensible corner/stack positions from the dimensions.`,
    `- Reject (emit null) only requests that require genuinely unsupported`,
    `  features such as gears, full sheet-metal flanges, or freeform surfaces.`,
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
                            "angle"?:   number }  // optional for "circular" (default 360, range (0,360])

add_feature_to_last:      { "kind": "add_feature_to_last",
                            "featureType": one of the types below,
                            "params": { <param>: number, … } }   // omitted params use feature defaults
${ADDABLE_FEATURES.map((f) => `   • ${f.type}: ${f.params.join(', ')}`).join('\n')}

update_last_param:        { "kind": "update_last_param",
                            "paramKey": string, "value": number }   // edit the LAST feature's param ("make it 8mm")

remove_last:              { "kind": "remove_last" }                  // remove the LAST feature ("remove the fillet")

create_sketch_extrude:    { "kind": "create_sketch_extrude",
                            "profile": [{ "x": number, "y": number }, …],  // CLOSED 2D outline, mm, ≥3 pts, CCW
                            "depth": number,                                // extrude thickness, mm
                            "plane"?: "xy" | "xz" | "yz",                   // default xy
                            "operation"?: "add" | "subtract" }             // default add

build_part:               { "kind": "build_part",
                            "base": { "shapeId": "box"|"cylinder"|"sphere"|"cone"|"disk"|"pipe"|"torus",
                                      "params": { <param>: number } },
                            "features": [ { "type": "hole"|"fillet"|"chamfer"|"shell"|"thread"|"draft"|
                                                    "linearPattern"|"circularPattern"|"scale",
                                            "params": { <param>: number } }, … ] }
                            // ONE base + an ordered list of features stacked on it

assemble_parts:           { "kind": "assemble_parts",
                            "parts": [ { "name"?: string,
                                         "shapeId": "box"|"cylinder"|"sphere"|"cone"|"disk"|"pipe"|
                                                    "torus"|"hexNut"|"washer"|"bolt"|"gear"|"flange",
                                         "params": { <param>: number },
                                         "position"?: [x, y, z],   // mm, default [0,0,0]
                                         "rotation"?: [x, y, z] }, … ] }  // degrees
                            // ≥2 DIFFERENT parts positioned in space (a real assembly)`;

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
  update_last_param: [
    {
      in: 'make it 8mm',
      out: '{"kind":"update_last_param","paramKey":"radius","value":8}',
    },
    {
      in: 'make the fillet 5 instead',
      out: '{"kind":"update_last_param","paramKey":"radius","value":5}',
    },
  ],
  remove_last: [
    {
      in: 'remove the fillet',
      out: '{"kind":"remove_last"}',
    },
    {
      in: '마지막 거 지워줘',
      out: '{"kind":"remove_last"}',
    },
  ],
  create_sketch_extrude: [
    {
      in: 'an L-shaped bracket, 50mm legs, 20mm wide, 5mm thick',
      out: '{"kind":"create_sketch_extrude","profile":[{"x":0,"y":0},{"x":50,"y":0},{"x":50,"y":20},{"x":20,"y":20},{"x":20,"y":50},{"x":0,"y":50}],"depth":5}',
    },
    {
      in: 'a right-triangle gusset 40x40, 6mm thick',
      out: '{"kind":"create_sketch_extrude","profile":[{"x":0,"y":0},{"x":40,"y":0},{"x":0,"y":40}],"depth":6}',
    },
    {
      in: '한 변 30 정육각형 프로파일 10mm 두께',
      out: '{"kind":"create_sketch_extrude","profile":[{"x":30,"y":0},{"x":15,"y":26},{"x":-15,"y":26},{"x":-30,"y":0},{"x":-15,"y":-26},{"x":15,"y":-26}],"depth":10}',
    },
  ],
  build_part: [
    {
      in: 'a 50x30x20 plate with a 10mm hole and 2mm filleted edges',
      out: '{"kind":"build_part","base":{"shapeId":"box","params":{"width":50,"height":20,"depth":30}},"features":[{"type":"hole","params":{"diameter":10}},{"type":"fillet","params":{"radius":2}}]}',
    },
    {
      in: '지름 40 높이 60 원통, 가운데 12mm 구멍, 윗면 모깎기 3mm',
      out: '{"kind":"build_part","base":{"shapeId":"cylinder","params":{"diameter":40,"height":60}},"features":[{"type":"hole","params":{"diameter":12}},{"type":"fillet","params":{"radius":3}}]}',
    },
  ],
  assemble_parts: [
    {
      in: 'a 80x80x5 base plate with 4 cylindrical legs 10mm diameter 40mm tall at the corners',
      out: '{"kind":"assemble_parts","parts":[{"name":"plate","shapeId":"box","params":{"width":80,"height":5,"depth":80},"position":[0,0,0]},{"name":"leg1","shapeId":"cylinder","params":{"diameter":10,"height":40},"position":[30,-22,30]},{"name":"leg2","shapeId":"cylinder","params":{"diameter":10,"height":40},"position":[-30,-22,30]},{"name":"leg3","shapeId":"cylinder","params":{"diameter":10,"height":40},"position":[30,-22,-30]},{"name":"leg4","shapeId":"cylinder","params":{"diameter":10,"height":40},"position":[-30,-22,-30]}]}',
    },
    {
      in: '두 플레이트(50x50x4)를 5mm 띄워 쌓고 가운데 M6 볼트로 관통',
      out: '{"kind":"assemble_parts","parts":[{"name":"plate_bottom","shapeId":"box","params":{"width":50,"height":4,"depth":50},"position":[0,0,0]},{"name":"plate_top","shapeId":"box","params":{"width":50,"height":4,"depth":50},"position":[0,9,0]},{"name":"bolt","shapeId":"bolt","params":{"shaftDiameter":6,"shaftLength":20},"position":[0,0,0]}]}',
    },
  ],
  add_feature_to_last: [
    {
      in: 'add a thread pitch 2',
      out: '{"kind":"add_feature_to_last","featureType":"thread","params":{"pitch":2}}',
    },
    {
      in: '나사 넣어줘',
      out: '{"kind":"add_feature_to_last","featureType":"thread","params":{}}',
    },
    {
      in: 'add 3 degree draft',
      out: '{"kind":"add_feature_to_last","featureType":"draft","params":{"angle":3}}',
    },
    {
      in: 'hollow it out 2mm walls',
      out: '{"kind":"add_feature_to_last","featureType":"shell","params":{"wallThickness":2}}',
    },
    {
      in: 'scale to 1.5x',
      out: '{"kind":"add_feature_to_last","featureType":"scale","params":{"scaleX":1.5,"scaleY":1.5,"scaleZ":1.5}}',
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
