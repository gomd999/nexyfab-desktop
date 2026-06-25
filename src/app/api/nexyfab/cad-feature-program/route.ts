import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { getPrompt } from '@/lib/ai/prompts';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { resolveCodegenModel } from '@/lib/ai/codegenModels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/nexyfab/cad-feature-program — the PRECISE (expert) path. Turns a
 * mechanical-part request into an ordered parametric B-rep feature program
 * (sketchExtrude / hole / pattern / rib / fillet / chamfer) with exact
 * dimensions. The client executes the program in the modeler to build a real
 * solid with an editable feature tree + STEP. (Free-form/organic stays on
 * /scad-intent-from-nl.)
 */
interface FeatureProgram { part?: string; features?: unknown[] }

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-feature-program:${ip}`, 100, 3_600_000).allowed) { // TEMP: raised 20→100 for model testing
    return NextResponse.json({ error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; previousProgram?: FeatureProgram; modelId?: string };
  const prompt = (body.prompt ?? '').trim();
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  const codegen = resolveCodegenModel(typeof body.modelId === 'string' ? body.modelId : undefined);

  const def = getPrompt('cad-feature-program');
  const userContent = body.previousProgram
    ? `Here is the current feature program:\n\`\`\`json\n${JSON.stringify(body.previousProgram)}\n\`\`\`\n\nApply this change and return the COMPLETE updated program (keep features not mentioned): ${prompt}`
    : prompt;

  let text: string;
  try {
    const res = await chatCompletion({
      messages: [
        { role: 'system', content: def.template },
        { role: 'user', content: userContent },
      ],
      preferProvider: codegen.preferProvider,
      model: codegen.model,
      maxTokens: def.defaults.maxTokens,
      temperature: def.defaults.temperature,
      timeoutMs: def.defaults.timeoutMs,
      task: def.id,
    });
    text = res.text;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'generation failed' }, { status: 502 });
  }

  // Extract the JSON object from the response.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return NextResponse.json({ error: 'no program returned' }, { status: 502 });
  let program: FeatureProgram;
  try { program = JSON.parse(m[0]); } catch { return NextResponse.json({ error: 'invalid program JSON' }, { status: 502 }); }
  if (!Array.isArray(program.features) || program.features.length === 0) {
    return NextResponse.json({ error: 'program has no features' }, { status: 502 });
  }
  return NextResponse.json({ part: program.part ?? 'part', features: program.features });
}
