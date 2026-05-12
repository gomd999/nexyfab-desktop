/**
 * POST /api/nexyfab/cert-filter
 *
 * Phase 7-2 — Certifications & Regulations Filter.
 * Given an industry (medical, aerospace, automotive, food, etc.) plus optional
 * region (KR / US / EU) and intended use, returns the certifications most
 * commonly required and a short explanation per cert. The client uses the
 * returned list to filter the manufacturers panel.
 *
 * Freemium metric = 'cert_filter' (free: 10/month, pro+: unlimited).
 */

import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { getPrompt } from '@/lib/ai/prompts';
import { recordPromptCall, classifyAiError } from '@/lib/ai/telemetry';

interface RequestBody {
  industry: string;
  region?: 'KR' | 'US' | 'EU' | 'global';
  useCase?: string;
  material?: string;
  process?: string;
  /** Currently-selected suppliers to score against (optional, for ranking). */
  suppliers?: Array<{ id?: string; certifications?: string[] }>;
  lang?: string;
  projectId?: string;
}

interface CertEntry {
  code: string;
  name: string;
  nameKo: string;
  required: boolean;
  reason: string;
  reasonKo: string;
  region?: string;
}

interface CertFilterResponse {
  industry: string;
  required: CertEntry[];
  recommended: CertEntry[];
  /** Optional supplier scoring: how many required certs each supplier has. */
  supplierScores?: Array<{ id?: string; have: string[]; missing: string[]; score: number }>;
  summary: string;
  summaryKo: string;
}

function stripMarkdownJson(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

// ─── Rule-based fallback ──────────────────────────────────────────────────

const INDUSTRY_CERT_MAP: Record<string, { required: CertEntry[]; recommended: CertEntry[] }> = {
  medical: {
    required: [
      { code: 'ISO_13485',  name: 'ISO 13485',  nameKo: 'ISO 13485',  required: true,  reason: 'Medical device QMS — globally required.', reasonKo: '의료기기 품질경영시스템 — 전세계 공통 필수.' },
      { code: 'FDA_21CFR820', name: 'FDA 21 CFR 820', nameKo: 'FDA 21 CFR 820', required: true, reason: 'US Quality System Regulation for medical devices.', reasonKo: '미국 의료기기 품질시스템 규정.', region: 'US' },
    ],
    recommended: [
      { code: 'ISO_14971', name: 'ISO 14971', nameKo: 'ISO 14971', required: false, reason: 'Risk management for medical devices.', reasonKo: '의료기기 위험관리.' },
      { code: 'CE_MDR',    name: 'CE / MDR',  nameKo: 'CE / MDR',  required: false, reason: 'EU Medical Device Regulation marking.', reasonKo: '유럽 MDR 인증.', region: 'EU' },
    ],
  },
  aerospace: {
    required: [
      { code: 'AS9100',     name: 'AS9100',     nameKo: 'AS9100',     required: true,  reason: 'Aerospace QMS — required by every airframer.', reasonKo: '항공우주 품질경영 — 모든 항공기 제조사 필수.' },
      { code: 'NADCAP',     name: 'NADCAP',     nameKo: 'NADCAP',     required: true,  reason: 'Special-process accreditation (heat treat, NDT, welding, etc.).', reasonKo: '특수공정(열처리·비파괴검사·용접 등) 인증.' },
    ],
    recommended: [
      { code: 'ITAR',       name: 'ITAR',       nameKo: 'ITAR',       required: false, reason: 'Required for US defense parts.', reasonKo: '미국 방위 부품에 필수.', region: 'US' },
      { code: 'ISO_9001',   name: 'ISO 9001',   nameKo: 'ISO 9001',   required: false, reason: 'Foundational QMS.', reasonKo: '기본 품질경영.' },
    ],
  },
  automotive: {
    required: [
      { code: 'IATF_16949', name: 'IATF 16949', nameKo: 'IATF 16949', required: true,  reason: 'Automotive QMS — Tier 1/2 supplier baseline.', reasonKo: '자동차 품질경영 — 1/2차 협력사 기본요건.' },
    ],
    recommended: [
      { code: 'ISO_9001',   name: 'ISO 9001',   nameKo: 'ISO 9001',   required: false, reason: 'Often a stepping stone for IATF.', reasonKo: 'IATF 진입을 위한 기반.' },
      { code: 'PPAP',       name: 'PPAP',       nameKo: 'PPAP',       required: false, reason: 'Production Part Approval Process — OEM submission.', reasonKo: '양산 부품 승인 절차.' },
      { code: 'IMDS',       name: 'IMDS',       nameKo: 'IMDS',       required: false, reason: 'Material data reporting required by most OEMs.', reasonKo: '재료 데이터 보고 — 대부분 OEM 요구.' },
    ],
  },
  food: {
    required: [
      { code: 'FDA_21CFR177', name: 'FDA 21 CFR 177', nameKo: 'FDA 21 CFR 177', required: true, reason: 'Food-contact polymer compliance (US).', reasonKo: '미국 식품 접촉 고분자 적합성.', region: 'US' },
      { code: 'EU_10_2011',   name: 'EU 10/2011',     nameKo: 'EU 10/2011',     required: true, reason: 'EU food-contact plastics regulation.', reasonKo: '유럽 식품 접촉 플라스틱 규정.', region: 'EU' },
    ],
    recommended: [
      { code: 'NSF',         name: 'NSF',          nameKo: 'NSF',         required: false, reason: 'Drinking-water and food equipment certification.', reasonKo: '음용수 및 식품 설비 인증.' },
      { code: 'ISO_22000',   name: 'ISO 22000',    nameKo: 'ISO 22000',   required: false, reason: 'Food safety management system.', reasonKo: '식품안전 경영시스템.' },
    ],
  },
  general: {
    required: [
      { code: 'ISO_9001', name: 'ISO 9001', nameKo: 'ISO 9001', required: true, reason: 'Baseline quality management — buyer expectation.', reasonKo: '기본 품질경영 — 구매자 기본 요구.' },
    ],
    recommended: [
      { code: 'ISO_14001', name: 'ISO 14001', nameKo: 'ISO 14001', required: false, reason: 'Environmental management — increasingly required.', reasonKo: '환경경영 — 점점 더 요구되는 추세.' },
    ],
  },
};

function ruleBasedCerts(body: RequestBody): CertFilterResponse {
  const key = body.industry.toLowerCase();
  const entry = INDUSTRY_CERT_MAP[key] ?? INDUSTRY_CERT_MAP.general;
  const required = entry.required;
  const recommended = entry.recommended;

  const _requiredCodes = new Set(required.map(c => c.code));
  const supplierScores = body.suppliers?.map(s => {
    const certs = (s.certifications ?? []).map(c => c.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
    const have = required.filter(r => certs.some(c => c.includes(r.code.replace(/_/g, '')) || c === r.code)).map(r => r.code);
    const missing = required.filter(r => !have.includes(r.code)).map(r => r.code);
    const score = required.length === 0 ? 100 : Math.round((have.length / required.length) * 100);
    return { id: s.id, have, missing, score };
  });

  return {
    industry: body.industry,
    required,
    recommended,
    supplierScores,
    summary: `For ${body.industry} parts, focus on ${required.map(r => r.code).join(', ') || 'baseline ISO 9001'}.`,
    summaryKo: `${body.industry} 부품의 경우 ${required.map(r => r.nameKo).join(', ') || '기본 ISO 9001'} 인증을 우선 확인하세요.`,
  };
}

// ─── POST handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'cert_filter');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'Cert Filter requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade for unlimited Cert Filter.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!body.industry) {
    return NextResponse.json({ error: 'industry is required' }, { status: 400 });
  }

  const { recordAIHistory } = await import('@/lib/ai-history');

  const historyTitle = `${body.industry}${body.region ? ` (${body.region})` : ''} — ${body.useCase ?? 'general'}`;
  const historyContext = {
    industry: body.industry,
    region: body.region,
    useCase: body.useCase,
    material: body.material,
    process: body.process,
  };

  const prompt = getPrompt('cert-filter');
  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.template },
    { role: 'user', content: JSON.stringify({
      industry: body.industry,
      region: body.region,
      useCase: body.useCase,
      material: body.material,
      process: body.process,
      suppliers: body.suppliers?.slice(0, 20),
      requestedLanguage: body.lang ?? 'en',
    }) },
  ];

  let content = '';
  try {
    const result = await chatCompletion({
      messages,
      maxTokens: prompt.defaults.maxTokens,
      temperature: prompt.defaults.temperature,
      timeoutMs: prompt.defaults.timeoutMs,
      task: prompt.id,
    });
    content = result.text;
    recordPromptCall({
      userId: planCheck.userId,
      promptId: prompt.id,
      promptVersion: prompt.version,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      success: true,
    });
  } catch (e) {
    recordPromptCall({
      userId: planCheck.userId,
      promptId: prompt.id,
      promptVersion: prompt.version,
      provider: e instanceof AiProviderError ? e.provider : 'unknown',
      model: 'unknown',
      latencyMs: 0,
      success: false,
      errorClass: classifyAiError(e),
    });
    if (e instanceof AiNotConfiguredError) {
      recordUsageEvent(planCheck.userId, 'cert_filter');
      const fallback = ruleBasedCerts(body);
      recordAIHistory({
        userId: planCheck.userId,
        feature: 'cert_filter',
        title: historyTitle,
        payload: fallback,
        context: historyContext,
        projectId: body.projectId,
      });
      return NextResponse.json(fallback);
    }
    const detail = e instanceof AiProviderError
      ? `${e.provider}${e.status ? ` (${e.status})` : ''}: ${e.message}`
      : (e instanceof Error ? e.message : String(e));
    console.warn('[cert-filter] AI provider failed, using rule-based fallback:', detail);
    recordUsageEvent(planCheck.userId, 'cert_filter');
    const fallback = ruleBasedCerts(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'cert_filter',
      title: historyTitle,
      payload: fallback,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }

  try {
    const parsed = JSON.parse(stripMarkdownJson(content)) as Partial<CertFilterResponse>;

    if (!Array.isArray(parsed.required) && !Array.isArray(parsed.recommended)) {
      throw new Error('Invalid LLM response shape');
    }

    const cleaned: CertFilterResponse = {
      industry: parsed.industry ?? body.industry,
      required: (parsed.required ?? []).slice(0, 12).map(r => ({
        code: r.code ?? 'UNKNOWN',
        name: r.name ?? r.code ?? 'Unknown',
        nameKo: r.nameKo ?? r.name ?? r.code ?? 'Unknown',
        required: true,
        reason: r.reason ?? '',
        reasonKo: r.reasonKo ?? r.reason ?? '',
        region: r.region,
      })),
      recommended: (parsed.recommended ?? []).slice(0, 12).map(r => ({
        code: r.code ?? 'UNKNOWN',
        name: r.name ?? r.code ?? 'Unknown',
        nameKo: r.nameKo ?? r.name ?? r.code ?? 'Unknown',
        required: false,
        reason: r.reason ?? '',
        reasonKo: r.reasonKo ?? r.reason ?? '',
        region: r.region,
      })),
      supplierScores: parsed.supplierScores,
      summary: parsed.summary ?? '',
      summaryKo: parsed.summaryKo ?? parsed.summary ?? '',
    };

    recordUsageEvent(planCheck.userId, 'cert_filter');
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'cert_filter',
      title: historyTitle,
      payload: cleaned,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(cleaned);
  } catch (err) {
    console.warn('[cert-filter] AI response parse failed, using rule-based fallback:', err);
    recordUsageEvent(planCheck.userId, 'cert_filter');
    const fallback = ruleBasedCerts(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'cert_filter',
      title: historyTitle,
      payload: fallback,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }
}
