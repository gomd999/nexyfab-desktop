/**
 * POST /api/nexyfab/design-brief  (Wave A · WA-D3 — 3면 표면의 API 면)
 *
 * One natural-language brief → a VERIFIED design package (or an explicit
 * refusal). The LLM's role is confined to producing a `DesignPlan`; everything
 * downstream is deterministic and gate-checked (design-driver, WA-A). This
 * route is the HTTP glue only:
 *
 *   parse brief → auth (401) / plan (403) → $budget (402) → rate-limit +
 *   monthly slot (429) → runDesignBrief(planner injected) → 200 package /
 *   422 refusal (stage · reason · failed gate ids — 값 날조 없음).
 *
 * The planner is NOT chosen here: `runDesignBrief` defaults to the deterministic
 * `fixturePlanner` and the orchestrator swaps in llmPlanner at the runner seam
 * (./runner) without touching this file. Helpers/types live in ./runner
 * (sibling module) so this file is handlers + config only (Next 16 rule).
 *
 * Same contract as the MCP `design_brief` tool and the web entry — all three
 * call the shared ./runner, so the same brief yields the same payload.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkPlan, consumeMonthlyMetricSlot } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { captureServerError } from '@/lib/error-capture';
import { parseBrief, runDesignBrief } from './runner';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = parseBrief(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Auth is required (design-brief spends AI budget). checkPlan returns 401 for
  // an unauthenticated request and 403 when the plan is insufficient.
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  // Per-user daily $ budget gate.
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

  // Burst guard + monthly plan slot (플랜 게이트).
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`design-brief:${planCheck.userId}:${ip}`, 30, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many design-brief requests — try again shortly.', code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }
  const slot = await consumeMonthlyMetricSlot(planCheck.userId, planCheck.plan, 'design_brief');
  if (!slot.ok) {
    return NextResponse.json(
      { error: `Plan limit reached (${slot.limit}/month).`, code: 'MONTHLY_LIMIT', limit: slot.limit },
      { status: 429 },
    );
  }

  try {
    const payload = await runDesignBrief(parsed.brief);
    if (!payload.ok) {
      // 명시 거부 — stage/reason/게이트 수치를 그대로 노출(422). 값 날조 없음.
      return NextResponse.json(payload, { status: 422 });
    }
    const usage = slot.limit > 0
      ? { used: slot.used, limit: slot.limit, remaining: Math.max(0, slot.limit - slot.used) }
      : undefined;
    return NextResponse.json({ ...payload, ...(usage ? { usage } : {}) });
  } catch (e) {
    captureServerError(e, {
      route: '/api/nexyfab/design-brief',
      method: 'POST',
      errorClass: 'designBriefHandler',
      userId: planCheck.userId,
    });
    console.error('design-brief error:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'design-brief run failed' }, { status: 500 });
  }
}
