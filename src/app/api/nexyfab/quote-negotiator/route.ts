/**
 * POST /api/nexyfab/quote-negotiator
 *
 * Phase 8-1 — Quote Comparison & Negotiation Assistant (customer-side).
 * Given an RFQ summary + one or more supplier quotes, generates:
 *   - A ranked comparison (best value, fastest, balance pick)
 *   - A negotiation email draft per selected supplier (counter-offer, volume
 *     discount ask, lead-time improvement) in EN + KO
 *
 * Freemium: free = 3/month, pro+ = unlimited.
 */

import { NextRequest, NextResponse } from 'next/server';

interface QuoteInput {
  id: string;
  factoryName: string;
  estimatedAmount: number;
  estimatedDays: number | null;
  note?: string | null;
  validUntil?: string | null;
}

interface RfqContext {
  rfqId?: string;
  projectName?: string;
  material?: string;
  process?: string;
  quantity?: number;
  targetBudgetKrw?: number;
  targetLeadDays?: number;
}

interface RequestBody {
  rfq: RfqContext;
  quotes: QuoteInput[];
  /** Which supplier ID(s) to negotiate with (defaults to all non-lowest) */
  negotiateWith?: string[];
  /** Negotiation goal */
  goal?: 'price' | 'leadtime' | 'both';
  lang?: string;
  projectId?: string;
}

interface RankedQuote {
  id: string;
  factoryName: string;
  estimatedAmount: number;
  estimatedDays: number | null;
  tag: 'best_price' | 'fastest' | 'balanced' | 'expensive' | null;
  vsLowest: number;
  score: number;
}

interface NegotiationDraft {
  supplierId: string;
  supplierName: string;
  subject: string;
  subjectKo: string;
  body: string;
  bodyKo: string;
  asks: string[];
  asksKo: string[];
}

interface NegotiatorResult {
  ranked: RankedQuote[];
  recommendation: string;
  recommendationKo: string;
  negotiations: NegotiationDraft[];
  summary: string;
  summaryKo: string;
}

function stripMarkdownJson(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

function ruleBasedResult(body: RequestBody): NegotiatorResult {
  const { rfq, quotes, goal = 'both' } = body;
  if (!quotes.length) {
    return {
      ranked: [], recommendation: 'No quotes to compare.', recommendationKo: '비교할 견적이 없습니다.',
      negotiations: [], summary: '', summaryKo: '',
    };
  }

  const min = Math.min(...quotes.map(q => q.estimatedAmount));
  const max = Math.max(...quotes.map(q => q.estimatedAmount));
  const minDays = Math.min(...quotes.filter(q => q.estimatedDays).map(q => q.estimatedDays!));

  // Score = 70% price rank + 30% lead rank
  const ranked: RankedQuote[] = quotes.map(q => {
    const pScore = max > min ? 100 - Math.round(((q.estimatedAmount - min) / (max - min)) * 100) : 100;
    const dScore = q.estimatedDays && minDays > 0
      ? 100 - Math.min(100, Math.round(((q.estimatedDays - minDays) / minDays) * 100))
      : 50;
    const score = Math.round(pScore * 0.7 + dScore * 0.3);
    const vsLowest = min > 0 ? Math.round(((q.estimatedAmount - min) / min) * 100) : 0;
    return { id: q.id, factoryName: q.factoryName, estimatedAmount: q.estimatedAmount, estimatedDays: q.estimatedDays, vsLowest, score, tag: null };
  }).sort((a, b) => b.score - a.score);

  // Assign tags
  const bestPrice = ranked.find(r => r.estimatedAmount === min);
  const fastest = ranked.find(r => r.estimatedDays === minDays && minDays !== Infinity);
  if (bestPrice) bestPrice.tag = 'best_price';
  if (fastest && fastest.id !== bestPrice?.id) fastest.tag = 'fastest';
  if (ranked[0] && !ranked[0].tag) ranked[0].tag = 'balanced';
  ranked.slice(-1).forEach(r => { if (!r.tag) r.tag = 'expensive'; });

  const top = ranked[0];
  const recommendation = `Recommend ${top.factoryName} (score ${top.score}/100). ${
    top.tag === 'best_price' ? 'Lowest price.' : top.tag === 'fastest' ? 'Fastest lead time.' : 'Best overall value.'
  }${rfq.targetBudgetKrw && top.estimatedAmount > rfq.targetBudgetKrw ? ` Note: exceeds target budget by ${Math.round(((top.estimatedAmount - rfq.targetBudgetKrw) / rfq.targetBudgetKrw) * 100)}%.` : ''}`;
  const recommendationKo = `${top.factoryName} 추천 (점수 ${top.score}/100). ${
    top.tag === 'best_price' ? '최저가.' : top.tag === 'fastest' ? '최단 납기.' : '종합 가성비 최우선.'
  }${rfq.targetBudgetKrw && top.estimatedAmount > rfq.targetBudgetKrw ? ` 목표 예산보다 ${Math.round(((top.estimatedAmount - rfq.targetBudgetKrw) / rfq.targetBudgetKrw) * 100)}% 초과.` : ''}`;

  // Generate negotiation emails for non-top or explicitly requested suppliers
  const targets = body.negotiateWith?.length
    ? quotes.filter(q => body.negotiateWith!.includes(q.id))
    : ranked.filter(r => r.vsLowest > 5 && r.id !== bestPrice?.id);

  const negotiations: NegotiationDraft[] = targets.map(target => {
    const q = quotes.find(qq => qq.id === target.id)!;
    const rankedEntry = ranked.find(r => r.id === target.id);
    const pctAbove = rankedEntry?.vsLowest ?? 0;
    const baseAsk = Math.round(q.estimatedAmount * 0.92 / 1000) * 1000;
    const asks: string[] = [];
    const asksKo: string[] = [];

    if (goal !== 'leadtime') {
      asks.push(`Can you offer ${q.factoryName} at ${baseAsk.toLocaleString()} KRW (−8% from your quote)?`);
      asksKo.push(`${baseAsk.toLocaleString()}원으로 조정 가능하신가요? (견적 대비 8% 절감)`);
      if (rfq.quantity && rfq.quantity >= 10) {
        asks.push(`What discount is available for a ${Math.round(rfq.quantity * 2)}pcs re-order?`);
        asksKo.push(`${Math.round(rfq.quantity * 2)}개 재주문 시 볼륨 할인 조건은?`);
      }
    }
    if (goal !== 'price') {
      asks.push(`Can lead time be reduced${q.estimatedDays ? ` from ${q.estimatedDays} days` : ''}? What's the expedite fee?`);
      asksKo.push(`납기 단축${q.estimatedDays ? ` (현재 ${q.estimatedDays}일)` : ''} 가능한가요? 특급 처리 비용은?`);
    }
    asks.push('Please confirm if your quote includes shipping and packaging costs.');
    asksKo.push('포장 및 배송비 포함 여부를 확인 부탁드립니다.');

    const subject = `Re: Quote for ${rfq.projectName ?? 'Your Project'} — Negotiation Request`;
    const subjectKo = `견적 조정 요청 — ${rfq.projectName ?? '프로젝트'}`;
    const body = `Hello ${q.factoryName} team,\n\nThank you for your quote of ${q.estimatedAmount.toLocaleString()} KRW${
      rfq.quantity ? ` for ${rfq.quantity} pcs` : ''
    }. We have received ${quotes.length} quotes and are finalising our supplier selection.\n\nYour quote is ${pctAbove > 0 ? `${pctAbove}% above the most competitive offer we received` : 'competitive'}. We would like to partner with you if we can align on the following:\n\n${asks.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\nWe aim to decide within 3 business days. Looking forward to your reply.\n\nBest regards.`;
    const bodyKo = `${q.factoryName} 담당자님,\n\n${rfq.quantity ? `${rfq.quantity}개` : ''} 견적 ${q.estimatedAmount.toLocaleString()}원 감사합니다. 총 ${quotes.length}개 업체에서 견적을 받았으며 최종 파트너사 선정 중입니다.\n\n귀사 견적은 ${pctAbove > 0 ? `가장 경쟁력 있는 견적 대비 ${pctAbove}% 높은 수준입니다` : '경쟁력 있는 수준입니다'}. 아래 사항 협의 가능하신 경우 귀사와 함께하고 싶습니다:\n\n${asksKo.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\n3 영업일 내 결정 예정입니다. 회신 기다리겠습니다.\n\n감사합니다.`;

    return { supplierId: q.id, supplierName: q.factoryName, subject, subjectKo, body, bodyKo, asks, asksKo };
  });

  const spread = max - min;
  const summary = `${quotes.length} quotes received. Spread: ${spread.toLocaleString()} KRW (${max > 0 ? Math.round((spread / min) * 100) : 0}%). ${negotiations.length} negotiation draft(s) generated.`;
  const summaryKo = `${quotes.length}개 견적 수신. 가격 차이 ${spread.toLocaleString()}원 (${max > 0 ? Math.round((spread / min) * 100) : 0}%). 협상 초안 ${negotiations.length}건 생성.`;

  return { ranked, recommendation, recommendationKo, negotiations, summary, summaryKo };
}

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'quote_negotiator');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'Quote Negotiator requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade for unlimited access.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!body.rfq || !Array.isArray(body.quotes) || body.quotes.length === 0) {
    return NextResponse.json({ error: 'rfq and at least one quote are required' }, { status: 400 });
  }

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  const { recordAIHistory } = await import('@/lib/ai-history');

  const historyTitle = `${body.rfq.projectName ?? 'RFQ'} — ${body.quotes.length} quotes`;
  const historyContext = {
    rfqId: body.rfq.rfqId,
    quotesCount: body.quotes.length,
    goal: body.goal,
    material: body.rfq.material,
  };

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'quote_negotiator');
    const fallback = ruleBasedResult(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'quote_negotiator',
      title: historyTitle,
      payload: fallback,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }

  const systemPrompt =
    'You are a procurement negotiation expert. Given an RFQ context and a list of supplier quotes, ' +
    'produce a JSON response with: ' +
    '"ranked" (sorted array of quotes with tags best_price|fastest|balanced|expensive, vsLowest %, score 0-100), ' +
    '"recommendation" (EN), "recommendationKo" (KR), ' +
    '"negotiations" (array of {supplierId, supplierName, subject, subjectKo, body, bodyKo, asks[], asksKo[]} for each non-best supplier), ' +
    '"summary" (EN), "summaryKo" (KR). ' +
    'Negotiations should be polite but assertive — reference competing quote count, request specific % off or lead-time reduction. ' +
    'Tone: professional. Body under 1500 chars. asks 3-5 items. Return JSON only, no markdown.';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({
            rfq: body.rfq,
            quotes: body.quotes,
            negotiateWith: body.negotiateWith,
            goal: body.goal ?? 'both',
            lang: body.lang ?? 'ko',
          }) },
        ],
        temperature: 0.4,
        max_tokens: 3000,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripMarkdownJson(content)) as Partial<NegotiatorResult>;

    if (!parsed.ranked || !parsed.recommendation) throw new Error('Invalid LLM response shape');

    const result: NegotiatorResult = {
      ranked: Array.isArray(parsed.ranked) ? parsed.ranked.slice(0, 20) as RankedQuote[] : [],
      recommendation: parsed.recommendation ?? '',
      recommendationKo: parsed.recommendationKo ?? parsed.recommendation ?? '',
      negotiations: Array.isArray(parsed.negotiations) ? parsed.negotiations.slice(0, 10) as NegotiationDraft[] : [],
      summary: parsed.summary ?? '',
      summaryKo: parsed.summaryKo ?? parsed.summary ?? '',
    };

    recordUsageEvent(planCheck.userId, 'quote_negotiator');
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'quote_negotiator',
      title: historyTitle,
      payload: result,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.warn('[quote-negotiator] DeepSeek API call failed, using rule-based fallback:', err);
    recordUsageEvent(planCheck.userId, 'quote_negotiator');
    const fallback = ruleBasedResult(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'quote_negotiator',
      title: historyTitle,
      payload: fallback,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }
}
