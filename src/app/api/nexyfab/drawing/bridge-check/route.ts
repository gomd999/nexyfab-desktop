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
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CheckFn = (assembly: unknown, params: Record<string, unknown>) => unknown;
type Mod = {
  bridgeCheck: CheckFn;
  bridgeLoop?: CheckFn;
  archBridgeCheck?: CheckFn;
  trussBridgeCheck?: CheckFn;
  cableStayedCheck?: CheckFn;
  suspensionCheck?: CheckFn;
  stairCheck?: CheckFn;
};
type RptMod = {
  bridgeReport: (r: unknown, o?: Record<string, unknown>) => string;
  archBridgeReport?: (r: unknown, o?: Record<string, unknown>) => string;
  simpleCheckReport?: (r: unknown, o?: Record<string, unknown>) => string;
};

// meta 필드 → 검토 함수·리포트 제목 디스패치(260718b). archMeta=전용 리포트, 그 외=범용.
const CHECK_DISPATCH: Array<{ meta: string; fn: keyof Mod; title: string; arch?: boolean }> = [
  { meta: 'archMeta', fn: 'archBridgeCheck', title: '아치교 간이 검토', arch: true },
  { meta: 'trussMeta', fn: 'trussBridgeCheck', title: '트러스교 간이 검토' },
  { meta: 'cableStayedMeta', fn: 'cableStayedCheck', title: '사장교 간이 검토' },
  { meta: 'suspensionMeta', fn: 'suspensionCheck', title: '현수교 간이 검토' },
  { meta: 'stairMeta', fn: 'stairCheck', title: '산업 계단 간이 검토' },
];

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
    body = await readBoundedJson<typeof body>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'assembly가 너무 큽니다.' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!Array.isArray(body.assembly?.parts) || body.assembly.parts.length === 0) {
    return NextResponse.json({ ok: false, error: 'assembly.parts 가 필요합니다.' }, { status: 400 });
  }

  try {
    const mod = await load();
    // meta 필드 기반 자동 디스패치(260718b): 아치·트러스·사장·현수·계단=간이 폐형 체인,
    // 거더교(bridgeMeta)=실시설계급 체인. 함수 미탑재 시 거더 체인 폴백.
    const asmMeta = body.assembly as Record<string, unknown>;
    const disp = CHECK_DISPATCH.find((d) => asmMeta[d.meta] && typeof mod[d.fn] === 'function');
    const result = disp
      ? (mod[disp.fn] as CheckFn)(body.assembly, body.params ?? {})
      : (body as { mode?: string }).mode === 'loop' && mod.bridgeLoop ? mod.bridgeLoop(body.assembly, body.params ?? {}) : mod.bridgeCheck(body.assembly, body.params ?? {});
    if (body.format === 'html') {
      const rpt = await loadRpt();
      let html: string;
      if (disp?.arch && rpt.archBridgeReport) {
        html = rpt.archBridgeReport(result, { title: body.assembly?.name ?? disp.title });
      } else if (disp && rpt.simpleCheckReport) {
        html = rpt.simpleCheckReport(result, { title: body.assembly?.name ?? disp.title });
      } else {
        let svg = '';
        try {
          const sp = join(process.cwd(), 'scripts', 'drawing-to-3d', 'section-drawings.mjs');
          const sd = (await import(/* webpackIgnore: true */ pathToFileURL(sp).href)) as { bridgeGeneralSvg: (bm: unknown, o?: Record<string, unknown>) => string };
          const bm = (body.assembly as { bridgeMeta?: unknown }).bridgeMeta;
          if (bm) svg = sd.bridgeGeneralSvg(bm);
        } catch { /* 도면 실패는 비치명 */ }
        html = rpt.bridgeReport(result, { title: body.assembly?.name ?? '거더교 검증', svg });
      }
      return NextResponse.json({ result, html });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'bridge-check failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
