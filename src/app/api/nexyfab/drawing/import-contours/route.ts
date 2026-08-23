/**
 * POST /api/nexyfab/drawing/import-contours — 수치지형도 DXF → 등고(contours) 인입.
 *
 * body: { dxf: string, origin: {E, N}(m), layerFilter?: string }
 * → { ok, contours: [{elevM, pts(mm 로컬)}], stats } — Wave 2 좌표 규약(절대 TM m+origin) 동일.
 * 파싱=결정론(dxf-import.mjs)·표고 없는 폴리라인=제외 집계(지어내지 않음).
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

// Match the generic API proxy ceiling; ordinary ASCII DXF up to the existing
// product limit still fits without advertising an unreachable route budget.
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ImpMod = {
  parseDxfContours: (t: string, o?: { layerFilter?: string | null }) => { contours: Array<{ layer: string; elevM: number; pts: number[][] }>; stats: Record<string, unknown> };
  contoursToLocal: (p: { contours: Array<{ elevM: number; pts: number[][] }> }, origin: unknown) => { ok: boolean; error?: string; contours: Array<{ elevM: number; pts: number[][] }> };
};
let _imp: ImpMod | null = null;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-import-contours:${ip}`, 6, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { dxf?: string; origin?: { E?: number; N?: number }; layerFilter?: string };
  try { body = await readBoundedJson(req, MAX_BODY_BYTES); } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'DXF 12MB 초과 — 도엽을 나눠 주세요.' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const dxf = body.dxf ?? '';
  if (!dxf || typeof dxf !== 'string') return NextResponse.json({ ok: false, error: 'dxf 텍스트가 필요합니다.' }, { status: 400 });
  if (dxf.length > 12_000_000) return NextResponse.json({ ok: false, error: 'DXF 12MB 초과 — 도엽을 나눠 주세요.' }, { status: 400 });

  try {
    if (!_imp) _imp = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'dxf-import.mjs')).href)) as ImpMod;
    const parsed = _imp.parseDxfContours(dxf, { layerFilter: typeof body.layerFilter === 'string' && body.layerFilter ? body.layerFilter : null });
    if (!parsed.contours.length) {
      return NextResponse.json({ ok: false, error: '등고 폴리라인을 찾지 못함(표고 z/38 없는 폴리라인은 제외 — 지어내지 않음)', stats: parsed.stats }, { status: 200 });
    }
    const loc = _imp.contoursToLocal(parsed, body.origin);
    if (!loc.ok) return NextResponse.json({ ok: false, error: loc.error, stats: parsed.stats }, { status: 200 });
    // 안전 상한: 점 총량 캡(브라우저·후속 파생 성능 예산) — 초과분은 균등 솎음(집계 공개)
    let totalPts = loc.contours.reduce((s, c) => s + c.pts.length, 0);
    let thinned = 0;
    if (totalPts > 20000) {
      const k = Math.ceil(totalPts / 20000);
      for (const c of loc.contours) {
        const kept = c.pts.filter((_, i) => i % k === 0 || i === c.pts.length - 1);
        thinned += c.pts.length - kept.length;
        c.pts = kept;
      }
      totalPts = loc.contours.reduce((s, c) => s + c.pts.length, 0);
    }
    return NextResponse.json({ ok: true, contours: loc.contours, stats: { ...parsed.stats, totalPts, thinned } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'import failed: ' + (e instanceof Error ? e.message : String(e)).slice(0, 200) }, { status: 500 });
  }
}
