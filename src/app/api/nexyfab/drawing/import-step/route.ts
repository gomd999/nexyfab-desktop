/**
 * POST /api/nexyfab/drawing/import-step — 실물 STEP → NexyFab 어셈블리(브리지, 260717).
 *
 * body: { step: string(≤15MB), name?, material? } →
 *   { ok, assembly(box 근사·note 명시), stats, ...buildAssembly 결과(designOk 등) }
 * 이후 기존 패키지 라우트로 GA·BOM·XLSX·IFC·STEP 재생성 가능("STEP 열면 도면·물량").
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { stepToNexyfabAssembly } from '@/lib/brep-bridge/stepToNexyfabAssembly';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AsmMod = { buildAssembly: (a: unknown) => { ok: boolean; gateErrors?: string[]; interferences?: unknown[]; structural?: unknown; support?: unknown; designOk?: boolean; parts?: unknown } };
let _asm: AsmMod | null = null;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-import-step:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { step?: string; name?: string; material?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  const step = body.step ?? '';
  if (!step || typeof step !== 'string') return NextResponse.json({ ok: false, error: 'step 텍스트가 필요합니다.' }, { status: 400 });
  if (step.length > 15_000_000) return NextResponse.json({ ok: false, error: 'STEP 15MB 초과 — 부분 파일로 나눠주세요.' }, { status: 400 });

  const bridged = stepToNexyfabAssembly(step, {
    name: typeof body.name === 'string' && body.name ? body.name.slice(0, 60) : 'STEP import',
    ...(typeof body.material === 'string' && body.material ? { material: body.material } : {}),
  });
  if (!bridged.ok || !bridged.assembly) return NextResponse.json({ ok: false, error: bridged.error, stats: bridged.stats }, { status: 200 });

  try {
    if (!_asm) _asm = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'assembly.mjs')).href)) as AsmMod;
    const built = _asm.buildAssembly(bridged.assembly);
    return NextResponse.json({
      ok: true,
      assembly: bridged.assembly,
      stats: bridged.stats,
      parts: built.parts ?? bridged.assembly.parts,
      interferences: built.interferences ?? [],
      structural: built.structural ?? null,
      support: built.support ?? null,
      designOk: built.designOk ?? null,
      gateErrors: built.ok ? [] : (built.gateErrors ?? []),
    });
  } catch (e) {
    // 빌드 실패해도 브리지 결과는 반환(정직 — 클라가 어셈블리 확인 가능)
    return NextResponse.json({ ok: true, assembly: bridged.assembly, stats: bridged.stats, buildError: String(e instanceof Error ? e.message : e).slice(0, 160) });
  }
}
