import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { getPrompt } from '@/lib/ai/prompts';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { resolveRuntimeCodegenModel } from '@/lib/ai/codegenModelRuntime';
import { getAuthUser } from '@/lib/auth-middleware';
import { clarificationQuestions, findUngroundedProgramDimensions, validateCadFeatureProgram, type CadFeatureProgram } from '@/lib/ai/cadFeatureProgram';
import { extractManufacturingContext } from '@/lib/ai/manufacturingContext';
import type { SelectionContext } from '@/lib/ai/selectionContext';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { appendLunaDesignContext, runLunaDesignPreflight } from '@/lib/ai/lunaDesignSidecars';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024;

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
  const body = (await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => ({}))) as { prompt?: string; previousProgram?: FeatureProgram; modelId?: string; selectionContext?: SelectionContext; lang?: string };
  const locale = resolveServerLocale(req, body.lang ?? req.nextUrl.searchParams.get('lang'));
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-feature-program:${ip}`, 20, 3_600_000).allowed) {
    return NextResponse.json({ error: localizedApiMessage(locale, 'rateLimited'), code: 'RATE_LIMIT', outputLanguage: locale.route }, { status: 429 });
  }
  const prompt = (body.prompt ?? '').trim();
  if (!prompt) return NextResponse.json({ error: localizedApiMessage(locale, 'promptRequired'), outputLanguage: locale.route }, { status: 400 });
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  const authUser = await getAuthUser(req).catch(() => null);
  const codegen = await resolveRuntimeCodegenModel(
    typeof body.modelId === 'string' ? body.modelId : undefined,
    authUser?.plan ?? 'free',
  );
  if (!codegen.ok) {
    return NextResponse.json({
      error: codegen.code === 'MODEL_PLAN_LOCKED' ? localizedApiMessage(locale, 'planUpgrade') : localizedApiMessage(locale, 'unknownModel'),
      code: codegen.code,
      requestedModel: codegen.requestedId,
      ...(codegen.requiredTier ? { requiredTier: codegen.requiredTier } : {}),
    }, { status: codegen.code === 'MODEL_PLAN_LOCKED' ? 403 : 400 });
  }

  const def = getPrompt('cad-feature-program');
  const selectionBlock = body.selectionContext
    ? `\n\nThe user explicitly selected this CAD context. Modify only this target unless the request clearly requires a broader dependency update:\n\`\`\`json\n${JSON.stringify(body.selectionContext)}\n\`\`\``
    : '';
  const rawUserContent = (body.previousProgram
    ? `Here is the current feature program:\n\`\`\`json\n${JSON.stringify(body.previousProgram)}\n\`\`\`\n\nApply this change and return the COMPLETE updated program (keep features not mentioned): ${prompt}`
    : prompt) + selectionBlock;
  const lunaPreflight = await runLunaDesignPreflight({
    prompt,
    selectedProvider: codegen.provider,
    selectedModel: codegen.model,
    userId: authUser?.userId,
    signal: req.signal,
  });
  const userContent = appendLunaDesignContext(rawUserContent, lunaPreflight);

  let text: string;
  let cachedPromptTokens = 0;
  let cacheWriteTokens = 0;
  try {
    const res = await chatCompletion({
      messages: [
        { role: 'system', content: `${def.template}\n\n[OUTPUT LANGUAGE CONTRACT]\nWrite natural-language part names, questions, and explanations in ${locale.languageName}; preserve feature types, parameter keys, identifiers, and dimensions.` },
        { role: 'user', content: userContent },
      ],
      provider: codegen.provider,
      allowProviderFallback: true,
      model: codegen.model,
      maxTokens: def.defaults.maxTokens,
      temperature: def.defaults.temperature,
      timeoutMs: def.defaults.timeoutMs,
      task: def.id,
    });
    text = res.text;
    cachedPromptTokens = res.cachedPromptTokens ?? 0;
    cacheWriteTokens = res.cacheWriteTokens ?? 0;
  } catch (e) {
    console.error('cad-feature-program provider error:', e);
    return NextResponse.json({ error: localizedApiMessage(locale, 'providerFailed'), outputLanguage: locale.route }, { status: 502 });
  }

  // Extract the JSON object from the response.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return NextResponse.json({ error: localizedApiMessage(locale, 'invalidAiResponse'), outputLanguage: locale.route }, { status: 502 });
  let program: FeatureProgram;
  try { program = JSON.parse(m[0]); } catch { return NextResponse.json({ error: localizedApiMessage(locale, 'invalidAiResponse'), outputLanguage: locale.route }, { status: 502 }); }
  if (!Array.isArray(program.features) || program.features.length === 0) {
    const questions = Array.isArray(program.questions)
      ? program.questions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
      : [];
    return NextResponse.json({
      error: localizedApiMessage(locale, 'badRequest'), code: 'CLARIFICATION_REQUIRED',
      questions: questions.length > 0 ? questions : [localizedApiMessage(locale, 'promptRequired')],
      outputLanguage: locale.route,
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
      error: localizedApiMessage(locale, 'badRequest'),
      code: 'FEATURE_PROGRAM_INVALID',
      details: validation.errors,
      questions: clarificationQuestions(validation.errors),
      outputLanguage: locale.route,
    }, { status: 422 });
  }
  if (!body.previousProgram) {
    const ungrounded = findUngroundedProgramDimensions(prompt, candidate);
    if (ungrounded.length > 0) {
      return NextResponse.json({
        error: localizedApiMessage(locale, 'badRequest'),
        code: 'UNGROUNDED_DIMENSIONS',
        details: ungrounded,
        questions: clarificationQuestions(ungrounded),
        outputLanguage: locale.route,
      }, { status: 422 });
    }
  }
  return NextResponse.json({
    ...candidate,
    aiExecution: {
      selectedModelId: codegen.catalog.id,
      selectedModelLabel: codegen.catalog.label,
      textModel: codegen.model,
      visionModel: null,
      visionAutoRouted: false,
      cacheProfile: codegen.cacheProfile,
      inputCacheHit: cachedPromptTokens > 0,
      cachedPromptTokens,
      cacheWriteTokens,
      parallelAssistantModel: lunaPreflight.model,
      parallelAssistantTasks: lunaPreflight.completedTasks,
    },
    outputLanguage: locale.route,
  });
}
