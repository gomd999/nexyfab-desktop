import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { captureServerError } from '@/lib/error-capture';
import { actionReplyRequiresConfirmation, normalizeEngChatActionPayload } from '@/lib/engChatActionPayload';
import { CALC_CATALOG } from '../calcCatalog';
import { rateLimit } from '@/lib/rate-limit';
import {
  consumeEngineeringChatGuestQuota,
  GUEST_ENGINEERING_CHAT_DAILY_LIMIT,
} from '@/lib/ai/engineeringChatGuestQuota';
import { getTrustedClientIp } from '@/lib/client-ip';
import { mechanicalSemanticCorrection } from '@/lib/ai/mechanicalSemanticCorrection';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { mechanicalVocabularyPrompt } from '@/lib/ai/mechanicalVocabulary';
import { buildCadActionPlan } from '@/lib/ai/cadActionPlan';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 512 * 1024;

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
type ActionLang = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
const LANGUAGE_NAME: Record<ActionLang, string> = { kr: 'Korean', en: 'English', ja: 'Japanese', cn: 'Simplified Chinese', es: 'Spanish', ar: 'Arabic' };
const ACTION_FALLBACK: Record<ActionLang, { mechanical: string; missing: string; detail: string }> = {
  kr: { mechanical: '어떤 부품·조립체·배선을 만들까요? 형상과 치수 또는 결선 대상을 알려주세요.', missing: '계산에 필요한 값이 부족합니다. 값을 알려주시면 검토해 드릴게요.', detail: '조금 더 구체적으로 알려주시겠어요?' },
  en: { mechanical: 'What part, assembly or wiring should I create? Provide the geometry and dimensions or wiring targets.', missing: 'Some required calculation values are missing. Provide them and I will run the check.', detail: 'Could you provide a little more detail?' },
  ja: { mechanical: 'どの部品・アセンブリ・配線を作成しますか？形状と寸法、または結線対象を教えてください。', missing: '計算に必要な値が不足しています。値を指定すると検討を実行します。', detail: 'もう少し具体的に教えてください。' },
  cn: { mechanical: '要创建什么零件、装配体或接线？请提供形状尺寸或接线对象。', missing: '缺少计算所需的数值。请补充后再进行校核。', detail: '请再具体说明一些。' },
  es: { mechanical: '¿Qué pieza, conjunto o cableado debo crear? Indica la geometría y cotas o los puntos de conexión.', missing: 'Faltan valores necesarios para el cálculo. Indícalos y ejecutaré la comprobación.', detail: '¿Puedes dar un poco más de detalle?' },
  ar: { mechanical: 'ما الجزء أو التجميع أو التوصيلات التي تريد إنشاءها؟ حدّد الشكل والأبعاد أو نقاط التوصيل.', missing: 'تنقص بعض القيم اللازمة للحساب. أدخلها وسأجري التحقق.', detail: 'هل يمكنك تقديم تفاصيل أكثر؟' },
};

const NEXYFAB_WIRING = `
[NexyFab capability wiring — select the native capability before answering]
- intent: one part → scad/compose; multiple parts, frames, engines, tanks or systems → assembly/assemble.
- vocabulary: use the canonical mechanical types and parameters from VOCAB_SPEC; never invent a type when a canonical type exists.
- jet/turbomachinery: route to the turbojet_concept assembly vocabulary (inlet, casing, shaft, blade_ring, annular_combustor, nozzle) and preserve dimensions/stage counts.
- refinement: if history contains a generated design, return the same action type and revise only requested fields; do not downgrade to reply.
- verification/export: after geometry, expose native checks (interference, structure, DFM) and native outputs (SCAD, STEP, BOM, package) as follow-up actions.
- engineering tools: choose the native deterministic calculator when the request is a check (beam/frame deflection, buckling, tank/pressure, bolted joint, weld, shaft, heat-flow or tolerance); do not replace a calculator with free-form CAD prose.
- precision CAD bridge: use feature/face edits, mate/constraint repair, drawing/GD&T and revision history when the user refers to an existing model; preserve IDs and unchanged dimensions.
- manufacturing bridge: use material/process recommendation, DFM, cost/quote, BOM and supplier handoff only after the geometry/check stage is explicit.
- unsupported physics: keep the CAD action executable and put advanced CFD/thermal/certification work in a concise expandable scope note.`;

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
- **핵심 치수가 발화에 없으면 먼저 되물어라(2026-07-16 사용자 결정)**: {"type":"reply"}로 질문 2~3개를
  던지되, 각 질문에 **권장 기본값을 붙여라**(예: "탱크 용량은요? (통상 200L → ⌀600×H700 t3)").
  마지막 줄에 "기본값으로 진행이라고 답하시면 바로 생성합니다"를 명시. 사용자가 "기본값/알아서/진행"
  신호를 주면 그때 가정(가정: ... 명시)으로 생성한다. **되묻기는 스레드당 한 번** — 히스토리에 이미
  질문했으면 다시 묻지 말고 진행(최우선 원칙과 동일).
- **대형 시스템(수처리장치·플랜트 등 여러 부품)**: reply 에 시스템 구성(핵심 부품)을 1~2줄 요약 +
  핵심 치수 질문(권장 기본값 포함)을 먼저 제시한다. 진행 신호(기본값/알아서/응)를 받으면 assembly 로
  생성(예: 수처리→프레임 스키드 + 탱크 + 펌프 + 파이프 조립체).
- **터보제트/터보팬/가스터빈 개념 설계는 지원한다.** 엔진 형식·팬 직경·전체 길이·압축기/터빈 단수와 블레이드 수를 묻고,
  진행 신호 후 assembly 로 생성한다. 실제 NACA 파생 축류 블레이드 링, 환형 연소기, 축·케이싱·흡배기 유로가 생성된다.
  단, 공기역학 대응 범위는 유로 면적·허브/팁비·단 배치의 예비 형상이며 CFD 압력/온도장, 연소 안정성, 열·크리프,
  로터동역학·비산방지·감항 인증은 검증 완료라고 말하지 않는다. "NexyFab 범위 밖"이라고 뭉뚱그려 거절하지 말고
  가능한 개념 CAD와 미검증 해석 항목을 분리해서 안내한다.
- 조립체 어휘=판금/구조 중심(plate·bracket·flange·tube·각관·box·cylinder). "여러 개/조립/프레임/랙/체결/장치/시스템" 신호면 assembly.
- 단일 prompt 는 영어·간결·수치 (예: "mounting bracket 200x100x60mm with four 8mm holes").
- 전기 배선은 결선표(개산). 규격/길이 불확실 시 lengthM:0, note 에 "확인 필요". 정밀 3D 하네스는 다루지 않음.
- **직전 설계 수정(증분)**: 대화에 [직전 설계 스펙]이 주어지면, '~바꿔/늘려/추가/삭제/하나 더' 류 요청은
  새 설계가 아니라 **그 스펙을 기반으로 요청 부분만 반영한 전체 스펙**을 같은 type(assembly/scad)으로
  다시 출력하라. 바꾸지 않은 부품·치수는 그대로 유지(임의 재배치 금지).
- 근거 없는 정밀치수 날조는 피하되, 진행 신호 후의 표준·통상값 가정은 "가정/개산"으로 표기(정직 + 무한 되묻기 금지 — 한 번 묻고 진행).`;

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
- input 의 숫자 파라미터는 순수 숫자만(단위 문자열 금지). 단, 스키마 설명이 JSON 객체/배열
  구조를 정의하는 파라미터(예: layers, tip, internal, geometry, camber, tendon, walls,
  fixtures, soilCheck, treeWeight, detail, boundary, crackControl, crackWidth, ultimate)는
  그 구조 그대로의 JSON 값으로 채워라(문자열로 감싸지 말 것). 구조 내 숫자도 순수 숫자.`;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedJson<unknown>(req, MAX_BODY_BYTES);
    body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch (error) {
    const locale = resolveServerLocale(req);
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: localizedApiMessage(locale, 'badRequest'), code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    return NextResponse.json({ error: localizedApiMessage(locale, 'badRequest'), code: 'BAD_REQUEST' }, { status: 400 });
  }
  // Resolve the requested language before every rate, plan, quota, and budget gate.
  const locale = resolveServerLocale(req, body.lang);
  const lang: ActionLang = locale.route;
  // IP 레이트리밋(감사 2026-07-16) — eng-chat 본 라우트와 동일 30/min
  const _ip = getTrustedClientIp(req.headers);
  const _rl = rateLimit(`eng-chat-action:${_ip}`, 30, 60_000);
  if (!_rl.allowed) return NextResponse.json({ error: localizedApiMessage(locale, 'rateLimited'), code: 'RATE_LIMITED' }, { status: 429 });
  const planCheck = await checkPlan(req, 'free');
  const userPlan = planCheck.ok ? planCheck.plan : 'free';

  try {
    const lastSpec: string = typeof body?.lastSpec === 'string' ? String(body.lastSpec).slice(0, 1500) : '';
    const message: unknown = body?.message;
    const history: unknown = body?.history;
    const domainRaw: unknown = body?.domain;
    const languageRule = `\n[Mandatory output language]\nWrite every user-facing reply in ${LANGUAGE_NAME[lang]}. Do not use another language even if prior history contains it. Keep JSON keys and CAD technical identifiers in English.`;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: localizedApiMessage(locale, 'messageRequired'), code: 'MESSAGE_REQUIRED' }, { status: 400 });
    }
    const domain: ActionDomain = ACTION_DOMAINS.includes(domainRaw as ActionDomain)
      ? (domainRaw as ActionDomain)
      : 'civil';

    if (!planCheck.ok) {
      const guestQuota = await consumeEngineeringChatGuestQuota(req, _ip);
      if (!guestQuota.allowed) {
        if (guestQuota.unavailable) {
          return NextResponse.json({
            error: localizedApiMessage(locale, 'quotaUnavailable'),
            code: 'GUEST_CHAT_QUOTA_UNAVAILABLE',
            resetAtMs: guestQuota.resetAt,
          }, { status: 503 });
        }
        return NextResponse.json({
          error: localizedApiMessage(locale, 'quotaReached', { limit: GUEST_ENGINEERING_CHAT_DAILY_LIMIT }),
          code: 'GUEST_CHAT_QUOTA',
          limit: GUEST_ENGINEERING_CHAT_DAILY_LIMIT,
          resetAtMs: guestQuota.resetAt,
        }, { status: 429 });
      }
    }

    if (planCheck.ok) {
      const budget = await checkUserBudget(planCheck.userId, planCheck.orgId);
      if (!budget.ok) {
        return NextResponse.json({ error: localizedApiMessage(locale, 'costBudget', { limit: budget.limitUsd }), code: 'COST_BUDGET' }, { status: 402 });
      }
      // 슬롯 미소모(감사 2026-07-16): 한 설계 턴이 action(분류)+compose/assemble 두 번
      // 차감되던 이중 소모 해소 — 슬롯은 후속 geometry 라우트(guardStudioAi)가 1회만 소모.
      // 예산·브레이커는 그대로 통과한다(위/아래 가드).
    }
    try {
      const { getActiveBreaker } = await import('@/lib/cost-breaker');
      if (await getActiveBreaker()) {
        return NextResponse.json({ error: localizedApiMessage(locale, 'breaker'), code: 'AI_PAUSED' }, { status: 503 });
      }
    } catch { /* ignore */ }

    if (domain === 'mechanical') {
      const deterministicCorrection = mechanicalSemanticCorrection(message, history, lastSpec, lang);
      if (deterministicCorrection) return NextResponse.json(deterministicCorrection);
    }

    const messages: ChatMessage[] = [{ role: 'system', content: (domain === 'mechanical' ? `${MECH_SYSTEM}\n${NEXYFAB_WIRING}` : SYSTEM) + languageRule }];
    const historyLimit = userPlan === 'free' ? 4 : 8;
    if (Array.isArray(history)) {
      for (const h of history.slice(-historyLimit)) {
        if (h?.role === 'user' || h?.role === 'assistant') {
          messages.push({ role: h.role, content: String(h.content ?? '').slice(0, 2000) });
        }
      }
    }
    if (lastSpec) messages.push({ role: 'assistant', content: '[직전 설계 스펙]\n' + lastSpec }); // 증분 수정 컨텍스트
    const vocabularyHint = domain === 'mechanical' ? mechanicalVocabularyPrompt(message) : '';
    messages.push({ role: 'user', content: `[domain:${domain}][reply-language:${LANGUAGE_NAME[lang]}]${vocabularyHint ? `\n${vocabularyHint}` : ''}\n${message.slice(0, 2000)}` });

    let raw = '';
    try {
      const result = await chatCompletion({ messages, maxTokens: 600, temperature: 0.2, timeoutMs: 30_000, task: 'eng-chat-action' });
      raw = result.text;
    } catch (e) {
      if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: localizedApiMessage(locale, 'providerNotConfigured'), code: 'AI_NOT_CONFIGURED' }, { status: 500 });
      const detail = e instanceof AiProviderError ? `${e.provider}: ${e.message}` : (e instanceof Error ? e.message : String(e));
      console.error('eng-chat-action provider error:', detail);
      return NextResponse.json({ error: localizedApiMessage(locale, 'providerFailed'), code: 'AI_REQUEST_FAILED' }, { status: 502 });
    }

    const parsed = normalizeEngChatActionPayload(raw);
    if (!parsed) {
      // Never leak a malformed provider envelope into the user-facing chat.
      return NextResponse.json({ type: 'reply', reply: '', code: 'ACTION_FORMAT_INVALID' });
    }

    const reply = typeof parsed.reply === 'string' ? parsed.reply : '';

    // 기계설계: 단일부품(scad) / 조립체(assembly) / 전기 결선표(wiring) / 질문(reply)
    if (domain === 'mechanical') {
      const p = (parsed as { prompt?: unknown }).prompt;
      if ((parsed.type === 'scad' || parsed.type === 'assembly') && typeof p === 'string' && p.trim()) {
        if (actionReplyRequiresConfirmation(reply)) {
          return NextResponse.json({ type: 'reply', reply });
        }
        return NextResponse.json({ ...parsed, type: parsed.type, prompt: p.trim(), reply, plan: buildCadActionPlan(message, parsed) });
      }
      const cables = (parsed as { cables?: unknown }).cables;
      if (parsed.type === 'wiring' && Array.isArray(cables) && cables.length > 0) {
        return NextResponse.json({ type: 'wiring', reply, cables });
      }
      return NextResponse.json({ type: 'reply', reply: reply || raw.trim() || ACTION_FALLBACK[lang].mechanical });
    }

    if (parsed.type === 'calc' && typeof parsed.id === 'string') {
      const spec = CALC_CATALOG.find(c => c.id === parsed.id);
      const input = parsed.input && typeof parsed.input === 'object' ? parsed.input : {};
      // 필수 파라미터 검증 — 하나라도 숫자로 없으면 되묻기로 강등(할루시 방지)
      const missing = spec ? spec.required.filter(k => typeof (input as Record<string, unknown>)[k] !== 'number') : ['(unknown calculator)'];
      if (!spec || missing.length > 0) {
        return NextResponse.json({
          type: 'reply',
          reply: reply || `${ACTION_FALLBACK[lang].missing}${spec ? ` (${missing.join(', ')})` : ''}`,
        });
      }
      return NextResponse.json({ type: 'calc', id: spec.id, title: spec.title, input, reply });
    }

    return NextResponse.json({ type: 'reply', reply: reply || raw.trim() || ACTION_FALLBACK[lang].detail });
  } catch (e) {
    captureServerError(e, { route: 'eng-chat-action' });
    return NextResponse.json({ error: localizedApiMessage(locale, 'badRequest'), code: 'BAD_REQUEST' }, { status: 400 });
  }
}
