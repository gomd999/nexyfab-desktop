/**
 * POST /api/nexyfab/cost-copilot
 *
 * Design-for-Cost Copilot (Phase 4) — conversational "reduce cost by X%" or
 * "cut lead time by half" style queries. Given the current design state
 * (params, material, process, quantity) and a natural-language request, asks
 * the LLM to return 1-4 concrete change suggestions. Each suggestion can
 * include a parameter delta, a material swap, or a process swap. The client
 * then runs the actual cost math via estimateCosts() for each suggestion.
 *
 * Freemium: metric = 'cost_copilot' (free: 5/month, pro+: unlimited).
 */

import { NextRequest, NextResponse } from 'next/server';

// ─── Types ─────────────────────────────────────────────────────────────────

interface RequestBody {
  userMessage: string;
  params: Record<string, number>;
  materialId: string;
  process: string;
  quantity: number;
  lang?: string;
  /** Optional prior turns to give LLM context. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Optional project link for history filtering. */
  projectId?: string;
}

interface CopilotSuggestion {
  id: string;
  title: string;
  titleKo: string;
  rationale: string;
  rationaleKo: string;
  /** Parameter deltas to apply (e.g. { wallThickness: +0.5 }) */
  paramDeltas?: Record<string, number>;
  /** Swap to this material id (from MATERIAL_PRESETS) */
  materialSwap?: string;
  /** Swap to this process id */
  processSwap?: string;
  /** Rough expected savings percent (-100..+100; negative = increase) */
  estimatedSavingsPercent: number;
  /** Tradeoff caveat, if any */
  caveat?: string;
  caveatKo?: string;
}

interface CopilotResponse {
  reply: string;
  replyKo: string;
  suggestions: CopilotSuggestion[];
}

// ─── Rule-based fallback ───────────────────────────────────────────────────

const LOWER_COST_MATERIAL_BY_CLASS: Record<string, string> = {
  titanium: 'aluminum',
  copper: 'aluminum',
  gold: 'aluminum',
  steel: 'aluminum',
  abs_white: 'abs_black',
  nylon: 'abs_white',
  ceramic: 'abs_white',
};

const FASTER_PROCESS: Record<string, string> = {
  injection_molding: '3d_printing',
  casting: 'cnc_milling',
  cnc_turning: '3d_printing',
  sheet_metal: 'cnc_milling',
};

function ruleBasedSuggest(body: RequestBody): CopilotResponse {
  const text = body.userMessage.toLowerCase();
  const suggestions: CopilotSuggestion[] = [];

  const wantsCost = /cost|cheap|saving|절감|싸|비용|저렴/.test(text);
  const wantsSpeed = /fast|speed|lead.?time|빨리|납기|속도/.test(text);
  const wantsQuality = /quality|stronger|strength|품질|강도|튼튼/.test(text);

  // Target savings parse — default 15% if not specified
  const pctMatch = text.match(/(\d{1,2})\s*%/);
  const targetPct = pctMatch ? Math.min(80, parseInt(pctMatch[1]!, 10)) : 15;

  // 1. Wall thickness / thickness trim
  const thinableKey = Object.keys(body.params).find(k => /thickness|wall/i.test(k));
  if (thinableKey && wantsCost) {
    const cur = body.params[thinableKey] ?? 0;
    if (cur > 2) {
      suggestions.push({
        id: 'thin-wall',
        title: `Reduce ${thinableKey} by 0.5mm`,
        titleKo: `${thinableKey}을(를) 0.5mm 축소`,
        rationale: `Thinner walls cut material volume — biggest lever when ${body.materialId} is the bulk cost.`,
        rationaleKo: `벽이 얇을수록 재료 체적이 감소 — ${body.materialId} 재료비 비중이 클 때 효과가 가장 큽니다.`,
        paramDeltas: { [thinableKey]: -0.5 },
        estimatedSavingsPercent: 8,
        caveat: 'Check DFM minimum wall for your process before applying.',
        caveatKo: '적용 전 해당 공정의 최소 벽 두께를 확인하세요.',
      });
    }
  }

  // 2. Material swap
  const swapTo = LOWER_COST_MATERIAL_BY_CLASS[body.materialId];
  if (swapTo && wantsCost) {
    suggestions.push({
      id: 'material-swap',
      title: `Switch material to ${swapTo}`,
      titleKo: `재료를 ${swapTo}(으)로 변경`,
      rationale: `${swapTo} has materially lower per-cm³ cost than ${body.materialId} while covering most non-critical applications.`,
      rationaleKo: `${swapTo}은(는) ${body.materialId} 대비 단위 체적당 비용이 크게 낮고 대부분의 비임계 용도에 사용 가능합니다.`,
      materialSwap: swapTo,
      estimatedSavingsPercent: 25,
      caveat: 'Mechanical properties differ — verify load-bearing requirements first.',
      caveatKo: '기계적 물성이 달라지므로 하중 요구사항을 먼저 검증하세요.',
    });
  }

  // 3. Process swap for speed
  const fasterProc = FASTER_PROCESS[body.process];
  if (fasterProc && (wantsSpeed || (!wantsCost && !wantsQuality))) {
    suggestions.push({
      id: 'process-swap',
      title: `Switch process to ${fasterProc}`,
      titleKo: `공정을 ${fasterProc}(으)로 변경`,
      rationale: `${fasterProc} skips tooling steps — typically ${body.quantity < 50 ? '50-70% faster' : 'faster for prototypes but less economical at scale'}.`,
      rationaleKo: `${fasterProc}은(는) 공구/금형 단계를 건너뛰어 ${body.quantity < 50 ? '50~70% 빠르지만' : '시제품에 유리, 양산엔 불리'}.`,
      processSwap: fasterProc,
      estimatedSavingsPercent: body.quantity < 50 ? 20 : -10,
      caveat: 'Surface finish & tolerances may downgrade slightly.',
      caveatKo: '표면 마감과 공차가 다소 저하될 수 있습니다.',
    });
  }

  // 4. Quantity leverage
  if (wantsCost && body.quantity < 100) {
    suggestions.push({
      id: 'qty-leverage',
      title: `Consolidate to qty ${Math.max(100, body.quantity * 5)}`,
      titleKo: `수량을 ${Math.max(100, body.quantity * 5)}개로 통합`,
      rationale: `Setup & tooling cost amortize across units — typical volume discount kicks in above 100pc for ${body.process}.`,
      rationaleKo: `셋업·공구비는 수량에 반비례 — ${body.process}에서 100개 이상부터 할인 구간에 진입합니다.`,
      estimatedSavingsPercent: 30,
      caveat: 'Only useful if demand actually exists for the higher volume.',
      caveatKo: '수량 증가에 실제 수요가 있을 때만 유효합니다.',
    });
  }

  // Fallback if no specific intent parsed
  if (suggestions.length === 0) {
    suggestions.push({
      id: 'generic',
      title: 'Share a goal like "cut cost by 20%" or "faster lead time"',
      titleKo: '"비용 20% 절감" 또는 "납기 단축" 같은 목표를 알려주세요',
      rationale: 'Specific goals let the copilot target material, wall, or process levers precisely.',
      rationaleKo: '구체적인 목표가 있으면 재료·두께·공정 레버를 정확히 조정할 수 있습니다.',
      estimatedSavingsPercent: 0,
    });
  }

  const replyBase = wantsCost
    ? `Here are ${suggestions.length} levers to target ~${targetPct}% cost savings:`
    : wantsSpeed
      ? `Lead-time levers — try these:`
      : `Considered your request. Here are some options:`;
  const replyKoBase = wantsCost
    ? `약 ${targetPct}% 비용 절감을 위한 ${suggestions.length}가지 레버입니다:`
    : wantsSpeed
      ? `납기 단축을 위한 옵션입니다:`
      : `요청을 검토한 결과 옵션은 다음과 같습니다:`;

  return { reply: replyBase, replyKo: replyKoBase, suggestions };
}

function stripMarkdownJson(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ─── POST handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'cost_copilot');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'Cost Copilot requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade to Pro for unlimited Cost Copilot.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as RequestBody;
  if (!body.userMessage || !body.materialId || !body.process) {
    return NextResponse.json({ error: 'userMessage, materialId, and process are required' }, { status: 400 });
  }

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

  const { recordAIHistory } = await import('@/lib/ai-history');

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'cost_copilot');
    const fallback = ruleBasedSuggest(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'cost_copilot',
      title: body.userMessage.slice(0, 120),
      payload: fallback,
      context: { params: body.params, materialId: body.materialId, process: body.process, quantity: body.quantity },
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }

  const systemPrompt =
    'You are a Design-for-Cost expert for CNC, injection, sheet-metal, casting, and 3D-printing parts. ' +
    'The user gives you the current design state (params, material, process, quantity) plus a goal in natural language. ' +
    'Return 1-4 concrete change suggestions that move toward their goal. For each suggestion choose the right lever: ' +
    '(a) parameter deltas (paramDeltas, numeric adds/subtracts), (b) material swap (materialSwap = material id), ' +
    '(c) process swap (processSwap = process id). Available material ids: aluminum, steel, titanium, copper, gold, ' +
    'abs_white, abs_black, nylon, glass, rubber, wood, ceramic. Available process ids: cnc_milling, cnc_turning, ' +
    'injection_molding, sheet_metal, casting, 3d_printing. Include estimatedSavingsPercent (negative = increase) ' +
    'and a tradeoff caveat. Also give a short top-level reply (en+ko). ' +
    'Respond with JSON: { "reply", "replyKo", "suggestions": [ { "id", "title", "titleKo", "rationale", "rationaleKo", ' +
    '"paramDeltas"?, "materialSwap"?, "processSwap"?, "estimatedSavingsPercent", "caveat"?, "caveatKo"? } ] }. ' +
    'Keep text fields under 180 characters. Do NOT wrap JSON in markdown.';

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
          ...(body.history ?? []).slice(-6),
          { role: 'user', content: JSON.stringify({
            userMessage: body.userMessage,
            currentState: {
              params: body.params,
              materialId: body.materialId,
              process: body.process,
              quantity: body.quantity,
            },
            requestedLanguage: body.lang ?? 'en',
          }) },
        ],
        temperature: 0.4,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripMarkdownJson(content)) as Partial<CopilotResponse>;

    if (!parsed.reply || !Array.isArray(parsed.suggestions)) throw new Error('Invalid LLM response shape');

    const reply: CopilotResponse = {
      reply: parsed.reply,
      replyKo: parsed.replyKo ?? parsed.reply,
      suggestions: parsed.suggestions.slice(0, 4).map((s, idx) => {
        const ss = s as Partial<CopilotSuggestion>;
        return {
          id: ss.id ?? `s-${idx}`,
          title: ss.title ?? '',
          titleKo: ss.titleKo ?? ss.title ?? '',
          rationale: ss.rationale ?? '',
          rationaleKo: ss.rationaleKo ?? ss.rationale ?? '',
          paramDeltas: ss.paramDeltas && typeof ss.paramDeltas === 'object'
            ? Object.fromEntries(Object.entries(ss.paramDeltas).filter(([, v]) => typeof v === 'number')) as Record<string, number>
            : undefined,
          materialSwap: typeof ss.materialSwap === 'string' ? ss.materialSwap : undefined,
          processSwap: typeof ss.processSwap === 'string' ? ss.processSwap : undefined,
          estimatedSavingsPercent: typeof ss.estimatedSavingsPercent === 'number' ? ss.estimatedSavingsPercent : 0,
          caveat: ss.caveat,
          caveatKo: ss.caveatKo ?? ss.caveat,
        };
      }),
    };

    recordUsageEvent(planCheck.userId, 'cost_copilot');
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'cost_copilot',
      title: body.userMessage.slice(0, 120),
      payload: reply,
      context: { params: body.params, materialId: body.materialId, process: body.process, quantity: body.quantity },
      projectId: body.projectId,
    });
    return NextResponse.json(reply);
  } catch (err) {
    console.warn('[cost-copilot] DeepSeek API call failed, using rule-based fallback:', err);
    recordUsageEvent(planCheck.userId, 'cost_copilot');
    const fallback = ruleBasedSuggest(body);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'cost_copilot',
      title: body.userMessage.slice(0, 120),
      payload: fallback,
      context: { params: body.params, materialId: body.materialId, process: body.process, quantity: body.quantity },
      projectId: body.projectId,
    });
    return NextResponse.json(fallback);
  }
}
