/**
 * /api/nexyfab/drawing/landscape-check — 조경 구조 체인 (Wave A · 조경 L1+L2).
 *
 * POST { assembly, params } → 목재 부재 검토(timber_beam, 단면·스팬·간격 형상 파생)
 * + 풍하중 전도(입력 풍압 → FS·앵커 인발). 풍압 미입력 시 전도는 정직 생략.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Mod = { landscapeCheck: (assembly: unknown, params: Record<string, unknown>) => unknown };
type RptMod = { landscapeReport: (r: unknown, o?: Record<string, unknown>) => string };

let _mod: Mod | null = null;
let _rpt: RptMod | null = null;
async function load(): Promise<Mod> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'landscape-check.mjs');
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
  const rl = rateLimit(`drawing-landscape:${ip}`, 20, 60_000);
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
    const result = mod.landscapeCheck(body.assembly, body.params ?? {});
    if (body.format === 'html') {
      const rpt = await loadRpt();
      const { designNet } = await import('@/lib/design-net');
      const { net, rev } = await designNet(body.assembly, 'landscape');
      return NextResponse.json({ result, html: rpt.landscapeReport(result, { title: body.assembly?.name ?? '조경 구조 검증', net, rev }) });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'landscape-check failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
