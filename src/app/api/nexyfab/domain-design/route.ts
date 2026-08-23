/**
 * POST /api/nexyfab/domain-design  (다분야 확장 #3 — 표면 노출)
 *
 * One brief → a VERIFIED domain package (or an explicit refusal), for the non-
 * mechanical domains (civil / interior / construction / landscape). The HTTP glue
 * only:
 *
 *   parse {domain, brief} → auth (401/403) → rate-limit (429) → unknown domain
 *   (404) → runDomainDesign(domain, brief) → 200 package / 422 refusal
 *   (stage · reason · failed gate ids — 값 날조 없음).
 *
 * Unlike design-brief (mechanical, LLM-planned, AI budget), these domains run the
 * DETERMINISTIC fixture planner today — no AI spend — so there is no $ budget /
 * monthly-slot gate. When an LLM planner is wired per domain (WA-D pattern), the
 * budget gates get added here, exactly as in the mechanical route.
 *
 * Shares the runDomainDriver spine + refusal IR with every other surface, so the
 * same {domain, brief} yields the same payload.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024;
import { getTrustedClientIp } from '@/lib/client-ip';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { captureServerError } from '@/lib/error-capture';
import { DOMAIN_NAMES, isKnownDomain, runDomainDesign, type DomainBrief } from '@/lib/eng-domain/registry';

/** A brief with a fixture key is deterministic (no AI spend); free text hits the
 *  LLM planner (real cost) and must pass the per-user $ budget gate. */
function isLlmBrief(brief: DomainBrief): boolean {
  return !(typeof brief.params?.fixture === 'string' && brief.params.fixture.length > 0);
}

export const dynamic = 'force-dynamic';

function parseInput(body: unknown): { domain: string; brief: DomainBrief } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const domain = b.domain;
  if (typeof domain !== 'string' || domain.length === 0) {
    return { error: `'domain' is required (one of: ${DOMAIN_NAMES.join(', ')})` };
  }
  const briefRaw = b.brief;
  if (!briefRaw || typeof briefRaw !== 'object') return { error: "'brief' object is required" };
  const br = briefRaw as Record<string, unknown>;
  if (typeof br.id !== 'string' || br.id.length === 0) return { error: "'brief.id' is required" };
  const brief: DomainBrief = { id: br.id };
  if (typeof br.text === 'string') brief.text = br.text;
  if (br.params && typeof br.params === 'object') brief.params = br.params as DomainBrief['params'];
  return { domain, brief };
}

export async function POST(req: NextRequest) {
  const body = await readBoundedJson<Record<string, unknown>>(req, MAX_JSON_BODY_BYTES).catch(() => ({}));
  const parsed = parseInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Auth required (a verified draft is a real deliverable). 401 unauth / 403 plan.
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  // Free-text briefs hit the LLM planner (real AI spend) → per-user daily $ gate.
  // Fixture briefs are deterministic (no spend) and skip it.
  if (isLlmBrief(parsed.brief)) {
    const budget = await checkUserBudget(planCheck.userId, planCheck.orgId);
    if (!budget.ok) {
      return NextResponse.json(
        { error: `Daily AI spend limit reached ($${budget.limitUsd}).`, code: 'COST_BUDGET', usedCents: budget.usedCents, limitUsd: budget.limitUsd, resetAtMs: budget.resetAtMs },
        { status: 402 },
      );
    }
  }

  // Burst guard.
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`domain-design:${planCheck.userId}:${ip}`, 60, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many domain-design requests — try again shortly.', code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

  if (!isKnownDomain(parsed.domain)) {
    return NextResponse.json(
      { error: `unknown domain '${parsed.domain}'`, code: 'UNKNOWN_DOMAIN', known: DOMAIN_NAMES },
      { status: 404 },
    );
  }

  try {
    const result = await runDomainDesign(parsed.domain, parsed.brief);
    // Refusal (계획 날조 없음): stage/reason/failed gate ids surfaced as 422.
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    captureServerError(e, {
      route: '/api/nexyfab/domain-design',
      method: 'POST',
      errorClass: 'domainDesignHandler',
      userId: planCheck.userId,
    });
    console.error('domain-design error:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'domain-design run failed' }, { status: 500 });
  }
}
