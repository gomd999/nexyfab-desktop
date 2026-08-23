/**
 * POST /api/nexyfab/intent-from-image
 *
 * Pipeline: image upload → vision LLM emits JSON intent → deterministic
 * intentToScad → SCAD source the caller can render or pipe to verify-spec.
 *
 * This is the Pro+ "Zoo.dev-style differentiator": user uploads a photo or
 * sketch of a mechanical part, and we hand back a structured CAD intent.
 * Same whitelist contract as scad-intent-from-nl — the vision model can only
 * pick from SUPPORTED_SHAPES + SUPPORTED_FEATURES.
 *
 * Caller flow: POST { imageBase64, mimeType?, hintText? } → receive
 * { intent, scad, warnings, summary, cached }. Push `intent` into the
 * /verify-spec textarea (the panel has a button for this) or pipe `scad`
 * directly into /api/nexyfab/openscad-render.
 */
import { RASTER_MIME } from '@/lib/drawingInput';
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { recordPromptCall, classifyAiError } from '@/lib/ai/telemetry';
import { captureServerError } from '@/lib/error-capture';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';
import { getPrompt } from '@/lib/ai/prompts';
import {
  decodeImageBase64,
  extractIntentFromImage,
  readCachedImageIntent,
  IMAGE_INTENT_MAX_BYTES,
  IMAGE_INTENT_PROMPT_ID,
  type ImageIntentOutcome,
} from '@/lib/ai/imageIntentExtractor';
import { resolveRuntimeCodegenModel } from '@/lib/ai/codegenModelRuntime';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per (ip,user) hourly cap. Vision is expensive; cap tighter than text routes. */
const RATE_LIMIT_PER_HOUR = 20;
// 5 MiB decoded raster expands to about 6.7 MiB base64, plus the data URL and JSON envelope.
const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(req, MAX_JSON_BODY_BYTES);
  } catch (error) {
    const bounded = boundedJsonError(error);
    const locale = resolveServerLocale(req, new URL(req.url).searchParams.get('lang'));
    return NextResponse.json(
      {
        ok: false,
        error: bounded?.status === 413
          ? `image request exceeds ${Math.round(MAX_JSON_BODY_BYTES / 1024 / 1024)} MB`
          : localizedApiMessage(locale, 'badRequest'),
        code: bounded?.status === 413 ? 'IMAGE_TOO_LARGE' : 'BAD_REQUEST',
        outputLanguage: locale.route,
      },
      { status: bounded?.status ?? 400 },
    );
  }
  // Route handlers receive a Web Request contract. Using req.url also keeps
  // the handler testable with a standards-compliant Request double instead of
  // requiring NextRequest's convenience-only nextUrl property.
  const locale = resolveServerLocale(req, body.lang ?? new URL(req.url).searchParams.get('lang'));
  // (1) Pro+ gate — image-to-CAD is a paid feature.
  const planCheck = await checkPlan(req, 'pro');
  if (!planCheck.ok) {
    return NextResponse.json(
      { ok: false, error: localizedApiMessage(locale, 'planUpgrade'), code: 'PLAN_LOCKED', required: 'pro', outputLanguage: locale.route },
      { status: 403 },
    );
  }
  const userId = planCheck.userId;
  const plan = planCheck.plan;

  // (2) Rate limit — vision is 5-20× pricier than text, so we cap aggressively.
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`intent-from-image:${ip}:${userId}`, RATE_LIMIT_PER_HOUR, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: localizedApiMessage(locale, 'rateLimited'), code: 'RATE_LIMIT', outputLanguage: locale.route },
      { status: 429 },
    );
  }

  // (3) Body parsing.
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  if (!imageBase64) {
    return NextResponse.json(
      { ok: false, error: localizedApiMessage(locale, 'promptRequired'), code: 'IMAGE_REQUIRED', outputLanguage: locale.route },
      { status: 400 },
    );
  }
  const decoded = decodeImageBase64(imageBase64);
  if (!decoded) {
    return NextResponse.json(
      { ok: false, error: localizedApiMessage(locale, 'badRequest'), code: 'IMAGE_DECODE_FAILED', outputLanguage: locale.route },
      { status: 400 },
    );
  }
  if (decoded.bytes.length > IMAGE_INTENT_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `image exceeds ${Math.round(IMAGE_INTENT_MAX_BYTES / 1024 / 1024)} MB (got ${decoded.bytes.length} bytes after decoding)`,
        code: 'IMAGE_TOO_LARGE', outputLanguage: locale.route,
      },
      { status: 413 },
    );
  }
  // mimeType: caller hint wins, then data-URL inference, then default png.
  const callerMime = typeof body.mimeType === 'string' ? body.mimeType : '';
  const ALLOWED_MIME = new Set<string>(RASTER_MIME); // 단일 소스: @/lib/drawingInput
  const mimeType = ALLOWED_MIME.has(callerMime)
    ? (callerMime as 'image/png' | 'image/jpeg' | 'image/webp')
    : (decoded.mimeType ?? 'image/png');
  const hintText = typeof body.hintText === 'string' ? body.hintText.slice(0, 2000) : undefined;
  const codegen = await resolveRuntimeCodegenModel(
    typeof body.modelId === 'string' ? body.modelId : undefined,
    plan,
  );
  if (!codegen.ok) {
    return NextResponse.json({
      ok: false,
      error: codegen.code === 'MODEL_PLAN_LOCKED' ? localizedApiMessage(locale, 'planUpgrade') : localizedApiMessage(locale, 'unknownModel'),
      code: codegen.code,
      requestedModel: codegen.requestedId, outputLanguage: locale.route,
    }, { status: codegen.code === 'MODEL_PLAN_LOCKED' ? 403 : 400 });
  }

  const promptDef = getPrompt(IMAGE_INTENT_PROMPT_ID);
  const extractInput = {
    imageBytes: decoded.bytes,
    mimeType,
    hintText,
    selectedModel: { provider: codegen.provider, model: codegen.model },
  } as const;
  let usage: { used: number; limit: number; remaining: number } | undefined;

  // (4) Cache first. A hit performs no provider work and consumes no budget.
  let probe: ImageIntentOutcome | null = await readCachedImageIntent(extractInput);
  if (!probe) {
    // (5) For a cache miss, reserve both spend and monthly allowance before
    // making the paid VL call. The current counter API has no reservation/
    // refund primitive, so a provider failure still consumes this attempt.
    const budget = await checkUserBudget(userId, planCheck.orgId);
    if (!budget.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: localizedApiMessage(locale, 'costBudget', { limit: budget.limitUsd }),
          code: 'COST_BUDGET',
          usedCents: budget.usedCents,
          limitUsd: budget.limitUsd,
          resetAtMs: budget.resetAtMs, outputLanguage: locale.route,
        },
        { status: 402 },
      );
    }
    const slot = await consumeMonthlyMetricSlot(userId, plan, 'image_intent', undefined, planCheck.orgId);
    if (!slot.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Monthly image-to-CAD limit reached (${slot.limit}/month).`,
          code: 'MONTHLY_LIMIT',
          limit: slot.limit, outputLanguage: locale.route,
        },
        { status: 429 },
      );
    }
    if (slot.limit > 0) {
      usage = { used: slot.used, limit: slot.limit, remaining: Math.max(0, slot.limit - slot.used) };
    }
    probe = await extractIntentFromImage({ ...extractInput, skipCacheRead: true });
  }
  if (!probe.ok) {
    // Failed before any AI work: 4xx-style errors. Otherwise propagate the
    // provider error class for ops.
    const t0 = Date.now();
    if (probe.code === 'IMAGE_REQUIRED' || probe.code === 'IMAGE_TOO_LARGE') {
      return NextResponse.json(
        { ok: false, error: localizedApiMessage(locale, 'badRequest'), code: probe.code, outputLanguage: locale.route },
        { status: probe.code === 'IMAGE_TOO_LARGE' ? 413 : 400 },
      );
    }
    if (probe.code === 'NO_VISION') {
      return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'visionNotConfigured'), code: 'NO_VISION', outputLanguage: locale.route }, { status: 500 });
    }
    if (probe.code === 'AI_REQUEST_FAILED') {
      recordPromptCall({
        userId, orgId: planCheck.orgId, promptId: promptDef.id, promptVersion: promptDef.version,
        provider: probe.provider ?? 'unknown', model: 'unknown',
        latencyMs: Date.now() - t0, success: false,
        errorClass: classifyAiError(new Error(probe.message)),
      });
      captureServerError(new Error(probe.message), {
        route: '/api/nexyfab/intent-from-image', method: 'POST',
        errorClass: 'visionProviderError', userId,
        tags: { provider: probe.provider ?? 'unknown' },
      });
      return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'providerFailed'), code: 'AI_REQUEST_FAILED', outputLanguage: locale.route }, { status: 502 });
    }
    if (probe.code === 'NON_JSON' || probe.code === 'INVALID_JSON_SHAPE' || probe.code === 'BAD_SHAPE_ID') {
      return NextResponse.json(
        { ok: false, error: localizedApiMessage(locale, 'invalidAiResponse'), code: probe.code, outputLanguage: locale.route },
        { status: 502 },
      );
    }
    if (probe.code === 'UNSUPPORTED') {
      return NextResponse.json(
        { ok: false, error: localizedApiMessage(locale, 'unsupportedShape'), code: 'UNSUPPORTED', outputLanguage: locale.route },
        { status: 422 },
      );
    }
    if (probe.code === 'CONVERTER_REJECT') {
      return NextResponse.json(
        { ok: false, error: localizedApiMessage(locale, 'converterRejected'), code: 'CONVERTER_REJECT', outputLanguage: locale.route },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'providerFailed'), code: 'UNKNOWN', outputLanguage: locale.route }, { status: 500 });
  }

  // (7) Telemetry — only on real AI calls.
  if (!probe.cached) {
    recordPromptCall({
      userId,
      orgId: planCheck.orgId,
      promptId: promptDef.id,
      promptVersion: promptDef.version,
      provider: probe.provider ?? 'unknown',
      model: probe.model ?? 'unknown',
      latencyMs: probe.latencyMs ?? 0,
      promptTokens: probe.promptTokens,
      completionTokens: probe.completionTokens,
      cachedPromptTokens: probe.cachedPromptTokens,
      cacheWriteTokens: probe.cacheWriteTokens,
      cacheMissTokens: probe.cacheMissTokens,
      cacheProfile: probe.cacheProfile,
      success: true,
    });
  }

  // (8) Audit — non-blocking. Pro+ only by default (Free is blocked at step 1).
  try {
    logCadPipelineAudit({
      userId,
      plan,
      action: CadAuditAction.IMAGE_INTENT_EXTRACTED,
      resourceId: probe.cacheKey,
      metadata: {
        cached: probe.cached,
        mimeType,
        imageBytes: decoded.bytes.length,
        hasHint: !!hintText,
        shapeId: probe.intent.shapeId,
        provider: probe.provider,
        model: probe.model,
        promptVersion: promptDef.version,
      },
      ip,
    });
  } catch { /* never block on audit */ }

  // (9) Post-call budget warning — same shape as scad-intent-from-nl.
  let budgetWarning: { usedCents: number; limitUsd: number | null; fraction: number } | undefined;
  try {
    const post = await checkUserBudget(userId, planCheck.orgId);
    if (post.approaching) {
      budgetWarning = { usedCents: post.usedCents, limitUsd: post.limitUsd, fraction: post.fraction };
    }
  } catch { /* never block on telemetry */ }

  return NextResponse.json({
    ok: true,
    intent: probe.intent,
    scad: probe.scad,
    warnings: probe.warnings,
    summary: probe.summary,
    /**
     * ★260731 — **치수가 읽힌 값인지 추정된 값인지 호출측에 알린다.**
     *
     * 실측(합성 픽토리얼 48장): 치수 표기가 **없는** 그림에서 비율 정확도 **63.6%**.
     * 즉 표기 없는 이미지의 치수는 「대략」이다. 그런데 그 사실이 산문 `summary` 에만
     * 있어서 **하류가 구별할 수 없었고**, 추정치가 그대로 3D·견적으로 흘러갔다.
     * ⚠ 신고 정확도는 실측 48/48 이고 **과대신고(추정을 「읽었다」)는 0** 이다 —
     *   비율은 못 고쳐도 「믿어도 되는 값인가」는 정확히 전달된다.
     * ⚠ 값을 막지 않는다. 3D 는 그대로 만들되 **측정치인 척하지 않는다.**
     */
    ...(probe.dimensionSource ? { dimensionSource: probe.dimensionSource } : {}),
    cached: probe.cached,
    ...(usage ? { usage } : {}),
    ...(budgetWarning ? { budgetWarning } : {}),
    outputLanguage: locale.route,
  });
}
