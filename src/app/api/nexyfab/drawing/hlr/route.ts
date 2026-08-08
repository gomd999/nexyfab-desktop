/**
 * POST /api/nexyfab/drawing/hlr
 *
 * K5 심화(260808) — 어셈블리 → OCCT HLR 실투영 도면(가시선+은선) + 해석 치수
 * (placedAabb·plate holes 파라미터 사상 — 픽셀 측정 아님, 날조 불가).
 * 수 초 걸리는 온디맨드 연산 — 실시간 프리뷰가 아니라 도면 출력용.
 *
 * caller: { assembly, views? } 또는 { intent, views? }(체크포인트 단계 — 어셈블리
 * 이전, compose intent 직결. K5 확대 260808) → { ok, views: { front?, top? }, dims }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type HlrResult = {
  ok: boolean; views?: Record<string, string>; dims?: unknown; gateErrors?: string[];
};
type HlrModule = {
  hlrDrawingWithDims: (asm: unknown, opts?: { views?: string[] }) => Promise<HlrResult>;
  hlrDrawingFromIntent: (intent: unknown, opts?: { views?: string[] }) => Promise<HlrResult>;
};

let _mod: HlrModule | null = null;
async function loadHlr(): Promise<HlrModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'hlr-drawing.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as HlrModule;
  return _mod;
}

const ALLOWED_VIEWS = new Set(['front', 'top', 'left']);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  // HLR 은 STEP 왕복 포함 수 초 연산 — html 렌더보다 빡빡한 한도.
  const rl = rateLimit(`drawing-hlr:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { assembly?: { parts?: unknown[] }; intent?: Record<string, unknown>; views?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const hasIntent = !!body.intent && typeof body.intent === 'object';
  if (!hasIntent && (!body.assembly || !Array.isArray(body.assembly.parts) || body.assembly.parts.length === 0)) {
    return NextResponse.json({ ok: false, error: 'assembly.parts[] 또는 intent 가 필요합니다.' }, { status: 400 });
  }
  if (!hasIntent && body.assembly!.parts!.length > 600) {
    // HLR(STEP 왕복+은선 제거)은 조립 검증(20k)과 예산이 다르다 — STEP 방출 상한과 정렬.
    return NextResponse.json({ ok: false, error: `부품 ${body.assembly!.parts!.length} > HLR 예산 600 — 구간을 나눠 출력하세요.` }, { status: 413 });
  }
  const views = (body.views ?? ['front', 'top']).filter((v) => ALLOWED_VIEWS.has(v)).slice(0, 3);
  if (!views.length) return NextResponse.json({ ok: false, error: 'views 는 front/top/left 중에서.' }, { status: 400 });

  try {
    const mod = await loadHlr();
    const result = hasIntent
      ? await mod.hlrDrawingFromIntent(body.intent, { views })
      : await mod.hlrDrawingWithDims(body.assembly, { views });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: hasIntent ? 'intent gate 실패' : 'assembly gate 실패', gateErrors: result.gateErrors ?? [] }, { status: 422 });
    }
    return NextResponse.json({ ok: true, views: result.views, dims: result.dims });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'HLR projection failed: ' + msg.slice(0, 200) }, { status: 502 });
  }
}
