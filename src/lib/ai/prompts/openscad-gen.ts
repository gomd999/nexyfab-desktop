import type { PromptDefinition } from './index';

/**
 * openscad-gen route serves four sub-prompts. We expose each as a separate
 * registry entry under the parent id "openscad-gen" so callers can pick the
 * right mode explicitly: getPrompt('openscad-gen:generate'), etc.
 */

const JSCAD_API = `
const { primitives, booleans, transforms, expansions, extrusions, hulls, measurements, text } = jscad;

// Primitives
primitives.cuboid({ size: [w, h, d], center: [x, y, z] })
primitives.cylinder({ radius: r, height: h, segments: 64, center: [x, y, z] })
primitives.sphere({ radius: r, segments: 32 })
primitives.torus({ innerRadius: r1, outerRadius: r2 })
primitives.polyhedron({ points: [[x,y,z],...], faces: [[0,1,2],...] })
primitives.circle({ radius: r, segments: 32 })   // 2D
primitives.rectangle({ size: [w, h] })            // 2D
primitives.polygon({ points: [[x,y],...] })        // 2D

// Booleans
booleans.union(solid1, solid2, ...)
booleans.subtract(base, tool1, tool2, ...)
booleans.intersect(solid1, solid2)

// Transforms
transforms.translate([x, y, z], solid)
transforms.rotate([rx, ry, rz], solid)   // radians
transforms.scale([sx, sy, sz], solid)
transforms.mirrorX/Y/Z(solid)

// Extrusions
extrusions.extrudeLinear({ height: h }, profile2D)
extrusions.extrudeRotate({ segments: 32, angle: Math.PI * 2 }, profile2D)

// Expansions (rounding)
expansions.expand({ delta: r, segments: 16 }, solid)
expansions.offset({ delta: d }, shape2D)

// Hulls
hulls.hull(solid1, solid2)
`;

const GENERATE = `You are a precision CAD code generator for NexyFab.
Convert the user's natural language description into valid @jscad/modeling JavaScript code.

API reference:
\`\`\`
${JSCAD_API}
\`\`\`

RULES:
1. Always use millimeters
2. Code MUST define a \`main()\` function returning ONE solid
3. Use booleans.subtract for holes/pockets
4. Bolt hole radii: M3=1.7, M4=2.25, M5=2.75, M6=3.3, M8=4.5, M10=5.5
5. Wall thickness min 2mm
6. Declare all dimensions as named const at top for parametric editing

RESPONSE (JSON only, no markdown):
{ "code": "...", "description": "한국어 형상 설명", "dims": { "x": n, "y": n, "z": n } }`;

const REFINE = `You are a precision CAD code modifier for NexyFab.
The user has existing JSCAD code and wants to modify or extend it.
Analyze the existing code carefully and apply ONLY the requested change while preserving everything else.

API reference:
\`\`\`
${JSCAD_API}
\`\`\`

RULES:
1. Return the COMPLETE modified code (not a diff)
2. Preserve all existing named consts and structure
3. Only modify what the user asks — do not refactor unrelated parts
4. Keep the \`main()\` function signature

RESPONSE (JSON only, no markdown):
{ "code": "...", "description": "변경 내용 한국어 요약" }`;

const FIX = `You are a JSCAD debugging expert. Fix the provided code so it compiles without error.
Do NOT change any dimensions or design intent — only fix the syntax/API errors.

Common issues:
- Wrong parameter names (e.g. use 'size' not 'dimensions' for cuboid)
- Missing jscad namespace prefix
- Incorrect argument order
- Using OpenSCAD syntax instead of @jscad/modeling

RESPONSE (JSON only, no markdown):
{ "code": "...", "description": "수정 내용 한국어 요약" }`;

const FACE_OP = `You are a precision CAD code modifier for NexyFab.
The user selected a specific face on the 3D model and wants to apply an operation to it.
Use the face normal and position to determine the correct location in the JSCAD coordinate system.

Face normal conventions:
  +Y = top face, -Y = bottom face
  +X = right face, -X = left face
  +Z = front face, -Z = back face

RULES:
1. Infer the face location from the normal and the existing code's geometry
2. Apply the requested operation at the correct position
3. Return COMPLETE modified code

RESPONSE (JSON only, no markdown):
{ "code": "...", "description": "변경 내용 한국어 요약" }`;

// Each mode is a separate registry entry under id `openscad-gen-{mode}` so
// telemetry can attribute requests to the exact prompt path. The default
// export is the `generate` variant for backward compatibility with callers
// that pull `openscad-gen` directly.

const baseDefaults = {
  temperature: 0.1,
  maxTokens: 5000,
  timeoutMs: 30_000,
};

export const openscadGenGenerate: PromptDefinition = {
  id: 'openscad-gen-generate',
  version: '1.0.0',
  description: 'Generate JSCAD JavaScript code from natural language.',
  template: GENERATE,
  defaults: baseDefaults,
};

export const openscadGenRefine: PromptDefinition = {
  id: 'openscad-gen-refine',
  version: '1.0.0',
  description: 'Refine existing JSCAD code with a follow-up prompt; preserves untouched parts.',
  template: REFINE,
  defaults: baseDefaults,
};

export const openscadGenFix: PromptDefinition = {
  id: 'openscad-gen-fix',
  version: '1.0.0',
  description: 'Fix compile errors in JSCAD code without changing design intent.',
  template: FIX,
  defaults: { ...baseDefaults, temperature: 0.0 },
};

export const openscadGenFaceOp: PromptDefinition = {
  id: 'openscad-gen-face-op',
  version: '1.0.0',
  description: 'Apply an operation to a user-selected face of an existing JSCAD model.',
  template: FACE_OP,
  defaults: baseDefaults,
};

const def: PromptDefinition = {
  id: 'openscad-gen',
  version: '1.0.0',
  description: 'Generate / refine / fix / face-op JSCAD code (despite the route name, output is JSCAD JS, not OpenSCAD .scad). Default = generate; see openscad-gen-{refine,fix,face-op} for the others.',
  template: GENERATE,
  defaults: baseDefaults,
};

export default def;

export const openscadGenVariants = {
  generate: GENERATE,
  refine: REFINE,
  fix: FIX,
  faceOp: FACE_OP,
} as const;
