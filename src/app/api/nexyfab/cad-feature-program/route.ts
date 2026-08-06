import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { getPrompt } from '@/lib/ai/prompts';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { resolveCodegenModel } from '@/lib/ai/codegenModels';
import { clarificationQuestions, findUngroundedProgramDimensions, validateCadFeatureProgram, type CadFeatureProgram } from '@/lib/ai/cadFeatureProgram';
import { extractManufacturingContext } from '@/lib/ai/manufacturingContext';
import type { SelectionContext } from '@/lib/ai/selectionContext';

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
interface FeatureProgram { part?: string; features?: unknown[]; questions?: unknown[] }

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-feature-program:${ip}`, 20, 3_600_000).allowed) {
    return NextResponse.json({ error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; previousProgram?: FeatureProgram; modelId?: string; selectionContext?: SelectionContext };
  const prompt = (body.prompt ?? '').trim();
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  const codegen = resolveCodegenModel(typeof body.modelId === 'string' ? body.modelId : undefined);

  const def = getPrompt('cad-feature-program');
  const selectionBlock = body.selectionContext
    ? `\n\nThe user explicitly selected this CAD context. Modify only this target unless the request clearly requires a broader dependency update:\n\`\`\`json\n${JSON.stringify(body.selectionContext)}\n\`\`\``
    : '';
  const userContent = (body.previousProgram
    ? `Here is the current feature program:\n\`\`\`json\n${JSON.stringify(body.previousProgram)}\n\`\`\`\n\nApply this change and return the COMPLETE updated program (keep features not mentioned): ${prompt}`
    : prompt) + selectionBlock;

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
    const questions = Array.isArray(program.questions)
      ? program.questions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
      : [];
    return NextResponse.json({
      error: 'dimensions need clarification', code: 'CLARIFICATION_REQUIRED',
      questions: questions.length > 0 ? questions : ['Please provide the missing base dimensions.'],
    }, { status: 422 });
  }
  const extractedContext = extractManufacturingContext(prompt);
  const previousContext = (body.previousProgram as CadFeatureProgram | undefined)?.verificationContext;
  const candidate: CadFeatureProgram = {
    part: program.part ?? 'part',
    features: program.features as CadFeatureProgram['features'],
    verificationContext: {
      ...extractedContext,
      process: extractedContext.process ?? previousContext?.process,
      material: extractedContext.material ?? previousContext?.material,
    },
  };
  const validation = validateCadFeatureProgram(candidate);
  if (!validation.ok) {
    return NextResponse.json({
      error: 'feature program needs clarification',
      code: 'FEATURE_PROGRAM_INVALID',
      details: validation.errors,
      questions: clarificationQuestions(validation.errors),
    }, { status: 422 });
  }
  if (!body.previousProgram) {
    const ungrounded = findUngroundedProgramDimensions(prompt, candidate);
    if (ungrounded.length > 0) {
      return NextResponse.json({
        error: 'dimensions need clarification',
        code: 'UNGROUNDED_DIMENSIONS',
        details: ungrounded,
        questions: clarificationQuestions(ungrounded),
      }, { status: 422 });
    }
  }
  return NextResponse.json(candidate);
}
