/**
 * POST /api/nexyfab/rfq-writer
 *
 * Phase 7-1 — Auto RFQ Writer.
 * Given a design context (material/process/quantity/geometry) plus a target
 * supplier, generates a tailored RFQ email draft (subject + body in EN+KO)
 * that emphasizes the supplier's strengths and asks the right talking points.
 *
 * Freemium metric = 'rfq_writer' (free: 5/month, pro+: unlimited).
 */

import { NextRequest, NextResponse } from 'next/server';

interface SupplierBrief {
  id?: string;
  name?: string;
  nameKo?: string;
  region?: string;
  certifications?: string[];
  processes?: string[];
  rating?: number;
  minLeadTime?: number;
  maxLeadTime?: number;
}

interface RequestBody {
  supplier: SupplierBrief;
  partName?: string;
  material: string;
  process: string;
  quantity: number;
  /** Optional helpers for context */
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  tolerance?: string;
  surfaceFinish?: string;
  certificationsRequired?: string[];
  /** Talking points the user already has in mind */
  talkingPoints?: string[];
  /** 'formal' = 비즈니스 격식, 'concise' = 짧고 단도직입, 'collaborative' = 협력적 */
  tone?: 'formal' | 'concise' | 'collaborative';
  lang?: string;
  projectId?: string;
}

interface RfqDraft {
  subject: string;
  subjectKo: string;
  body: string;
  bodyKo: string;
  /** Bulleted list of questions/asks for negotiation. */
  asks: string[];
  asksKo: string[];
  /** Suggested 첨부 파일/도면/규격 체크리스트 */
  attachmentsChecklist: string[];
  attachmentsChecklistKo: string[];
}

function stripMarkdownJson(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

function ruleBasedDraft(body: RequestBody): RfqDraft {
  const supplierName = body.supplier.nameKo ?? body.supplier.name ?? 'Supplier';
  const partName = body.partName ?? 'Custom Part';
  const subject = `RFQ — ${partName} (${body.material}, qty ${body.quantity})`;
  const subjectKo = `견적 요청 — ${partName} (${body.material}, ${body.quantity}개)`;

  const baseBody =
    `Hello ${supplierName} team,\n\n` +
    `We are evaluating manufacturing partners for a ${body.process} part in ${body.material}.\n` +
    `Quantity: ${body.quantity} pcs.` +
    (body.volume_cm3 ? ` Approx. volume: ${Math.round(body.volume_cm3)} cm³.` : '') +
    (body.bbox ? ` Bounding box: ${body.bbox.w} × ${body.bbox.h} × ${body.bbox.d} mm.` : '') +
    (body.tolerance ? ` Tolerance: ${body.tolerance}.` : '') +
    (body.surfaceFinish ? ` Surface: ${body.surfaceFinish}.` : '') +
    `\n\nCould you confirm feasibility, lead time, and unit price?\n\n` +
    `Best regards.`;

  const baseBodyKo =
    `${supplierName} 담당자님 안녕하세요,\n\n` +
    `${body.material} 재질의 ${body.process} 부품 견적을 요청드립니다.\n` +
    `수량: ${body.quantity}개.` +
    (body.volume_cm3 ? ` 체적 약 ${Math.round(body.volume_cm3)} cm³.` : '') +
    (body.bbox ? ` 외형 ${body.bbox.w} × ${body.bbox.h} × ${body.bbox.d} mm.` : '') +
    (body.tolerance ? ` 공차 ${body.tolerance}.` : '') +
    (body.surfaceFinish ? ` 표면 처리 ${body.surfaceFinish}.` : '') +
    `\n\n생산 가능 여부, 납기, 단가 회신 부탁드립니다.\n\n` +
    `감사합니다.`;

  const asks = [
    `Unit price at ${body.quantity} pcs and at ${Math.max(1, Math.round(body.quantity / 10))} pcs for comparison.`,
    'Lead time including QC + shipping.',
    'Tooling/setup cost separately.',
    'Material certificate (if applicable).',
  ];
  const asksKo = [
    `${body.quantity}개 단가 및 ${Math.max(1, Math.round(body.quantity / 10))}개 비교 단가.`,
    '품질검사 및 배송 포함 납기.',
    '셋업/툴링 비용 별도 표기.',
    '재료 시험성적서 (해당 시).',
  ];

  const attachmentsChecklist = [
    'STEP / IGES file',
    '2D drawing with critical dimensions',
    'Tolerance and surface-finish callouts',
    'Quantity tier breakdown (1 / 10 / 100 / target)',
  ];
  const attachmentsChecklistKo = [
    'STEP / IGES 파일',
    '주요 치수 표기 2D 도면',
    '공차 및 표면처리 사양',
    '수량 단계별 견적 (1 / 10 / 100 / 목표)',
  ];

  return { subject, subjectKo, body: baseBody, bodyKo: baseBodyKo, asks, asksKo, attachmentsChecklist, attachmentsChecklistKo };
}

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'rfq_writer');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'RFQ Writer requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade for unlimited RFQ Writer.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!body.supplier || !body.material || !body.process || !body.quantity) {
    return NextResponse.json({ error: 'supplier, material, process, quantity are required' }, { status: 400 });
  }

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  const { recordAIHistory } = await import('@/lib/ai-history');

  const historyTitle = `${body.supplier.nameKo ?? body.supplier.name ?? 'Supplier'} — ${body.partName ?? 'Part'} × ${body.quantity}`;
  const historyContext = {
    supplierId: body.supplier.id,
    supplierName: body.supplier.name,
    material: body.material,
    process: body.process,
    quantity: body.quantity,
    tone: body.tone,
  };

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'rfq_writer');
    const fallback = ruleBasedDraft(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'rfq_writer',
      title: historyTitle,
      payload: fallback,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }

  const tone = body.tone ?? 'formal';
  const systemPrompt =
    'You write professional manufacturing RFQ (Request For Quotation) emails. ' +
    'Given a buyer-side design context and one target supplier, draft a single tailored RFQ email that ' +
    `(1) opens politely in the supplier's regional style, ` +
    `(2) summarizes the part (material, process, quantity, key geometry), ` +
    `(3) emphasizes 1-2 of the supplier's known strengths (certifications, lead time, processes), ` +
    `(4) asks specific feasibility / pricing / lead-time questions. ` +
    `Tone = ${tone}. ` +
    `Return JSON: { "subject", "subjectKo", "body", "bodyKo", "asks": string[], "asksKo": string[], ` +
    `"attachmentsChecklist": string[], "attachmentsChecklistKo": string[] }. ` +
    'Body length under 1200 characters. asks/checklist 4-6 items each. Do NOT wrap in markdown.';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({
            supplier: body.supplier,
            partName: body.partName,
            material: body.material,
            process: body.process,
            quantity: body.quantity,
            volume_cm3: body.volume_cm3,
            bbox: body.bbox,
            tolerance: body.tolerance,
            surfaceFinish: body.surfaceFinish,
            certificationsRequired: body.certificationsRequired,
            talkingPoints: body.talkingPoints,
            requestedLanguage: body.lang ?? 'en',
          }) },
        ],
        temperature: 0.5,
        max_tokens: 1800,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripMarkdownJson(content)) as Partial<RfqDraft>;

    if (!parsed.subject || !parsed.body) throw new Error('Invalid LLM response shape');

    const draft: RfqDraft = {
      subject: parsed.subject,
      subjectKo: parsed.subjectKo ?? parsed.subject,
      body: parsed.body,
      bodyKo: parsed.bodyKo ?? parsed.body,
      asks: Array.isArray(parsed.asks) ? parsed.asks.slice(0, 8) : [],
      asksKo: Array.isArray(parsed.asksKo) ? parsed.asksKo.slice(0, 8) : (Array.isArray(parsed.asks) ? parsed.asks.slice(0, 8) : []),
      attachmentsChecklist: Array.isArray(parsed.attachmentsChecklist) ? parsed.attachmentsChecklist.slice(0, 8) : [],
      attachmentsChecklistKo: Array.isArray(parsed.attachmentsChecklistKo)
        ? parsed.attachmentsChecklistKo.slice(0, 8)
        : (Array.isArray(parsed.attachmentsChecklist) ? parsed.attachmentsChecklist.slice(0, 8) : []),
    };

    recordUsageEvent(planCheck.userId, 'rfq_writer');
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'rfq_writer',
      title: historyTitle,
      payload: draft,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(draft);
  } catch (err) {
    console.warn('[rfq-writer] DeepSeek API call failed, using rule-based fallback:', err);
    recordUsageEvent(planCheck.userId, 'rfq_writer');
    const fallback = ruleBasedDraft(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'rfq_writer',
      title: historyTitle,
      payload: fallback,
      context: historyContext,
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }
}
