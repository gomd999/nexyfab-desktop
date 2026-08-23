/**
 * /api/nexyfab/drawing/genimage — 텍스트/사진 → 흰 배경 시안 이미지.
 *
 * 파이프라인 위치: text→[시안 이미지]→2D도안→3D · image→[배경 정리]→2D도안→3D.
 * 입력 커스텀 계층(buildGenImagePrompt)이 흰 배경·단일 객체·정면 뷰 규격을 강제 —
 * 다운스트림 도안 판독 정확도를 위한 설계이지 미관 옵션이 아니다.
 *
 * 쿼터: 비회원(데모세션+IP)·무료 2회/일, 유료 50회/일(nf_usage_events 'image_gen').
 * 정직 원칙: 시안은 치수·형상 근거가 아님 — 라벨 동봉, 도안 변환은 기존 게이트 통과 필수.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { checkPlan } from '@/lib/plan-guard';
import { checkUserBudget } from '@/lib/ai/userBudget';
import { buildGenImagePrompt, consumeDailyImageSlot, GENIMAGE_ANON_DAILY } from '@/lib/genimage';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 7 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-genimage:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  try {
    const { getActiveBreaker } = await import('@/lib/cost-breaker');
    if (await getActiveBreaker()) return NextResponse.json({ ok: false, error: 'AI가 일시 중지되어 있습니다.' }, { status: 503 });
  } catch { /* ignore */ }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'GEMINI_API_KEY 미설정' }, { status: 503 });

  let body: { prompt?: string; imageBase64?: string; mimeType?: string; domain?: string };
  try {
    body = await readBoundedJson<typeof body>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: '이미지가 너무 큽니다(≤4MB)' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const text = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const img = (body.imageBase64 ?? '').replace(/^data:image\/\w+;base64,/, '');
  if (!text && !img) return NextResponse.json({ ok: false, error: 'prompt 또는 imageBase64 필요' }, { status: 400 });
  if (img && img.length > 6_000_000) return NextResponse.json({ ok: false, error: '이미지가 너무 큽니다(≤4MB)' }, { status: 400 });
  const mime = /^image\/(png|jpe?g|webp)$/.test(body.mimeType ?? '') ? String(body.mimeType) : 'image/png';

  // ── 일일 쿼터(사용자 결정: 비회원·무료 2/일, 유료 50/일) — 슬롯 선소모 ──
  let quota: { used: number; limit: number };
  const planCheck = await checkPlan(req, 'free');
  if (planCheck.ok) {
    const budget = await checkUserBudget(planCheck.userId, planCheck.orgId);
    if (!budget.ok) {
      return NextResponse.json({ ok: false, error: `일일 AI 사용 한도($${budget.limitUsd})에 도달했습니다.`, code: 'COST_BUDGET' }, { status: 402 });
    }
    const slot = await consumeDailyImageSlot(planCheck.userId, planCheck.plan);
    if (!slot.ok) {
      return NextResponse.json({ ok: false, error: `오늘 이미지 생성 한도(${slot.limit}회)에 도달했습니다.`, code: 'IMAGE_QUOTA', used: slot.used, limit: slot.limit }, { status: 429 });
    }
    quota = { used: slot.used, limit: slot.limit };
  } else {
    // 비회원 — 데모세션 id(있으면)+IP 키. 인메모리+Redis 동기(rate-limit) 24h 창.
    let sid = '';
    try {
      const { getDemoSession } = await import('@/lib/demo-session');
      sid = (await getDemoSession(req))?.id ?? '';
    } catch { /* 세션 없음 — IP만 */ }
    const anonRl = rateLimit(`genimage-day:${sid || 'ip'}:${ip}`, GENIMAGE_ANON_DAILY, 86_400_000);
    if (!anonRl.allowed) {
      return NextResponse.json({
        ok: false, error: `오늘 이미지 생성 한도(${GENIMAGE_ANON_DAILY}회)에 도달했습니다. 가입(무료)하면 매일 이어서, Pro는 50회/일.`,
        code: 'IMAGE_QUOTA', used: GENIMAGE_ANON_DAILY, limit: GENIMAGE_ANON_DAILY,
      }, { status: 429 });
    }
    quota = { used: GENIMAGE_ANON_DAILY - anonRl.remaining, limit: GENIMAGE_ANON_DAILY };
  }

  const prompt = buildGenImagePrompt({ text, hasImage: !!img, domain: body.domain });
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (img) parts.push({ inline_data: { mime_type: mime, data: img } });

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ ok: false, error: `Gemini ${res.status}: ${t.slice(0, 180)}` }, { status: 502 });
    }
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> } }> };
    for (const p of j.candidates?.[0]?.content?.parts ?? []) {
      const d = p.inlineData?.data ?? p.inline_data?.data;
      const m = p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? 'image/png';
      if (d) {
        return NextResponse.json({
          ok: true, imageBase64: d, mime: m,
          quota: { ...quota, remaining: Math.max(0, quota.limit - quota.used) },
          label: 'AI 시안(흰 배경, 비검증) — 치수·형상 근거 아님. 도안 변환 시 판독 게이트를 통과해야 함.',
        });
      }
    }
    return NextResponse.json({ ok: false, error: 'Gemini가 이미지를 반환하지 않음(안전필터 가능)' }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'genimage failed: ' + (e instanceof Error ? e.message : String(e)).slice(0, 180) }, { status: 502 });
  }
}
