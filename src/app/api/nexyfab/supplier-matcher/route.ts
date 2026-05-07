/**
 * POST /api/nexyfab/supplier-matcher
 *
 * AI Supplier Matcher (Phase 3) — given a set of manufacturer candidates plus
 * the current shape/material/process/quantity context, asks the LLM to pick
 * Top-3 with reasoning, strengths, concerns, and tailored RFQ talking points.
 *
 * Input: client pre-scored candidates so the server has less work (and so the
 * user's local geometry never leaves this endpoint).
 *
 * Freemium: metric = 'ai_supplier_match' (free: 3/month, pro+: unlimited).
 */

import { NextRequest, NextResponse } from 'next/server';

// ─── Types ─────────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  name: string;
  nameKo: string;
  region: string;
  processes: string[];
  minLeadTime: number;
  maxLeadTime: number;
  rating: number;
  reviewCount: number;
  priceLevel: string;
  certifications: string[];
  matchScore: number;
}

interface RequestBody {
  candidates: Candidate[];
  material: string;
  process: string;
  quantity: number;
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  useCase?: 'prototype' | 'production' | 'custom';
  priority?: 'cost' | 'speed' | 'quality';
  lang?: string;
  projectId?: string;
}

interface RankedSupplier {
  id: string;
  rank: number;
  score: number;
  reasoning: string;
  reasoningKo: string;
  strengths: string[];
  strengthsKo: string[];
  concerns: string[];
  concernsKo: string[];
  rfqTalkingPoints: string[];
  rfqTalkingPointsKo: string[];
}

// ─── Rule-based fallback ───────────────────────────────────────────────────

function ruleBasedRank(body: RequestBody): RankedSupplier[] {
  const sorted = [...body.candidates].sort((a, b) => b.matchScore - a.matchScore);
  const top3 = sorted.slice(0, 3);
  const { material, process: proc, quantity, priority = 'cost' } = body;

  return top3.map((c, idx) => {
    const isCertified = c.certifications.length > 0;
    const isFastLead = c.minLeadTime <= 7;
    const isBudget = c.priceLevel === 'budget' || c.priceLevel === 'low';
    const isPremium = c.priceLevel === 'premium' || c.priceLevel === 'high';
    const offersProc = c.processes.includes(proc);

    const strengths: string[] = [];
    const strengthsKo: string[] = [];
    if (offersProc) { strengths.push(`Direct ${proc.replace('_', ' ')} capability`); strengthsKo.push(`${proc.replace('_', ' ')} 공정 직접 보유`); }
    if (c.rating >= 4.5) { strengths.push(`High review rating (${c.rating.toFixed(1)}/5)`); strengthsKo.push(`높은 평점 (${c.rating.toFixed(1)}/5)`); }
    if (isFastLead) { strengths.push(`Fast lead time (${c.minLeadTime} days)`); strengthsKo.push(`빠른 납기 (${c.minLeadTime}일)`); }
    if (isCertified) { strengths.push(`Certified: ${c.certifications.slice(0, 2).join(', ')}`); strengthsKo.push(`인증: ${c.certifications.slice(0, 2).join(', ')}`); }
    if (isBudget && priority === 'cost') { strengths.push('Budget-tier pricing aligns with cost priority'); strengthsKo.push('저가 등급 — 비용 우선순위에 부합'); }

    const concerns: string[] = [];
    const concernsKo: string[] = [];
    if (!offersProc) { concerns.push(`${proc} not listed — confirm capability in RFQ`); concernsKo.push(`${proc} 공정 미등록 — RFQ에서 확인 필요`); }
    if (c.reviewCount < 10) { concerns.push(`Low review volume (${c.reviewCount})`); concernsKo.push(`리뷰 수 적음 (${c.reviewCount})`); }
    if (c.minLeadTime > 14 && priority === 'speed') { concerns.push(`Long minimum lead time (${c.minLeadTime} days)`); concernsKo.push(`최소 납기 긴 편 (${c.minLeadTime}일)`); }
    if (isPremium && priority === 'cost') { concerns.push('Premium-tier pricing — expect higher unit cost'); concernsKo.push('프리미엄 등급 — 단가 상승 예상'); }
    if (quantity > 1000 && c.maxLeadTime <= 15) { concerns.push('Verify capacity for large-volume production'); concernsKo.push('대량 생산 캐파 사전 확인'); }

    const rfqTalkingPoints: string[] = [];
    const rfqTalkingPointsKo: string[] = [];
    rfqTalkingPoints.push(`Confirm ${material} stock availability and lead time`);
    rfqTalkingPointsKo.push(`${material} 재고 및 납기 확인`);
    rfqTalkingPoints.push(`Ask for MOQ and per-unit pricing at qty ${quantity}`);
    rfqTalkingPointsKo.push(`최소주문수량(MOQ) 및 수량 ${quantity} 기준 단가 문의`);
    if (!offersProc) {
      rfqTalkingPoints.push(`Verify ${proc} tolerances and surface-finish options`);
      rfqTalkingPointsKo.push(`${proc} 공차 및 표면 마감 옵션 확인`);
    }
    if (quantity >= 100) {
      rfqTalkingPoints.push('Request volume-discount schedule');
      rfqTalkingPointsKo.push('수량별 할인 스케줄 요청');
    }

    const reasoning = offersProc
      ? `${c.name} ranks ${idx + 1} with a ${c.matchScore}/100 match. Their ${proc} capability paired with ${c.rating.toFixed(1)}/5 rating makes them a ${idx === 0 ? 'strong primary' : 'solid alternative'} choice for ${material} ${body.useCase ?? 'production'}.`
      : `${c.name} ranks ${idx + 1} at ${c.matchScore}/100. They don't explicitly list ${proc}, but their adjacent capabilities and ${c.rating.toFixed(1)}/5 rating warrant a capability check via RFQ.`;
    const reasoningKo = offersProc
      ? `${c.nameKo}은(는) ${c.matchScore}/100점으로 ${idx + 1}순위입니다. ${proc} 공정 직접 보유 + ${c.rating.toFixed(1)}/5 평점 조합은 ${material} ${body.useCase === 'prototype' ? '시제품' : '양산'}에 ${idx === 0 ? '1순위로 적합' : '유력 대안'}합니다.`
      : `${c.nameKo}은(는) ${c.matchScore}/100점으로 ${idx + 1}순위입니다. ${proc} 공정은 명시돼 있지 않으나 인접 공정 역량과 ${c.rating.toFixed(1)}/5 평점을 근거로 RFQ에서 가능성을 확인할 가치가 있습니다.`;

    return {
      id: c.id,
      rank: idx + 1,
      score: c.matchScore,
      reasoning,
      reasoningKo,
      strengths, strengthsKo,
      concerns, concernsKo,
      rfqTalkingPoints, rfqTalkingPointsKo,
    };
  });
}

function stripMarkdownJson(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ─── POST handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'ai_supplier_match');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'AI Supplier Match requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade to Pro for unlimited AI supplier matching.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!Array.isArray(body.candidates) || body.candidates.length === 0 || !body.material || !body.process) {
    return NextResponse.json({ error: 'candidates[], material, and process are required' }, { status: 400 });
  }

  // Pre-trim to top-8 by local score so the LLM only sees strong candidates
  const top8 = [...body.candidates].sort((a, b) => b.matchScore - a.matchScore).slice(0, 8);
  const trimmedBody: RequestBody = { ...body, candidates: top8 };

  const { recordAIHistory } = await import('@/lib/ai-history');
  const historyTitle = `${body.process} × ${body.material} × qty ${body.quantity}`;
  const historyContext = {
    material: body.material,
    process: body.process,
    quantity: body.quantity,
    useCase: body.useCase,
    priority: body.priority,
    candidateCount: body.candidates.length,
  };
  const historyProjectId = body.projectId;

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'ai_supplier_match');
    const ranked = ruleBasedRank(trimmedBody);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'ai_supplier_match',
      title: historyTitle,
      payload: { ranked },
      context: historyContext,
      projectId: historyProjectId,
    });
    return NextResponse.json({ ranked });
  }

  const systemPrompt =
    'You are a manufacturing sourcing expert. Given a list of supplier candidates and the buyer context ' +
    '(material, process, quantity, geometry size, use-case, priority), pick the top 3 and justify each. ' +
    'For each selected supplier, return: rank (1-3), score (0-100), reasoning (en+ko), strengths (2-4 bullets, en+ko), ' +
    'concerns (1-3 bullets, en+ko), rfqTalkingPoints (2-4 bullets, en+ko). ' +
    'Respond with JSON: { "ranked": [ { "id", "rank", "score", "reasoning", "reasoningKo", "strengths", "strengthsKo", "concerns", "concernsKo", "rfqTalkingPoints", "rfqTalkingPointsKo" }, ... ] }. ' +
    'Each bullet under 100 chars. Do NOT wrap JSON in markdown code blocks.';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ ...trimmedBody, requestedLanguage: body.lang ?? 'en' }) },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripMarkdownJson(content)) as { ranked?: Partial<RankedSupplier>[] };

    if (!Array.isArray(parsed.ranked) || parsed.ranked.length === 0) throw new Error('Invalid LLM response shape');

    const validIds = new Set(top8.map(c => c.id));
    const ranked: RankedSupplier[] = parsed.ranked
      .filter((r): r is Partial<RankedSupplier> & { id: string } => typeof r.id === 'string' && validIds.has(r.id))
      .slice(0, 3)
      .map((r, idx) => ({
        id: r.id,
        rank: r.rank ?? idx + 1,
        score: typeof r.score === 'number' ? r.score : (top8.find(c => c.id === r.id)?.matchScore ?? 0),
        reasoning: r.reasoning ?? '',
        reasoningKo: r.reasoningKo ?? r.reasoning ?? '',
        strengths: Array.isArray(r.strengths) ? r.strengths.slice(0, 4) : [],
        strengthsKo: Array.isArray(r.strengthsKo) ? r.strengthsKo.slice(0, 4) : (Array.isArray(r.strengths) ? r.strengths.slice(0, 4) : []),
        concerns: Array.isArray(r.concerns) ? r.concerns.slice(0, 3) : [],
        concernsKo: Array.isArray(r.concernsKo) ? r.concernsKo.slice(0, 3) : (Array.isArray(r.concerns) ? r.concerns.slice(0, 3) : []),
        rfqTalkingPoints: Array.isArray(r.rfqTalkingPoints) ? r.rfqTalkingPoints.slice(0, 4) : [],
        rfqTalkingPointsKo: Array.isArray(r.rfqTalkingPointsKo) ? r.rfqTalkingPointsKo.slice(0, 4) : (Array.isArray(r.rfqTalkingPoints) ? r.rfqTalkingPoints.slice(0, 4) : []),
      }));

    if (ranked.length === 0) throw new Error('No valid supplier ids returned');

    recordUsageEvent(planCheck.userId, 'ai_supplier_match');
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'ai_supplier_match',
      title: historyTitle,
      payload: { ranked },
      context: historyContext,
      projectId: historyProjectId,
    });
    return NextResponse.json({ ranked });
  } catch (err) {
    console.warn('[supplier-matcher] DeepSeek API call failed, using rule-based fallback:', err);
    recordUsageEvent(planCheck.userId, 'ai_supplier_match');
    const fallback = ruleBasedRank(trimmedBody);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'ai_supplier_match',
      title: historyTitle,
      payload: { ranked: fallback },
      context: historyContext,
      projectId: historyProjectId,
    });
    return NextResponse.json({ ranked: fallback });
  }
}
