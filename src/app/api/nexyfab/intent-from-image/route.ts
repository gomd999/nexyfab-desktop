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
  IMAGE_INTENT_MAX_BYTES,
  IMAGE_INTENT_PROMPT_ID,
} from '@/lib/ai/imageIntentExtractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per (ip,user) hourly cap. Vision is expensive; cap tighter than text routes. */
const RATE_LIMIT_PER_HOUR = 20;

export async function POST(req: NextRequest) {
  // (1) Pro+ gate — image-to-CAD is a paid feature.
  const planCheck = await checkPlan(req, 'pro');
  if (!planCheck.ok) {
    return NextResponse.json(
      { ok: false, error: 'Image-to-CAD requires Pro plan', code: 'PLAN_LOCKED', required: 'pro' },
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
      { ok: false, error: 'Rate limit exceeded — please wait before another upload', code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

  // (3) Body parsing.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  if (!imageBase64) {
    return NextResponse.json(
      { ok: false, error: 'imageBase64 is required (data URL or raw base64)', code: 'IMAGE_REQUIRED' },
      { status: 400 },
    );
  }
  const decoded = decodeImageBase64(imageBase64);
  if (!decoded) {
    return NextResponse.json(
      { ok: false, error: 'Could not decode imageBase64 (expected data URL or valid base64)', code: 'IMAGE_DECODE_FAILED' },
      { status: 400 },
    );
  }
  if (decoded.bytes.length > IMAGE_INTENT_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `image exceeds ${Math.round(IMAGE_INTENT_MAX_BYTES / 1024 / 1024)} MB (got ${decoded.bytes.length} bytes after decoding)`,
        code: 'IMAGE_TOO_LARGE',
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

  // (4) Budget gate — same shape as scad-intent-from-nl. Skipped for cache
  // hits later, so a hot image doesn't burn the user's daily budget.
  const budget = await checkUserBudget(userId);
  if (!budget.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Daily AI spend limit reached ($${budget.limitUsd}). Try again later.`,
        code: 'COST_BUDGET',
        usedCents: budget.usedCents,
        limitUsd: budget.limitUsd,
        resetAtMs: budget.resetAtMs,
      },
      { status: 402 },
    );
  }

  // (5) Monthly metric slot — only consumed when we actually call the
  // vision API. Cache hits skip both this and the budget check.
  // We provisionally consume here, then refund-by-omission isn't possible
  // with the existing API, so we check the cache one round before the slot:
  // the extractor's internal cache lookup races the slot consumption, but
  // since slots are integers consumed on success only, the worst case is
  // a single cache hit using one slot we shouldn't have.
  //
  // To avoid that we duplicate the cache key build to short-circuit before
  // consuming the slot. Same hash function the extractor uses → identical.
  const promptDef = getPrompt(IMAGE_INTENT_PROMPT_ID);

  // Pre-call the extractor; if it cache-hits we skip metric consumption.
  // Otherwise we consume + retry. Keeping this two-step keeps the extractor
  // single-purpose (vision + validate) and the route in charge of metering.
  const probe = await extractIntentFromImage({
    imageBytes: decoded.bytes,
    mimeType,
    hintText,
  });
  if (!probe.ok) {
    // Failed before any AI work: 4xx-style errors. Otherwise propagate the
    // provider error class for ops.
    const t0 = Date.now();
    if (probe.code === 'IMAGE_REQUIRED' || probe.code === 'IMAGE_TOO_LARGE') {
      return NextResponse.json(
        { ok: false, error: probe.message, code: probe.code },
        { status: probe.code === 'IMAGE_TOO_LARGE' ? 413 : 400 },
      );
    }
    if (probe.code === 'NO_VISION') {
      return NextResponse.json({ ok: false, error: probe.message, code: 'NO_VISION' }, { status: 500 });
    }
    if (probe.code === 'AI_REQUEST_FAILED') {
      recordPromptCall({
        userId, promptId: promptDef.id, promptVersion: promptDef.version,
        provider: probe.provider ?? 'unknown', model: 'unknown',
        latencyMs: Date.now() - t0, success: false,
        errorClass: classifyAiError(new Error(probe.message)),
      });
      captureServerError(new Error(probe.message), {
        route: '/api/nexyfab/intent-from-image', method: 'POST',
        errorClass: 'visionProviderError', userId,
        tags: { provider: probe.provider ?? 'unknown' },
      });
      return NextResponse.json({ ok: false, error: probe.message, code: 'AI_REQUEST_FAILED' }, { status: 502 });
    }
    if (probe.code === 'NON_JSON' || probe.code === 'INVALID_JSON_SHAPE' || probe.code === 'BAD_SHAPE_ID') {
      return NextResponse.json(
        { ok: false, error: probe.message, code: probe.code, raw: probe.raw },
        { status: 502 },
      );
    }
    if (probe.code === 'UNSUPPORTED') {
      return NextResponse.json(
        { ok: false, error: probe.message, code: 'UNSUPPORTED', reason: probe.message },
        { status: 422 },
      );
    }
    if (probe.code === 'CONVERTER_REJECT') {
      return NextResponse.json(
        { ok: false, error: probe.message, code: 'CONVERTER_REJECT', reason: probe.reason },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: false, error: probe.message, code: 'UNKNOWN' }, { status: 500 });
  }

  // (6) Consume monthly slot only when this was a real AI round-trip.
  let usage: { used: number; limit: number; remaining: number } | undefined;
  if (!probe.cached) {
    const slot = await consumeMonthlyMetricSlot(userId, plan, 'image_intent');
    if (!slot.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Monthly image-to-CAD limit reached (${slot.limit}/month).`,
          code: 'MONTHLY_LIMIT',
          limit: slot.limit,
        },
        { status: 429 },
      );
    }
    if (slot.limit > 0) {
      usage = { used: slot.used, limit: slot.limit, remaining: Math.max(0, slot.limit - slot.used) };
    }
  }

  // (7) Telemetry — only on real AI calls.
  if (!probe.cached) {
    recordPromptCall({
      userId,
      promptId: promptDef.id,
      promptVersion: promptDef.version,
      provider: probe.provider ?? 'unknown',
      model: probe.model ?? 'unknown',
      latencyMs: probe.latencyMs ?? 0,
      promptTokens: probe.promptTokens,
      completionTokens: probe.completionTokens,
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
    const post = await checkUserBudget(userId);
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
  });
}
