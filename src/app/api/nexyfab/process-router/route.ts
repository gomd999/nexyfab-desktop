/**
 * POST /api/nexyfab/process-router
 *
 * AI Process Router — given geometry metrics, material, and target quantity,
 * ranks applicable manufacturing processes and explains *why* each is suitable.
 * The server does NOT re-run the cost estimator; the client sends its locally
 * computed CostEstimate[] as context so the LLM can reason about absolute
 * numbers without having to mirror the estimator logic server-side.
 *
 * Freemium: metric = 'process_router' (free: 5/month, pro+: unlimited).
 */

import { NextRequest, NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────

type ProcessType = 'cnc' | 'fdm' | 'sla' | 'sls' | 'injection' | 'sheetmetal_laser';

interface CandidateEstimate {
  process: ProcessType;
  processName?: string;
  totalCost: number;
  unitCost: number;
  leadTime: string;
  currency: string;
  difficulty: number;
  confidence: 'high' | 'medium' | 'low';
}

interface RouterRequest {
  metrics: {
    volume_cm3: number;
    surfaceArea_cm2: number;
    boundingBox: { w: number; h: number; d: number };
    complexity: number;
  };
  material: string;
  quantity: number;
  useCase?: 'prototype' | 'production' | 'custom';
  priority?: 'cost' | 'speed' | 'quality';
  candidates: CandidateEstimate[];
  lang?: string;
  projectId?: string;
}

interface RankedProcess {
  process: ProcessType;
  rank: number;
  /** Fitness score 0-100 — how well this process matches the request */
  score: number;
  reasoning: string;
  reasoningKo: string;
  pros: string[];
  prosKo: string[];
  cons: string[];
  consKo: string[];
  /** Tags like 'low_volume', 'high_precision', 'cosmetic_finish' */
  bestFor: string[];
}

// ─── Rule-based fallback ranking ─────────────────────────────────────────

function ruleBasedRank(req: RouterRequest): RankedProcess[] {
  const { metrics, quantity, useCase, priority, candidates } = req;
  const { volume_cm3, boundingBox, complexity } = metrics;
  const maxDim = Math.max(boundingBox.w, boundingBox.h, boundingBox.d);
  const minDim = Math.min(boundingBox.w, boundingBox.h, boundingBox.d);
  const aspectRatio = maxDim / Math.max(minDim, 0.1);

  const ranked: RankedProcess[] = [];

  for (const c of candidates) {
    let score = 50;
    const pros: string[] = [];
    const prosKo: string[] = [];
    const cons: string[] = [];
    const consKo: string[] = [];
    const bestFor: string[] = [];
    let reasoning = '';
    let reasoningKo = '';

    switch (c.process) {
      case 'cnc': {
        if (quantity < 100) score += 20;
        else if (quantity > 1000) score -= 20;
        if (complexity > 0.7) score -= 10;
        if (priority === 'quality') score += 15;
        if (priority === 'cost' && quantity > 100) score -= 10;
        pros.push('High dimensional accuracy (±0.05mm)', 'Wide material range');
        prosKo.push('고정밀 치수 정확도(±0.05mm)', '다양한 재료 선택');
        cons.push('Per-unit cost high at volume', 'Setup time for each part');
        consKo.push('대량 생산 시 단가 높음', '부품마다 셋업 시간 소요');
        bestFor.push(quantity < 100 ? 'low_volume' : 'custom_part', 'high_precision');
        reasoning = `CNC is strong for ${quantity < 100 ? 'low-to-medium volume' : 'custom'} parts where precision matters. Expected unit cost: ${c.currency} ${c.unitCost.toFixed(2)}.`;
        reasoningKo = `CNC는 ${quantity < 100 ? '소·중량생산' : '맞춤형'} 부품에서 정밀도가 중요할 때 강점이 있습니다. 예상 단가: ${c.currency} ${c.unitCost.toFixed(2)}.`;
        break;
      }
      case 'injection': {
        if (quantity > 1000) score += 30;
        else if (quantity < 100) score -= 30;
        if (priority === 'cost' && quantity > 500) score += 15;
        pros.push('Lowest unit cost at volume', 'Excellent surface finish');
        prosKo.push('대량 생산 시 최저 단가', '우수한 표면 품질');
        cons.push('High upfront tooling cost', 'Long lead time for mold');
        consKo.push('초기 금형비 부담', '금형 제작 리드타임 김');
        bestFor.push('high_volume', 'plastic_parts');
        reasoning = `Injection molding only pays off above ~500 units; amortized tooling makes unit cost drop dramatically. Needs ${quantity < 500 ? 'MORE volume than you specified' : 'your volume fits'}.`;
        reasoningKo = `사출성형은 약 500개 이상부터 경제성이 나옵니다 — 금형비 상각으로 단가가 급락합니다. ${quantity < 500 ? '지정하신 수량보다 더 큰 물량이 필요' : '지정하신 수량에 적합'}합니다.`;
        break;
      }
      case 'fdm': {
        if (useCase === 'prototype') score += 25;
        if (quantity < 10) score += 15;
        if (priority === 'speed') score += 20;
        if (complexity > 0.7) score += 10;
        if (maxDim > 250) score -= 20;
        pros.push('Fast turnaround (hours)', 'No tooling cost', 'Complex geometry OK');
        prosKo.push('빠른 출력 (시간 단위)', '금형비 없음', '복잡 형상 가능');
        cons.push('Layer lines visible', 'Lower strength than injection', 'Limited material properties');
        consKo.push('적층 라인 보임', '사출 대비 낮은 강도', '재료 물성 제한');
        bestFor.push('prototype', 'low_volume', 'rapid_iteration');
        reasoning = `FDM is ideal for prototypes and small runs — build-ready in hours with zero tooling investment.`;
        reasoningKo = `FDM은 프로토타입과 소량 생산에 이상적 — 금형비 없이 시간 단위로 출력 가능.`;
        break;
      }
      case 'sla': {
        if (useCase === 'prototype') score += 20;
        if (quantity < 50) score += 10;
        if (priority === 'quality') score += 15;
        if (volume_cm3 > 1000) score -= 15;
        pros.push('Smooth surface finish', 'Fine detail (0.05mm)', 'Good for visual prototypes');
        prosKo.push('매끄러운 표면 마감', '미세 디테일 (0.05mm)', '시각적 프로토타입에 우수');
        cons.push('Brittle material', 'UV-sensitive', 'Smaller build volume');
        consKo.push('깨지기 쉬운 재료', 'UV 민감성', '제한된 출력 부피');
        bestFor.push('prototype', 'cosmetic_finish', 'fine_detail');
        reasoning = `SLA wins when you need a polished, presentation-quality prototype with fine features.`;
        reasoningKo = `SLA는 정밀한 디테일의 고품질 프로토타입이 필요할 때 강점이 있습니다.`;
        break;
      }
      case 'sls': {
        if (useCase === 'prototype' || useCase === 'custom') score += 15;
        if (complexity > 0.7) score += 15;
        if (quantity < 200) score += 10;
        pros.push('Strong functional parts', 'No support structures needed', 'Good for complex geometry');
        prosKo.push('강한 기능성 부품', '서포트 불필요', '복잡 형상에 우수');
        cons.push('Porous surface', 'Limited materials (PA/TPU)', 'More expensive than FDM');
        consKo.push('다공성 표면', '제한된 재료 (PA/TPU)', 'FDM 대비 고가');
        bestFor.push('functional_prototype', 'complex_geometry', 'low_volume');
        reasoning = `SLS shines for strong, complex functional parts without support removal hassle.`;
        reasoningKo = `SLS는 서포트 제거 번거로움 없이 복잡한 기능성 부품이 필요할 때 빛납니다.`;
        break;
      }
      case 'sheetmetal_laser': {
        if (aspectRatio > 5 && minDim < 10) score += 30; // flat-ish parts
        else score -= 20;
        if (quantity > 50) score += 10;
        if (priority === 'cost' && aspectRatio > 5) score += 15;
        pros.push('Fast for flat parts', 'Low per-unit cost', 'Quick prototype-to-production');
        prosKo.push('평판 부품에 빠름', '낮은 개당 단가', '프로토타입→양산 빠른 전환');
        cons.push('Flat/bent geometry only', 'No complex 3D features');
        consKo.push('평판·벤딩 형상만 가능', '복잡한 3D 형상 불가');
        bestFor.push('flat_parts', 'brackets', 'enclosures');
        reasoning = aspectRatio > 5
          ? `Part geometry looks flat/bent — sheet metal laser is a natural fit.`
          : `Part appears too 3D for sheet metal — better suited to CNC or casting.`;
        reasoningKo = aspectRatio > 5
          ? `형상이 평판·벤딩 타입으로 보여 판금 레이저가 적합합니다.`
          : `형상이 3D 입체로 판금에는 부적합 — CNC나 주조가 더 적합합니다.`;
        break;
      }
      default:
        continue;
    }

    score = Math.max(0, Math.min(100, score));
    ranked.push({
      process: c.process,
      rank: 0, // filled after sort
      score,
      reasoning,
      reasoningKo,
      pros, prosKo, cons, consKo, bestFor,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return ranked;
}

function stripMarkdownJson(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ─── POST handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'process_router');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'AI Process Router requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade to Pro for unlimited Process Router.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RouterRequest;

  if (!body.metrics || !body.material || !body.quantity || !Array.isArray(body.candidates) || body.candidates.length === 0) {
    return NextResponse.json({ error: 'metrics, material, quantity, and candidates[] are required' }, { status: 400 });
  }

  const { recordAIHistory } = await import('@/lib/ai-history');
  const historyTitle = `${body.material} × qty ${body.quantity}${body.useCase ? ` (${body.useCase})` : ''}`;
  const historyContext = {
    material: body.material,
    quantity: body.quantity,
    useCase: body.useCase,
    priority: body.priority,
    metrics: body.metrics,
  };
  const historyProjectId = body.projectId;

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'process_router');
    const ranked = ruleBasedRank(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'process_router',
      title: historyTitle,
      payload: { ranked },
      context: historyContext,
      projectId: historyProjectId,
    });
    return NextResponse.json({ ranked });
  }

  const systemPrompt =
    'You are a manufacturing process selection expert. Given geometry metrics, material, quantity, ' +
    'and a list of candidate processes with their estimated cost/lead-time, rank them from best to worst fit. ' +
    'For each process, provide: fitness score (0-100), reasoning (English + Korean), pros (2-3 bullet list, en + ko), ' +
    'cons (2-3 bullet list, en + ko), and bestFor tags. ' +
    'Respond with a JSON object: { "ranked": [{ "process", "rank", "score", "reasoning", "reasoningKo", ' +
    '"pros": [], "prosKo": [], "cons": [], "consKo": [], "bestFor": [] }] }. ' +
    'Rank 1 = best fit. Do NOT wrap in markdown.';

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
          { role: 'user', content: JSON.stringify(body) },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripMarkdownJson(content)) as { ranked?: RankedProcess[] };

    if (!Array.isArray(parsed.ranked) || parsed.ranked.length === 0) throw new Error('Empty ranked array');

    const ranked = parsed.ranked
      .filter(r => r.process && typeof r.score === 'number')
      .map((r, i) => ({
        process: r.process,
        rank: r.rank ?? i + 1,
        score: Math.max(0, Math.min(100, Number(r.score))),
        reasoning: r.reasoning ?? '',
        reasoningKo: r.reasoningKo ?? r.reasoning ?? '',
        pros: Array.isArray(r.pros) ? r.pros.slice(0, 4) : [],
        prosKo: Array.isArray(r.prosKo) ? r.prosKo.slice(0, 4) : [],
        cons: Array.isArray(r.cons) ? r.cons.slice(0, 4) : [],
        consKo: Array.isArray(r.consKo) ? r.consKo.slice(0, 4) : [],
        bestFor: Array.isArray(r.bestFor) ? r.bestFor.slice(0, 5) : [],
      }));

    recordUsageEvent(planCheck.userId, 'process_router');
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'process_router',
      title: historyTitle,
      payload: { ranked },
      context: historyContext,
      projectId: historyProjectId,
    });
    return NextResponse.json({ ranked });
  } catch (err) {
    console.warn('[process-router] DeepSeek API call failed, using rule-based fallback:', err);
    recordUsageEvent(planCheck.userId, 'process_router');
    const fallback = ruleBasedRank(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'process_router',
      title: historyTitle,
      payload: { ranked: fallback },
      context: historyContext,
      projectId: historyProjectId,
    });
    return NextResponse.json({ ranked: fallback });
  }
}
