/**
 * /api/nexyfab/drawing/param-sweep — ① 안전범위 밴드 · ② 목표 기반 자동 탐색.
 * POST { domain, templateId, params, chainParams, param, min, max, points?, goal?, res? }
 * goal 없으면 밴드만, goal='minPass'|'maxPass'면 이분법 탐색 결과 포함.
 * 각 점 = 어셈블리 재빌드 + 체인 전체 재검증(결정론) — AI 아님.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Mod = {
  sweepParam: (o: Record<string, unknown>) => Record<string, unknown>;
  searchGoal: (o: Record<string, unknown>) => Record<string, unknown>;
};
type SnapMod = { snapFor: (p: string) => Record<string, unknown>; snapValue: (p: string, v: number) => Record<string, unknown> };

let _mod: Mod | null = null;
let _snap: SnapMod | null = null;
async function load(): Promise<Mod> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'param-sweep.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as Mod;
  return _mod;
}
async function loadSnap(): Promise<SnapMod> {
  if (_snap) return _snap;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'snap-lists.mjs');
  _snap = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as SnapMod;
  return _snap;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-sweep:${ip}`, 12, 60_000); // 스윕은 무겁다 — 보수적 제한
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  for (const k of ['domain', 'templateId', 'param']) {
    if (!body[k]) return NextResponse.json({ ok: false, error: `${k} 필요` }, { status: 400 });
  }

  try {
    const mod = await load();
    const result = body.goal ? mod.searchGoal(body) : mod.sweepParam(body);
    // 스냅 정보 동봉 (③ — 클라이언트가 결과 값에 표 절점 스냅 제안)
    const snap = (await loadSnap()).snapFor(String(body.param));
    return NextResponse.json({ ...result, snap });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'param-sweep failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
