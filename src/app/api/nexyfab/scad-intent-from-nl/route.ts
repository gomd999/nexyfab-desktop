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
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { getPromptVariant } from '@/lib/ai/prompts';
import { recordPromptCall, classifyAiError } from '@/lib/ai/telemetry';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { intentToScad, type IntentInput, type IntentFeature } from '@/lib/openscad-render/intentToScad';
import { getCachedIntent, setCachedIntent } from '@/lib/ai/intentCache';
import { captureServerError } from '@/lib/error-capture';

export const dynamic = 'force-dynamic';

// Keep these whitelists in lock-step with intentToScad's SUPPORTED_SHAPES /
// SUPPORTED_FEATURES so the AI can never pick something the converter rejects.
const SUPPORTED_SHAPES = [
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'pipe', 'disk',
  'hexNut', 'washer', 'iBeam', 'lBracket', 'flange', 'bolt',
  'gear', 'threadedRod', 'roundedBox', 'screw', 'springCoil',
  'sweep', 'loft', 'fanBlade',
  'heatsink', 'manifold', 'turbine',
  'enclosure', 'tBeam', 'uChannel', 'zPurlin',
  'rackUnit', 'shelfBracket', 'hingedBracket', 'motorMount',
] as const;
const SUPPORTED_FEATURES = [
  'hole', 'fillet', 'chamfer', 'mirror', 'linearPattern', 'circularPattern', 'scale', 'shell',
  'thread', 'draft', 'twist', 'rotate',
] as const;


export async function POST(req: NextRequest) {
  const planCheck = await checkPlan(req, 'free');
  const userPlan = planCheck.ok ? planCheck.plan : 'free';

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }
  if (prompt.length > 4000) {
    return NextResponse.json({ error: 'prompt too long (max 4000 chars)' }, { status: 413 });
  }

  // Cache lookup — same prompt → same intent → same SCAD. A hit avoids the
  // paid AI round-trip AND does NOT consume a monthly quota slot, which is
  // intentional: we're only metering work that actually costs us money.
  const cached = await getCachedIntent(prompt);
  if (cached) {
    return NextResponse.json({
      intent: cached.intent,
      scad: cached.scad,
      warnings: cached.warnings,
      summary: cached.summary,
      cached: true,
    });
  }

  // Per-user $ budget gate fires first — same as shape-chat.
  if (planCheck.ok) {
    const budget = await checkUserBudget(planCheck.userId);
    if (!budget.ok) {
      return NextResponse.json(
        {
          error: `Daily AI spend limit reached ($${budget.limitUsd}). Try again later.`,
          code: 'COST_BUDGET',
          usedCents: budget.usedCents,
          limitUsd: budget.limitUsd,
          resetAtMs: budget.resetAtMs,
        },
        { status: 402 },
      );
    }
    const slot = await consumeMonthlyMetricSlot(planCheck.userId, userPlan, 'shape_chat');
    if (!slot.ok) {
      return NextResponse.json(
        { error: `Free plan limit reached (${slot.limit}/month).`, code: 'MONTHLY_LIMIT' },
        { status: 429 },
      );
    }
  }

  const promptDef = getPromptVariant('scad-intent-from-nl', planCheck.ok ? planCheck.userId : undefined);
  const messages: ChatMessage[] = [
    { role: 'system', content: promptDef.template },
    { role: 'user', content: prompt },
  ];

  let raw = '';
  try {
    const result = await chatCompletion({
      messages,
      maxTokens: promptDef.defaults.maxTokens,
      temperature: promptDef.defaults.temperature,
      timeoutMs: promptDef.defaults.timeoutMs,
      task: promptDef.id,
    });
    raw = result.text;
    recordPromptCall({
      userId: planCheck.ok ? planCheck.userId : undefined,
      promptId: promptDef.id,
      promptVersion: promptDef.version,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      success: true,
    });
  } catch (e) {
    recordPromptCall({
      userId: planCheck.ok ? planCheck.userId : undefined,
      promptId: promptDef.id,
      promptVersion: promptDef.version,
      provider: e instanceof AiProviderError ? e.provider : 'unknown',
      model: 'unknown',
      latencyMs: 0,
      success: false,
      errorClass: classifyAiError(e),
    });
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: 'AI provider not configured' }, { status: 500 });
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
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
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
    return NextResponse.json({ error: 'AI returned non-JSON response', raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
    return NextResponse.json({ error: 'AI returned invalid JSON object', raw: raw.slice(0, 400) }, { status: 502 });
  }
  const parsed = parsedRaw as Record<string, unknown>;

  if (parsed.error === 'unsupported') {
    return NextResponse.json(
      { error: 'unsupported', reason: parsed.reason ?? 'AI declined to express this as a supported shape', code: 'UNSUPPORTED' },
      { status: 422 },
    );
  }

  // Validate the AI's intent matches the whitelist BEFORE handing it to the converter.
  if (typeof parsed.shapeId !== 'string' || !(SUPPORTED_SHAPES as readonly string[]).includes(parsed.shapeId)) {
    return NextResponse.json(
      { error: `AI picked an unsupported shapeId: ${parsed.shapeId}`, raw: raw.slice(0, 400) },
      { status: 502 },
    );
  }
  let params: Record<string, number> = {};
  if (parsed.params != null && typeof parsed.params === 'object' && !Array.isArray(parsed.params)) {
    params = parsed.params as Record<string, number>;
  }

  const allowedFeatureTypes = new Set<string>(SUPPORTED_FEATURES);
  let features: IntentFeature[] = [];
  if (Array.isArray(parsed.features)) {
    features = parsed.features.filter((f): f is IntentFeature => {
      if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
      const t = (f as Record<string, unknown>).type;
      return typeof t === 'string' && allowedFeatureTypes.has(t);
    });
  }

  const intent: IntentInput = {
    shapeId: parsed.shapeId,
    params,
    features,
    facets: typeof parsed.facets === 'number' ? parsed.facets : undefined,
  };

  const conv = intentToScad(intent);
  if (!conv.ok) {
    return NextResponse.json({ error: conv.reason, code: 'CONVERTER_REJECT', intent }, { status: 422 });
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 200) : undefined;

  // Persist to cache so subsequent identical prompts skip the AI call.
  // Fire-and-forget — a cache write failure must not break the response.
  setCachedIntent(prompt, {
    intent,
    scad: conv.scad,
    warnings: conv.warnings,
    summary,
  }).catch(e => console.warn('[scad-intent-from-nl] cache write failed:', e));

  let budgetWarning: { usedCents: number; limitUsd: number | null; fraction: number } | undefined;
  if (planCheck.ok) {
    try {
      const post = await checkUserBudget(planCheck.userId);
      if (post.approaching) {
        budgetWarning = { usedCents: post.usedCents, limitUsd: post.limitUsd, fraction: post.fraction };
      }
    } catch { /* never block on telemetry */ }
  }

  return NextResponse.json({
    intent,
    scad: conv.scad,
    warnings: conv.warnings,
    summary,
    cached: false,
    ...(budgetWarning ? { budgetWarning } : {}),
  });
}
