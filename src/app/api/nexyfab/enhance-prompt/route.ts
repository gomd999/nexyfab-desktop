// Prompt-expansion: turn a short, casual part request into a precise, structured
// brief that the OpenSCAD codegen path can model well. The user reviews/edits the
// expanded brief before sending it to generate — a deliberate "refine the ask"
// step. Works best for mechanical/parametric parts; flags organic shapes that
// CSG cannot model so the user is steered to the image→3D mesh path instead.

import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion, AiNotConfiguredError, AiProviderError } from '@/lib/ai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SYSTEM = `You rewrite a short, casual part request into a precise, structured brief for a parametric OpenSCAD model.
Output ONLY the rewritten brief — no code, no library names, no preamble.
Rules:
- Infer sensible millimetre dimensions where the user omits them, and state them explicitly.
- State the base shape first, then each feature (holes, fillets/chamfers, ribs, bosses, patterns) with sizes and positions.
- Name the key parameters (e.g. length, width, thickness, hole_dia, bolt_pcd, count).
- Keep it concise but complete (a tidy spec, not an essay).
- If the request is an organic shape (vehicle, animal, character, human, terrain), prepend exactly one line:
  "NOTE: organic shape — OpenSCAD/CSG cannot model this well; use an image→3D mesh instead."
- Do NOT include OpenSCAD code or include/use library statements.
Write the brief in the same language as the user's request.`;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { prompt?: string } | null;
  const prompt = body?.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  if (prompt.length > 2000) return NextResponse.json({ error: 'prompt too long (max 2000 chars)' }, { status: 413 });

  try {
    const { text } = await chatCompletion({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      maxTokens: 700,
      temperature: 0.3,
    });
    const enhanced = (text || '').trim();
    if (!enhanced) return NextResponse.json({ error: 'AI returned empty result' }, { status: 502 });
    return NextResponse.json({ enhanced });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
    if (e instanceof AiProviderError) return NextResponse.json({ error: 'AI provider error' }, { status: 502 });
    return NextResponse.json({ error: 'enhance failed' }, { status: 500 });
  }
}
