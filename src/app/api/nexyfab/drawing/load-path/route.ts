/**
 * /api/nexyfab/drawing/load-path — 건축 하중경로 자동 체인 (Wave A · B1).
 *
 * GET  → 활하중 용도 목록 (KDS 41 12 00 표 3.2-1)
 * POST { assembly, params } → 슬래브 자중+활하중 → 하중조합 → 보(rc_beam) →
 *        기둥(rc_column_pm) → 기초(isolated_footing) 체인 결과.
 *
 * 하중은 지어내지 않음: 자중=형상 결정론, 활하중=KDS 표(용도 선택), 철근·기초·지반=입력.
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Mod = {
  loadPathCheck: (assembly: unknown, params: Record<string, unknown>) => unknown;
  listUsages: () => Array<{ key: string; kNm2: number; label: string }>;
};

let _mod: Mod | null = null;
async function load(): Promise<Mod> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'load-path.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as Mod;
  return _mod;
}

export async function GET(): Promise<NextResponse> {
  try {
    const mod = await load();
    return NextResponse.json({ ok: true, usages: mod.listUsages(), ref: 'KDS 41 12 00:2022 표 3.2-1' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-loadpath:${ip}`, 20, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { assembly?: { parts?: unknown[] }; params?: Record<string, unknown> };
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
    return NextResponse.json(mod.loadPathCheck(body.assembly, body.params ?? {}));
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'load-path failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
