/**
 * /api/nexyfab/drawing/interior-check — 인테리어 피난·마감 체인 (Wave A · I2+I3).
 *
 * POST { assembly, params } → 보행거리 BFS(최원점→출입구, 장애물 우회) +
 * 수용인원·피난폭(occupancy_egress, 문폭 형상 파생) + 마감 물량(개구 공제).
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Mod = { interiorCheck: (assembly: unknown, params: Record<string, unknown>) => unknown };
type RptMod = { interiorReport: (r: unknown, o?: Record<string, unknown>) => string };

let _mod: Mod | null = null;
let _rpt: RptMod | null = null;
async function load(): Promise<Mod> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'interior-check.mjs');
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
  const rl = rateLimit(`drawing-interior:${ip}`, 20, 60_000);
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
    const result = mod.interiorCheck(body.assembly, body.params ?? {});
    if (body.format === 'html') {
      const rpt = await loadRpt();
      return NextResponse.json({ result, html: rpt.interiorReport(result, { title: body.assembly?.name ?? '피난·마감 검증' }) });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'interior-check failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
