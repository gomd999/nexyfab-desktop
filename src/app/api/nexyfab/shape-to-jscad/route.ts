/**
 * POST /api/nexyfab/shape-to-jscad
 * Converts existing parametric shape + features into editable JSCAD code.
 * Input: { shapeId, params, features, bbox }
 * Output: { code, description }
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are a CAD code converter for NexyFab. Convert parametric shape data into clean @jscad/modeling JavaScript code.

Rules:
1. All dimensions are in mm
2. Declare ALL dimensions as named consts at the top (for slider editing)
3. Use booleans.subtract for holes/cutouts, booleans.union for additions
4. Return ONE function called main() that returns ONE solid
5. Include comments for clarity

Available API:
const { primitives, booleans, transforms, expansions, extrusions } = jscad;
primitives.cuboid({ size: [w, h, d] })
primitives.cylinder({ radius: r, height: h, segments: 64 })
primitives.sphere({ radius: r, segments: 32 })
booleans.subtract(base, ...tools)
booleans.union(...solids)
transforms.translate([x,y,z], solid)
transforms.rotate([rx,ry,rz], solid)
expansions.expand({ delta: r, segments: 16 }, solid)
extrusions.extrudeLinear({ height: h }, profile2D)
primitives.circle({ radius: r })
primitives.rectangle({ size: [w,h] })

RESPONSE (JSON only):
{ "code": "...", "description": "한국어 설명" }`;

export async function POST(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;

  const { shapeId, params, features, bbox } = await req.json().catch(() => ({}));

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) {
    return NextResponse.json({ error: 'AI key not configured' }, { status: 500 });
  }

  const featureList = Array.isArray(features) && features.length > 0
    ? `\nApplied features: ${features.map((f: { type: string; params: Record<string, number> }) => `${f.type}(${JSON.stringify(f.params)})`).join(', ')}`
    : '';

  const bboxNote = bbox ? `\nBounding box: ${bbox.w}×${bbox.h}×${bbox.d} mm` : '';

  const userMessage = `Convert this shape to JSCAD code:
Shape type: ${shapeId ?? 'unknown'}
Parameters: ${JSON.stringify(params ?? {})}${bboxNote}${featureList}

Generate accurate JSCAD code that recreates this geometry with the exact same dimensions.`;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deepseekKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
      temperature: 0.05,
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
    if (!parsed.code) throw new Error('No code');
    return NextResponse.json({ code: parsed.code, description: parsed.description ?? '' });
  } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw }, { status: 500 });
  }
}
