/**
 * /api/nexyfab/drawing/bridge-check — 거더교 체인 (실시설계급 계산·비법정).
 *
 * POST { assembly, params } → 고정하중(형상×밀도) + KL-510 활하중(영향선 엔진,
 * 공표표 재현 검증) × 레버룰/입력 DF → 극한 I(1.25DC+1.50DW+1.80LL, KDS 24 12 11
 * 원문) → 선택 시 RC 단면 검토(rc_beam). format:'html' 시 리포트 동봉.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Mod = {
  bridgeCheck: (assembly: unknown, params: Record<string, unknown>) => unknown;
  bridgeLoop?: (assembly: unknown, params: Record<string, unknown>) => unknown;
  archBridgeCheck?: (assembly: unknown, params: Record<string, unknown>) => unknown;
};
type RptMod = { bridgeReport: (r: unknown, o?: Record<string, unknown>) => string; archBridgeReport?: (r: unknown, o?: Record<string, unknown>) => string };

let _mod: Mod | null = null;
let _rpt: RptMod | null = null;
async function load(): Promise<Mod> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'bridge-check.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as Mod;
  return _mod;
}
async function loadRpt(): Promise<RptMod> {
  if (_rpt) return _rpt;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'chain-reports.mjs');
  _rpt = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as RptMod;
  return _rpt;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-bridge:${ip}`, 20, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { assembly?: { parts?: unknown[]; name?: string }; params?: Record<string, unknown>; format?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!Array.isArray(body.assembly?.parts) || body.assembly.parts.length === 0) {
    return NextResponse.json({ ok: false, error: 'assembly.parts 가 필요합니다.' }, { status: 400 });
  }

  try {
    const mod = await load();
    // 아치교(archMeta)=간이 폐형 체인(260718), 거더교(bridgeMeta)=실시설계급 체인 — 자동 디스패치
    const isArch = !!(body.assembly as { archMeta?: unknown }).archMeta && !!mod.archBridgeCheck;
    const result = isArch
      ? mod.archBridgeCheck!(body.assembly, body.params ?? {})
      : (body as { mode?: string }).mode === 'loop' && mod.bridgeLoop ? mod.bridgeLoop(body.assembly, body.params ?? {}) : mod.bridgeCheck(body.assembly, body.params ?? {});
    if (body.format === 'html') {
      const rpt = await loadRpt();
      let svg = '';
      try {
        const sp = join(process.cwd(), 'scripts', 'drawing-to-3d', 'section-drawings.mjs');
        const sd = (await import(/* webpackIgnore: true */ pathToFileURL(sp).href)) as { bridgeGeneralSvg: (bm: unknown, o?: Record<string, unknown>) => string };
        const bm = (body.assembly as { bridgeMeta?: unknown }).bridgeMeta;
        if (bm) svg = sd.bridgeGeneralSvg(bm);
      } catch { /* 도면 실패는 비치명 */ }
      const html = isArch && rpt.archBridgeReport
        ? rpt.archBridgeReport(result, { title: body.assembly?.name ?? '아치교 간이 검토' })
        : rpt.bridgeReport(result, { title: body.assembly?.name ?? '거더교 검증', svg });
      return NextResponse.json({ result, html });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'bridge-check failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
