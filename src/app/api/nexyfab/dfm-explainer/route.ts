/**
 * POST /api/nexyfab/dfm-explainer
 *
 * AI DFM Explainer — given a detected DFM issue, returns:
 *   - Natural-language root-cause explanation (en + ko)
 *   - 1~3 alternative fix strategies beyond the built-in suggestion
 *   - Estimated qualitative cost impact note
 *
 * Quantitative before/after cost delta is computed client-side by re-running
 * `estimateCosts()` with the proposed parameter override — this endpoint only
 * returns the *reasoning* an LLM can provide.
 *
 * Freemium: metric = 'dfm_insights' (free: 5/month, pro+: unlimited).
 */

import { NextRequest, NextResponse } from 'next/server';

// ─── Types (mirror the DFMIssue client shape, trimmed to what LLM needs) ──

type Severity = 'error' | 'warning' | 'info';
type IssueType =
  | 'undercut' | 'thin_wall' | 'deep_pocket' | 'sharp_corner'
  | 'draft_angle' | 'uniform_wall' | 'tool_access' | 'aspect_ratio'
  | 'overhang' | 'bridge' | 'support_volume';
type ProcessKind =
  | 'cnc_milling' | 'cnc_turning' | 'injection_molding' | 'sheet_metal'
  | 'die_casting' | '3d_printing' | 'sla' | 'sls';

interface DFMIssueInput {
  type: IssueType;
  severity: Severity;
  description: string;
  suggestion: string;
}

interface Alternative {
  label: string;
  labelKo: string;
  rationale: string;
  rationaleKo: string;
  /** Optional parameter delta to suggest (client interprets + shows cost delta) */
  paramHint?: { key: string; delta: number };
}

interface DFMExplanation {
  rootCause: string;
  rootCauseKo: string;
  /** Why this matters for the chosen manufacturing process */
  processImpact: string;
  processImpactKo: string;
  alternatives: Alternative[];
  /** Qualitative cost note: e.g. "expected +15% due to added machining setups" */
  costNote: string;
  costNoteKo: string;
}

// ─── Rule-based fallback (used when LLM unavailable / errors) ─────────────

function ruleBasedExplain(issue: DFMIssueInput, process: ProcessKind): DFMExplanation {
  const libs: Record<IssueType, DFMExplanation> = {
    thin_wall: {
      rootCause: 'Wall thickness below the minimum viable for this process leads to tool deflection, vibration, or warping.',
      rootCauseKo: '이 공정의 최소 유효 두께 미만이면 공구 처짐·진동·뒤틀림이 발생합니다.',
      processImpact: process === 'cnc_milling' ? 'CNC endmills chatter on thin walls, leaving poor surface finish.' : 'Thin walls collapse during cooling or ejection.',
      processImpactKo: process === 'cnc_milling' ? 'CNC 엔드밀이 얇은 벽에서 떨리며 표면 품질이 나빠집니다.' : '얇은 벽은 냉각 또는 이젝션 중 붕괴됩니다.',
      alternatives: [
        { label: 'Add ribs for stiffness', labelKo: '리브 추가로 강성 확보', rationale: 'Ribs let you keep nominal thin wall while meeting stiffness.', rationaleKo: '명목 두께를 유지하며 강성을 확보합니다.' },
        { label: 'Locally thicken only the problem area', labelKo: '문제 영역만 국부 증육', rationale: 'Cheaper than uniform thickening.', rationaleKo: '전체 증육보다 비용이 낮습니다.', paramHint: { key: 'thickness', delta: +1.0 } },
      ],
      costNote: 'Increasing minimum wall by 1mm typically adds 5–15% material + negligible machining time.',
      costNoteKo: '최소 벽 두께를 1mm 증가시키면 재료비 5~15% 증가, 가공 시간은 거의 동일합니다.',
    },
    undercut: {
      rootCause: 'Geometry trapped behind a feature prevents tool or mold release along the primary axis.',
      rootCauseKo: '주 축 방향으로 공구나 금형을 분리할 수 없는 형상이 걸려 있습니다.',
      processImpact: process === 'injection_molding' || process === 'die_casting' ? 'Requires side-action cores (slides), which add tooling cost and cycle time.' : 'Requires 5-axis or EDM setup.',
      processImpactKo: process === 'injection_molding' || process === 'die_casting' ? '사이드 액션 코어(슬라이드)가 필요해 금형비와 사이클 타임이 증가합니다.' : '5축 또는 방전 가공(EDM) 셋업이 필요합니다.',
      alternatives: [
        { label: 'Remove or relocate the undercut', labelKo: '언더컷 제거 또는 위치 변경', rationale: 'Cheapest fix if function permits.', rationaleKo: '기능이 허용하면 가장 저렴한 해결책입니다.' },
        { label: 'Split part into 2 assemblies', labelKo: '2개 조립품으로 분할', rationale: 'Eliminates undercut at the cost of an assembly step.', rationaleKo: '조립 공정을 추가하는 대신 언더컷을 제거합니다.' },
      ],
      costNote: process === 'injection_molding' ? 'Side-action tooling adds ~$3–8k per slide.' : '5-axis setup typically +30–60% machine cost.',
      costNoteKo: process === 'injection_molding' ? '사이드 액션 금형은 슬라이드당 약 3~8백만원 추가됩니다.' : '5축 셋업은 보통 장비 비용 30~60% 증가합니다.',
    },
    draft_angle: {
      rootCause: 'Vertical or insufficient draft causes the part to stick in the mold or die during ejection.',
      rootCauseKo: '구배각이 수직이거나 부족하면 이젝션 시 금형에 달라붙습니다.',
      processImpact: 'Poor surface finish, ejection marks, or cracked parts.',
      processImpactKo: '표면 품질 불량, 이젝터 자국, 또는 파트 파손이 발생합니다.',
      alternatives: [
        { label: 'Apply 1~3° draft on vertical faces', labelKo: '수직 면에 1~3° 구배 적용', rationale: 'Industry standard for most plastics.', rationaleKo: '대부분의 플라스틱에 적합한 업계 표준.', paramHint: { key: 'draftAngle', delta: +2 } },
        { label: 'Use textured surfaces with 3~5° draft', labelKo: '텍스처 면에는 3~5° 구배', rationale: 'Textured finishes need extra draft to release cleanly.', rationaleKo: '텍스처 마감은 깨끗한 분리를 위해 추가 구배가 필요합니다.' },
      ],
      costNote: 'Adding draft is free — tooling cost is identical, only CAD geometry changes.',
      costNoteKo: '구배 추가는 추가 비용이 없습니다 — 금형비는 동일, CAD 형상만 변경됩니다.',
    },
    deep_pocket: {
      rootCause: 'Pocket depth-to-width ratio exceeds tool reach, requiring long specialty tooling.',
      rootCauseKo: '포켓 깊이/너비 비율이 공구 도달 한계를 초과해 특수 롱툴이 필요합니다.',
      processImpact: 'Long tools chatter, deflect, and machine slower — often 2–3x cycle time.',
      processImpactKo: '롱툴은 떨림·처짐이 발생해 절삭 속도가 느려지며 사이클 타임이 2~3배 증가합니다.',
      alternatives: [
        { label: 'Reduce pocket depth', labelKo: '포켓 깊이 감소', rationale: 'Best if function allows.', rationaleKo: '기능이 허용하면 최선.' },
        { label: 'Widen the pocket', labelKo: '포켓 너비 증가', rationale: 'Allows standard-length tooling.', rationaleKo: '표준 공구 사용이 가능해집니다.' },
      ],
      costNote: 'Specialty long tooling adds 20–40% machine time.',
      costNoteKo: '특수 롱툴은 가공 시간을 20~40% 증가시킵니다.',
    },
    sharp_corner: {
      rootCause: 'Internal sharp corners are impossible to mill — tool radius always leaves a fillet.',
      rootCauseKo: '내부 샤프 코너는 밀링이 불가능합니다 — 공구 반경이 항상 필렛을 남깁니다.',
      processImpact: 'Designer expected a square corner; machine shop will either add a fillet or reject the drawing.',
      processImpactKo: '설계자는 직각 모서리를 기대했지만, 가공 업체는 필렛을 추가하거나 도면을 거부합니다.',
      alternatives: [
        { label: 'Add a minimum 1mm fillet', labelKo: '최소 1mm 필렛 추가', rationale: 'Matches standard endmill radii.', rationaleKo: '표준 엔드밀 반경에 맞습니다.', paramHint: { key: 'cornerRadius', delta: +1 } },
        { label: 'Use EDM wire-cut for exact square', labelKo: '정확한 직각이 필요하면 와이어 EDM', rationale: 'Only needed for hardened steel or critical fits.', rationaleKo: '경화강이나 중요 공차 부위에만 사용.' },
      ],
      costNote: 'Adding fillets is free; EDM adds 50–100% to corner cost.',
      costNoteKo: '필렛 추가는 무료; EDM은 코너 비용을 50~100% 증가시킵니다.',
    },
    aspect_ratio: {
      rootCause: 'High length-to-width ratio causes clamping and deflection problems during machining.',
      rootCauseKo: '길이/너비 비가 높으면 가공 중 클램핑과 처짐 문제가 발생합니다.',
      processImpact: 'Requires intermediate supports or split machining passes.',
      processImpactKo: '중간 지지대 또는 분할 가공이 필요합니다.',
      alternatives: [
        { label: 'Split into shorter sections and join', labelKo: '짧은 섹션으로 분할 후 접합', rationale: 'Easier machining, add joint features.', rationaleKo: '가공이 쉬워지지만 접합 구조 추가 필요.' },
        { label: 'Add intermediate web/rib supports', labelKo: '중간 웹·리브 지지대 추가', rationale: 'Stiffens during machining, can remain or be removed.', rationaleKo: '가공 중 강성 확보, 이후 유지 또는 제거.' },
      ],
      costNote: 'Splitting adds ~10% material but cuts machine time 20–30%.',
      costNoteKo: '분할은 재료비 10% 증가하지만 가공 시간은 20~30% 단축됩니다.',
    },
    uniform_wall: {
      rootCause: 'Non-uniform wall thickness causes differential shrinkage and internal stress.',
      rootCauseKo: '벽 두께가 균일하지 않으면 차등 수축과 내부 응력이 발생합니다.',
      processImpact: 'Warping, sink marks, and dimensional variation.',
      processImpactKo: '뒤틀림, 싱크 마크, 치수 편차가 발생합니다.',
      alternatives: [
        { label: 'Hollow out thick sections (coring)', labelKo: '두꺼운 부분 속비우기(코링)', rationale: 'Maintains visual bulk while achieving uniform wall.', rationaleKo: '외관은 유지하며 균일 두께를 달성합니다.' },
        { label: 'Add ribs instead of thick walls', labelKo: '두꺼운 벽 대신 리브 추가', rationale: 'Same stiffness at uniform wall.', rationaleKo: '균일 두께로 동일한 강성을 얻습니다.' },
      ],
      costNote: 'Coring reduces material 15–30% and shortens cycle time.',
      costNoteKo: '코링은 재료비 15~30% 감소 및 사이클 타임 단축.',
    },
    tool_access: {
      rootCause: 'The feature is in a location the cutting tool cannot reach from any approach angle.',
      rootCauseKo: '어느 접근 각도에서도 절삭 공구가 도달할 수 없는 위치에 형상이 있습니다.',
      processImpact: 'Requires 5-axis, EDM, or part redesign.',
      processImpactKo: '5축 가공, EDM, 또는 설계 변경이 필요합니다.',
      alternatives: [
        { label: 'Reorient feature for 3-axis access', labelKo: '3축 접근 가능하도록 형상 재배치', rationale: 'Eliminates specialty setup cost.', rationaleKo: '특수 셋업 비용을 제거합니다.' },
        { label: 'Split part into subassembly', labelKo: '서브어셈블리로 분할', rationale: 'Each piece accessible separately.', rationaleKo: '각 부품을 개별 접근 가능하게 만듭니다.' },
      ],
      costNote: '5-axis setup +30–60% machine cost; redesign is typically free.',
      costNoteKo: '5축 셋업은 장비 비용 30~60% 증가; 재설계는 보통 무료.',
    },
    overhang: {
      rootCause: 'Overhanging features above the self-support angle need printed supports that leave surface scars.',
      rootCauseKo: '셀프서포트 각도를 초과하는 오버행은 서포트가 필요하며 제거 후 표면 흔적이 남습니다.',
      processImpact: 'Support material waste + post-processing time.',
      processImpactKo: '서포트 재료 낭비 + 후가공 시간 추가.',
      alternatives: [
        { label: 'Reorient part to self-support', labelKo: '파트를 셀프서포트 방향으로 재배치', rationale: 'Zero support material needed.', rationaleKo: '서포트 재료 불필요.' },
        { label: 'Add chamfer to reduce angle to 45°', labelKo: '챔퍼로 각도를 45°로 감소', rationale: 'Below most FDM support threshold.', rationaleKo: '대부분 FDM 서포트 기준 이하.' },
      ],
      costNote: 'Reorientation is free; support material typically 10–25% of part volume.',
      costNoteKo: '재배치는 무료; 서포트 재료는 보통 파트 부피의 10~25%.',
    },
    bridge: {
      rootCause: 'Long bridges sag between supports during printing before material cools.',
      rootCauseKo: '긴 브리지는 재료가 식기 전에 지지 사이에서 처집니다.',
      processImpact: 'Dimensional inaccuracy and surface droop.',
      processImpactKo: '치수 부정확과 표면 처짐이 발생합니다.',
      alternatives: [
        { label: 'Shorten bridge span or add pillar', labelKo: '브리지 길이 단축 또는 기둥 추가', rationale: 'Keep bridges under 10mm for most FDM.', rationaleKo: '대부분 FDM에서 10mm 이하로 유지.' },
        { label: 'Convert to arch/chamfer profile', labelKo: '아치·챔퍼 프로파일로 변경', rationale: 'Self-supports without bridges.', rationaleKo: '브리지 없이 스스로 지지됩니다.' },
      ],
      costNote: 'Pillar adds negligible material; redesign is free.',
      costNoteKo: '기둥 추가는 재료비 거의 없음; 재설계는 무료.',
    },
    support_volume: {
      rootCause: 'Support material volume exceeds the part volume — orientation is suboptimal.',
      rootCauseKo: '서포트 재료 부피가 파트 부피를 초과합니다 — 배치가 최적이 아닙니다.',
      processImpact: 'High material waste and long print time.',
      processImpactKo: '재료 낭비와 긴 출력 시간이 발생합니다.',
      alternatives: [
        { label: 'Re-orient for lower support', labelKo: '서포트 최소화 방향으로 재배치', rationale: 'Typically halves support volume.', rationaleKo: '보통 서포트 부피가 절반으로 줄어듭니다.' },
        { label: 'Split into multiple prints', labelKo: '여러 개로 분할 출력', rationale: 'Each piece orients optimally.', rationaleKo: '각 조각을 최적 방향으로 배치.' },
      ],
      costNote: 'Reorientation typically saves 20–40% print cost.',
      costNoteKo: '재배치는 보통 출력 비용 20~40% 절감.',
    },
  };
  return libs[issue.type] ?? {
    rootCause: issue.description,
    rootCauseKo: issue.description,
    processImpact: issue.suggestion,
    processImpactKo: issue.suggestion,
    alternatives: [],
    costNote: 'No cost estimate available for this issue type.',
    costNoteKo: '이 이슈 유형은 비용 추정을 사용할 수 없습니다.',
  };
}

function stripMarkdownJson(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ─── POST handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { checkPlan, checkMonthlyLimit, recordUsageEvent } = await import('@/lib/plan-guard');
  const planCheck = await checkPlan(req, 'free');
  if (!planCheck.ok) return planCheck.response;

  const usageCheck = await checkMonthlyLimit(planCheck.userId, planCheck.plan, 'dfm_insights');
  if (!usageCheck.ok) {
    const isPro = usageCheck.limit === -2;
    return NextResponse.json(
      {
        error: isPro
          ? 'AI DFM Insights requires Pro plan or higher.'
          : `Free plan limit reached (${usageCheck.limit}/month). Upgrade to Pro for unlimited AI DFM insights.`,
        requiresPro: isPro,
        used: usageCheck.used,
        limit: usageCheck.limit,
      },
      { status: 403 },
    );
  }

  const body = await req.json() as {
    issue: DFMIssueInput;
    process: ProcessKind;
    material?: string;
    params?: Record<string, number>;
    lang?: string;
    projectId?: string;
  };

  const { issue, process: procKind, material, params, lang, projectId } = body;
  if (!issue || !issue.type || !procKind) {
    return NextResponse.json({ error: 'issue.type and process are required' }, { status: 400 });
  }

  const { recordAIHistory } = await import('@/lib/ai-history');
  const historyTitle = `${issue.type} (${issue.severity}) — ${procKind}`;
  const historyContext = {
    issue,
    process: procKind,
    material,
    params,
  };

  const apiKey = globalThis.process?.env?.DEEPSEEK_API_KEY;
  const baseUrl = globalThis.process?.env?.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

  if (!apiKey) {
    recordUsageEvent(planCheck.userId, 'dfm_insights');
    const explanation = ruleBasedExplain(issue, procKind);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'dfm_insights',
      title: historyTitle,
      payload: { explanation },
      context: historyContext,
      projectId,
    });
    return NextResponse.json({ explanation });
  }

  const systemPrompt =
    'You are a manufacturing engineering expert. Given a detected Design-for-Manufacturing issue, ' +
    'explain the root cause, the impact on the specified manufacturing process, ' +
    '1-3 alternative fix strategies (each with a short rationale), and a qualitative cost note. ' +
    'Respond with a JSON object with these exact keys: "rootCause", "rootCauseKo", "processImpact", "processImpactKo", ' +
    '"alternatives" (array of { "label", "labelKo", "rationale", "rationaleKo", "paramHint"?: { "key", "delta" } }), ' +
    '"costNote", "costNoteKo". ' +
    'Keep each text field under 200 characters. Do NOT wrap JSON in markdown code blocks.';

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
          { role: 'user', content: JSON.stringify({ issue, process: procKind, material, params, requestedLanguage: lang ?? 'en' }) },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripMarkdownJson(content)) as Partial<DFMExplanation>;

    if (!parsed.rootCause || !parsed.processImpact) throw new Error('Invalid LLM response shape');

    const explanation: DFMExplanation = {
      rootCause: parsed.rootCause,
      rootCauseKo: parsed.rootCauseKo ?? parsed.rootCause,
      processImpact: parsed.processImpact,
      processImpactKo: parsed.processImpactKo ?? parsed.processImpact,
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives.slice(0, 3).map(a => ({
        label: a.label,
        labelKo: a.labelKo ?? a.label,
        rationale: a.rationale ?? '',
        rationaleKo: a.rationaleKo ?? a.rationale ?? '',
        paramHint: a.paramHint && typeof a.paramHint.key === 'string' && typeof a.paramHint.delta === 'number'
          ? { key: a.paramHint.key, delta: a.paramHint.delta }
          : undefined,
      })) : [],
      costNote: parsed.costNote ?? '',
      costNoteKo: parsed.costNoteKo ?? parsed.costNote ?? '',
    };

    recordUsageEvent(planCheck.userId, 'dfm_insights');
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'dfm_insights',
      title: historyTitle,
      payload: { explanation },
      context: historyContext,
      projectId,
    });
    return NextResponse.json({ explanation });
  } catch (err) {
    console.warn('[dfm-explainer] DeepSeek API call failed, using rule-based fallback:', err);
    recordUsageEvent(planCheck.userId, 'dfm_insights');
    const fallback = ruleBasedExplain(issue, procKind);
    recordAIHistory({
      userId: planCheck.userId,
      feature: 'dfm_insights',
      title: historyTitle,
      payload: { explanation: fallback },
      context: historyContext,
      projectId,
    });
    return NextResponse.json({ explanation: fallback });
  }
}
