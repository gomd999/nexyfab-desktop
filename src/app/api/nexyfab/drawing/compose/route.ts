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
 * 그대로 동작. GEMINI_API_KEY는 apiKey() env-first로 process.env에서 읽음
 * (260803 — 260802의 OpenAI 전환을 되돌림. OpenAI 배선은 ai-json.mjs에 그대로 남아
 *  있어 `models: ['gpt-5.6-sol']` 이나 NEXYFAB_AI_JSON_MODELS 로 되돌아갈 수 있다).
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
import { recordFailure } from '@/lib/failureLog';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 64 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ComposeResult = {
  intent: unknown; scad?: string; gatePassed: boolean; rounds: number;
  gateErrors?: string[]; verify?: { manifold?: boolean; triangles?: number; error?: string } | null;
  // 260803 부분 산출 — 게이트에 걸린 피처만 빼고 형상을 냈을 때의 내역.
  dropped?: Array<{ id: string; kind: string; op: string; error: string; massDirection: string }>;
  degraded?: boolean;
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
    const body = await readBoundedJson<{ description?: string }>(req, MAX_BODY_BYTES);
    description = (body.description ?? '').trim();
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'description이 너무 깁니다(2000자 이하).' }, { status: 413 });
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
      /**
       * 여기까지 왔다는 것은 **피처를 빼도 형상이 성립하지 않는다**는 뜻이다
       * (`resolveComposeIntent` 가 add 를 전부 잃거나 태그로 못 짚는 오류일 때만 실패시킨다).
       * 잘못된 형상을 내는 것보다 사유를 말하는 게 낫다 — 다만 무엇을 빼려 했는지도 같이 싣는다.
       */
      // ★260803 — 피처를 빼도 형상이 성립하지 않은 진짜 실패. 지문으로 남긴다.
      void recordFailure({
        stage: 'gate', input: description, errors: r.gateErrors ?? [],
        partTypes: ((r.intent as { features?: Array<{ kind?: string }> })?.features ?? [])
          .map((f) => String(f?.kind ?? '')).filter(Boolean),
      });
      return NextResponse.json({
        ok: false, stage: 'gate', intent: r.intent, gateErrors: r.gateErrors, rounds: r.rounds,
        dropped: r.dropped ?? [],
      });
    }
    return NextResponse.json({
      ok: true, intent: r.intent, scad: r.scad, rounds: r.rounds, verify: r.verify,
      // ⚠ 부분 산출이면 질량 방향까지 실어 보낸다 — subtract 를 뺀 경우 **질량이 과대**다.
      dropped: r.dropped ?? [], degraded: r.degraded ?? false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 키 미설정은 503(설정 문제) — 백엔드를 Gemini↔OpenAI 로 바꿔도 맞게 남도록 둘 다 본다.
    const status = /DEEPSEEK_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY/.test(msg) ? 503 : 502;
    return NextResponse.json({ ok: false, error: 'compose failed: ' + msg.slice(0, 200) }, { status });
  }
}
