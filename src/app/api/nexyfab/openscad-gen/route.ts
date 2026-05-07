/**
 * POST /api/nexyfab/openscad-gen
 * (경로명은 역사적 — 응답 본문은 **@jscad/modeling** JavaScript, OpenSCAD 언어 아님.)
 * Modes:
 *   generate  — natural language → new JSCAD code
 *   refine    — modify existing code based on follow-up prompt
 *   fix       — auto-fix compile error in existing code
 *   face-op   — apply an operation to a specific face of existing code
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';

export const dynamic = 'force-dynamic';

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

const GENERATE_PROMPT = `You are a precision CAD code generator for NexyFab.
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

const REFINE_PROMPT = `You are a precision CAD code modifier for NexyFab.
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

const FIX_PROMPT = `You are a JSCAD debugging expert. Fix the provided code so it compiles without error.
Do NOT change any dimensions or design intent — only fix the syntax/API errors.

Common issues:
- Wrong parameter names (e.g. use 'size' not 'dimensions' for cuboid)
- Missing jscad namespace prefix
- Incorrect argument order
- Using OpenSCAD syntax instead of @jscad/modeling

RESPONSE (JSON only, no markdown):
{ "code": "...", "description": "수정 내용 한국어 요약" }`;

const FACE_OP_PROMPT = `You are a precision CAD code modifier for NexyFab.
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

export async function POST(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const body = await req.json().catch(() => ({}));
  const {
    prompt = '',
    currentCode,
    errorMsg,
    selectedFace,
    mode = 'generate',
  } = body as {
    prompt?: string;
    currentCode?: string;
    errorMsg?: string;
    selectedFace?: { normal: number[]; normalLabel: string; area: number; position: number[] };
    mode?: 'generate' | 'refine' | 'fix' | 'face-op';
  };

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) {
    return NextResponse.json({ error: 'AI key not configured' }, { status: 500 });
  }

  let systemPrompt: string;
  let userMessage: string;

  if (mode === 'fix' && currentCode && errorMsg) {
    systemPrompt = FIX_PROMPT;
    userMessage = `CURRENT CODE:\n\`\`\`js\n${currentCode}\n\`\`\`\n\nERROR:\n${errorMsg}`;
  } else if (mode === 'refine' && currentCode) {
    systemPrompt = REFINE_PROMPT;
    userMessage = `CURRENT CODE:\n\`\`\`js\n${currentCode}\n\`\`\`\n\nUSER REQUEST: ${prompt}`;
  } else if (mode === 'face-op' && currentCode && selectedFace) {
    systemPrompt = FACE_OP_PROMPT;
    userMessage = `CURRENT CODE:\n\`\`\`js\n${currentCode}\n\`\`\`\n\nSELECTED FACE:\n- Direction: ${selectedFace.normalLabel} (normal: [${selectedFace.normal.map(n => n.toFixed(2)).join(', ')}])\n- Area: ${selectedFace.area.toFixed(1)} mm²\n- Click position: [${selectedFace.position.map(p => p.toFixed(1)).join(', ')}] mm\n\nUSER REQUEST: ${prompt}`;
  } else {
    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }
    systemPrompt = GENERATE_PROMPT;
    userMessage = prompt;
  }

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deepseekKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 5000,
      temperature: mode === 'fix' ? 0.0 : 0.1,
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '';

  try {
    let jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '');
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first !== -1 && last > first) jsonStr = jsonStr.slice(first, last + 1);
    const parsed = JSON.parse(jsonStr.trim());

    if (!parsed.code || typeof parsed.code !== 'string') throw new Error('No code');

    return NextResponse.json({
      code: parsed.code,
      description: parsed.description ?? '',
      dims: parsed.dims ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw }, { status: 500 });
  }
}
