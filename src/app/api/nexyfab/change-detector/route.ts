/**
 * POST /api/nexyfab/change-detector
 *
 * Phase 9-1 — Design Change Detector (customer-side).
 * Compares two design revisions (spec objects, not raw STEP files — file diff
 * requires a CAD processing pipeline not yet available). Surfaces:
 *   - Which spec fields changed and their magnitude
 *   - Whether the change likely affects cost / lead time
 *   - Whether already-sent RFQs need to be re-issued
 *   - Suggested actions (re-RFQ, update DFM, notify supplier)
 *
 * Freemium: free = Pro-only (-2), pro+ = unlimited.
 */

import { NextRequest, NextResponse } from 'next/server';

interface DesignSpec {
  /** Rev label, e.g. "Rev A", "v2.1" */
  label?: string;
  material?: string;
  process?: string;
  quantity?: number;
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  tolerance?: string;
  surfaceFinish?: string;
  dfmScore?: number | null;
  certifications?: string[];
  note?: string;
}

interface ActiveRfq {
  rfqId: string;
  status: string;
  assignedFactory?: string;
}

interface RequestBody {
  prev: DesignSpec;
  next: DesignSpec;
  activeRfqs?: ActiveRfq[];
  lang?: string;
  projectId?: string;
}

interface SpecDiff {
  field: string;
  fieldKo: string;
  prev: string;
  next: string;
  impact: 'high' | 'medium' | 'low';
  impactKo: string;
}

interface ChangeDetectorResult {
  diffs: SpecDiff[];
  costImpact: 'increase' | 'decrease' | 'neutral' | 'unknown';
  costImpactKo: string;
  leadImpact: 'increase' | 'decrease' | 'neutral' | 'unknown';
  leadImpactKo: string;
  reRfqRequired: boolean;
  reRfqReason: string;
  reRfqReasonKo: string;
  actions: string[];
  actionsKo: string[];
  summary: string;
  summaryKo: string;
  affectedRfqs: string[];
}

const FIELD_META: Record<string, { ko: string; impact: SpecDiff['impact'] }> = {
  material:      { ko: '재질',       impact: 'high'   },
  process:       { ko: '공정',       impact: 'high'   },
  quantity:      { ko: '수량',       impact: 'medium' },
  volume_cm3:    { ko: '체적(cm³)',  impact: 'high'   },
  tolerance:     { ko: '공차',       impact: 'high'   },
  surfaceFinish: { ko: '표면처리',   impact: 'medium' },
  dfmScore:      { ko: 'DFM 점수',  impact: 'medium' },
  certifications:{ ko: '인증 요건', impact: 'high'   },
  bbox:          { ko: '외형 치수',  impact: 'medium' },
};

function stripMarkdownJson(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

function bboxStr(b?: { w: number; h: number; d: number }): string {
  return b ? `${b.w}×${b.h}×${b.d}mm` : '—';
}

function certStr(c?: string[]): string {
  return c && c.length ? c.join(', ') : '없음';
}

function ruleBasedResult(body: RequestBody): ChangeDetectorResult {
  const { prev, next, activeRfqs = [] } = body;
  const diffs: SpecDiff[] = [];

  const compare = (field: keyof DesignSpec, prevVal: unknown, nextVal: unknown, prevStr: string, nextStr: string) => {
    if (prevStr === nextStr) return;
    const meta = FIELD_META[field] ?? { ko: field, impact: 'low' as const };
    diffs.push({
      field, fieldKo: meta.ko,
      prev: prevStr, next: nextStr,
      impact: meta.impact,
      impactKo: meta.impact === 'high' ? '높음' : meta.impact === 'medium' ? '보통' : '낮음',
    });
  };

  compare('material',      prev.material,      next.material,      prev.material ?? '—',      next.material ?? '—');
  compare('process',       prev.process,       next.process,       prev.process ?? '—',       next.process ?? '—');
  compare('tolerance',     prev.tolerance,     next.tolerance,     prev.tolerance ?? '—',     next.tolerance ?? '—');
  compare('surfaceFinish', prev.surfaceFinish, next.surfaceFinish, prev.surfaceFinish ?? '—', next.surfaceFinish ?? '—');
  compare('quantity',      prev.quantity,      next.quantity,      String(prev.quantity ?? '—'), String(next.quantity ?? '—'));
  compare('volume_cm3',    prev.volume_cm3,    next.volume_cm3,    prev.volume_cm3 != null ? `${prev.volume_cm3.toFixed(1)} cm³` : '—', next.volume_cm3 != null ? `${next.volume_cm3.toFixed(1)} cm³` : '—');
  compare('bbox',          JSON.stringify(prev.bbox), JSON.stringify(next.bbox), bboxStr(prev.bbox ?? undefined), bboxStr(next.bbox ?? undefined));
  compare('dfmScore',      prev.dfmScore,      next.dfmScore,      prev.dfmScore != null ? String(prev.dfmScore) : '—', next.dfmScore != null ? String(next.dfmScore) : '—');
  compare('certifications', JSON.stringify(prev.certifications), JSON.stringify(next.certifications), certStr(prev.certifications), certStr(next.certifications));

  const highDiffs = diffs.filter(d => d.impact === 'high');
  const hasHighImpact = highDiffs.length > 0;

  // Cost impact heuristic
  type CostImpact = ChangeDetectorResult['costImpact'];
  type LeadImpact = ChangeDetectorResult['leadImpact'];
  let costImpact: CostImpact = 'neutral';
  if (diffs.some(d => d.field === 'material') || diffs.some(d => d.field === 'tolerance') || diffs.some(d => d.field === 'process')) {
    costImpact = 'increase';
  } else if (next.quantity && prev.quantity && next.quantity > prev.quantity) {
    costImpact = 'decrease';
  } else if (diffs.length > 0) {
    costImpact = 'unknown';
  }

  let leadImpact: LeadImpact = 'neutral';
  if (diffs.some(d => d.field === 'process') || diffs.some(d => d.field === 'certifications')) {
    leadImpact = 'increase';
  } else if (next.quantity && prev.quantity && next.quantity > prev.quantity * 1.5) {
    leadImpact = 'increase';
  }

  const impactKoMap: Record<string, string> = { increase: '증가 예상', decrease: '감소/단축 가능', neutral: '변화 없음', unknown: '불확실' };
  const costImpactKo = `비용 ${impactKoMap[costImpact] ?? ''}`;
  const leadImpactKo = `납기 ${impactKoMap[leadImpact] ?? ''}`;

  const reRfqRequired = hasHighImpact || diffs.length >= 3;
  const affectedRfqs = activeRfqs
    .filter(r => r.status === 'pending' || r.status === 'assigned' || r.status === 'quoted')
    .map(r => r.rfqId);

  const reRfqReason = reRfqRequired
    ? `${highDiffs.length} high-impact change(s) detected (${highDiffs.map(d => d.field).join(', ')}). Active RFQ pricing is no longer valid.`
    : diffs.length === 0
    ? 'No spec changes detected — existing RFQs remain valid.'
    : 'Minor changes only — consider notifying suppliers but re-RFQ may not be required.';
  const reRfqReasonKo = reRfqRequired
    ? `${highDiffs.length}개의 주요 변경 감지 (${highDiffs.map(d => d.fieldKo).join(', ')}). 기존 RFQ 견적가가 무효화됩니다.`
    : diffs.length === 0
    ? '사양 변경 없음 — 기존 RFQ 유효.'
    : '경미한 변경 — 공급사 통보를 고려하되 재발송은 선택사항.';

  const actions: string[] = [];
  const actionsKo: string[] = [];
  if (reRfqRequired && affectedRfqs.length > 0) {
    actions.push(`Re-issue RFQ to ${affectedRfqs.length} active supplier(s).`);
    actionsKo.push(`활성 공급사 ${affectedRfqs.length}곳에 RFQ 재발송.`);
  }
  if (diffs.some(d => d.field === 'material' || d.field === 'process')) {
    actions.push('Re-run DFM analysis on new design.');
    actionsKo.push('변경된 설계로 DFM 분석 재실행.');
  }
  if (diffs.some(d => d.field === 'certifications')) {
    actions.push('Run Cert Filter with updated certification requirements.');
    actionsKo.push('변경된 인증 요건으로 인증 필터 재실행.');
  }
  if (diffs.length > 0 && !reRfqRequired) {
    actions.push('Notify assigned suppliers of minor spec update.');
    actionsKo.push('배정된 공급사에 경미한 사양 변경 통보.');
  }
  if (actions.length === 0 && diffs.length === 0) {
    actions.push('No action required.');
    actionsKo.push('조치 불필요.');
  }

  const summary = diffs.length === 0
    ? 'No changes detected between revisions.'
    : `${diffs.length} change(s) detected. ${reRfqRequired ? 'Re-RFQ recommended.' : 'Minor update — notify suppliers.'}`;
  const summaryKo = diffs.length === 0
    ? '두 리비전 간 변경 없음.'
    : `${diffs.length}개 변경 감지. ${reRfqRequired ? '재견적 요청 권장.' : '경미한 변경 — 공급사 통보 권장.'}`;

  return { diffs, costImpact, costImpactKo, leadImpact, leadImpactKo, reRfqRequired, reRfqReason, reRfqReasonKo, actions, actionsKo, summary, summaryKo, affectedRfqs };
}

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'change_detector');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'Change Detector requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade for unlimited access.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!body.prev || !body.next) {
    return NextResponse.json({ error: 'prev and next design specs are required' }, { status: 400 });
  }

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  const { recordAIHistory } = await import('@/lib/ai-history');

  const historyTitle = `${body.prev.label ?? 'Rev A'} → ${body.next.label ?? 'Rev B'}`;
  const historyContext = { prevLabel: body.prev.label, nextLabel: body.next.label, activeRfqs: body.activeRfqs?.length };

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'change_detector');
    const fallback = ruleBasedResult(body);
    recordAIHistory({ userId: planCheck.userId, feature: 'change_detector', title: historyTitle, payload: fallback, context: historyContext, projectId: body.projectId });
    return NextResponse.json(fallback);
  }

  const systemPrompt =
    'You analyze manufacturing design spec changes between two revisions. ' +
    'Given prev and next spec objects, return JSON: { ' +
    '"diffs": [{field, fieldKo, prev, next, impact("high"|"medium"|"low"), impactKo}], ' +
    '"costImpact": "increase"|"decrease"|"neutral"|"unknown", "costImpactKo", ' +
    '"leadImpact": "increase"|"decrease"|"neutral"|"unknown", "leadImpactKo", ' +
    '"reRfqRequired": boolean, "reRfqReason"(EN), "reRfqReasonKo"(KR), ' +
    '"actions": string[], "actionsKo": string[], ' +
    '"summary"(EN), "summaryKo"(KR), "affectedRfqs": string[] }. ' +
    'Be concise and focus on manufacturing impact. No markdown.';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ prev: body.prev, next: body.next, activeRfqs: body.activeRfqs, lang: body.lang ?? 'ko' }) },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`DeepSeek error: ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(stripMarkdownJson(data.choices?.[0]?.message?.content ?? '')) as Partial<ChangeDetectorResult>;
    if (!parsed.diffs) throw new Error('Invalid shape');

    const result: ChangeDetectorResult = {
      diffs: Array.isArray(parsed.diffs) ? parsed.diffs as SpecDiff[] : [],
      costImpact: parsed.costImpact ?? 'unknown',
      costImpactKo: parsed.costImpactKo ?? '',
      leadImpact: parsed.leadImpact ?? 'unknown',
      leadImpactKo: parsed.leadImpactKo ?? '',
      reRfqRequired: parsed.reRfqRequired ?? false,
      reRfqReason: parsed.reRfqReason ?? '',
      reRfqReasonKo: parsed.reRfqReasonKo ?? parsed.reRfqReason ?? '',
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      actionsKo: Array.isArray(parsed.actionsKo) ? parsed.actionsKo : [],
      summary: parsed.summary ?? '',
      summaryKo: parsed.summaryKo ?? parsed.summary ?? '',
      affectedRfqs: Array.isArray(parsed.affectedRfqs) ? parsed.affectedRfqs : [],
    };

    recordUsageEvent(planCheck.userId, 'change_detector');
    recordAIHistory({ userId: planCheck.userId, feature: 'change_detector', title: historyTitle, payload: result, context: historyContext, projectId: body.projectId });
    return NextResponse.json(result);
  } catch (err) {
    console.warn('[change-detector] fallback:', err);
    recordUsageEvent(planCheck.userId, 'change_detector');
    const fallback = ruleBasedResult(body);
    recordAIHistory({ userId: planCheck.userId, feature: 'change_detector', title: historyTitle, payload: fallback, context: historyContext, projectId: body.projectId });
    return NextResponse.json(fallback);
  }
}
