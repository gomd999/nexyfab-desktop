/**
 * POST /api/nexyfab/order-priority
 *
 * Phase 8-2 — Order Prioritization Scorer (partner-side).
 * Given the partner's incoming quote list + capacity profile, ranks each
 * RFQ by expected margin × DFM fit × deadline urgency × process match.
 *
 * Freemium: free = Pro-only (-2), pro+ = unlimited.
 */

import { NextRequest, NextResponse } from 'next/server';

interface IncomingQuote {
  id: string;
  projectName: string;
  estimatedAmount: number;
  status: string;
  dfmScore?: number | null;
  dfmProcess?: string | null;
  validUntil?: string | null;
  details?: string | null;
  bbox?: { w: number; h: number; d: number } | null;
}

interface PartnerProfile {
  hourlyRateKrw?: number;
  materialMargin?: number;
  processes?: string[];
  certifications?: string[];
  currentBacklogDays?: number;
  leadCapacityDays?: number;
}

interface RequestBody {
  quotes: IncomingQuote[];
  partner?: PartnerProfile;
  lang?: string;
  projectId?: string;
}

interface RankedQuote {
  id: string;
  projectName: string;
  estimatedAmount: number;
  score: number;
  tag: 'priority' | 'good_fit' | 'consider' | 'pass';
  estimatedMarginKrw: number;
  marginPct: number;
  reasons: string[];
  reasonsKo: string[];
  riskFlags: string[];
  riskFlagsKo: string[];
}

interface PriorityResult {
  ranked: RankedQuote[];
  summary: string;
  summaryKo: string;
  topPick?: string;
  topPickKo?: string;
}

function stripMarkdownJson(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

function ruleBasedResult(body: RequestBody): PriorityResult {
  const { quotes, partner } = body;
  const hourly = partner?.hourlyRateKrw ?? 80000;
  const materialMargin = partner?.materialMargin ?? 0.35;
  const partnerProcesses = (partner?.processes ?? []).map(p => p.toLowerCase());
  const backlog = partner?.currentBacklogDays ?? 5;
  const leadCap = partner?.leadCapacityDays ?? 20;
  const now = Date.now();

  const ranked: RankedQuote[] = quotes
    .filter(q => q.status === 'pending' || q.status === 'responded')
    .map(q => {
      const dfm = q.dfmScore ?? 70;
      const process = q.dfmProcess ?? '';

      // ── Margin estimate ──────────────────────────────────────────────────────
      const volumeCm3 = q.bbox
        ? Math.max(1, (q.bbox.w * q.bbox.h * q.bbox.d) / 1000 * 0.3)
        : 30;
      const cycleMin = Math.max(2, (100 - dfm) / 8 + Math.sqrt(volumeCm3));
      const laborCost = (cycleMin / 60) * hourly;
      const matCost = volumeCm3 * 200 * (1 + materialMargin);
      const estimatedCost = (laborCost + matCost) * 1.12;
      const estimatedMarginKrw = Math.max(0, q.estimatedAmount - estimatedCost);
      const marginPct = q.estimatedAmount > 0
        ? Math.round((estimatedMarginKrw / q.estimatedAmount) * 100)
        : 0;

      // ── Score components ─────────────────────────────────────────────────────
      // 1. Margin score (0-40)
      const marginScore = Math.min(40, Math.max(0, Math.round(marginPct * 0.8)));

      // 2. DFM fit score (0-25): high DFM = easy = prefer
      const dfmScore_ = Math.round((dfm / 100) * 25);

      // 3. Process match (0-15)
      const processMatch = partnerProcesses.length === 0 || partnerProcesses.includes(process.toLowerCase()) ? 15 : 0;

      // 4. Deadline urgency score (0-20): reward near-but-achievable deadlines
      let deadlineScore = 10;
      const riskFlags: string[] = [];
      const riskFlagsKo: string[] = [];
      if (q.validUntil) {
        const daysLeft = Math.round((new Date(q.validUntil).getTime() - now) / 86_400_000);
        if (daysLeft <= 0) {
          deadlineScore = 0;
          riskFlags.push('Expired or expiring today');
          riskFlagsKo.push('만료됐거나 오늘 만료');
        } else if (daysLeft <= 3) {
          deadlineScore = 20;
          riskFlags.push(`Only ${daysLeft}d left — expedite needed`);
          riskFlagsKo.push(`${daysLeft}일 남음 — 특급 처리 필요`);
        } else if (daysLeft <= 7) {
          deadlineScore = 18;
        } else if (daysLeft <= 14) {
          deadlineScore = 14;
        } else {
          deadlineScore = 8;
        }
        if (backlog > 0 && daysLeft - backlog < 3) {
          riskFlags.push('Lead time may clash with current backlog');
          riskFlagsKo.push('현재 백로그와 납기 충돌 가능성');
        }
      }

      // Capacity risk
      if (backlog >= leadCap) {
        riskFlags.push('Current backlog near capacity limit');
        riskFlagsKo.push('현재 백로그가 캐파 한계에 근접');
      }

      const score = marginScore + dfmScore_ + processMatch + deadlineScore;

      const reasons: string[] = [];
      const reasonsKo: string[] = [];
      if (marginPct >= 35) { reasons.push(`High margin (~${marginPct}%)`); reasonsKo.push(`높은 마진 (~${marginPct}%)`); }
      if (dfm >= 75) { reasons.push('High DFM — easy to produce'); reasonsKo.push('DFM 높음 — 생산 용이'); }
      if (processMatch === 15) { reasons.push('Process matches your capabilities'); reasonsKo.push('공정 역량 일치'); }
      if (deadlineScore >= 18) { reasons.push('Urgent deadline — first-mover advantage'); reasonsKo.push('긴박한 납기 — 선점 기회'); }
      if (reasons.length === 0) { reasons.push('Standard opportunity'); reasonsKo.push('일반 수주 기회'); }

      const tag: RankedQuote['tag'] =
        score >= 70 ? 'priority' :
        score >= 50 ? 'good_fit' :
        score >= 30 ? 'consider' : 'pass';

      return {
        id: q.id,
        projectName: q.projectName,
        estimatedAmount: q.estimatedAmount,
        score,
        tag,
        estimatedMarginKrw: Math.round(estimatedMarginKrw),
        marginPct,
        reasons,
        reasonsKo,
        riskFlags,
        riskFlagsKo,
      };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const summary = `${ranked.length} active quotes ranked. ${ranked.filter(r => r.tag === 'priority').length} priority, ${ranked.filter(r => r.tag === 'good_fit').length} good fit.`;
  const summaryKo = `활성 견적 ${ranked.length}건 분석. 우선순위 ${ranked.filter(r => r.tag === 'priority').length}건, 적합 ${ranked.filter(r => r.tag === 'good_fit').length}건.`;
  const topPick = top ? `Top pick: ${top.projectName} (score ${top.score}/100, est. margin ~${top.marginPct}%).` : undefined;
  const topPickKo = top ? `추천 수주: ${top.projectName} (점수 ${top.score}/100, 예상 마진 ~${top.marginPct}%).` : undefined;

  return { ranked, summary, summaryKo, topPick, topPickKo };
}

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'order_priority');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'Order Priority Scorer requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade for unlimited access.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!Array.isArray(body.quotes) || body.quotes.length === 0) {
    return NextResponse.json({ error: 'quotes array is required' }, { status: 400 });
  }

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  const { recordAIHistory } = await import('@/lib/ai-history');

  const historyTitle = `Order Priority — ${body.quotes.length} quotes`;
  const historyContext = { quotesCount: body.quotes.length, partnerProcesses: body.partner?.processes };

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'order_priority');
    const fallback = ruleBasedResult(body);
    recordAIHistory({ userId: planCheck.userId, feature: 'order_priority', title: historyTitle, payload: fallback, context: historyContext, projectId: body.projectId });
    return NextResponse.json(fallback);
  }

  const systemPrompt =
    'You are a manufacturing partner business advisor. Given a list of incoming RFQs and the partner\'s capacity profile, ' +
    'rank each RFQ by attractiveness (margin × DFM fit × deadline urgency × process match). ' +
    'Return JSON: { "ranked": [{id, projectName, estimatedAmount, score(0-100), tag("priority"|"good_fit"|"consider"|"pass"), ' +
    'estimatedMarginKrw, marginPct, reasons[], reasonsKo[], riskFlags[], riskFlagsKo[]}], ' +
    '"summary"(EN), "summaryKo"(KR), "topPick"(EN), "topPickKo"(KR) }. ' +
    'Be concise. No markdown.';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ quotes: body.quotes, partner: body.partner, lang: body.lang ?? 'ko' }) },
        ],
        temperature: 0.3,
        max_tokens: 2500,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`DeepSeek error: ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(stripMarkdownJson(data.choices?.[0]?.message?.content ?? '')) as Partial<PriorityResult>;
    if (!parsed.ranked) throw new Error('Invalid shape');

    const result: PriorityResult = {
      ranked: (parsed.ranked as RankedQuote[]).slice(0, 50),
      summary: parsed.summary ?? '',
      summaryKo: parsed.summaryKo ?? parsed.summary ?? '',
      topPick: parsed.topPick,
      topPickKo: parsed.topPickKo ?? parsed.topPick,
    };

    recordUsageEvent(planCheck.userId, 'order_priority');
    recordAIHistory({ userId: planCheck.userId, feature: 'order_priority', title: historyTitle, payload: result, context: historyContext, projectId: body.projectId });
    return NextResponse.json(result);
  } catch (err) {
    console.warn('[order-priority] fallback:', err);
    recordUsageEvent(planCheck.userId, 'order_priority');
    const fallback = ruleBasedResult(body);
    recordAIHistory({ userId: planCheck.userId, feature: 'order_priority', title: historyTitle, payload: fallback, context: historyContext, projectId: body.projectId });
    return NextResponse.json(fallback);
  }
}
