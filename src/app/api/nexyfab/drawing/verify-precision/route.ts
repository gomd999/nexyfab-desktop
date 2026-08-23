/**
 * POST /api/nexyfab/drawing/verify-precision — 스튜디오 "정밀 검증" 온디맨드 (P0-b, 260719b).
 *
 * A1 라운드트립(STEP 재임포트 실측 ↔ 폐형 예측 부피·AABB) + B1 의심쌍 메시 부울
 * (AABB 과탐 해제·실측 관통량 — 잔여 간섭 시). 생성≠검증의 웹 표면화 —
 * MCP step_roundtrip/refine_interferences 도구와 동일 엔진(단일 소스).
 * 격자 템플릿(송전탑류)은 latticeLap 관례 분류 옵션 동봉.
 * caller: { assembly, latticeLapMm3? } → { ok, roundtrip, interferenceRefine, interferences, designOk }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Assembly = { parts?: Array<Record<string, unknown>> };
type Built = { ok: boolean; gateErrors?: string[]; interferences?: unknown[]; designOk?: boolean };
type Mods = {
  asm: { buildAssembly: (a: Assembly) => Built };
  rt: { stepRoundTrip: (a: Assembly) => Promise<unknown> };
  ir: { refineInterferencesMesh: (a: Assembly, i: unknown[], o?: { latticeLapMm3?: number }) => Promise<unknown> };
};

let _m: Mods | null = null;
async function load(): Promise<Mods> {
  if (_m) return _m;
  const base = join(process.cwd(), 'scripts', 'drawing-to-3d');
  const imp = (f: string) => import(/* webpackIgnore: true */ pathToFileURL(join(base, f)).href);
  _m = { asm: (await imp('assembly.mjs')) as Mods['asm'], rt: (await imp('roundtrip.mjs')) as Mods['rt'], ir: (await imp('interference-refine.mjs')) as Mods['ir'] };
  return _m;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-verify-precision:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let assembly: Assembly;
  let latticeLapMm3 = 0;
  try {
    const body = await readBoundedJson<{ assembly?: Assembly; latticeLapMm3?: number }>(req, MAX_BODY_BYTES);
    assembly = body.assembly ?? {};
    if (typeof body.latticeLapMm3 === 'number' && body.latticeLapMm3 > 0) latticeLapMm3 = Math.min(body.latticeLapMm3, 200_000);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'assembly가 너무 큽니다.' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!Array.isArray(assembly.parts) || assembly.parts.length === 0) {
    return NextResponse.json({ ok: false, error: 'assembly.parts 가 필요합니다.' }, { status: 400 });
  }

  let mods: Mods;
  try { mods = await load(); } catch (e) {
    return NextResponse.json({ ok: false, error: 'pipeline load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }

  const built = mods.asm.buildAssembly(assembly);
  if (!built.ok) return NextResponse.json({ ok: false, stage: 'gate', gateErrors: built.gateErrors ?? [] }, { status: 200 });

  let roundtrip: unknown = null;
  try { roundtrip = await mods.rt.stepRoundTrip(assembly); } catch (e) { roundtrip = { error: String(e instanceof Error ? e.message : e).slice(0, 160) }; }
  let interferenceRefine: unknown = null;
  if ((built.interferences ?? []).length) {
    try { interferenceRefine = await mods.ir.refineInterferencesMesh(assembly, built.interferences ?? [], latticeLapMm3 > 0 ? { latticeLapMm3 } : undefined); } catch (e) { interferenceRefine = { error: String(e instanceof Error ? e.message : e).slice(0, 160) }; }
  }
  return NextResponse.json({
    ok: true, roundtrip, interferenceRefine,
    interferences: built.interferences ?? [], designOk: built.designOk ?? null,
    note: 'A1=STEP 재임포트 실측↔폐형 예측(밴드 명시) · B1=의심쌍 한정 메시 부울(전수 아님 명시)',
  });
}
