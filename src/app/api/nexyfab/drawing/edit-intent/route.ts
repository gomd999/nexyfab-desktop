/**
 * /api/nexyfab/drawing/edit-intent — "말로 수정" (P2 확장).
 *
 * POST { utterance, allowedParams: [{name, current, min?, max?, unit?}], selectedParam? }
 * → { ok, edits: [{param, op:'set'|'delta', value}], source:'regex'|'llm', note? }
 *
 * 계약: AI는 문장→구조화 편집 변환만(이해). 값의 적용·한계는 클라이언트 재빌드 시
 * reconstruct 게이트 + 체인 재검증이 결정론으로 처리 — AI가 형상을 직접 만지지 않음.
 * 정규식 우선(결정론, "200 줄여"·"3000으로"·"10% 늘려") → 못 읽으면 LLM 폴백
 * (allowedParams 목록으로 제약, JSON 강제, 검증 실패 시 정직 거부).
 */
import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion, AiNotConfiguredError, type ChatMessage } from '@/lib/ai';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 256 * 1024;

type ParamSpec = { name: string; current: number; min?: number; max?: number; unit?: string };
type Edit = { param: string; op: 'set' | 'delta'; value: number };

/** 정규식 우선 파서 — 선택 파라미터 문맥에서 수치·증감 해석 (결정론). */
function parseRegex(utterance: string, selected: string | undefined, params: ParamSpec[]): Edit[] | null {
  const u = utterance.replace(/\s+/g, ' ').trim();
  // 대상 파라미터: 문장에 이름이 있으면 그것, 없으면 선택된 것
  const named = params.find((p) => u.toLowerCase().includes(p.name.toLowerCase()));
  const target = named?.name ?? selected;
  if (!target) return null;
  const spec = params.find((p) => p.name === target);
  if (!spec) return null;

  // 단위 흡수: m/cm/mm → mm
  const num = (s: string, unit?: string) => {
    const v = parseFloat(s);
    if (unit === 'm') return v * 1000;
    if (unit === 'cm') return v * 10;
    return v;
  };
  let m;
  // "X(m|cm|mm)로/으로 (해|맞춰|설정)" → set
  if ((m = u.match(/([\d.]+)\s*(mm|cm|m)?\s*(로|으로)\s*(해|맞|설정|변경|바꿔)?/))) {
    return [{ param: target, op: 'set', value: num(m[1], m[2]) }];
  }
  // "X% 줄여/늘려" → delta 비율
  if ((m = u.match(/([\d.]+)\s*%\s*(줄|감소|늘|증가|키)/))) {
    const pct = parseFloat(m[1]) / 100;
    const sign = /줄|감소/.test(m[2]) ? -1 : 1;
    return [{ param: target, op: 'delta', value: Math.round(spec.current * pct) * sign }];
  }
  // "X(mm|cm|m) 줄여/늘려/키워/올려/내려/두껍게/얇게" → delta
  if ((m = u.match(/([\d.]+)\s*(mm|cm|m)?\s*(만큼)?\s*(줄|감소|빼|늘|증가|키|올|내|두껍|얇)/))) {
    const sign = /줄|감소|빼|내|얇/.test(m[4]) ? -1 : 1;
    return [{ param: target, op: 'delta', value: num(m[1], m[2]) * sign }];
  }
  return null;
}

const LLM_SYS = `너는 CAD 편집 인텐트 변환기다. 사용자의 한 문장을 아래 허용 파라미터 목록 안에서 JSON 배열로 변환한다.
출력은 오직 JSON: [{"param":"이름","op":"set"|"delta","value":숫자(mm)}] — 다른 텍스트 금지.
규칙: 목록에 없는 파라미터 금지. 애매하면 빈 배열 []. 값을 지어내지 말 것. m/cm는 mm로 환산.`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { utterance?: string; allowedParams?: ParamSpec[]; selectedParam?: string; lang?: string } = {};
  let bodyError: ReturnType<typeof boundedJsonError> = null;
  try { body = await readBoundedJson<typeof body>(req, MAX_BODY_BYTES); }
  catch (error) { bodyError = boundedJsonError(error); }
  const locale = resolveServerLocale(req, body.lang ?? req.nextUrl.searchParams.get('lang'));
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-editintent:${ip}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'rateLimited'), outputLanguage: locale.route }, { status: 429 });
  // 구독 정합(2026-07-16): 로그인=shape_chat 슬롯+예산, 익명=합산 리밋(게스트 데모 유지)
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  if (bodyError) {
    return NextResponse.json(
      { ok: false, error: localizedApiMessage(locale, 'badRequest'), outputLanguage: locale.route },
      { status: bodyError.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400 },
    );
  }
  const utterance = (body.utterance ?? '').slice(0, 300);
  const params = Array.isArray(body.allowedParams) ? body.allowedParams.slice(0, 40) : [];
  if (!utterance || !params.length) {
    return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'messageRequired'), outputLanguage: locale.route }, { status: 400 });
  }

  // 1) 정규식 우선 (결정론)
  const rex = parseRegex(utterance, body.selectedParam, params);
  if (rex) return NextResponse.json({ ok: true, edits: rex, source: 'regex', outputLanguage: locale.route });

  // 2) LLM 폴백 — allowedParams 제약 + JSON 강제 + 사후 검증(결정론 게이트)
  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: `${LLM_SYS}\n[OUTPUT LANGUAGE CONTRACT] Keep JSON keys, parameter identifiers, operation names, and numeric values unchanged.` },
      {
        role: 'user',
        content: `허용 파라미터: ${JSON.stringify(params.map((p) => ({ name: p.name, current: p.current, min: p.min, max: p.max })))}\n선택됨: ${body.selectedParam ?? '없음'}\n문장: ${utterance}`,
      },
    ];
    const res = await chatCompletion({ messages, maxTokens: 300, temperature: 0 });
    const text = (res as { text?: string; content?: string }).text ?? (res as { content?: string }).content ?? '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'invalidAiResponse'), outputLanguage: locale.route });
    let edits: Edit[];
    try {
      edits = JSON.parse(jsonMatch[0]) as Edit[];
    } catch {
      return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'invalidAiResponse'), outputLanguage: locale.route });
    }
    // 사후 검증: 허용 목록·연산·수치 (지어낸 파라미터 거부)
    const names = new Set(params.map((p) => p.name));
    const valid = edits.filter((e) => e && names.has(e.param) && (e.op === 'set' || e.op === 'delta') && Number.isFinite(e.value));
    if (!valid.length) return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'badRequest'), outputLanguage: locale.route });
    return NextResponse.json({ ok: true, edits: valid, source: 'llm', note: localizedApiMessage(locale, 'freeformSummary'), outputLanguage: locale.route });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'providerNotConfigured'), outputLanguage: locale.route });
    }
    console.error('edit-intent provider error:', e);
    return NextResponse.json({ ok: false, error: localizedApiMessage(locale, 'providerFailed'), outputLanguage: locale.route }, { status: 502 });
  }
}
