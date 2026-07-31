/**
 * POST /api/nexyfab/drawing/flow — **한 번의 호출로 이어지는 설계 흐름** (260802).
 *
 * ## 문제의 정확한 형태
 * 기능이 없는 게 아니다. **사용자가 네 번 결정해야** 했다:
 * ```
 * /genimage     시안 이미지
 * /assemble     자연어 → 어셈블리      (260802: 게이트 통과 12.5% → 87.5%)
 * /import-step  실물 CAD → 어셈블리    (260802: 커널 우선 · 정확 물성)
 * /package      도면·물량·검토·STEP
 * ```
 * 경쟁 제품이 파는 것은 개별 기능이 아니라 **한 번**이다.
 *
 * ## ⚠ 이것은 **오케스트레이터**다 — 새 엔진이 아니다
 * 판정·게이트·형상은 **전부 기존 소스**가 한다. 여기서 새 판정을 만들지 않는다 —
 * 요약이 원본과 갈리면 그게 더 나쁘다(이 세션 내내 지킨 규약).
 *
 * ## 규약
 * 1. **단계마다 성공/실패와 사유를 남긴다.** 하나가 실패해도 나머지를 진행한다 —
 *    「없음」이 「필요 없음」으로 읽히면 안 된다.
 * 2. **부분 성공을 성공이라 하지 않는다.** 최종 `ok` 는 **필수 단계**가 다 됐을 때만 참이고,
 *    선택 단계 실패는 `partial: true` 로 구별한다.
 * 3. **단계별 소요를 싣는다.** 커널 20.6초·AI 8초가 붙으므로 사용자는 **어디서 기다리는지**
 *    알아야 한다.
 * 4. **되돌아갈 수 있어야 한다.** 중간 산출물(어셈블리 JSON)을 그대로 돌려줘,
 *    3단계만 다시 하고 싶을 때 1단계부터 하지 않게 한다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 한 단계의 결과 — **성공했든 아니든 반드시 남긴다.** */
interface Step {
  name: string;
  ok: boolean;
  ms: number;
  /** 필수 단계인가. 선택 단계 실패는 전체를 실패로 만들지 않는다. */
  required: boolean;
  /** 실패 사유. 성공이면 null — 「사유 없음」이 「성공」으로 읽히지 않게 명시한다. */
  reason: string | null;
}

type Json = Record<string, unknown>;

/**
 * 내부 라우트를 부른다. ⚠ HTTP 로 자기 자신을 부르지 않는다 —
 *   배포 환경에서 자기 호출은 URL·인증·타임아웃이 얽히고, 무엇보다 **한 요청이
 *   여러 요청으로 늘어나 rate limit 를 자기가 소진한다.** 핸들러를 직접 부른다.
 */
async function callRoute(
  mod: Promise<{ POST: (r: NextRequest) => Promise<Response> }>,
  body: Json,
  req: NextRequest,
): Promise<{ status: number; json: Json }> {
  const { POST } = await mod;
  const h = new Headers({ 'content-type': 'application/json' });
  const xff = req.headers.get('x-forwarded-for');
  if (xff) h.set('x-forwarded-for', xff);
  const sub = new NextRequest(req.url, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const res = await POST(sub);
  let json: Json = {};
  try { json = (await res.json()) as Json; } catch { json = {}; }
  return { status: res.status, json };
}

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  // ⚠ 흐름 하나가 하위 라우트를 여러 번 부르므로 **여기서 한 번만** 제한한다.
  const rl = rateLimit(`drawing-flow:${ip}`, 3, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 많습니다 — 잠시 후 다시 시도하세요.' }, { status: 429 });

  let body: { text?: string; stepText?: string; options?: Json; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const stepText = typeof body.stepText === 'string' ? body.stepText : '';
  if (!text && !stepText) {
    return NextResponse.json({ ok: false, error: 'text(자연어) 또는 stepText(실물 CAD) 중 하나가 필요합니다.' }, { status: 400 });
  }

  const steps: Step[] = [];
  const t0 = Date.now();
  const run = async (name: string, required: boolean, fn: () => Promise<{ ok: boolean; reason?: string }>): Promise<boolean> => {
    const s = Date.now();
    try {
      const r = await fn();
      steps.push({ name, ok: r.ok, ms: Date.now() - s, required, reason: r.ok ? null : (r.reason ?? '실패') });
      return r.ok;
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - s, required, reason: String(e instanceof Error ? e.message : e).slice(0, 200) });
      return false;
    }
  };

  let assembly: Json | null = null;
  let fidelity: string | null = null;
  let fidelityWarnings: string[] = [];

  // ── 1) 형상 확보 — 실물 CAD 가 있으면 그쪽이 우선이다(선언이 추정보다 낫다) ──────
  if (stepText) {
    await run('import-step', true, async () => {
      const { status, json } = await callRoute(import('../import-step/route'), { step: stepText, name: body.name ?? 'CAD import' }, req);
      if (status !== 200 || json.ok !== true) return { ok: false, reason: String(json.error ?? `status ${status}`) };
      assembly = (json.assembly as Json) ?? null;
      fidelity = typeof json.fidelity === 'string' ? json.fidelity : null;
      fidelityWarnings = Array.isArray(json.fidelityWarnings) ? (json.fidelityWarnings as string[]) : [];
      return { ok: assembly != null, reason: assembly ? undefined : '어셈블리가 비었다' };
    });
  } else {
    await run('assemble', true, async () => {
      const { status, json } = await callRoute(import('../assemble/route'), { description: text }, req);
      if (status !== 200 || json.ok !== true) return { ok: false, reason: String(json.error ?? `status ${status}`) };
      assembly = (json.assembly as Json) ?? null;
      return { ok: assembly != null, reason: assembly ? undefined : '어셈블리가 비었다' };
    });
  }

  // ── 2) 패키지 — 도면·물량·검토·STEP ──────────────────────────────────────
  let pkg: Json | null = null;
  if (assembly) {
    await run('package', true, async () => {
      const { status, json } = await callRoute(import('../package/route'), { assembly, options: body.options ?? {} }, req);
      if (status !== 200 || json.ok !== true) return { ok: false, reason: String(json.error ?? `status ${status}`) };
      pkg = json;
      return { ok: true };
    });
  }

  const required = steps.filter((s) => s.required);
  const ok = required.length > 0 && required.every((s) => s.ok);
  const partial = ok && steps.some((s) => !s.ok);

  return NextResponse.json({
    ok,
    /** 필수는 다 됐지만 선택 단계가 실패했다 — **성공이라 부르지 않는다.** */
    ...(partial ? { partial: true } : {}),
    steps,
    totalMs: Date.now() - t0,
    /** 중간 산출물 — 특정 단계만 다시 하려면 이것을 그대로 다음 호출에 넣는다. */
    assembly,
    ...(fidelity ? { fidelity } : {}),
    ...(fidelityWarnings.length ? { fidelityWarnings } : {}),
    ...(pkg ? { package: pkg } : {}),
  });
}
