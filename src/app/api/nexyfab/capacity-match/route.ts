/**
 * POST /api/nexyfab/capacity-match
 *
 * Phase 9-2 — Idle-capacity matcher (partner-side).
 * Matches partner's declared idle capacity + process profile against open RFQs
 * and generates auto-pitch emails per matched job.
 *
 * Freemium: free = Pro-only (-2), pro+ = unlimited.
 */

import { NextRequest, NextResponse } from 'next/server';

interface PartnerProfile {
  processes: string[];
  certifications?: string[];
  idleWindowDays: number;
  hourlyRateKrw?: number;
  leadCapacityDays?: number;
  company?: string;
}

interface OpenRfq {
  rfqId: string;
  projectName: string;
  process?: string;
  material?: string;
  quantity?: number;
  dfmScore?: number | null;
  certifications?: string[];
  deadlineDate?: string;
  budgetKrw?: number;
}

interface RequestBody {
  partner: PartnerProfile;
  openRfqs?: OpenRfq[];
  lang?: string;
  projectId?: string;
}

interface MatchedRfq {
  rfqId: string;
  projectName: string;
  matchScore: number;
  matchReasons: string[];
  matchReasonsKo: string[];
  estimatedMarginKrw: number | null;
  urgency: 'high' | 'medium' | 'low';
  urgencyKo: string;
  pitchSubject: string;
  pitchBody: string;
  pitchSubjectKo: string;
  pitchBodyKo: string;
}

interface CapacityMatchResult {
  matches: MatchedRfq[];
  summary: string;
  summaryKo: string;
  idleWindowDays: number;
  totalMatched: number;
}

function stripMarkdownJson(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

function daysTillDeadline(deadlineDate?: string): number | null {
  if (!deadlineDate) return null;
  const diff = new Date(deadlineDate).getTime() - Date.now();
  return Math.round(diff / 86400000);
}

function processMatch(partnerProcesses: string[], rfqProcess?: string): boolean {
  if (!rfqProcess) return true;
  const rfqLower = rfqProcess.toLowerCase();
  return partnerProcesses.some(p => rfqLower.includes(p.toLowerCase()) || p.toLowerCase().includes(rfqLower));
}

function certMatch(partnerCerts: string[], rfqCerts?: string[]): boolean {
  if (!rfqCerts || rfqCerts.length === 0) return true;
  const partnerLower = partnerCerts.map(c => c.toLowerCase());
  return rfqCerts.every(c => partnerLower.some(p => p.includes(c.toLowerCase()) || c.toLowerCase().includes(p)));
}

function ruleBasedResult(body: RequestBody): CapacityMatchResult {
  const { partner, openRfqs = [] } = body;
  const partnerCerts = partner.certifications ?? [];

  const matches: MatchedRfq[] = [];

  for (const rfq of openRfqs) {
    const matchReasons: string[] = [];
    const matchReasonsKo: string[] = [];
    let score = 0;

    // Process match (0-40)
    if (processMatch(partner.processes, rfq.process)) {
      score += 40;
      matchReasons.push(`Process match: ${rfq.process ?? 'flexible'}`);
      matchReasonsKo.push(`공정 일치: ${rfq.process ?? '유연'}`);
    } else {
      matchReasons.push('Process mismatch — may still quote');
      matchReasonsKo.push('공정 미일치 — 견적 가능 여부 확인 필요');
    }

    // Cert match (0-20)
    if (certMatch(partnerCerts, rfq.certifications)) {
      score += 20;
      if (rfq.certifications && rfq.certifications.length > 0) {
        matchReasons.push(`Certifications met: ${rfq.certifications.join(', ')}`);
        matchReasonsKo.push(`인증 요건 충족: ${rfq.certifications.join(', ')}`);
      }
    } else {
      score -= 10;
      matchReasons.push('Missing required certifications');
      matchReasonsKo.push('일부 인증 요건 미충족');
    }

    // DFM fit (0-20): higher DFM score = easier job
    if (rfq.dfmScore != null) {
      const dfmBonus = Math.round((rfq.dfmScore / 100) * 20);
      score += dfmBonus;
      if (rfq.dfmScore >= 75) {
        matchReasons.push(`High DFM score (${rfq.dfmScore}) — easy to manufacture`);
        matchReasonsKo.push(`DFM 점수 양호 (${rfq.dfmScore}) — 제조 난이도 낮음`);
      }
    }

    // Deadline urgency (0-20)
    const daysLeft = daysTillDeadline(rfq.deadlineDate);
    let urgency: MatchedRfq['urgency'] = 'low';
    let urgencyKo = '여유';
    if (daysLeft != null) {
      if (daysLeft <= 7) {
        urgency = 'high'; urgencyKo = '긴급';
        if (daysLeft <= (partner.leadCapacityDays ?? 14)) score += 20;
      } else if (daysLeft <= 21) {
        urgency = 'medium'; urgencyKo = '보통';
        score += 10;
      } else {
        score += 5;
      }
    }

    // Margin estimate
    let estimatedMarginKrw: number | null = null;
    if (rfq.budgetKrw && partner.hourlyRateKrw && partner.idleWindowDays) {
      const idleHours = partner.idleWindowDays * 8;
      const costEstimate = idleHours * partner.hourlyRateKrw;
      estimatedMarginKrw = Math.max(0, rfq.budgetKrw - costEstimate);
    }

    // Pitch email
    const company = partner.company ?? '저희 공장';
    const pitchSubject = `[NexyFab] Capacity Available — ${rfq.projectName}`;
    const pitchBody = [
      `Dear NexyFab Team,`,
      ``,
      `We currently have ${partner.idleWindowDays} idle production days available and would like to submit a capacity offer for "${rfq.projectName}" (RFQ: ${rfq.rfqId}).`,
      ``,
      `Our facilities specialise in: ${partner.processes.join(', ')}.`,
      partnerCerts.length ? `Certified to: ${partnerCerts.join(', ')}.` : '',
      rfq.dfmScore ? `We reviewed the part's DFM score (${rfq.dfmScore}/100) and are confident in manufacturability.` : '',
      ``,
      `We can begin immediately and deliver within ${partner.leadCapacityDays ?? 14} days.`,
      `Please let us know if you would like a formal quotation.`,
      ``,
      `Best regards,`,
      company,
    ].filter(l => l !== undefined && (l !== '' || true)).join('\n');

    const pitchSubjectKo = `[NexyFab] 유휴 캐파 활용 제안 — ${rfq.projectName}`;
    const pitchBodyKo = [
      `NexyFab 담당자님,`,
      ``,
      `현재 ${partner.idleWindowDays}일간 생산 여유 캐파가 있어 "${rfq.projectName}" (RFQ: ${rfq.rfqId}) 수주 의향을 전달드립니다.`,
      ``,
      `전문 공정: ${partner.processes.join(', ')}.`,
      partnerCerts.length ? `보유 인증: ${partnerCerts.join(', ')}.` : '',
      rfq.dfmScore ? `해당 부품의 DFM 점수(${rfq.dfmScore}/100)를 검토하였으며, 제조 가능성을 확인하였습니다.` : '',
      ``,
      `즉시 착수 가능하며, ${partner.leadCapacityDays ?? 14}일 이내 납품 가능합니다.`,
      `정식 견적서가 필요하신 경우 연락 주십시오.`,
      ``,
      `감사합니다,`,
      company,
    ].filter(l => l !== undefined && (l !== '' || true)).join('\n');

    matches.push({
      rfqId: rfq.rfqId,
      projectName: rfq.projectName,
      matchScore: Math.max(0, Math.min(100, score)),
      matchReasons,
      matchReasonsKo,
      estimatedMarginKrw,
      urgency,
      urgencyKo,
      pitchSubject,
      pitchBody,
      pitchSubjectKo,
      pitchBodyKo,
    });
  }

  matches.sort((a, b) => b.matchScore - a.matchScore);

  const topMatch = matches[0];
  const summary = matches.length === 0
    ? 'No open RFQs to match against. Check back when new RFQs are available.'
    : `${matches.length} RFQ(s) analysed. Top match: "${topMatch.projectName}" (score ${topMatch.matchScore}/100).`;
  const summaryKo = matches.length === 0
    ? '매칭할 오픈 RFQ가 없습니다. 새 RFQ가 등록되면 다시 확인하세요.'
    : `${matches.length}개 RFQ 분석 완료. 최적 매칭: "${topMatch.projectName}" (점수 ${topMatch.matchScore}/100).`;

  return {
    matches,
    summary,
    summaryKo,
    idleWindowDays: partner.idleWindowDays,
    totalMatched: matches.length,
  };
}

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'capacity_match');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'Capacity Match requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade for unlimited access.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!body.partner || !body.partner.processes || body.partner.processes.length === 0) {
    return NextResponse.json({ error: 'partner.processes is required' }, { status: 400 });
  }
  if (!body.partner.idleWindowDays || body.partner.idleWindowDays < 1) {
    return NextResponse.json({ error: 'partner.idleWindowDays must be >= 1' }, { status: 400 });
  }

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  const { recordAIHistory } = await import('@/lib/ai-history');

  const historyTitle = `캐파 매칭 — ${body.partner.processes.join('/')} · ${body.partner.idleWindowDays}일`;
  const historyContext = { processes: body.partner.processes, idleWindowDays: body.partner.idleWindowDays, rfqCount: body.openRfqs?.length ?? 0 };

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'capacity_match');
    const fallback = ruleBasedResult(body);
    recordAIHistory({ userId: planCheck.userId, feature: 'capacity_match', title: historyTitle, payload: fallback, context: historyContext, projectId: body.projectId });
    return NextResponse.json(fallback);
  }

  const systemPrompt =
    'You are a manufacturing capacity matchmaker. Given a partner profile (processes, certs, idle days, hourly rate) ' +
    'and a list of open RFQs, rank the RFQs by fit and generate a short pitch email per match. ' +
    'Return JSON: { matches: [{ rfqId, projectName, matchScore(0-100), matchReasons[], matchReasonsKo[], ' +
    'estimatedMarginKrw(null if unknown), urgency("high"|"medium"|"low"), urgencyKo, ' +
    'pitchSubject, pitchBody, pitchSubjectKo, pitchBodyKo }], ' +
    'summary(EN), summaryKo(KR), idleWindowDays, totalMatched }. ' +
    'Sort matches by matchScore descending. No markdown.';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ partner: body.partner, openRfqs: body.openRfqs ?? [], lang: body.lang ?? 'ko' }) },
        ],
        temperature: 0.25,
        max_tokens: 3000,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) throw new Error(`DeepSeek error: ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(stripMarkdownJson(data.choices?.[0]?.message?.content ?? '')) as Partial<CapacityMatchResult>;
    if (!Array.isArray(parsed.matches)) throw new Error('Invalid shape');

    const result: CapacityMatchResult = {
      matches: parsed.matches as MatchedRfq[],
      summary: parsed.summary ?? '',
      summaryKo: parsed.summaryKo ?? parsed.summary ?? '',
      idleWindowDays: body.partner.idleWindowDays,
      totalMatched: parsed.matches.length,
    };

    recordUsageEvent(planCheck.userId, 'capacity_match');
    recordAIHistory({ userId: planCheck.userId, feature: 'capacity_match', title: historyTitle, payload: result, context: historyContext, projectId: body.projectId });
    return NextResponse.json(result);
  } catch (err) {
    console.warn('[capacity-match] fallback:', err);
    recordUsageEvent(planCheck.userId, 'capacity_match');
    const fallback = ruleBasedResult(body);
    recordAIHistory({ userId: planCheck.userId, feature: 'capacity_match', title: historyTitle, payload: fallback, context: historyContext, projectId: body.projectId });
    return NextResponse.json(fallback);
  }
}
