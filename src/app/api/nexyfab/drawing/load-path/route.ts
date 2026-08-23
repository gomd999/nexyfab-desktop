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
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Mod = {
  loadPathCheck: (assembly: unknown, params: Record<string, unknown>) => unknown;
  listUsages: () => Array<{ key: string; kNm2: number; label: string }>;
};
type RptMod = { loadPathReport: (r: unknown, o?: Record<string, unknown>) => string };

let _mod: Mod | null = null;
let _rpt: RptMod | null = null;
async function load(): Promise<Mod> {
  if (_mod) return _mod;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'load-path.mjs');
  _mod = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as Mod;
  return _mod;
}
async function loadRpt(): Promise<RptMod> {
  if (_rpt) return _rpt;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'chain-reports.mjs');
  _rpt = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as RptMod;
  return _rpt;
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
    type LpResult = {
      ok?: boolean;
      loads?: { spans?: { xs_mm?: number[]; ys_mm?: number[] }; slab?: { D_kN?: number; areaM2?: number }; usage?: { live_kNm2?: number } };
      slabSLS?: unknown;
    };
    const result = mod.loadPathCheck(body.assembly, body.params ?? {}) as LpResult;

    // ── 슬래브 SLS 처짐 (배치 1+2 ②) — 검증된 Mindlin 솔버 재사용 (fea/plateMindlin) ──
    //    최대 베이 패널·4변 단순지지·탄성 총단면(Ec=8500∛(fck+Δf), KDS 14 20 10 식 4.3-2).
    //    균열(Ie)·크리프 장기처짐 미반영 — 실제 장기처짐은 수 배 가능(리포트 명시). 한계=관례값 입력.
    if (result.ok && body.params?.slabCheck !== false && result.loads?.spans?.xs_mm && result.loads.spans.ys_mm) {
      try {
        const { mindlinPlateSolve } = await import('@/app/[lang]/shape-generator/fea/plateMindlin');
        const xs = result.loads.spans.xs_mm, ys = result.loads.spans.ys_mm;
        const spanX = Math.max(...xs.slice(1).map((v, i) => v - xs[i]));
        const spanY = Math.max(...ys.slice(1).map((v, i) => v - ys[i]));
        const slabPart = body.assembly.parts.find((p) => (p as { role?: string }).role === 'slab') as { params?: { height?: number } } | undefined;
        const t = Number(slabPart?.params?.height) || 150;
        const fck = Number(body.params?.fck) || 24;
        const dF = fck <= 40 ? 4 : fck >= 60 ? 6 : 4 + ((fck - 40) / 20) * 2;
        const Ec = 8500 * Math.cbrt(fck + dF); // MPa
        const nu = Number(body.params?.slabPoisson) || 0.18;
        const wD = (Number(result.loads.slab?.D_kN) || 0) / (Number(result.loads.slab?.areaM2) || 1); // kN/m²
        const wL = Number(result.loads.usage?.live_kNm2) || 0;
        const NX = 16;
        const solve = (q_kPa: number) => mindlinPlateSolve({
          nx: NX, ny: NX, lx: spanX / NX, ly: spanY / NX,
          E: Ec, nu, thickness: t, pressure: q_kPa / 1000, // kPa → N/mm² ×10⁻³
        }).maxDeflection;
        const limitLn = Number(body.params?.slabDeflLimitL) || 360;   // 활하중 관례 L/360
        const limitTn = Number(body.params?.slabDeflLimitT) || 240;   // 전체 관례 L/240
        const Lshort = Math.min(spanX, spanY);
        const dL = solve(wL), dT = solve(wD + wL);
        (result as Record<string, unknown>).slabSLS = {
          panelMm: `${Math.round(spanX)}×${Math.round(spanY)} t${t}`,
          Ec_MPa: Math.round(Ec), nu, method: `Mindlin 판 FEM ${NX}×${NX} · 4변 단순지지 · 탄성 총단면`,
          live: { delta_mm: +dL.toFixed(2), limit_mm: +(Lshort / limitLn).toFixed(1), spec: `L/${limitLn}`, pass: dL <= Lshort / limitLn },
          total: { delta_mm: +dT.toFixed(2), limit_mm: +(Lshort / limitTn).toFixed(1), spec: `L/${limitTn}`, pass: dT <= Lshort / limitTn },
          note: '균열 유효강성(Ie)·크리프 장기처짐 미반영(탄성 즉시처짐) — 장기는 수 배 가능. 한계값은 관례(입력 가능)·KDS 14 20 30 상세검토 별도.',
        };
      } catch { /* 슬래브 검토 실패는 체인을 막지 않음 */ }
    }

    // format=html → 인쇄양식 리포트 HTML 동봉 (설계 패키지 문서들과 동일 스타일)
    if (body.format === 'html') {
      const rpt = await loadRpt();
      const { designNet } = await import('@/lib/design-net');
      const { net, rev } = await designNet(body.assembly, 'building');
      return NextResponse.json({ result, html: rpt.loadPathReport(result, { title: body.assembly?.name ?? '하중경로 검증', net, rev, svg: await (async () => {
        try {
          const sp = join(process.cwd(), 'scripts', 'drawing-to-3d', 'section-drawings.mjs');
          const sd = (await import(/* webpackIgnore: true */ pathToFileURL(sp).href)) as { rebarSectionSvg: (p: unknown, o?: Record<string, unknown>) => string };
          const bm0 = (result as { beams?: Array<{ section?: string }> }).beams?.[0];
          const As = Number((body.params as Record<string, unknown> | undefined)?.beamAs) || 0;
          if (!bm0?.section || !(As > 0)) return '';
          const [bw, bh] = bm0.section.split('×').map(Number);
          return sd.rebarSectionSvg({ b: bw, h: bh, As, barDia: Number((body.params as Record<string, unknown> | undefined)?.barDia) || 22, cover: 40 });
        } catch { return ''; }
      })() }) });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'load-path failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 });
  }
}
