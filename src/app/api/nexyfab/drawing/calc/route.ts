/**
 * POST /api/nexyfab/drawing/calc — 계산기 스튜디오 실행 라우트.
 * { id, input, standard? } → engineering-core registry.mjs(런타임 import) runCalculator
 * 결과(verdict/checks/refs/status/disclaimer)를 그대로 반환 — 정직성: 가공 없음.
 * { drawing: { kind: 'rebar_elevation', params } } 동봉 시 배근 전개도 SVG도 반환.
 * 카탈로그(GET)는 calcCatalog.ts를 정적 제공(폼 자동생성용).
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { CALC_CATALOG } from '@/app/api/eng-chat/calcCatalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RegistryModule = { runCalculator: (id: string, input: unknown, standardId?: string) => Record<string, unknown> };
type DrawModule = { rebarElevationSvg: (p: Record<string, unknown>) => string };

let _reg: RegistryModule | null = null;
async function loadRegistry(): Promise<RegistryModule> {
  if (_reg) return _reg;
  const p = join(process.cwd(), 'scripts', 'engineering-core', 'registry.mjs');
  _reg = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as RegistryModule;
  return _reg;
}
let _draw: DrawModule | null = null;
async function loadDraw(): Promise<DrawModule> {
  if (_draw) return _draw;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'section-drawings.mjs');
  _draw = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as DrawModule;
  return _draw;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, catalog: CALC_CATALOG });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-calc:${ip}`, 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });
  try {
    const body = (await req.json()) as { id?: string; input?: unknown; standard?: string; drawing?: { kind?: string; params?: Record<string, unknown> } };
    let result: Record<string, unknown> | null = null;
    if (body.id) {
      if (typeof body.id !== 'string' || typeof body.input !== 'object' || body.input === null) {
        return NextResponse.json({ ok: false, error: 'id·input 필요' }, { status: 400 });
      }
      const reg = await loadRegistry();
      result = reg.runCalculator(body.id, body.input, body.standard ?? 'KDS');
    }
    let svg: string | null = null;
    if (body.drawing?.kind === 'rebar_elevation') {
      const draw = await loadDraw();
      svg = draw.rebarElevationSvg(body.drawing.params ?? {});
    }
    if (!result && !svg) return NextResponse.json({ ok: false, error: 'id 또는 drawing 필요' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(result ? { result } : {}), ...(svg ? { svg } : {}) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const gate = msg.includes('input gate');
    return NextResponse.json({ ok: false, error: msg, gate }, { status: gate ? 422 : 500 });
  }
}
