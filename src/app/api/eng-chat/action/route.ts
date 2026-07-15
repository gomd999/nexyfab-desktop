import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { captureServerError } from '@/lib/error-capture';
import { CALC_CATALOG } from '../calcCatalog';

/* ══════════════════════════════════════════════════════════════════════════════
   /api/eng-chat/action — 랜딩 챗의 "실행형" 의도추출.

   토목/건축/조경 도메인에서 사용자의 자연어 요청을 결정론 계산 엔진(eng-api) 호출
   의도로 변환한다. AI 는 CALC_CATALOG 를 근거로 다음 중 하나를 엄격한 JSON 으로 반환:
     { type:'calc', id, input, reply }   — 필수 파라미터가 모두 갖춰졌을 때
     { type:'reply', reply }             — 부족한 값 되묻기 / 일반 질문 응답

   실제 계산 실행(POST /v1/demo/calc/{id})은 클라이언트(ChatHero)가 수행해 결과
   카드를 렌더한다. 즉 이 라우트는 "무엇을 어떤 입력으로 돌릴지"만 정한다.

   정직성: 수치를 지어내지 않는다. 표준/유도 가능한 값만 가정하고 reply 에 명시,
   불확실하면 되묻는다. 결과는 비법정 참고자료.
   ══════════════════════════════════════════════════════════════════════════════ */

type ActionDomain = 'civil' | 'architecture' | 'landscape' | 'mechanical';
const ACTION_DOMAINS: ActionDomain[] = ['civil', 'architecture', 'landscape', 'mechanical'];

// 기계설계: 부품 "생성" 요청 vs 일반 질문 분류. 생성이면 scad 파이프라인용 프롬프트 정제.
const MECH_SYSTEM = `당신은 NexyFab 기계설계 에이전트입니다. 사용자 요청을 [단일부품 생성 / 조립체 생성 /
전기배선 / 실질 답변] 중 하나로 처리해 JSON 하나만 출력합니다.
**최우선 원칙: 같은 되묻기를 반복하지 말 것.** 대화 히스토리를 보고, 이미 물어봤거나 사용자가
"추천/알아서/진행/응/그래" 등 위임 신호를 주면, 되묻지 말고 통상 표준값을 가정해 **구체적으로
진행**하라(가정은 reply 에 "가정: ..."로 밝힌다).

[출력 — JSON 하나만, 코드펜스/설명 금지]
- 단일 부품(하나의 몸체): {"type":"scad","prompt":"<영어 형상+치수 mm>","reply":"<사용자 언어>"}
- 여러 부품 조립체(프레임/랙, 탱크+펌프+배관, 플레이트+포스트 등): {"type":"assembly","prompt":"<각 부품 종류·치수·배치>","reply":"<사용자 언어>"}
- 전기 배선/결선: {"type":"wiring","reply":"<사용자 언어>","cables":[{"from":"","to":"","type":"CV/제어 등","cores":0,"mm2":0,"lengthM":0,"note":""}]}
- 재료 비교·DFM 조언·추천·개념 질문 등 답변형: {"type":"reply","reply":"<실질적이고 구체적인 답변>"}

[규칙]
- reply 는 사용자 언어로, **실질적으로**(똑같은 문장 재사용 금지). 추천 요청엔 실제 추천안을 제시.
- 치수가 없으면 통상값을 가정해 진행(예: "200L 탱크"→원통 ⌀600×H700 t3, "브래킷"→200×100×60 t6 4×⌀8홀). 가정은 reply 에 "가정: ..."로 명시.
- **대형 시스템(수처리장치·플랜트 등 여러 부품)**: reply 에 시스템 구성(핵심 부품)을 1~2줄로 요약한 뒤, **대표/핵심 부품을 assembly 또는 scad 로 즉시 생성 제안**한다(예: 수처리→프레임 스키드 + 탱크 + 펌프 + 파이프 조립체). 사용자가 처음부터 "설계할거야"라고만 해도 한 번은 통상 구성으로 생성해 보여준다.
- 조립체 어휘=판금/구조 중심(plate·bracket·flange·tube·각관·box·cylinder). "여러 개/조립/프레임/랙/체결/장치/시스템" 신호면 assembly.
- 단일 prompt 는 영어·간결·수치 (예: "mounting bracket 200x100x60mm with four 8mm holes").
- 전기 배선은 결선표(개산). 규격/길이 불확실 시 lengthM:0, note 에 "확인 필요". 정밀 3D 하네스는 다루지 않음.
- 근거 없는 정밀치수 날조는 피하되, 표준·통상값 가정은 "가정/개산"으로 표기해 적극 진행(정직 + 무한 되묻기 금지).`;

function catalogPromptBlock(): string {
  return CALC_CATALOG.map(c => {
    const params = Object.entries(c.params)
      .map(([k, p]) => `      ${k}: ${p.desc || p.type || ''}${c.required.includes(k) ? ' [필수]' : ' [선택]'}`)
      .join('\n');
    return `  • id=${c.id} | ${c.domain} | ${c.title}\n    required: [${c.required.join(', ')}]\n${params}`;
  }).join('\n');
}

const SYSTEM = `당신은 NexyFab 엔지니어링 계산 에이전트입니다. 사용자의 자연어 요청을 아래
계산기 카탈로그 중 하나의 실행 의도로 변환합니다. 반드시 JSON 하나만 출력하세요.

[계산기 카탈로그] (input 은 반드시 아래 스키마의 단위로)
${catalogPromptBlock()}

[출력 형식 — JSON 하나만, 코드펜스/설명 금지]
- 요청이 특정 계산기에 매핑되고 필수 파라미터를 모두 확보(또는 표준·유도값으로 안전하게 채움) 가능하면:
  {"type":"calc","id":"<카탈로그 id>","input":{<필수+가능한 선택 파라미터, 스키마 단위의 숫자>},"reply":"<한 줄 설명+가정 명시>"}
- 필수 값이 부족하고 안전히 유도 불가하면:
  {"type":"reply","reply":"<부족한 값만 콕 집어 되묻기>"}
- 계산과 무관한 일반 질문이면:
  {"type":"reply","reply":"<도움되는 짧은 답변>"}

[규칙]
- 반드시 사용자가 쓴 언어로 reply 작성.
- 단위 변환 필수 (예: "경간 6m" → L:6000 (mm), "옹벽 4m" → H:4 (m, 스키마대로)).
- 수치를 지어내지 말 것. 표준 단면·표준 재료값 등 근거 있는 값만 가정하고 reply 에 "가정: ..."로 밝힐 것.
- 표준 단면(예: H-300x150)의 단면성능(Sx,Ix,Aw 등)을 정확히 모르면 type:reply 로 해당 값을 되물을 것.
- input 의 값은 순수 숫자만(단위 문자열 금지).`;

function stripJson(raw: string): string {
  let s = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return s;
}

export async function POST(req: NextRequest) {
  const planCheck = await checkPlan(req, 'free');
  const userPlan = planCheck.ok ? planCheck.plan : 'free';

  try {
    const body = await req.json();
    const message: unknown = body?.message;
    const history: unknown = body?.history;
    const domainRaw: unknown = body?.domain;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }
    const domain: ActionDomain = ACTION_DOMAINS.includes(domainRaw as ActionDomain)
      ? (domainRaw as ActionDomain)
      : 'civil';

    if (planCheck.ok) {
      const budget = await checkUserBudget(planCheck.userId);
      if (!budget.ok) {
        return NextResponse.json({ error: `Daily AI spend limit reached ($${budget.limitUsd}).`, code: 'COST_BUDGET' }, { status: 402 });
      }
      const { consumeMonthlyMetricSlot } = await import('@/lib/plan-guard');
      const slot = await consumeMonthlyMetricSlot(planCheck.userId, userPlan, 'shape_chat');
      if (!slot.ok) {
        return NextResponse.json({ error: `Free plan limit reached (${slot.limit}/month).` }, { status: 429 });
      }
    }
    try {
      const { getActiveBreaker } = await import('@/lib/cost-breaker');
      if (await getActiveBreaker()) {
        return NextResponse.json({ error: 'AI is temporarily paused. Please try again later.' }, { status: 503 });
      }
    } catch { /* ignore */ }

    const messages: ChatMessage[] = [{ role: 'system', content: domain === 'mechanical' ? MECH_SYSTEM : SYSTEM }];
    const historyLimit = userPlan === 'free' ? 4 : 8;
    if (Array.isArray(history)) {
      for (const h of history.slice(-historyLimit)) {
        if (h?.role === 'user' || h?.role === 'assistant') {
          messages.push({ role: h.role, content: String(h.content ?? '').slice(0, 2000) });
        }
      }
    }
    messages.push({ role: 'user', content: `[분야:${domain}] ${message.slice(0, 2000)}` });

    let raw = '';
    try {
      const result = await chatCompletion({ messages, maxTokens: 600, temperature: 0.2, timeoutMs: 30_000, task: 'eng-chat-action' });
      raw = result.text;
    } catch (e) {
      if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: 'AI provider not configured' }, { status: 500 });
      const detail = e instanceof AiProviderError ? `${e.provider}: ${e.message}` : (e instanceof Error ? e.message : String(e));
      console.error('eng-chat-action provider error:', detail);
      return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
    }

    let parsed: { type?: string; id?: string; input?: Record<string, unknown>; reply?: string };
    try {
      parsed = JSON.parse(stripJson(raw));
    } catch {
      // 파싱 실패 → 원문을 그대로 대화 응답으로
      return NextResponse.json({ type: 'reply', reply: raw.trim() || '다시 한 번 요청해 주시겠어요?' });
    }

    const reply = typeof parsed.reply === 'string' ? parsed.reply : '';

    // 기계설계: 단일부품(scad) / 조립체(assembly) / 전기 결선표(wiring) / 질문(reply)
    if (domain === 'mechanical') {
      const p = (parsed as { prompt?: unknown }).prompt;
      if ((parsed.type === 'scad' || parsed.type === 'assembly') && typeof p === 'string' && p.trim()) {
        return NextResponse.json({ type: parsed.type, prompt: p.trim(), reply });
      }
      const cables = (parsed as { cables?: unknown }).cables;
      if (parsed.type === 'wiring' && Array.isArray(cables) && cables.length > 0) {
        return NextResponse.json({ type: 'wiring', reply, cables });
      }
      return NextResponse.json({ type: 'reply', reply: reply || raw.trim() || '어떤 부품/조립체/배선을 만들까요? 형상·치수 또는 결선 대상을 알려주세요.' });
    }

    if (parsed.type === 'calc' && typeof parsed.id === 'string') {
      const spec = CALC_CATALOG.find(c => c.id === parsed.id);
      const input = parsed.input && typeof parsed.input === 'object' ? parsed.input : {};
      // 필수 파라미터 검증 — 하나라도 숫자로 없으면 되묻기로 강등(할루시 방지)
      const missing = spec ? spec.required.filter(k => typeof (input as Record<string, unknown>)[k] !== 'number') : ['(unknown calculator)'];
      if (!spec || missing.length > 0) {
        return NextResponse.json({
          type: 'reply',
          reply: reply || `계산에 필요한 값이 부족합니다${spec ? `: ${missing.join(', ')}` : ''}. 값을 알려주시면 검토해 드릴게요.`,
        });
      }
      return NextResponse.json({ type: 'calc', id: spec.id, title: spec.title, input, reply });
    }

    return NextResponse.json({ type: 'reply', reply: reply || raw.trim() || '조금 더 구체적으로 알려주시겠어요?' });
  } catch (e) {
    captureServerError(e, { route: 'eng-chat-action' });
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}
