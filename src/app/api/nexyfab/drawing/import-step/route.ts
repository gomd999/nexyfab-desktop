/**
 * POST /api/nexyfab/drawing/import-step — 실물 CAD → NexyFab 어셈블리(브리지, 260717~18).
 *
 * body: { step: string(≤15MB), name?, material?, format?: 'step'|'iges'|'stl'(기본 step),
 *         stlBase64?: string(binary STL) } →
 *   { ok, assembly(box/cyl 근사·note 명시), stats, ...buildAssembly 결과 }
 * 미지원 독점 포맷(SKP/DWG/F3D/SLDPRT/IPT)은 오류에 변환 안내 동봉(정직 — 파서 날조 금지).
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { stepToNexyfabAssembly } from '@/lib/brep-bridge/stepToNexyfabAssembly';
import { igesToNexyfabAssembly, stlToNexyfabAssembly } from '@/lib/brep-bridge/meshIgesImport';
import { ifcToNexyfabAssembly } from '@/lib/brep-bridge/ifcImport';
import { dwgToNexyfabAssembly } from '@/lib/brep-bridge/dwgImport';
import { satToNexyfabAssembly } from '@/lib/brep-bridge/satImport';
import { xtToNexyfabAssembly } from '@/lib/brep-bridge/xtImport';

/** 독점 포맷 안내(임포트 불가 시 정직 응답) — 각 툴의 개방 포맷 내보내기 경로. */
const CONVERT_GUIDE: Record<string, string> = {
  skp: 'SketchUp: 파일→내보내기→3D 모델→STL 또는 (Pro) IFC/DWG — STL 업로드 지원',
  f3d: 'Fusion 360: 파일→내보내기→STEP(.step) — STEP 업로드 지원',
  sldprt: 'SolidWorks: 파일→다른 이름으로 저장→STEP AP214 — STEP 업로드 지원',
  sldasm: 'SolidWorks: 파일→다른 이름으로 저장→STEP AP214(어셈블리 유지) — STEP 업로드 지원',
  ipt: 'Inventor: 파일→내보내기→CAD 형식→STEP — STEP 업로드 지원',
  iam: 'Inventor: 파일→내보내기→CAD 형식→STEP(어셈블리 유지) — STEP 업로드 지원',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AsmMod = { buildAssembly: (a: unknown) => { ok: boolean; gateErrors?: string[]; interferences?: unknown[]; contacts?: unknown[]; structural?: unknown; support?: unknown; pipes?: unknown; designOk?: boolean; parts?: unknown; openscad?: string; composeIntent?: unknown; welds?: unknown[]; weldTotalMm?: number } };
let _asm: AsmMod | null = null;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-import-step:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: { step?: string; name?: string; material?: string; format?: string; stlBase64?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  const fmt = String(body.format ?? 'step').toLowerCase();
  if (CONVERT_GUIDE[fmt]) {
    return NextResponse.json({ ok: false, error: `${fmt.toUpperCase()} 는 독점 포맷 — 파서 미지원(정직). 변환 경로: ${CONVERT_GUIDE[fmt]}` }, { status: 200 });
  }
  const name = typeof body.name === 'string' && body.name ? body.name.slice(0, 60) : `${fmt.toUpperCase()} import`;
  const matOpt = typeof body.material === 'string' && body.material ? { material: body.material } : {};
  let bridged;
  if (fmt === 'x_t' || fmt === 'xt' || fmt === 'xmt_txt') {
    // Parasolid XT 텍스트 — 공개 스펙 파서(임베디드 V14+ · 점군 AABB · 어긋남=정직 거부)
    const src = typeof body.stlBase64 === 'string' && body.stlBase64
      ? Buffer.from(body.stlBase64, 'base64').toString('latin1')
      : (body.step ?? '');
    if (!src) return NextResponse.json({ ok: false, error: 'x_t 텍스트가 필요합니다.' }, { status: 400 });
    if (src.length > 60_000_000) return NextResponse.json({ ok: false, error: 'x_t 60MB 초과(웹 업로드 예산)' }, { status: 400 });
    bridged = xtToNexyfabAssembly(src, { name });
  } else if (fmt === 'sat' || fmt === 'sab') {
    // ACIS SAT(텍스트)/SAB(바이너리) — 바디별 점군 AABB box(정직 근사 명시)
    const buf = typeof body.stlBase64 === 'string' && body.stlBase64
      ? Buffer.from(body.stlBase64, 'base64')
      : Buffer.from(body.step ?? '', 'latin1');
    if (buf.length > 60_000_000) return NextResponse.json({ ok: false, error: 'SAT 60MB 초과(웹 업로드 예산)' }, { status: 400 });
    if (!buf.length) return NextResponse.json({ ok: false, error: 'SAT 데이터가 필요합니다.' }, { status: 400 });
    const head15 = buf.toString('latin1', 0, 15);
    bridged = head15 === 'ACIS BinaryFile' || head15 === 'ASM BinaryFile4'
      ? satToNexyfabAssembly(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { name })
      : satToNexyfabAssembly(buf.toString('latin1'), { name });
  } else if (fmt === 'dwg') {
    // 3D 메시 DWG(Revit 계열 익스포트) — LibreDWG WASM 파싱, 부품=폴리페이스 AABB box.
    // 2D 도면 DWG 는 /drawing/dwg-convert(DXF+씨앗) 경로가 담당.
    const b64 = typeof body.stlBase64 === 'string' ? body.stlBase64 : '';
    if (!b64) return NextResponse.json({ ok: false, error: 'DWG 바이너리(stlBase64 필드, base64)가 필요합니다.' }, { status: 400 });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 60_000_000) return NextResponse.json({ ok: false, error: 'DWG 60MB 초과' }, { status: 400 });
    bridged = await dwgToNexyfabAssembly(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { name });
  } else if (fmt === 'stl') {
    const buf = typeof body.stlBase64 === 'string' && body.stlBase64
      ? Buffer.from(body.stlBase64, 'base64')
      : Buffer.from(body.step ?? '', 'latin1');
    if (buf.length > 30_000_000) return NextResponse.json({ ok: false, error: 'STL 30MB 초과' }, { status: 400 });
    bridged = stlToNexyfabAssembly(buf, { name, ...matOpt });
  } else if (fmt === 'ifc') {
    const src = body.step ?? '';
    if (!src) return NextResponse.json({ ok: false, error: 'IFC 텍스트가 필요합니다.' }, { status: 400 });
    if (src.length > 40_000_000) return NextResponse.json({ ok: false, error: 'IFC 40MB 초과(웹 업로드 예산) — 층/동 분할 내보내기 필요' }, { status: 400 });
    bridged = ifcToNexyfabAssembly(src, { name });
  } else if (fmt === 'iges' || fmt === 'igs') {
    const src = body.step ?? '';
    if (!src) return NextResponse.json({ ok: false, error: 'IGES 텍스트가 필요합니다.' }, { status: 400 });
    if (src.length > 15_000_000) return NextResponse.json({ ok: false, error: 'IGES 15MB 초과' }, { status: 400 });
    bridged = igesToNexyfabAssembly(src, { name, ...matOpt });
  } else {
    const step = body.step ?? '';
    if (!step || typeof step !== 'string') return NextResponse.json({ ok: false, error: 'step 텍스트가 필요합니다.' }, { status: 400 });
    if (step.length > 15_000_000) return NextResponse.json({ ok: false, error: 'STEP 15MB 초과 — 부분 파일로 나눠주세요.' }, { status: 400 });
    bridged = stepToNexyfabAssembly(step, { name, ...matOpt });
  }
  if (!bridged.ok || !bridged.assembly) return NextResponse.json({ ok: false, error: bridged.error, stats: bridged.stats }, { status: 200 });

  try {
    if (!_asm) _asm = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'assembly.mjs')).href)) as AsmMod;
    const built = _asm.buildAssembly(bridged.assembly);
    // preset 응답 계약과 동일(composeIntent·openscad 포함) — 패널·뷰어·패키지 플로우 재사용
    return NextResponse.json({
      ok: true,
      assembly: bridged.assembly,
      stats: bridged.stats,
      openscad: built.openscad ?? null,
      composeIntent: built.composeIntent ?? null,
      parts: built.parts ?? bridged.assembly.parts,
      interferences: built.interferences ?? [],
      contacts: built.contacts ?? [],
      welds: built.welds ?? [], weldTotalMm: built.weldTotalMm ?? 0,
      structural: built.structural ?? null,
      support: built.support ?? null,
      pipes: built.pipes ?? null,
      designOk: built.designOk ?? null,
      gateErrors: built.ok ? [] : (built.gateErrors ?? []),
    });
  } catch (e) {
    // 빌드 실패해도 브리지 결과는 반환(정직 — 클라가 어셈블리 확인 가능)
    return NextResponse.json({ ok: true, assembly: bridged.assembly, stats: bridged.stats, buildError: String(e instanceof Error ? e.message : e).slice(0, 160) });
  }
}
