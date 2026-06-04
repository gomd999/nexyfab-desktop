/**
 * POST /api/nexyfab/sketch-from-image
 *
 * Pipeline: image upload → vision LLM detects 2D sketch primitives → structured
 * SketchEntities (points / lines / circles / arcs) the sketch solver + SVG
 * overlay consume. Companion to /intent-from-image (which emits a 3D CAD intent);
 * this one stays in 2D sketch space for the constraint editor.
 *
 * Pro+ gated (vision is expensive). Body: { imageBase64, mimeType? } →
 * { ok, entities, warnings }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { recordPromptCall, classifyAiError } from '@/lib/ai/telemetry';
import { captureServerError } from '@/lib/error-capture';
import { runSketchFromImage } from '@/lib/ai/sketchFromImageService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per (ip,user) hourly cap. Vision is expensive — cap tightly, like intent-from-image. */
const RATE_LIMIT_PER_HOUR = 20;

const HTTP_FOR_CODE: Record<string, number> = {
  IMAGE_REQUIRED: 400,
  IMAGE_DECODE_FAILED: 400,
  IMAGE_TOO_LARGE: 413,
  INFER_FAILED: 502,
};

export async function POST(req: NextRequest) {
  // (1) Pro+ gate — image→sketch is a paid vision feature.
  const planCheck = await checkPlan(req, 'pro');
  if (!planCheck.ok) {
    return NextResponse.json(
      { ok: false, error: 'Image-to-sketch requires Pro plan', code: 'PLAN_LOCKED', required: 'pro' },
      { status: 403 },
    );
  }
  const userId = planCheck.userId;

  // (2) Rate limit.
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`sketch-from-image:${ip}:${userId}`, RATE_LIMIT_PER_HOUR, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Rate limit exceeded — please wait before another upload', code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

  // (3) Body.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';

  // (4) Budget gate — block before the (paid) vision call.
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

  // (5) Decode + validate + detect (core service; real provider-backed detector).
  const t0 = Date.now();
  let result;
  try {
    result = await runSketchFromImage({ imageBase64 });
  } catch (err) {
    captureServerError(err instanceof Error ? err : new Error(String(err)), {
      route: '/api/nexyfab/sketch-from-image', method: 'POST', errorClass: 'visionProviderError', userId,
    });
    return NextResponse.json({ ok: false, error: 'sketch detection failed', code: 'INFER_FAILED' }, { status: 502 });
  }

  if (!result.ok) {
    if (result.code === 'INFER_FAILED') {
      recordPromptCall({
        userId, promptId: 'vision-sketch-detect', promptVersion: '1',
        provider: 'unknown', model: 'unknown', latencyMs: Date.now() - t0,
        success: false, errorClass: classifyAiError(new Error(result.error ?? 'infer failed')),
      });
    }
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code, warnings: result.warnings },
      { status: HTTP_FOR_CODE[result.code ?? 'INFER_FAILED'] ?? 500 },
    );
  }

  // (6) Telemetry — successful vision round-trip.
  recordPromptCall({
    userId, promptId: 'vision-sketch-detect', promptVersion: '1',
    provider: 'anthropic', model: 'vision', latencyMs: Date.now() - t0, success: true,
  });

  return NextResponse.json({
    ok: true,
    entities: result.entities,
    warnings: result.warnings,
    imageBytes: result.imageBytes,
  });
}
