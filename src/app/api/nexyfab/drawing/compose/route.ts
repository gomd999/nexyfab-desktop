/**
 * POST /api/nexyfab/drawing/compose
 *
 * 사이트 배선(스테이지 C) — 범용 자유조합 파이프라인(scripts/drawing-to-3d)을
 * 웹앱에서 호출. 텍스트 설명 → AI 범용 프리미티브 조합 → 결정론 게이트/정규화 →
 * OpenSCAD. 3D 렌더는 클라이언트(브라우저 openscad-wasm)가 담당하므로 서버는
 * AI+게이트+방출(순수 JS)만 — 서버측 wasm 불필요.
 *
 * 구현 노트: compose.mjs를 webpackIgnore 런타임 import로 로드 → webpack이 번들
 * (및 그 안의 openscad-wasm dynamic import)을 건드리지 않아 런타임 노드 해석이
 * 그대로 동작. OPENAI_API_KEY는 openaiApiKey() env-first로 process.env에서 읽음
 * (260802 — Gemini/DeepSeek에서 OpenAI gpt-5.6-sol로 이전).
 *
 * caller: { description } → { ok, intent, scad?, gateErrors? }. scad를
 *   openscadWorker(브라우저)에 넣어 STL 렌더/프리뷰.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { guardStudioAi } from '@/lib/studio-ai-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ComposeResult = {
  intent: unknown; scad?: string; gatePassed: boolean; rounds: number;
  gateErrors?: string[]; verify?: { manifold?: boolean; triangles?: number; error?: string } | null;
};
type ComposeModule = {
  composeWithGate: (d: string, o?: { maxRounds?: number }) => Promise<ComposeResult>;
};

let _mod: ComposeModule | null = null;
async function loadCompose(): Promise<ComposeModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'compose.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as ComposeModule;
  return _mod;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-compose:${ip}`, 12, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  // 구독 정합(2026-07-16): 로그인=shape_chat 슬롯+예산, 익명=합산 리밋(게스트 데모 유지)
  const planGuard = await guardStudioAi(req);
  if (planGuard) return planGuard;

  let description: string;
  try {
    const body = (await req.json()) as { description?: string };
    description = (body.description ?? '').trim();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!description || description.length < 4) {
    return NextResponse.json({ ok: false, error: 'description이 필요합니다(최소 4자).' }, { status: 400 });
  }
  if (description.length > 2000) {
    return NextResponse.json({ ok: false, error: 'description이 너무 깁니다(2000자 이하).' }, { status: 400 });
  }

  let compose: ComposeModule;
  try {
    compose = await loadCompose();
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'pipeline load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }

  try {
    // 교정 루프 포함: AI 조합 → 게이트 → 실패 시 오류 되먹여 수정 → 실렌더 검증.
    const r = await compose.composeWithGate(description, { maxRounds: 2 });
    if (!r.gatePassed) {
      // 교정으로도 유효 형상 실패 — 형상 만들지 않고 오류 반환(잘못된 형상 방지).
      return NextResponse.json({ ok: false, stage: 'gate', intent: r.intent, gateErrors: r.gateErrors, rounds: r.rounds });
    }
    return NextResponse.json({ ok: true, intent: r.intent, scad: r.scad, rounds: r.rounds, verify: r.verify });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /OPENAI_API_KEY/.test(msg) ? 503 : 502;
    return NextResponse.json({ ok: false, error: 'compose failed: ' + msg.slice(0, 200) }, { status });
  }
}
