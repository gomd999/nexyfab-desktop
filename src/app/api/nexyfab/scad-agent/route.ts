/**
 * POST /api/nexyfab/scad-agent
 *
 * Runs one user turn through the SCAD coding agent. Streams events as
 * Server-Sent Events so the browser can render incremental progress
 * (model thinking, tool calls firing, render results coming back).
 *
 * Body: { userPrompt: string, session?: AgentSession }
 *   - First call: omit `session` to start fresh.
 *   - Subsequent calls: pass back `session` from the previous SSE `done`
 *     event to continue the conversation.
 *
 * Response: SSE stream. Each event is `data: <JSON AgentEvent>\n\n`.
 *
 * Plan gating: free + per-user $ budget. Same gates as scad-intent-from-nl.
 */
import { NextRequest } from 'next/server';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { recordPromptCall } from '@/lib/ai/telemetry';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';
import { captureServerError } from '@/lib/error-capture';
import { runScadAgent, makeServerAiClient } from '@/lib/ai/scad-agent/runScadAgent';
import { makeTools } from '@/lib/ai/scad-agent/tools';
import { SERVER_HOST_ADAPTERS } from '@/lib/ai/scad-agent/serverAdapters';
import type { AgentEvent, AgentSession } from '@/lib/ai/scad-agent/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BODY_LIMIT_BYTES = 200_000;

export async function POST(req: NextRequest) {
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  // P1 — Rate limit (parity with shape-chat / openscad-render). Tight cap
  // because each agent run can fan out to many model + render calls.
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`scad-agent:${ip}:${planCheck.userId}`, 30, 3_600_000);
  if (!rl.allowed) {
    return Response.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT' }, { status: 429 });
  }

  // Per-user $ budget gate fires next — shared with shape-chat / NL-intent.
  const budget = await checkUserBudget(planCheck.userId);
  if (!budget.ok) {
    return Response.json({
      error: `Daily AI spend limit reached ($${budget.limitUsd}). Try again later.`,
      code: 'COST_BUDGET',
      usedCents: budget.usedCents,
      limitUsd: budget.limitUsd,
      resetAtMs: budget.resetAtMs,
    }, { status: 402 });
  }

  // P1 — Monthly slot quota. Free plan is gated to upgrade prompt (-2);
  // Pro 50, Team 200, Enterprise unlimited. We consume the slot up-front
  // so a slow-running session doesn't get billed twice if the user retries.
  const slot = await consumeMonthlyMetricSlot(planCheck.userId, planCheck.plan, 'scad_agent');
  if (!slot.ok) {
    if (slot.limit === -2) {
      return Response.json({
        error: 'AI Agent (OpenSCAD) is a Pro+ feature. Upgrade to use it.',
        code: 'PLAN_LOCKED',
      }, { status: 403 });
    }
    return Response.json({
      error: `Monthly limit reached (${slot.used}/${slot.limit} agent runs).`,
      code: 'MONTHLY_LIMIT',
      used: slot.used,
      limit: slot.limit,
    }, { status: 429 });
  }

  let body: { userPrompt?: unknown; session?: unknown };
  try {
    const text = await req.text();
    if (text.length > BODY_LIMIT_BYTES) {
      return Response.json({ error: 'request body too large' }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const userPrompt = typeof body.userPrompt === 'string' ? body.userPrompt.trim() : '';
  if (!userPrompt) {
    return Response.json({ error: 'userPrompt is required' }, { status: 400 });
  }
  if (userPrompt.length > 4000) {
    return Response.json({ error: 'userPrompt too long (max 4000 chars)' }, { status: 413 });
  }

  // The session is opaque from the API's perspective — the client passed
  // it back from the previous run. Validate the minimal shape so a
  // crafted payload can't trip the agent.
  let session: AgentSession | null = null;
  if (body.session !== undefined) {
    if (!body.session || typeof body.session !== 'object') {
      return Response.json({ error: 'session must be an object or omitted' }, { status: 400 });
    }
    session = body.session as AgentSession;
  }

  // Free tier gets a tighter budget — Pro callers default to BUDGET_DEFAULTS.
  // checkPlan already loaded the plan; reuse it.
  const tightBudget = planCheck.plan === 'free';

  const encoder = new TextEncoder();
  const t0 = Date.now();
  // Wire the incoming request's abort signal into the agent loop so a
  // client disconnect (browser closed, navigation away) stops further
  // provider calls instead of letting the server task keep burning quota.
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (ev: AgentEvent) => {
        const line = `data: ${JSON.stringify(ev)}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

      // P1 — Track final outcome for telemetry / audit so we can see
      // success/failure rates per provider in the ops dashboard.
      let finalStatus: string = 'unknown';
      let totalTokens = 0;
      const provider = 'unknown';

      try {
        const { session: finalSession } = await runScadAgent({
          userPrompt,
          session,
          ai: makeServerAiClient({ task: 'scad-agent' }),
          tools: makeTools(SERVER_HOST_ADAPTERS),
          tokensCap: tightBudget ? 30_000 : undefined,
          turnsCap: tightBudget ? 6 : undefined,
          toolCallsCap: tightBudget ? 12 : undefined,
          // Stage 2 — Free plan gets 0 vision calls (Pro feature),
          // Pro defaults to BUDGET_DEFAULTS.visionCallsCap (3).
          visionCallsCap: tightBudget ? 0 : undefined,
          onEvent: sendEvent,
          signal: abortController.signal,
        });
        finalStatus = finalSession.status;
        totalTokens = finalSession.budget.tokensUsed;
      } catch (e) {
        const err = e as Error;
        finalStatus = 'error';
        captureServerError(err, { route: '/api/nexyfab/scad-agent', errorClass: 'agent_run' });
        const ev: AgentEvent = { type: 'error', message: err.message };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      } finally {
        // Best-effort telemetry + audit — never block close on these.
        try {
          recordPromptCall({
            userId: planCheck.ok ? planCheck.userId : undefined,
            promptId: 'scad-agent',
            promptVersion: 'v1',
            provider,
            model: 'agent-loop',
            latencyMs: Date.now() - t0,
            promptTokens: totalTokens,
            success: finalStatus === 'done',
          });
        } catch { /* ignore */ }
        try {
          await logCadPipelineAudit({
            userId: planCheck.userId,
            plan: planCheck.plan,
            action: CadAuditAction.SCAD_AGENT_RUN,
            resourceId: `agent-${t0}`,
            metadata: {
              status: finalStatus,
              tokensUsed: totalTokens,
              elapsedMs: Date.now() - t0,
              continuedSession: !!session,
            },
            ip,
          });
        } catch { /* ignore */ }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      // Signal beta status — clients can hit /api/feature-flags for details.
      'X-Beta-Feature': 'scad_agent',
    },
  });
}
