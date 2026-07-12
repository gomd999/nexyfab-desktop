/**
 * GET  /api/nexyfab/drawing/fab  → 기본 단가표(편집용)
 * POST /api/nexyfab/drawing/fab  → { intent, thicknessMm?, rates? } → { spec, estimate, dxf }
 *
 * 완벽화 Pillar ⑤: 판재 레이저 제조 명세(결정론) + 예상비용(추정) + 절단 DXF.
 * spec(절단길이·피어싱·중량 등)은 정확, estimate.total은 예상(편집 단가). dxf는 평판 절단용.
 * fab.mjs를 webpackIgnore 런타임 import.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type FabModule = {
  DEFAULT_RATES: Record<string, number>;
  fabSpec: (intent: unknown, opts?: { thicknessMm?: number; densityKgMm3?: number }) => Record<string, unknown>;
  estimateCost: (spec: unknown, rates?: Record<string, number>) => Record<string, unknown>;
  toDxf: (intent: unknown) => string | null;
};

let _mod: FabModule | null = null;
async function loadFab(): Promise<FabModule> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'fab.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as FabModule;
  return _mod;
}

export async function GET(): Promise<NextResponse> {
  try {
    const mod = await loadFab();
    return NextResponse.json({ ok: true, rates: mod.DEFAULT_RATES });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-fab:${ip}`, 40, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { intent?: unknown; thicknessMm?: number; rates?: Record<string, number> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!body.intent || typeof body.intent !== 'object') {
    return NextResponse.json({ ok: false, error: 'intent가 필요합니다.' }, { status: 400 });
  }

  try {
    const mod = await loadFab();
    const spec = mod.fabSpec(body.intent, { thicknessMm: body.thicknessMm });
    const estimate = mod.estimateCost(spec, body.rates ?? {});
    const dxf = mod.toDxf(body.intent);
    return NextResponse.json({ ok: true, spec, estimate, dxf });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'fab failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
