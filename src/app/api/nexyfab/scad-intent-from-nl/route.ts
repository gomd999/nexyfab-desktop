/**
 * POST /api/nexyfab/scad-intent-from-nl
 *
 * Pipeline: NL → AI emits JSON intent → deterministic intentToScad → SCAD source.
 *
 * Why this shape:
 *   - AI never writes raw OpenSCAD code → ~0% syntax-error rate.
 *   - AI only picks shapeId from a fixed whitelist + numeric params + known features.
 *   - Same JSON intent always produces the same SCAD/STL → reproducible & cacheable.
 *
 * Caller flow: send { prompt }, receive { intent, scad, warnings }. Push `scad` into
 * the textarea or directly into POST /api/nexyfab/openscad-render to get an STL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { truncationNote } from '@/lib/ai/providers/truncation';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { pickExemplar } from '@/lib/ai/scadExemplars';
import {
  retrieveReferenceParts,
  formatReferencePartsBlock,
} from '@/lib/ai/reference/retrieveReferenceParts';
import { resolveRuntimeCodegenModel } from '@/lib/ai/codegenModelRuntime';
import { appendLunaDesignContext, runLunaDesignPreflight } from '@/lib/ai/lunaDesignSidecars';
import { visionCompletion, VisionNotConfiguredError, VisionProviderError } from '@/lib/ai/vision';
import { getPromptVariant } from '@/lib/ai/prompts';
import { recordPromptCall, classifyAiError } from '@/lib/ai/telemetry';
import { checkUserBudget } from '@/lib/ai/userBudget';
import {
  intentToScad,
  assemblyToScad,
  type IntentInput,
  type AssemblyPartInput,
} from '@/lib/openscad-render/intentToScad';
import { detectShapeFromText } from '@/lib/openscad-render/shapeAliases';
import { extractDimensions, reconcileIntent } from '@/lib/ai/dimensionExtractor';
import { getCachedIntent, setCachedIntent } from '@/lib/ai/intentCache';
import { captureServerError } from '@/lib/error-capture';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { readBoundedJson } from '@/lib/boundedJsonBody';
import {
  SUPPORTED_SHAPES,
  looksLikeOpenScad,
  normalizeFreeformScad,
  numParams,
  parseAssemblyParts,
  parseFeatures,
  parseProfile,
} from './intentParsing';

export const dynamic = 'force-dynamic';
// Allows a 5 MiB-class reference image after base64 expansion plus prompt/context fields.
const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;

/** Fire-and-forget AI-usage measurement to the central auth-server (measure
 *  only, no cap). Skips guests (no token to attribute). Never blocks the
 *  response — failures are swallowed. */
function meterAiUsage(req: NextRequest): void {
  try {
    const bearer = req.headers.get('authorization');
    const token = bearer && /^Bearer /i.test(bearer)
      ? bearer.slice(7)
      : req.cookies.get('nf_access_token')?.value;
    if (!token) return;
    void fetch('https://auth.nexysys.com/usage/ai', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  } catch { /* ignore */ }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedJson(req, MAX_JSON_BODY_BYTES);
    body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    const locale = resolveServerLocale(req);
    return NextResponse.json({ error: localizedApiMessage(locale, 'badRequest'), code: 'BAD_REQUEST' }, { status: 400 });
  }
  const locale = resolveServerLocale(req, body.lang);
  const outputLanguage = locale.languageName;
  const planCheck = await checkPlan(req, 'free');
  const userPlan = planCheck.ok ? planCheck.plan : 'free';

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const hasImageInput = typeof body.image === 'string' && body.image.length > 0;
  if (!prompt && !hasImageInput) {
    return NextResponse.json({ error: localizedApiMessage(locale, 'promptRequired'), code: 'PROMPT_REQUIRED' }, { status: 400 });
  }
  if (prompt.length > 4000) {
    return NextResponse.json({ error: localizedApiMessage(locale, 'promptTooLong'), code: 'PROMPT_TOO_LONG' }, { status: 413 });
  }

  // Refine mode: the client passes the previously-generated intent so the
  // prompt is treated as a MODIFICATION ("make it taller", "add a hole",
  // "remove a leg"). Contextual → not cacheable by prompt alone.
  const previousIntent = body.previousIntent && typeof body.previousIntent === 'object' && !Array.isArray(body.previousIntent)
    ? body.previousIntent as Record<string, unknown>
    : undefined;
  const refining = !!previousIntent;

  // Image-to-3D: a reference image (base64, optional data-URL prefix). When
  // present we read it with a vision model and write parametric OpenSCAD from
  // it — image GUIDES code generation (clean, truly parametric), NOT image→
  // B-rep. An image always implies free-form.
  const imageB64 = typeof body.image === 'string' && body.image.length > 0
    ? body.image.replace(/^data:image\/\w+;base64,/, '')
    : null;
  const imageMime = typeof body.image === 'string'
    ? (body.image.match(/^data:(image\/(?:png|jpeg|webp));base64,/)?.[1] as 'image/png' | 'image/jpeg' | 'image/webp' | undefined)
    : undefined;
  const hasImage = !!imageB64;

  // Free-form mode (CADAM-style): the model writes a COMPLETE OpenSCAD program
  // (arbitrary modules/CSG/BOSL2) instead of a whitelist intent — so organic
  // models like a car work. Returns raw .scad; the client parses Customizer
  // annotations for sliders. Not cached (large, iterated).
  const freeform = body.freeform === true || hasImage;
  // User-selected codegen model (Studio model picker) → preferred provider +
  // model, validated against the allowlist (never trust raw provider/model).
  // Free-form chat iteration: the prior OpenSCAD program to modify in place
  // ("make it taller", "add a hole") instead of starting fresh.
  const previousScad = typeof body.previousScad === 'string' && body.previousScad.trim().length > 0
    ? body.previousScad
    : null;
  // Self-repair: the client is feeding a render error back to fix an already-
  // generated design. This is not a NEW design, so it must not burn the guest
  // freebie (it carries previousScad and is rate-limited by the general gate).
  const isRepair = body.repair === true && !!previousScad;
  const requestedModelId = isRepair
    ? (userPlan === 'free' ? 'gpt-luna' : 'deepseek-pro')
    : (typeof body.modelId === 'string' ? body.modelId : undefined);
  const codegen = await resolveRuntimeCodegenModel(requestedModelId, userPlan);
  if (!codegen.ok) {
    return NextResponse.json({
      error: localizedApiMessage(locale, codegen.code === 'MODEL_PLAN_LOCKED' ? 'planUpgrade' : 'unknownModel'),
      code: codegen.code,
      requestedModel: codegen.requestedId,
      ...(codegen.requiredTier ? { requiredTier: codegen.requiredTier } : {}),
    }, { status: codegen.code === 'MODEL_PLAN_LOCKED' ? 403 : 400 });
  }

  // Cache lookup — same prompt → same intent → same SCAD. A hit avoids the
  // paid AI round-trip AND does NOT consume a monthly quota slot, which is
  // intentional: we're only metering work that actually costs us money.
  const cached = (refining || freeform) ? null : await getCachedIntent(prompt);
  if (cached) {
    return NextResponse.json({
      intent: cached.intent,
      scad: cached.scad,
      warnings: cached.warnings,
      summary: cached.summary,
      cached: true,
      aiExecution: {
        selectedModelId: codegen.catalog.id,
        selectedModelLabel: codegen.catalog.label,
        textModel: null,
        visionModel: null,
        visionAutoRouted: false,
        resultCacheHit: true,
        cacheProfile: codegen.cacheProfile,
      },
    });
  }

  // Per-user $ budget gate fires first — same as shape-chat.
  // Surfaced to the client so the lay AI front door can show a gentle
  // "N free generations left this month" nudge before the hard cap.
  let usage: { used: number; limit: number; remaining: number } | undefined;
  if (planCheck.ok) {
    const budget = await checkUserBudget(planCheck.userId, planCheck.orgId);
    if (!budget.ok) {
      return NextResponse.json(
        {
          error: localizedApiMessage(locale, 'costBudget', { limit: budget.limitUsd }),
          code: 'COST_BUDGET',
          usedCents: budget.usedCents,
          limitUsd: budget.limitUsd,
          resetAtMs: budget.resetAtMs,
        },
        { status: 402 },
      );
    }
    if (!isRepair) {
      const slot = await consumeMonthlyMetricSlot(planCheck.userId, userPlan, 'shape_chat', undefined, planCheck.orgId);
      if (!slot.ok) {
        return NextResponse.json(
          { error: localizedApiMessage(locale, 'planLimit', { limit: `${slot.limit}/month` }), code: 'MONTHLY_LIMIT', limit: slot.limit },
          { status: 429 },
        );
      }
      // limit === -1 means unlimited (paid plans) — leave usage undefined there.
      if (slot.limit > 0) {
        usage = { used: slot.used, limit: slot.limit, remaining: Math.max(0, slot.limit - slot.used) };
      }
    }
  }

  const promptDef = getPromptVariant(freeform ? 'scad-freeform' : 'scad-intent-from-nl', planCheck.ok ? planCheck.userId : undefined);

  // Deterministic shape detection from the multilingual glossary. The LLM is
  // unreliable at picking the shapeId for non-English shape words (DeepSeek
  // returns different answers by request region even at temperature 0), but it
  // extracts params correctly once the shape is known. So when the glossary
  // identifies the shape unambiguously, we pin it in the prompt (and enforce it
  // post-parse) — origin-independent and deterministic.
  const detectedShape = (refining || freeform) ? null : detectShapeFromText(prompt);
  // Few-shot: for a fresh freeform request, inject a known-good parametric
  // pattern for a matching part type so the model copies a working structure
  // (sharply improves dimensional/geometric accuracy). Skipped on refine/repair.
  const exemplar = (freeform && !previousScad) ? pickExemplar(prompt) : null;
  // Lever C — deterministic in-repo grounding: append real reference parts of
  // similar structure/scale as CITED, NON-AUTHORITATIVE examples (the block
  // labels itself). Extends the existing exemplar injection; the deterministic
  // intentToScad path is unchanged, so no retrieved number becomes a fact.
  const refBlock = (freeform && !previousScad)
    ? formatReferencePartsBlock(retrieveReferenceParts({ text: prompt }))
    : '';
  const freeformFresh = (exemplar
    ? `Reference pattern for a SIMILAR part — match this STRUCTURE, style and Customizer-annotation format, but adapt the dimensions and features to the request (do not copy it verbatim):\n\`\`\`\n${exemplar.scad}\n\`\`\`\n\nNow create: ${prompt}`
    : prompt) + (refBlock ? `\n\n${refBlock}` : '');
  const userContent = freeform
    ? (previousScad
      ? `Here is the current OpenSCAD program:\n\`\`\`\n${previousScad}\n\`\`\`\n\nApply this change and return the COMPLETE updated program, following ALL the rules above (keep the Customizer parameter annotations and groups; keep parts not mentioned unchanged): ${prompt}`
      : freeformFresh)
    : refining
    ? `Modify this existing design and return the COMPLETE updated intent in the SAME JSON format (catalog shape, "sketch", or assembly "parts"). Keep everything not mentioned unchanged.\n\nCurrent design:\n${JSON.stringify(previousIntent)}\n\nChange requested: ${prompt}`
    : (detectedShape
      ? `${prompt}\n\n[The shape is "${detectedShape}". Set shapeId to exactly "${detectedShape}" and extract that shape's params from the request.]`
      : prompt);
  const messages: ChatMessage[] = [
    { role: 'system', content: `${promptDef.template}\n\n[OUTPUT LANGUAGE CONTRACT]\nWrite every user-facing natural-language field (especially summary and warnings) in ${outputLanguage}. Keep JSON keys, shape IDs, units, and OpenSCAD code unchanged.` },
    { role: 'user', content: `[output-language:${outputLanguage}]\n${userContent}` },
  ];

  // Guest funnel: anonymous users get 1 free design/day. After that they must
  // log in (free). Logged-in users are metered by their plan budget/quota
  // above. Placed after the cache return so a cache hit doesn't burn the freebie.
  if (!planCheck.ok && !isRepair) {
    const guestIp = getTrustedClientIp(req.headers);
    const guestRl = rateLimit(`scad-gen-guest:${guestIp}`, 3, 24 * 3_600_000);
    if (!guestRl.allowed) {
      return NextResponse.json(
        { error: localizedApiMessage(locale, 'guestLimit'), code: 'GUEST_LIMIT' },
        { status: 401 },
      );
    }
  }

  const lunaPreflight = await runLunaDesignPreflight({
    prompt,
    selectedProvider: codegen.provider,
    selectedModel: codegen.model,
    userId: planCheck.ok ? planCheck.userId : undefined,
    signal: req.signal,
  });
  if (lunaPreflight.context) {
    messages[1] = { ...messages[1]!, content: appendLunaDesignContext(messages[1]!.content, lunaPreflight) };
  }

  let raw = '';
  /** ★260731 — 절단 신호를 파싱 실패 시점까지 들고 간다(대응이 정반대이므로). */
  let truncated: boolean | undefined;
  let finishReason: string | undefined;
  const used: {
    provider?: string;
    model?: string;
    cachedPromptTokens?: number;
    cacheWriteTokens?: number;
    visionModel?: string;
    visionAutoRouted?: boolean;
  } = {};
  try {
    let meta: {
      provider: string;
      model: string;
      latencyMs: number;
      promptTokens?: number;
      completionTokens?: number;
      cachedPromptTokens?: number;
      cacheWriteTokens?: number;
    };
    if (hasImage && imageB64) {
      // Image-to-3D HYBRID: the vision model PERCEIVES the object (describe
      // only), then DeepSeek writes the parametric OpenSCAD from that
      // description — the same proven free-form code path as text-to-3D. This
      // yields richer, more consistent parametric output than asking the vision
      // model to also write the code (it's better at seeing than at coding).
      const bytes = Uint8Array.from(Buffer.from(imageB64, 'base64'));
      const describePrompt = `You are analysing a photo or sketch of a physical object for CAD modelling. Describe ONLY what you see — structured and concise, NO code:
- Object category / overall shape
- Distinct parts and how they connect
- Approximate proportions and real-world dimensions in millimetres (estimate)
- Notable features: holes, fillets/rounded edges, ribs, symmetry, embossed text
${prompt ? 'User note: ' + prompt : ''}`;
      const v = await visionCompletion({
        prompt: describePrompt,
        images: [{ bytes, mimeType: imageMime }],
        selectedModel: { provider: codegen.provider, model: codegen.model },
        maxTokens: 700,
        timeoutMs: 40_000,
      });
      const description = v.text.trim();
      const codeResult = await chatCompletion({
        messages: [
          { role: 'system', content: promptDef.template },
          { role: 'user', content: `${prompt ? prompt + '\n\n' : ''}Model the object described below as a parametric OpenSCAD program following ALL the rules above. The description came from a photo — estimate sensible millimetre dimensions.\n\nObject description:\n${description}` },
        ],
        // Free-form geometry quality is much better from a strong spatial model.
        // Route to the user-picked model (default Gemini), with the normal chain
        // as fallback when that provider isn't configured/healthy.
        provider: codegen.provider,
        allowProviderFallback: true,
        model: codegen.model,
        maxTokens: 8000,
        temperature: promptDef.defaults.temperature,
        timeoutMs: 180_000,
        task: promptDef.id,
      });
      raw = codeResult.text;
      used.visionModel = v.model;
      used.visionAutoRouted = v.visionAutoRouted ?? false;
      meta = {
        provider: `${v.provider}+${codeResult.provider}`,
        model: `${v.model}+${codeResult.model}`,
        latencyMs: v.latencyMs + codeResult.latencyMs,
        promptTokens: (v.promptTokens ?? 0) + (codeResult.promptTokens ?? 0),
        completionTokens: (v.completionTokens ?? 0) + (codeResult.completionTokens ?? 0),
        cachedPromptTokens: codeResult.cachedPromptTokens,
        cacheWriteTokens: codeResult.cacheWriteTokens,
      };
    } else {
      const result = await chatCompletion({
        messages,
        // Free-form geometry: route to the user-picked model (default Gemini),
        // fall back via the normal chain. Whitelist path keeps the cheap chat model.
        ...(freeform ? { provider: codegen.provider, allowProviderFallback: true, model: codegen.model } : {}),
        maxTokens: freeform ? 8000 : promptDef.defaults.maxTokens,
        temperature: promptDef.defaults.temperature,
        timeoutMs: freeform ? 180_000 : promptDef.defaults.timeoutMs,
        task: promptDef.id,
      });
      raw = result.text;
      truncated = result.truncated;
      finishReason = result.finishReason;
      meta = {
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        cachedPromptTokens: result.cachedPromptTokens,
        cacheWriteTokens: result.cacheWriteTokens,
      };
    }
    recordPromptCall({
      userId: planCheck.ok ? planCheck.userId : undefined,
      orgId: planCheck.ok ? planCheck.orgId : null,
      promptId: promptDef.id,
      promptVersion: promptDef.version,
      provider: meta.provider,
      model: meta.model,
      latencyMs: meta.latencyMs,
      promptTokens: meta.promptTokens,
      completionTokens: meta.completionTokens,
      cachedPromptTokens: meta.cachedPromptTokens,
      cacheWriteTokens: meta.cacheWriteTokens,
      success: true,
    });
    used.provider = meta.provider;
    used.model = meta.model;
    used.cachedPromptTokens = meta.cachedPromptTokens;
    used.cacheWriteTokens = meta.cacheWriteTokens;
  } catch (e) {
    if (e instanceof VisionNotConfiguredError) {
      return NextResponse.json({ error: localizedApiMessage(locale, 'visionNotConfigured'), code: 'VISION_NOT_CONFIGURED' }, { status: 500 });
    }
    if (e instanceof VisionProviderError) {
      console.error('scad-intent-from-nl vision error:', e.message);
      const busy = e.status === 429 || e.status === 503 || /high demand|overload|unavailable|try again|temporarily|rate.?limit/i.test(e.message);
      return NextResponse.json(
        { error: localizedApiMessage(locale, busy ? 'visionBusy' : 'visionFailed'), code: busy ? 'VISION_BUSY' : 'VISION_FAILED' },
        { status: busy ? 503 : 502 },
      );
    }
    recordPromptCall({
      userId: planCheck.ok ? planCheck.userId : undefined,
      orgId: planCheck.ok ? planCheck.orgId : null,
      promptId: promptDef.id,
      promptVersion: promptDef.version,
      provider: e instanceof AiProviderError ? e.provider : 'unknown',
      model: 'unknown',
      latencyMs: 0,
      success: false,
      errorClass: classifyAiError(e),
    });
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: localizedApiMessage(locale, 'providerNotConfigured'), code: 'AI_NOT_CONFIGURED' }, { status: 500 });
    }
    const detail = e instanceof AiProviderError
      ? `${e.provider}${e.status ? ` (${e.status})` : ''}: ${e.message}`
      : (e instanceof Error ? e.message : String(e));
    console.error('scad-intent-from-nl provider error:', detail);
    captureServerError(e, {
      route: '/api/nexyfab/scad-intent-from-nl',
      method: 'POST',
      errorClass: e instanceof AiProviderError ? 'AiProviderError' : 'aiIntentHandler',
      userId: planCheck.ok ? planCheck.userId : undefined,
      tags: e instanceof AiProviderError ? { provider: e.provider } : {},
    });
    return NextResponse.json({ error: localizedApiMessage(locale, 'providerFailed'), code: 'AI_REQUEST_FAILED' }, { status: 502 });
  }

  // Free-form mode: the model returned a complete .scad program. Strip any
  // markdown fences and hand the raw source back — the client parses its
  // Customizer annotations into sliders. No whitelist, no intent.
  if (freeform) {
    const scad = normalizeFreeformScad(raw);
    // Some models still wrap mid-text; if fences remain, take the fenced block.
    // Normalise line endings: some models (e.g. Gemini) emit CRLF, and a stray
    // \r after `include <...>` makes OpenSCAD's parser throw "syntax error
    // line 1" — the render then fails entirely.
    // Accept any plausible OpenSCAD program. The BOSL2 include is a definitive
    // signal; otherwise look for any primitive/operation (broad — BOSL2 uses
    // cyl/tube/prismoid/rotate_extrude that a narrow list would wrongly reject).
    if (!looksLikeOpenScad(scad)) {
      return NextResponse.json({ error: localizedApiMessage(locale, 'invalidAiResponse'), code: 'SCAD_FORMAT_INVALID' }, { status: 502 });
    }
    meterAiUsage(req); // measure AI usage (non-cached, real AI call)
    return NextResponse.json({
      scad,
      freeform: true,
      summary: localizedApiMessage(locale, 'freeformSummary'),
      outputLanguage: locale.route,
      usedProvider: used.provider,
      usedModel: used.model,
      aiExecution: {
        selectedModelId: codegen.catalog.id,
        selectedModelLabel: codegen.catalog.label,
        textModel: used.model ?? codegen.model,
        visionModel: hasImage ? used.visionModel ?? null : null,
        visionAutoRouted: hasImage ? used.visionAutoRouted ?? false : false,
        parallelAssistantModel: lunaPreflight.model,
        parallelAssistantTasks: lunaPreflight.completedTasks,
        cacheProfile: codegen.cacheProfile,
        inputCacheHit: (used.cachedPromptTokens ?? 0) > 0,
        cachedPromptTokens: used.cachedPromptTokens ?? 0,
        cacheWriteTokens: used.cacheWriteTokens ?? 0,
      },
    });
  }

  // Extract JSON from response — strip markdown fences and find first/last brace.
  let parsedRaw: unknown;
  try {
    let s = raw.replace(/```json?\s*/gi, '').replace(/```/g, '');
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
    parsedRaw = JSON.parse(s.trim());
  } catch {
    /**
     * ★260731 — **절단과 형식 위반을 구별해서 답한다.**
     *   같은 「비-JSON」이라도 원인이 다르면 대응이 정반대다:
     *     형식 위반 → 프롬프트를 손본다   ·   절단 → 출력 상한을 올린다.
     *   자매 경로(`imageIntentFromSketch`, 상한 500)에서 24장 중 16장이 이 오류로
     *   실패했는데 **원인은 전부 절단**이었고, 원문을 손으로 찍어 보고서야 알았다.
     *   여기는 상한이 800 이라 같은 위험이 남아 있다 — 이제는 응답이 스스로 말한다.
     */
    const note = truncationNote({ truncated, finishReason }, promptDef.defaults.maxTokens);
    return NextResponse.json({
      error: localizedApiMessage(locale, 'invalidAiResponse'),
      code: note ? 'TRUNCATED' : 'NON_JSON',
      ...(note ? { detail: note } : {}),
      ...(finishReason ? { finishReason } : {}),
    }, { status: 502 });
  }

  if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
    return NextResponse.json({ error: localizedApiMessage(locale, 'invalidAiResponse'), code: 'INVALID_JSON_OBJECT' }, { status: 502 });
  }

  const parsed = parsedRaw as Record<string, unknown>;

  if (parsed.error === 'unsupported') {
    return NextResponse.json(
      { error: localizedApiMessage(locale, 'unsupportedShape'), reason: parsed.reason, code: 'UNSUPPORTED' },
      { status: 422 },
    );
  }

  let intent: IntentInput | { kind: 'assembly'; parts: AssemblyPartInput[] };
  let conv: ReturnType<typeof intentToScad>;
  // Deterministic-reconcile audit notes (surfaced on warnings for transparency).
  let reconcileNotes: string[] = [];

  if (Array.isArray(parsed.parts)) {
    // ── Assembly: heterogeneous parts → union() of placed parts ───────────
    const parts = parseAssemblyParts(parsed.parts);
    if (parts.length < 2) {
      return NextResponse.json({ error: localizedApiMessage(locale, 'invalidAssembly'), code: 'ASSEMBLY_INVALID' }, { status: 502 });
    }
    intent = { kind: 'assembly', parts };
    conv = assemblyToScad(parts);
  } else if (parsed.shapeId === 'sketch') {
    // ── Free-form sketch → linear_extrude(polygon) ────────────────────────
    const profile = parseProfile(parsed.profile);
    if (profile.length < 3) {
      return NextResponse.json({ error: localizedApiMessage(locale, 'invalidSketch'), code: 'SKETCH_INVALID' }, { status: 502 });
    }
    intent = { shapeId: 'sketch', params: numParams(parsed.params), features: parseFeatures(parsed.features), profile };
    conv = intentToScad(intent);
  } else {
    // ── Single catalog shape (the whitelist path) ─────────────────────────
    // Glossary override: trust deterministic detection over the model's pick.
    if (detectedShape && parsed.shapeId !== detectedShape) parsed.shapeId = detectedShape;
    if (typeof parsed.shapeId !== 'string' || !(SUPPORTED_SHAPES as readonly string[]).includes(parsed.shapeId)) {
      return NextResponse.json(
        { error: localizedApiMessage(locale, 'unsupportedShape'), code: 'UNSUPPORTED_SHAPE' },
        { status: 502 },
      );
    }
    intent = {
      shapeId: parsed.shapeId,
      params: numParams(parsed.params),
      features: parseFeatures(parsed.features),
      facets: typeof parsed.facets === 'number' ? parsed.facets : undefined,
    };
    // Deterministic dimension reconcile: the LLM is noisy on secondary NUMBERS
    // (hole Ø / count / position, bolt-circle). A regex extracts the explicitly
    // stated numbers reliably; on an explicit number the deterministic value
    // wins, otherwise the LLM's choice stands. Skipped on refine (the prompt is
    // a delta, not a full spec) so we never re-impose the original numbers on a
    // change request. `intent` here is a single catalog shape (IntentInput).
    if (!refining) {
      const rec = reconcileIntent(intent as IntentInput, extractDimensions(prompt));
      intent = rec.intent;
      if (rec.overrides.length > 0) {
        reconcileNotes = rec.overrides.map(
          o => `[reconcile] ${o.field}: ${o.from ?? 'n/a'} → ${o.to} (${o.reason})`,
        );
      }
    }
    conv = intentToScad(intent);
  }

  if (!conv.ok) {
    return NextResponse.json({ error: localizedApiMessage(locale, 'converterRejected'), code: 'CONVERTER_REJECT', intent }, { status: 422 });
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 200) : undefined;
  const warnings = reconcileNotes.length > 0 ? [...conv.warnings, ...reconcileNotes] : conv.warnings;

  // Persist to cache so subsequent identical prompts skip the AI call. Refine
  // results are contextual (depend on previousIntent) → not cached by prompt.
  // Fire-and-forget — a cache write failure must not break the response.
  if (!refining) {
    setCachedIntent(prompt, {
      intent,
      scad: conv.scad,
      warnings,
      summary,
    }).catch(e => console.warn('[scad-intent-from-nl] cache write failed:', e));
  }

  let budgetWarning: { usedCents: number; limitUsd: number | null; fraction: number } | undefined;
  if (planCheck.ok) {
    try {
      const post = await checkUserBudget(planCheck.userId, planCheck.orgId);
      if (post.approaching) {
        budgetWarning = { usedCents: post.usedCents, limitUsd: post.limitUsd, fraction: post.fraction };
      }
    } catch { /* never block on telemetry */ }
  }

  return NextResponse.json({
    intent,
    scad: conv.scad,
    warnings,
    summary,
    outputLanguage: locale.route,
    cached: false,
    aiExecution: {
      selectedModelId: codegen.catalog.id,
      selectedModelLabel: codegen.catalog.label,
      textModel: used.model ?? codegen.model,
      visionModel: null,
      visionAutoRouted: false,
      parallelAssistantModel: lunaPreflight.model,
      parallelAssistantTasks: lunaPreflight.completedTasks,
      cacheProfile: codegen.cacheProfile,
      inputCacheHit: (used.cachedPromptTokens ?? 0) > 0,
      cachedPromptTokens: used.cachedPromptTokens ?? 0,
      cacheWriteTokens: used.cacheWriteTokens ?? 0,
    },
    ...(usage ? { usage } : {}),
    ...(budgetWarning ? { budgetWarning } : {}),
  });
}
