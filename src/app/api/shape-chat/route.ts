import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { getPromptVariant } from '@/lib/ai/prompts';
import { recordPromptCall, classifyAiError } from '@/lib/ai/telemetry';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { sanitizeShapeChatResponse } from './sanitize';
import { captureServerError } from '@/lib/error-capture';

const SHAPE_IDS = ['box', 'cylinder', 'pipe', 'lBracket', 'flange', 'plateBend', 'gear', 'fanBlade', 'sprocket', 'pulley', 'sphere', 'cone', 'torus', 'wedge', 'sweep', 'loft'];
const FEATURE_TYPES = ['fillet', 'chamfer', 'shell', 'hole', 'linearPattern', 'circularPattern', 'mirror', 'boolean', 'draft', 'scale', 'moveCopy', 'splitBody'];


/* ══════════════════════════════════════════════════════════════════════════════
   POST handler
   ══════════════════════════════════════════════════════════════════════════════ */

export async function POST(req: NextRequest) {
  const planCheck = await checkPlan(req, 'free');
  const userPlan = planCheck.ok ? planCheck.plan : 'free';

  try {
    const { message, history, context } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Atomically reserve a monthly slot BEFORE calling the AI provider so
    // failed/parallel requests cannot overshoot the quota or burn API credits
    // past the limit.
    if (planCheck.ok) {
      // Per-user $ budget gate fires first — a single user's runaway loop
      // mustn't be able to keep consuming quota slots even if the slot count
      // is unlimited (Pro / Team).
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
      const { consumeMonthlyMetricSlot } = await import('@/lib/plan-guard');
      const slot = await consumeMonthlyMetricSlot(planCheck.userId, userPlan, 'shape_chat');
      if (!slot.ok) {
        return NextResponse.json(
          { error: `Free plan limit reached (${slot.limit}/month). Upgrade to Pro for unlimited AI chat.` },
          { status: 429 },
        );
      }
    }

    // A/B variant resolution — same userId always lands in same bucket.
    const prompt = getPromptVariant('shape-chat', planCheck.ok ? planCheck.userId : undefined);
    const messages: ChatMessage[] = [
      { role: 'system', content: prompt.template },
    ];

    // Free users: limited conversation history (last 4 turns); Pro+: last 10
    const historyLimit = userPlan === 'free' ? 4 : 10;
    if (Array.isArray(history)) {
      for (const h of history.slice(-historyLimit)) {
        if (h?.role === 'user' || h?.role === 'assistant' || h?.role === 'system') {
          messages.push({ role: h.role, content: String(h.content ?? '') });
        }
      }
    }

    // Inject current design context into the user message
    let userContent = message;
    if (context && typeof context === 'object') {
      const ctxStr = JSON.stringify(context);
      userContent = `[CONTEXT]${ctxStr}[/CONTEXT]\n\n${message}`;
    }

    messages.push({ role: 'user', content: userContent });

    let raw = '';
    try {
      const result = await chatCompletion({
        messages,
        maxTokens: prompt.defaults.maxTokens,
        temperature: prompt.defaults.temperature,
        timeoutMs: prompt.defaults.timeoutMs,
        task: prompt.id,
      });
      raw = result.text;
      recordPromptCall({
        userId: planCheck.ok ? planCheck.userId : undefined,
        promptId: prompt.id,
        promptVersion: prompt.version,
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
        promptId: prompt.id,
        promptVersion: prompt.version,
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
      console.error('shape-chat AI provider error:', detail);
      return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
    }

    // Extract JSON from response (handle markdown fences, leading text, etc.)
    let parsed: Record<string, unknown>;
    try {
      let jsonStr = raw;
      // Strip markdown code fences
      jsonStr = jsonStr.replace(/```json?\s*/g, '').replace(/```/g, '');
      // Find the first { and last } to extract JSON object
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
      }
      parsed = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({
        mode: 'single',
        shapeId: null,
        params: {},
        features: [],
        message: raw.length > 500 ? raw.slice(0, 500) + '...' : raw,
        error: 'Failed to parse AI response',
      });
    }

    // ── Validate per mode ──

    if (parsed.mode === 'bom') {
      if (Array.isArray(parsed.parts)) {
        parsed.parts = parsed.parts.filter((p: unknown) => {
          if (!p || typeof p !== 'object') return false;
          const rec = p as Record<string, unknown>;
          return typeof rec.shapeId === 'string' && SHAPE_IDS.includes(rec.shapeId);
        });
        for (const part of parsed.parts as unknown[]) {
          if (!part || typeof part !== 'object') continue;
          const pr = part as Record<string, unknown>;
          if (pr.features) {
            pr.features = (pr.features as unknown[]).filter((f: unknown) => {
              if (!f || typeof f !== 'object') return false;
              const fr = f as Record<string, unknown>;
              return typeof fr.type === 'string' && FEATURE_TYPES.includes(fr.type);
            });
          }
          // Ensure position/rotation exist
          if (!Array.isArray(pr.position)) pr.position = [0, 0, 0];
          if (!Array.isArray(pr.rotation)) pr.rotation = [0, 0, 0];
        }
      }

    } else if (parsed.mode === 'sketch') {
      const rawProfile = parsed.profile;
      const segments =
        rawProfile && typeof rawProfile === 'object' && Array.isArray((rawProfile as Record<string, unknown>).segments)
          ? (rawProfile as { segments: unknown[] }).segments
          : null;
      if (!segments || segments.length < 2) {
        parsed.error = 'Invalid sketch: need at least 2 segments';
      } else {
        // Validate each segment
        const segs = segments as Array<{ type?: string; points?: Array<{ x: number; y: number }> }>;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (!s.type || !Array.isArray(s.points)) { parsed.error = `Invalid segment ${i}`; break; }
          if (s.type === 'line' && s.points.length !== 2) { parsed.error = `Line segment ${i} needs 2 points`; break; }
          if (s.type === 'arc' && s.points.length !== 3) { parsed.error = `Arc segment ${i} needs 3 points`; break; }
          // Validate each point has x,y
          for (const p of s.points) {
            if (typeof p.x !== 'number' || typeof p.y !== 'number') { parsed.error = `Invalid point in segment ${i}`; break; }
          }
          if (parsed.error) break;
        }
        // Check closure
        if (!parsed.error) {
          const first = segs[0].points![0];
          const last = segs[segs.length - 1].points![segs[segs.length - 1].points!.length - 1];
          const dist = Math.sqrt((first.x - last.x) ** 2 + (first.y - last.y) ** 2);
          const prof = rawProfile as { segments: typeof segs; closed?: boolean };
          prof.closed = dist < 1.0; // 1mm tolerance
          if (!prof.closed) {
            // Auto-close by adding a closing line segment
            segs.push({ type: 'line', points: [last, first] });
            prof.closed = true;
          }
          parsed.profile = prof;
        }
        // Default config
        if (!parsed.config) parsed.config = {};
        const cfg = parsed.config as Record<string, unknown>;
        if (!cfg.mode) cfg.mode = 'extrude';
        if (cfg.mode === 'extrude' && !cfg.depth) cfg.depth = 30;
        if (cfg.mode === 'revolve') {
          if (!cfg.revolveAngle) cfg.revolveAngle = 360;
          if (!cfg.revolveAxis) cfg.revolveAxis = 'y';
        }
        parsed.config = cfg;
      }

    } else if (parsed.mode === 'optimize') {
      const validFaces = ['left', 'right', 'top', 'bottom', 'front', 'back'];
      if (parsed.fixedFaces && Array.isArray(parsed.fixedFaces)) {
        parsed.fixedFaces = parsed.fixedFaces.filter((f: unknown) => typeof f === 'string' && validFaces.includes(f));
      }
      if (parsed.loads && Array.isArray(parsed.loads)) {
        parsed.loads = parsed.loads.filter((l: unknown) => {
          if (!l || typeof l !== 'object') return false;
          const row = l as Record<string, unknown>;
          return typeof row.face === 'string' && validFaces.includes(row.face) && Array.isArray(row.force) && row.force.length === 3;
        });
      }
      // Clamp volfrac
      if (typeof parsed.volfrac === 'number') parsed.volfrac = Math.max(0.1, Math.min(0.6, parsed.volfrac));
      // Default dimensions
      if (!parsed.dimX) parsed.dimX = 200;
      if (!parsed.dimY) parsed.dimY = 100;
      if (!parsed.dimZ) parsed.dimZ = 200;

    } else if (parsed.mode === 'modify') {
      if (Array.isArray(parsed.actions)) {
        parsed.actions = parsed.actions.filter((a: unknown) => {
          if (!a || typeof a !== 'object') return false;
          const row = a as Record<string, unknown>;
          if (row.type === 'param') return typeof row.key === 'string' && typeof row.value === 'number';
          if (row.type === 'feature') return typeof row.featureType === 'string' && FEATURE_TYPES.includes(row.featureType);
          return false;
        });
      } else {
        parsed.actions = [];
      }

    } else {
      // Default to single
      if (!parsed.mode) parsed.mode = 'single';
      if (typeof parsed.shapeId === 'string' && !SHAPE_IDS.includes(parsed.shapeId)) {
        parsed.error = `Unknown shape: ${parsed.shapeId}`;
        parsed.shapeId = null;
      }
      if (parsed.features && Array.isArray(parsed.features)) {
        parsed.features = parsed.features.filter((f: unknown) => {
          if (!f || typeof f !== 'object') return false;
          const row = f as Record<string, unknown>;
          return typeof row.type === 'string' && FEATURE_TYPES.includes(row.type);
        });
      }
    }

    // Clamp/strip non-finite numeric values across all modes (defense against
    // hostile or hallucinated AI output: NaN, Infinity, 1e9, negative dims).
    sanitizeShapeChatResponse(parsed);

    // Include plan info so the client can show upgrade prompts when appropriate
    parsed._plan = userPlan;

    // Surface "approaching budget" warning (default 80%+). Client shows a
    // yellow toast as a heads-up before the hard 402 lockout fires. Reading
    // the cache is ~free; never blocks the response on telemetry.
    if (planCheck.ok) {
      try {
        const post = await checkUserBudget(planCheck.userId);
        if (post.approaching) {
          parsed._budgetWarning = {
            usedCents: post.usedCents,
            limitUsd: post.limitUsd,
            fraction: post.fraction,
          };
          // One-time-per-24h email so users notice before the hard 402.
          // Fire-and-forget — never block response.
          if (post.limitUsd) {
            void import('@/lib/ai/budgetWarningEmail').then(({ maybeSendBudgetWarningEmail }) =>
              maybeSendBudgetWarningEmail({
                userId: planCheck.userId,
                fraction: post.fraction,
                usedCents: post.usedCents,
                limitUsd: post.limitUsd!,
              }),
            ).catch(() => { /* swallow */ });
          }
        }
      } catch { /* never block response on a telemetry hint */ }
    }

    return NextResponse.json(parsed);
  } catch (e) {
    console.error('shape-chat error:', e);
    captureServerError(e, {
      route: '/api/shape-chat',
      method: 'POST',
      errorClass: 'shapeChatHandler',
      userId: planCheck.ok ? planCheck.userId : undefined,
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
