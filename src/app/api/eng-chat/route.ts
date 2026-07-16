import { NextRequest, NextResponse } from 'next/server';
import { checkPlan } from '@/lib/plan-guard';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { chatCompletion, AiNotConfiguredError, AiProviderError, type ChatMessage } from '@/lib/ai';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { captureServerError } from '@/lib/error-capture';
import { getSetting } from '@/lib/admin-settings';
import { streamChat, deepseekDeltaExtractor } from '@/lib/ai/streamingChat';

/* ══════════════════════════════════════════════════════════════════════════════
   /api/eng-chat — 랜딩 채팅-우선 히어로의 도메인 인식 대화 엔드포인트.

   - `stream: true` 요청이면 DeepSeek(OpenAI 호환 SSE)에서 토큰을 스트리밍해
     text/plain 청크로 흘려보낸다(TTFT 단축). 스트리밍이 불가/실패하면 아래
     비스트리밍 chatCompletion(프로바이더 폴백 체인 포함)으로 자동 폴백한다.
   - in-app CAD 의 /api/shape-chat(JSON shape-op)과는 별개. 여기는 순수 대화형.

   정직성: 모든 도메인 프롬프트는 "비법정 참고자료, 최종 검토는 유자격 기술자"
   임을 응답에 명시하도록 지시한다(feedback_landing_no_mock 정책과 정합).
   ══════════════════════════════════════════════════════════════════════════════ */

export type EngDomain = 'mechanical' | 'civil' | 'architecture' | 'landscape' | 'interior';

const DOMAIN_PROMPTS: Record<EngDomain, string> = {
  mechanical: `당신은 NexyFab의 기계설계 AI 어시스턴트입니다. 부품/기구 설계, DFM(제조성),
재료 선정, 공차/끼워맞춤, 가공법(밀링·선반·판금·사출·3D프린팅), 간이 강도·응력 감각을
다룹니다. 구체적 치수·재질·수량이 주어지면 설계 방향과 제조 리스크를 짚어 주세요.`,
  civil: `당신은 NexyFab의 토목·구조 AI 어시스턴트입니다. 보/기둥/기초/옹벽/관로/포장 등의
설계 개념, 하중·안정성 검토 관점, KDS/KCS 기준 체계, 수량산출(BOQ) 흐름을 다룹니다.
수치가 주어지면 어떤 검토(휨·전단·전도·활동·지지력 등)가 필요한지 안내하세요.
실제 수치 검증은 결정론 계산 엔진 데모로 이어질 수 있음을 알려 주세요.`,
  architecture: `당신은 NexyFab의 건축 AI 어시스턴트입니다. 콘크리트/RC 부재 개념, 건축 계획·
법규 체크포인트(용도·면적·피난 등 일반 관점), BIM 워크플로우, 마감·공법 선정을 다룹니다.
구체 조건이 주어지면 검토 순서와 리스크를 정리해 주세요.`,
  landscape: `당신은 NexyFab의 조경 AI 어시스턴트입니다. 식재 계획, 포장·배수, 조경 구조물,
관수·우수처리 개념과 관련 기준 체계를 다룹니다. 대지·용도가 주어지면 조경 접근과
배수·유지관리 관점을 안내하세요.`,
  interior: `당신은 NexyFab의 인테리어 AI 어시스턴트입니다. 공간 계획, 마감재·가구·조명 선정,
동선·치수 감각, 시공 순서와 개략 물량을 다룹니다. 공간 조건이 주어지면 레이아웃 방향과
마감 제안을 정리해 주세요.`,
};

const DOMAINS = Object.keys(DOMAIN_PROMPTS) as EngDomain[];

const COMMON_RULES = `
공통 지침:
- 반드시 사용자가 쓴 언어로 답하세요.
- 간결하고 실무적으로. 불릿·짧은 문단 위주.
- 수치를 지어내지 말고, 모르면 필요한 입력을 되물으세요.
- 산출 결과는 비법정 참고자료이며 최종 검토·서명은 유자격 기술자의 책임임을 답변 말미에
  한 줄로 밝히세요.`;

export async function POST(req: NextRequest) {
  // IP 레이트리밋 — 익명 경로(특히 mode:'title')의 무가드 반복 호출 차단(감사 2026-07-16)
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`eng-chat:${ip}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });

  const planCheck = await checkPlan(req, 'free');
  const userPlan = planCheck.ok ? planCheck.plan : 'free';

  try {
    const body = await req.json();
    const message: unknown = body?.message;
    const history: unknown = body?.history;
    const domainRaw: unknown = body?.domain;
    const wantStream = body?.stream === true;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }
    const domain: EngDomain = DOMAINS.includes(domainRaw as EngDomain)
      ? (domainRaw as EngDomain)
      : 'mechanical';

    // ── mode:'title' — 스레드 제목 요약(초경량, 슬롯 미소모) ─────────────────────
    if (body?.mode === 'title') {
      // 비용 브레이커는 title 경로도 통과해야 한다(감사: 우회 금지)
      try {
        const { getActiveBreaker } = await import('@/lib/cost-breaker');
        if (await getActiveBreaker()) return NextResponse.json({ title: null });
      } catch { /* 브레이커 조회 실패는 무시 */ }
      try {
        const result = await chatCompletion({
          messages: [
            { role: 'system', content: '대화의 주제를 사용자가 쓴 언어로 5단어 이내 명사구 제목으로 요약하라. 따옴표·마침표·접두어 없이 제목만 출력.' },
            { role: 'user', content: message.slice(0, 1200) },
          ],
          maxTokens: 24, temperature: 0.2, timeoutMs: 10_000, task: 'eng-chat-title',
        });
        const title = result.text.replace(/^["'「\s]+|["'」\s.]+$/g, '').slice(0, 40);
        return NextResponse.json({ title });
      } catch {
        return NextResponse.json({ title: null }); // 실패 시 클라 폴백(첫 문장 절단) 유지
      }
    }

    // 로그인 사용자에 한해 예산/쿼터 가드 (익명은 shape-chat 과 동일하게 무슬롯).
    // 슬롯은 shape_chat 과 공유해 별도 한도 신설을 피함.
    if (planCheck.ok) {
      const budget = await checkUserBudget(planCheck.userId);
      if (!budget.ok) {
        return NextResponse.json(
          { error: `오늘의 AI 사용 한도($${budget.limitUsd})에 도달했어요. 내일 다시 이용할 수 있습니다.`, code: 'COST_BUDGET', resetAtMs: budget.resetAtMs },
          { status: 402 },
        );
      }
      const { consumeMonthlyMetricSlot } = await import('@/lib/plan-guard');
      const slot = await consumeMonthlyMetricSlot(planCheck.userId, userPlan, 'shape_chat');
      if (!slot.ok) {
        return NextResponse.json(
          { error: `무료 플랜 월 한도(${slot.limit}회)에 도달했어요. Pro로 업그레이드하면 무제한입니다.`, code: 'PLAN_LIMIT' },
          { status: 429 },
        );
      }
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: `${DOMAIN_PROMPTS[domain]}\n${COMMON_RULES}` },
    ];
    const historyLimit = userPlan === 'free' ? 4 : 10;
    if (Array.isArray(history)) {
      for (const h of history.slice(-historyLimit)) {
        if (h?.role === 'user' || h?.role === 'assistant') {
          messages.push({ role: h.role, content: String(h.content ?? '').slice(0, 4000) });
        }
      }
    }
    messages.push({ role: 'user', content: message.slice(0, 4000) });
    const maxTokens = userPlan === 'free' ? 700 : 1200;

    // 비용 브레이커 — 활성 시 스트리밍/비스트리밍 모두 빠르게 차단.
    try {
      const { getActiveBreaker } = await import('@/lib/cost-breaker');
      if (await getActiveBreaker()) {
        return NextResponse.json({ error: 'AI is temporarily paused. Please try again later.' }, { status: 503 });
      }
    } catch { /* breaker 조회 실패는 무시하고 진행 */ }

    // ── 스트리밍 경로 (DeepSeek 직접, OpenAI 호환 SSE) ──────────────────────────
    if (wantStream) {
      try {
        const apiKey = (await getSetting('deepseek.api_key')) || process.env.DEEPSEEK_API_KEY;
        if (apiKey) {
          const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
          const upstream = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: maxTokens, temperature: 0.5, stream: true }),
            signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
          });
          if (upstream.ok && upstream.body) {
            const encoder = new TextEncoder();
            const src = upstream.body as unknown as AsyncIterable<Uint8Array>;
            const out = new ReadableStream<Uint8Array>({
              async start(controller) {
                try {
                  for await (const chunk of streamChat(src, { extractDelta: deepseekDeltaExtractor, signal: req.signal })) {
                    if (chunk.delta) controller.enqueue(encoder.encode(chunk.delta));
                  }
                } catch { /* 클라 연결 종료/업스트림 중단 — 스트림 정상 종료 */ }
                controller.close();
              },
            });
            return new Response(out, {
              headers: { 'content-type': 'text/plain; charset=utf-8', 'x-stream': '1', 'cache-control': 'no-cache, no-transform' },
            });
          }
          // upstream !ok → 아래 비스트리밍으로 폴백
        }
      } catch { /* 스트리밍 준비 실패 — 비스트리밍으로 폴백 */ }
    }

    // ── 비스트리밍 (프로바이더 폴백 체인 포함) ──────────────────────────────────
    try {
      const result = await chatCompletion({ messages, maxTokens, temperature: 0.5, timeoutMs: 30_000, task: 'eng-chat' });
      return NextResponse.json({ reply: result.text, domain, provider: result.provider });
    } catch (e) {
      if (e instanceof AiNotConfiguredError) {
        return NextResponse.json({ error: 'AI provider not configured' }, { status: 500 });
      }
      const detail = e instanceof AiProviderError
        ? `${e.provider}${e.status ? ` (${e.status})` : ''}: ${e.message}`
        : (e instanceof Error ? e.message : String(e));
      console.error('eng-chat AI provider error:', detail);
      return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
    }
  } catch (e) {
    captureServerError(e, { route: 'eng-chat' });
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}
