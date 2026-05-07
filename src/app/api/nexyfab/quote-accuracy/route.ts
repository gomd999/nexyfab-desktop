/**
 * POST /api/nexyfab/quote-accuracy
 *
 * Phase 9-3 — Quote Accuracy Learner (파트너 사이드).
 * 파트너가 과거 견적 이력(초안 금액 vs 수락 금액 vs 실제 원가)을 입력하면
 * 공정별 과소/과대 견적 편향, 정확도 점수, 보정 제안을 반환합니다.
 * 이 결과를 RFQ Responder 초안 생성 시 참고 데이터로 활용합니다.
 *
 * Freemium: free = Pro 전용(-2), pro+ = 무제한.
 */

import { NextRequest, NextResponse } from 'next/server';

interface QuoteEntry {
  entryId?: string;
  process?: string;
  material?: string;
  /** 파트너가 제출한 견적 금액 */
  draftAmount: number;
  /** 고객이 수락한 금액 (없으면 null) */
  acceptedAmount?: number | null;
  /** 실제 제조 원가 (없으면 null) */
  actualCost?: number | null;
  quantity?: number;
  deadlineDays?: number;
}

interface PartnerHint {
  hourlyRateKrw?: number;
  processes?: string[];
}

interface RequestBody {
  entries: QuoteEntry[];
  partner?: PartnerHint;
  lang?: string;
  projectId?: string;
}

interface ProcessBias {
  process: string;
  biasPercent: number;
  avgAccuracy: number;
  sampleCount: number;
  recommendation: string;
  recommendationKo: string;
}

interface AccuracySuggestion {
  title: string;
  titleKo: string;
  detail: string;
  detailKo: string;
  adjustmentPercent: number;
}

interface QuoteAccuracyResult {
  overallAccuracy: number;
  overallBiasPercent: number;
  processBias: ProcessBias[];
  suggestions: AccuracySuggestion[];
  summary: string;
  summaryKo: string;
  entriesAnalysed: number;
}

function stripMarkdownJson(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/** 편향 %: + = 과대견적, - = 과소견적 */
function calcBias(draft: number, ref: number): number {
  return ((draft - ref) / ref) * 100;
}

/** 정확도 0-100: 차이가 0%면 100, 50% 차이면 0 */
function calcAccuracy(draft: number, ref: number): number {
  const absBias = Math.abs(calcBias(draft, ref));
  return Math.max(0, 100 - absBias * 2);
}

function biasDescription(bias: number): { en: string; ko: string } {
  if (bias > 20) return { en: 'Significantly overquoting — losing deals.', ko: '심하게 과대 견적 — 수주 기회 손실 가능.' };
  if (bias > 8)  return { en: 'Slightly overquoting — consider lowering margin.', ko: '다소 과대 견적 — 마진 하향 조정 검토.' };
  if (bias < -20) return { en: 'Significantly underquoting — margin at risk.', ko: '심하게 과소 견적 — 마진 손실 위험.' };
  if (bias < -8)  return { en: 'Slightly underquoting — increase base rate.', ko: '다소 과소 견적 — 기준 단가 인상 검토.' };
  return { en: 'Well-calibrated — maintain current pricing.', ko: '견적 정확도 양호 — 현행 단가 유지.' };
}

function ruleBasedResult(body: RequestBody): QuoteAccuracyResult {
  const entries = body.entries.filter(e => e.draftAmount > 0);

  // 비교 기준: acceptedAmount 우선, 없으면 actualCost
  type ScoredEntry = { process: string; bias: number; accuracy: number };
  const scored: ScoredEntry[] = [];

  for (const e of entries) {
    const ref = e.acceptedAmount ?? e.actualCost ?? null;
    if (ref == null || ref <= 0) continue;
    scored.push({
      process: e.process?.trim() || '기타',
      bias: calcBias(e.draftAmount, ref),
      accuracy: calcAccuracy(e.draftAmount, ref),
    });
  }

  // 공정별 집계
  const byProcess: Record<string, { biases: number[]; accuracies: number[] }> = {};
  for (const s of scored) {
    if (!byProcess[s.process]) byProcess[s.process] = { biases: [], accuracies: [] };
    byProcess[s.process].biases.push(s.bias);
    byProcess[s.process].accuracies.push(s.accuracy);
  }

  const processBias: ProcessBias[] = Object.entries(byProcess).map(([process, data]) => {
    const avgBias = data.biases.reduce((a, b) => a + b, 0) / data.biases.length;
    const avgAcc  = data.accuracies.reduce((a, b) => a + b, 0) / data.accuracies.length;
    const desc    = biasDescription(avgBias);
    return {
      process,
      biasPercent: Math.round(avgBias * 10) / 10,
      avgAccuracy: Math.round(avgAcc),
      sampleCount: data.biases.length,
      recommendation: desc.en,
      recommendationKo: desc.ko,
    };
  }).sort((a, b) => Math.abs(b.biasPercent) - Math.abs(a.biasPercent));

  const overallBias = scored.length
    ? scored.reduce((s, e) => s + e.bias, 0) / scored.length
    : 0;
  const overallAccuracy = scored.length
    ? scored.reduce((s, e) => s + e.accuracy, 0) / scored.length
    : 0;

  // 보정 제안 생성
  const suggestions: AccuracySuggestion[] = [];

  for (const pb of processBias) {
    if (Math.abs(pb.biasPercent) < 5) continue;
    const adj = -Math.round(pb.biasPercent);
    suggestions.push({
      title: `${pb.process}: Adjust quotes by ${adj > 0 ? '+' : ''}${adj}%`,
      titleKo: `${pb.process}: 견적 ${adj > 0 ? '+' : ''}${adj}% 보정`,
      detail: `Based on ${pb.sampleCount} historical quote(s), your ${pb.process} quotes are ${pb.biasPercent > 0 ? 'over' : 'under'}-priced by ${Math.abs(pb.biasPercent).toFixed(1)}% on average. ${pb.recommendation}`,
      detailKo: `${pb.sampleCount}건 이력 기준, ${pb.process} 견적이 평균 ${Math.abs(pb.biasPercent).toFixed(1)}% ${pb.biasPercent > 0 ? '높습니다' : '낮습니다'}. ${pb.recommendationKo}`,
      adjustmentPercent: adj,
    });
  }

  if (scored.length === 0) {
    suggestions.push({
      title: 'Add historical quote data to get calibration insights.',
      titleKo: '이력 데이터를 입력하면 보정 인사이트를 얻을 수 있습니다.',
      detail: 'Enter at least one past quote with an accepted or actual cost amount.',
      detailKo: '수락 금액 또는 실제 원가가 있는 과거 견적을 1건 이상 입력하세요.',
      adjustmentPercent: 0,
    });
  }

  const summary = scored.length === 0
    ? 'No comparable data. Add accepted amounts to calculate accuracy.'
    : `Analysed ${scored.length} quote(s). Overall accuracy: ${Math.round(overallAccuracy)}/100. Bias: ${overallBias > 0 ? '+' : ''}${overallBias.toFixed(1)}%.`;
  const summaryKo = scored.length === 0
    ? '비교 가능한 데이터 없음. 수락 금액을 입력하면 정확도를 산출합니다.'
    : `${scored.length}건 분석 완료. 전체 정확도: ${Math.round(overallAccuracy)}/100. 편향: ${overallBias > 0 ? '+' : ''}${overallBias.toFixed(1)}%.`;

  return {
    overallAccuracy: Math.round(overallAccuracy),
    overallBiasPercent: Math.round(overallBias * 10) / 10,
    processBias,
    suggestions,
    summary,
    summaryKo,
    entriesAnalysed: scored.length,
  };
}

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'quote_accuracy');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'Quote Accuracy Learner requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade for unlimited access.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: 'entries array is required' }, { status: 400 });
  }

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  const { recordAIHistory } = await import('@/lib/ai-history');

  const historyTitle = `견적 정확도 분석 — ${body.entries.length}건`;
  const historyContext = { entryCount: body.entries.length, processes: [...new Set(body.entries.map(e => e.process ?? '기타'))] };

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'quote_accuracy');
    const fallback = ruleBasedResult(body);
    recordAIHistory({ userId: planCheck.userId, feature: 'quote_accuracy', title: historyTitle, payload: fallback, context: historyContext, projectId: body.projectId });
    return NextResponse.json(fallback);
  }

  const systemPrompt =
    'You are a manufacturing quote accuracy analyst. Given historical quote entries (draftAmount, acceptedAmount, actualCost, process), ' +
    'calculate per-process bias and accuracy, then suggest calibration adjustments. ' +
    'Return JSON: { overallAccuracy(0-100), overallBiasPercent(+ = overquote), ' +
    'processBias: [{ process, biasPercent, avgAccuracy, sampleCount, recommendation(EN), recommendationKo(KR) }], ' +
    'suggestions: [{ title(EN), titleKo(KR), detail(EN), detailKo(KR), adjustmentPercent }], ' +
    'summary(EN), summaryKo(KR), entriesAnalysed }. No markdown.';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ entries: body.entries, partner: body.partner, lang: body.lang ?? 'ko' }) },
        ],
        temperature: 0.2,
        max_tokens: 2500,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`DeepSeek error: ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(stripMarkdownJson(data.choices?.[0]?.message?.content ?? '')) as Partial<QuoteAccuracyResult>;
    if (typeof parsed.overallAccuracy !== 'number') throw new Error('Invalid shape');

    const result: QuoteAccuracyResult = {
      overallAccuracy: parsed.overallAccuracy ?? 0,
      overallBiasPercent: parsed.overallBiasPercent ?? 0,
      processBias: Array.isArray(parsed.processBias) ? parsed.processBias as ProcessBias[] : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions as AccuracySuggestion[] : [],
      summary: parsed.summary ?? '',
      summaryKo: parsed.summaryKo ?? parsed.summary ?? '',
      entriesAnalysed: parsed.entriesAnalysed ?? body.entries.length,
    };

    recordUsageEvent(planCheck.userId, 'quote_accuracy');
    recordAIHistory({ userId: planCheck.userId, feature: 'quote_accuracy', title: historyTitle, payload: result, context: historyContext, projectId: body.projectId });
    return NextResponse.json(result);
  } catch (err) {
    console.warn('[quote-accuracy] fallback:', err);
    recordUsageEvent(planCheck.userId, 'quote_accuracy');
    const fallback = ruleBasedResult(body);
    recordAIHistory({ userId: planCheck.userId, feature: 'quote_accuracy', title: historyTitle, payload: fallback, context: historyContext, projectId: body.projectId });
    return NextResponse.json(fallback);
  }
}
