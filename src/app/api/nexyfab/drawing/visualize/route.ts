/**
 * /api/nexyfab/drawing/visualize — 3D 캔버스 PNG → Gemini 실사 컨셉 렌더링.
 *
 * 파이프라인: text → 2D도면 → 3D(결정론) → 뷰어 캔버스 PNG 캡처(클라이언트) →
 * 이 라우트가 Gemini 이미지 모델(image-to-image)로 재질·조명·환경만 입힌 실사 컨셉 생성.
 *
 * 정직 원칙: 기하·구도는 실제 3D 렌더 스크린샷이 기준(형상 결정론) — AI는 표면 마감·
 * 조명·환경 제안만. 산출물은 항상 "컨셉 이미지(비검증)" 라벨 — 치수·형상 근거로 쓰지 않음.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 7 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const DOMAIN_STYLE: Record<string, string> = {
  mech: '산업 장비 제품 사진 — 스테인리스·도장 금속 질감, 공장/스튜디오 조명',
  civil: '토목 구조물 현장 사진 — 콘크리트 표면 질감, 야외 자연광, 주변 지반·배수 환경',
  building: '건축 시공 완료 사진 — 노출 콘크리트 골조, 자연광, 현장 맥락',
  landscape: '조경 완성 사진 — 방부목 질감, 주변 식재(잔디·관목)·야외 자연광, 골든아워',
  interior: '인테리어 실사 — 따뜻한 조명, 목재·타일 마감, 카페 분위기, 소품 최소',
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-visualize:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  // 감사 2026-07-16: 요청당 최고비용(이미지 생성) — 플랜 가드+브레이커 복종
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;
  try {
    const { getActiveBreaker } = await import('@/lib/cost-breaker');
    if (await getActiveBreaker()) return NextResponse.json({ ok: false, error: 'AI가 일시 중지되어 있습니다.' }, { status: 503 });
  } catch { /* ignore */ }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'GEMINI_API_KEY 미설정' }, { status: 503 });

  let body: { imagePng?: string; domain?: string; style?: string };
  try {
    body = await readBoundedJson<typeof body>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: '이미지가 너무 큽니다(≤4MB)' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const png = (body.imagePng ?? '').replace(/^data:image\/\w+;base64,/, '');
  if (!png || png.length < 1000) return NextResponse.json({ ok: false, error: 'imagePng(base64) 필요' }, { status: 400 });
  if (png.length > 6_000_000) return NextResponse.json({ ok: false, error: '이미지가 너무 큽니다(≤4MB)' }, { status: 400 });

  const styleHint = typeof body.style === 'string' && body.style.trim() ? body.style.trim().slice(0, 300) : (DOMAIN_STYLE[body.domain ?? ''] ?? DOMAIN_STYLE.mech);
  const prompt = `이 이미지는 CAD에서 렌더링한 3D 설계 형상 스크린샷이다. **기하·구도·비례·부재 배치를 정확히 유지한 채** 사실적인 사진으로 변환하라.
스타일: ${styleHint}.
규칙: 형상·부재 수·비례 변경 금지, 새 구조물 추가 금지. 표면 재질·조명·배경 환경만 사실적으로. 텍스트·워터마크 없음.`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: png } }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ ok: false, error: `Gemini ${res.status}: ${t.slice(0, 180)}` }, { status: 502 });
    }
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> } }> };
    const parts = j.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const d = p.inlineData?.data ?? p.inline_data?.data;
      const m = p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? 'image/png';
      if (d) {
        return NextResponse.json({
          ok: true, imageBase64: d, mime: m,
          label: '컨셉 이미지(비검증) — 기하는 3D 렌더 기준, 재질·조명·환경은 AI 제안. 치수·형상 근거로 사용 금지.',
        });
      }
    }
    return NextResponse.json({ ok: false, error: 'Gemini가 이미지를 반환하지 않음(안전필터 가능)' }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'visualize failed: ' + (e instanceof Error ? e.message : String(e)).slice(0, 180) }, { status: 502 });
  }
}
