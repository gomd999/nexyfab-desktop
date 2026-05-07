/**
 * POST /api/nexyfab/rfq-responder
 *
 * Phase 7-3 — RFQ Response Assistant (partner-side).
 * Given an incoming RFQ summary plus the partner's capacity profile,
 * generates a quote response draft (estimatedAmount, estimatedDays, note + EN/KO)
 * that the partner can then edit and submit through the existing
 * /api/partner/quotes/respond endpoint.
 *
 * Freemium metric = 'rfq_responder' (free: 5/month, pro+: unlimited).
 */

import { NextRequest, NextResponse } from 'next/server';

interface RfqBrief {
  quoteId?: string;
  partName?: string;
  projectName?: string;
  material?: string;
  process?: string;
  quantity?: number;
  /** Customer's posted budget (ceiling), in KRW. */
  budgetKrw?: number;
  /** DFM score 0-100 (higher = easier to manufacture). */
  dfmScore?: number | null;
  /** Free-text customer note / details. */
  customerNote?: string;
  /** Bounding box mm. */
  bbox?: { w: number; h: number; d: number } | null;
  /** Required certifications. */
  certificationsRequired?: string[];
  /** ISO date deadline. */
  deadline?: string;
}

interface PartnerCapacity {
  hourlyRateKrw?: number;
  /** % margin above raw material cost (default 0.35). */
  materialMargin?: number;
  /** Currently in-progress jobs. */
  currentBacklog?: number;
  /** Days of free capacity in next 30d. */
  leadCapacityDays?: number;
  certifications?: string[];
  processes?: string[];
}

interface RequestBody {
  rfq: RfqBrief;
  partner?: PartnerCapacity;
  lang?: string;
  projectId?: string;
}

interface BreakdownLine {
  label: string;
  labelKo: string;
  amountKrw: number;
}

interface ResponseDraft {
  estimatedAmount: number;
  estimatedAmountKrw: number;
  estimatedDays: number;
  note: string;
  noteKo: string;
  breakdown: BreakdownLine[];
  /** 0..1 — model self-confidence in this draft. */
  confidence: number;
  caveats: string[];
  caveatsKo: string[];
}

function stripMarkdownJson(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

function ruleBasedDraft(body: RequestBody): ResponseDraft {
  const { rfq, partner } = body;
  const qty = rfq.quantity ?? 1;
  const dfm = rfq.dfmScore ?? 70;
  const hourly = partner?.hourlyRateKrw ?? 80000;
  const margin = partner?.materialMargin ?? 0.35;

  // Volume-from-bbox heuristic (cm^3) — assume part fills ~30% of bbox.
  const volumeCm3 = rfq.bbox
    ? Math.max(1, (rfq.bbox.w * rfq.bbox.h * rfq.bbox.d) / 1000 * 0.3)
    : 30;

  const materialCostPerPart =
    (rfq.material?.toLowerCase().includes('titanium') ? 12 :
     rfq.material?.toLowerCase().includes('stainless') ? 6 :
     rfq.material?.toLowerCase().includes('aluminum') ? 4 :
     rfq.material?.toLowerCase().includes('steel') ? 3 : 2) * volumeCm3 * 100;

  // Setup hours scale with DFM difficulty.
  const setupHours = Math.max(1.5, (100 - dfm) / 20);
  const cycleMinutesPerPart = Math.max(2, (100 - dfm) / 8 + Math.sqrt(volumeCm3));
  const totalCycleHours = (cycleMinutesPerPart * qty) / 60;

  const laborCost = (setupHours + totalCycleHours) * hourly;
  const materialCost = materialCostPerPart * qty * (1 + margin);
  const overhead = (laborCost + materialCost) * 0.12;
  const subtotal = laborCost + materialCost + overhead;
  const total = Math.round(subtotal / 1000) * 1000;

  // Lead time: setup (1-3 days) + production days + 2 days QC/ship.
  const productionDays = Math.max(1, Math.ceil(totalCycleHours / 6));
  const leadTime = Math.min(60, Math.max(3, Math.ceil(setupHours / 4) + productionDays + 2));

  const breakdown: BreakdownLine[] = [
    { label: 'Setup & tooling', labelKo: '셋업/툴링', amountKrw: Math.round(setupHours * hourly) },
    { label: `Machining (${qty} pcs)`, labelKo: `가공 (${qty}개)`, amountKrw: Math.round(totalCycleHours * hourly) },
    { label: 'Material', labelKo: '재료비', amountKrw: Math.round(materialCost) },
    { label: 'Overhead & QC', labelKo: '간접비/검사', amountKrw: Math.round(overhead) },
  ];

  const note =
    `Quote based on ${qty} pcs in ${rfq.material ?? 'specified material'}. ` +
    `Lead ~${leadTime} days incl. QC and dispatch. ` +
    `Tooling cost is included; if recurring orders, can be amortized.`;
  const noteKo =
    `${rfq.material ?? '지정 재질'} ${qty}개 기준 견적입니다. ` +
    `납기는 검사·출하 포함 약 ${leadTime}일 소요됩니다. ` +
    `툴링 비용 포함이며, 반복 발주 시 분할 청구 가능합니다.`;

  const caveats: string[] = [];
  const caveatsKo: string[] = [];
  if (rfq.budgetKrw && total > rfq.budgetKrw * 1.15) {
    caveats.push(`Estimate exceeds posted budget (${rfq.budgetKrw.toLocaleString()} KRW) by >15%.`);
    caveatsKo.push(`고객 게시 예산(${rfq.budgetKrw.toLocaleString()}원)보다 15% 이상 높습니다.`);
  }
  if (dfm < 60) {
    caveats.push('Low DFM score — geometry may need design tweaks before quote firm-up.');
    caveatsKo.push('DFM 점수 낮음 — 견적 확정 전 설계 협의 권장.');
  }
  if (rfq.certificationsRequired && partner?.certifications) {
    const missing = rfq.certificationsRequired.filter(c => !partner.certifications?.includes(c));
    if (missing.length > 0) {
      caveats.push(`Missing required certifications: ${missing.join(', ')}.`);
      caveatsKo.push(`필수 인증 미보유: ${missing.join(', ')}.`);
    }
  }
  if (partner?.leadCapacityDays != null && leadTime > partner.leadCapacityDays) {
    caveats.push(`Lead time (${leadTime}d) exceeds current free capacity (${partner.leadCapacityDays}d).`);
    caveatsKo.push(`납기(${leadTime}일)가 현재 가용 캐파(${partner.leadCapacityDays}일)를 초과합니다.`);
  }

  const confidence = Math.max(0.4, Math.min(0.9, 0.85 - (caveats.length * 0.1) - (dfm < 70 ? 0.1 : 0)));

  return {
    estimatedAmount: total,
    estimatedAmountKrw: total,
    estimatedDays: leadTime,
    note,
    noteKo,
    breakdown,
    confidence,
    caveats,
    caveatsKo,
  };
}

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'rfq_responder');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'RFQ Responder requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade for unlimited RFQ Responder.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!body.rfq) {
    return NextResponse.json({ error: 'rfq is required' }, { status: 400 });
  }

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  const { recordAIHistory } = await import('@/lib/ai-history');

  const historyTitle = `${body.rfq.projectName ?? body.rfq.partName ?? 'RFQ'} × ${body.rfq.quantity ?? 1}`;
  const historyContext = {
    quoteId: body.rfq.quoteId,
    material: body.rfq.material,
    process: body.rfq.process,
    quantity: body.rfq.quantity,
    dfmScore: body.rfq.dfmScore,
  };

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'rfq_responder');
    const fallback = ruleBasedDraft(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'rfq_responder',
      title: historyTitle,
      payload: fallback,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }

  const systemPrompt =
    'You assist a manufacturing partner in drafting a quote response to an incoming RFQ. ' +
    'Given the RFQ brief and the partner capacity profile, produce a realistic Korean-market quote with: ' +
    '(1) estimatedAmountKrw — total quote in KRW, rounded to nearest 1000; ' +
    '(2) estimatedDays — lead time in calendar days including QC/dispatch; ' +
    '(3) note (EN) + noteKo (KR) — 2-3 sentences explaining what is included; ' +
    '(4) breakdown — 3-5 line items {label, labelKo, amountKrw} summing close to the total; ' +
    '(5) caveats / caveatsKo — risks (budget mismatch, low DFM, missing certs, capacity) the partner should review; ' +
    '(6) confidence 0..1. ' +
    'Use the partner hourlyRateKrw and materialMargin if provided; else assume 80,000 KRW/hr and 35% material margin. ' +
    'Return JSON only. Do NOT wrap in markdown.';

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
            partner: body.partner,
            requestedLanguage: body.lang ?? 'ko',
          }) },
        ],
        temperature: 0.4,
        max_tokens: 1600,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripMarkdownJson(content)) as Partial<ResponseDraft> & { estimatedAmountKrw?: number };

    const rawAmount = parsed.estimatedAmountKrw ?? parsed.estimatedAmount ?? 0;
    const total = Math.round((typeof rawAmount === 'number' ? rawAmount : Number(rawAmount) || 0) / 1000) * 1000;
    const parsedDays = typeof parsed.estimatedDays === 'number' ? parsed.estimatedDays : Number(parsed.estimatedDays);
    if (!total || !parsedDays || !Number.isFinite(parsedDays)) throw new Error('Invalid LLM response shape');

    const draft: ResponseDraft = {
      estimatedAmount: total,
      estimatedAmountKrw: total,
      estimatedDays: Math.max(1, Math.round(parsedDays)),
      note: parsed.note ?? '',
      noteKo: parsed.noteKo ?? parsed.note ?? '',
      breakdown: Array.isArray(parsed.breakdown) ? parsed.breakdown.slice(0, 6) as BreakdownLine[] : [],
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.slice(0, 6) : [],
      caveatsKo: Array.isArray(parsed.caveatsKo)
        ? parsed.caveatsKo.slice(0, 6)
        : (Array.isArray(parsed.caveats) ? parsed.caveats.slice(0, 6) : []),
    };

    recordUsageEvent(planCheck.userId, 'rfq_responder');
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'rfq_responder',
      title: historyTitle,
      payload: draft,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(draft);
  } catch (err) {
    console.warn('[rfq-responder] DeepSeek API call failed, using rule-based fallback:', err);
    recordUsageEvent(planCheck.userId, 'rfq_responder');
    const fallback = ruleBasedDraft(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'rfq_responder',
      title: historyTitle,
      payload: fallback,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }
}
