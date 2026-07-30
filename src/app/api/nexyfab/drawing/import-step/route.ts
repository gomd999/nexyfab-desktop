/**
 * POST /api/nexyfab/drawing/import-step — 실물 CAD → NexyFab 어셈블리(브리지, 260717).
 *
 * body: { step: string(≤15MB), name?, material?, format?: 'step'|'iges'|'stl'(기본 step),
 *         stlBase64?: string(binary STL) } →
 *   { ok, assembly(box/cyl 근사·note 명시), stats, ...buildAssembly 결과, reconstructionGate? }
 * 미지원 독점 포맷(SKP/DWG/F3D/SLDPRT/IPT)은 오류에 변환 안내 동봉(정직 — 파서 날조 금지).
 *
 * reconstructionGate (STEP 경로 한정, Pipeline B): 박스/실린더 "재구성"을 실물 STEP 형상과
 * 대조한다. 여기서 정직이 핵심 — 소스 IR 은 box 근사(stepToNexyfabAssembly)가 아니라
 * 순수-TS B-rep 판독(stepToIr)의 **실제 형상**에서 측정한다. 박스류는 통과, 곡면/복합은
 * 정직하게 실패, 충실히 측정 불가한 형상은 'unavailable'(가짜 통과 금지).
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { stepToNexyfabAssembly, stepToNexyfabAssemblyPreferKernel } from '@/lib/brep-bridge/stepToNexyfabAssembly';
import { igesToNexyfabAssembly, stlToNexyfabAssembly } from '@/lib/brep-bridge/meshIgesImport';
import { ifcToNexyfabAssembly } from '@/lib/brep-bridge/ifcImport';
import { dwgToNexyfabAssembly } from '@/lib/brep-bridge/dwgImport';
import { satToNexyfabAssembly } from '@/lib/brep-bridge/satImport';
import { xtToNexyfabAssembly } from '@/lib/brep-bridge/xtImport';
import { stepToIr, meshSoupToStepIr, gateIntentTriangles, acisReconstructionGate } from '@/lib/cad-ir';
import { recordUsageEvent } from '@/lib/plan-guard';

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

/** reconstructionGate 응답 형태 — STL 경로(reverse-engineer)와 동일 계약.
 * unavailable 에는 곡면 ACIS/Parasolid 처럼 커널이 없어 측정 불가할 때 STEP 재내보내기를 권하는
 * suggestion='export_step' + 사용자 메시지를 실어 정직한 실패를 다음 행동으로 잇는다. */
type ReconstructionGate =
  | { status: 'pass' | 'fail'; score: number; stage: string; checks: unknown; feedback: string; mode: 'passthrough' | 'approximation' }
  | { status: 'unavailable'; reason: string; suggestion?: 'export_step'; message?: string };

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
  let kernelFidelity: 'kernel-solid' | 'aabb-approx' | null = null;
  let kernelWarnings: string[] = [];
  // STEP 텍스트를 재구성 게이트(Pipeline B)용으로 보관 — STEP 경로에서만 채워진다.
  let stepSourceForGate: string | null = null;
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
    stepSourceForGate = step;
    /**
     * ★260802 — **커널 우선 · AABB 폴백**. 종전에는 전 부품을 AABB 상자로 받았고
     *   실측 오차가 **양방향**(0.02~26.6배)이라 신뢰 구간을 줄 수 없었다.
     *   커널 경로는 솔리드 단위 + 정확 물성이다(실측: 7.35MB → 205부품 전부 정확값).
     * ⚠ 폴백은 남긴다 — 커널이 못 읽는 파일이 있고(코퍼스 35 중 1), 그때 빈손으로
     *   돌아가는 것보다 근사라도 주고 **오차가 양방향임을 고지**하는 편이 낫다.
     */
    const kr = await stepToNexyfabAssemblyPreferKernel(step, { name, ...matOpt });
    bridged = kr;
    kernelFidelity = kr.fidelity ?? null;
    kernelWarnings = kr.warnings ?? [];
    // R2-①(260719): AP242 시맨틱 PMI(GD&T) 동시 판독 — 있으면 어셈블리에 동봉(부품도 표기용)
    try {
      const gmod = await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'gdt-import.mjs')).href) as { extractGdt: (t: string) => { counts: { datums: number; dims: number; geoTols: number } } };
      const gdt = gmod.extractGdt(step);
      if (bridged.ok && bridged.assembly && (gdt.counts.geoTols || gdt.counts.dims || gdt.counts.datums)) {
        (bridged.assembly as { gdt?: unknown }).gdt = gdt;
      }
    } catch { /* PMI 판독 실패는 임포트를 막지 않음(정직 — 값 없으면 미표기) */ }
  }
  if (!bridged.ok || !bridged.assembly) return NextResponse.json({ ok: false, error: bridged.error, stats: bridged.stats }, { status: 200 });

  try {
    if (!_asm) _asm = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'assembly.mjs')).href)) as AsmMod;
    const built = _asm.buildAssembly(bridged.assembly);

    // ── 재구성 검증 게이트(Pipeline B) — STEP 경로 한정 ─────────────────────────
    // CANDIDATE = 재구성(box/cyl 근사)을 render-preview::assemblyTriangles 로 테셀레이션.
    // SOURCE    = stepToIr 로 실물 STEP B-rep 을 충실히 측정한 IR(box 근사 아님).
    // 대조 실패(곡면/복합) = 정직한 저충실도 신호로 그대로 노출. 측정 불가 = 'unavailable'.
    let reconstructionGate: ReconstructionGate | undefined;
    if (stepSourceForGate) {
      try {
        // SOURCE IR: pure-TS B-rep reader first (fast, no wasm). It faithfully recovers
        // boxes / prisms / cylinders but flags curved / complex solids as 'unsupported'.
        const fast = stepToIr(stepSourceForGate, { path: `${name}.step`, name: `${name}.step` });
        const preferOcct = !fast.ok || fast.meta.unsupported.length > 0;
        let handled = false;

        // ── PASSTHROUGH mode (curved / complex) — reuse the in-process replicad OCCT mesher.
        // Mesh the REAL importSTEP solid once: that soup is BOTH the faithful source
        // measurement AND the gate candidate (round-trip identity), so genuinely-curved STEP
        // geometry PASSES on its true shape instead of being flattened to a bounding box.
        if (preferOcct) {
          try {
            const ts = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'to-step.mjs')).href)) as {
              stepTextToMesh: (t: string) => Promise<{ soup: [number, number, number][][]; triangles: number }>;
            };
            const mesh = await ts.stepTextToMesh(stepSourceForGate); // throws on opencascade RetError
            const srcOcct = meshSoupToStepIr(mesh.soup, stepSourceForGate, { path: `${name}.step`, name: `${name}.step` });
            if (!srcOcct.ok || !srcOcct.ir) {
              reconstructionGate = { status: 'unavailable', reason: srcOcct.reason ?? 'no_faithful_geometry' };
            } else {
              const g = gateIntentTriangles(mesh.soup, srcOcct.ir);
              reconstructionGate = { status: g.passed ? 'pass' : 'fail', score: g.score, stage: g.stage, checks: g.checks, feedback: g.feedback, mode: 'passthrough' };
            }
            handled = true;
          } catch (e) {
            // OCCT unavailable (wasm/ESM) or importSTEP failed. If the pure-TS reader still
            // produced a faithful (boxy) IR, fall through to APPROXIMATION honestly; otherwise
            // report 'unavailable' — never a fabricated pass on a curved part we cannot measure.
            if (!(fast.ok && fast.ir)) {
              reconstructionGate = { status: 'unavailable', reason: `occt_unavailable: ${String(e instanceof Error ? e.message : e).slice(0, 100)}` };
              handled = true;
            }
          }
        }

        // ── APPROXIMATION mode (boxy fast-path, or OCCT-unavailable fallback) — SOURCE is the
        // faithful pure-TS IR; CANDIDATE is the box/cyl reconstruction tessellated by
        // render-preview. Boxy parts PASS (box == box); curved reconstructions FAIL honestly.
        if (!handled) {
          if (!fast.ok || !fast.ir) {
            reconstructionGate = { status: 'unavailable', reason: fast.reason ?? 'no_faithful_geometry' };
          } else {
            const rp = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'render-preview.mjs')).href)) as { assemblyTriangles: (a: unknown) => [number, number, number][][] };
            const candTris = rp.assemblyTriangles({ parts: built.parts ?? bridged.assembly.parts });
            if (!Array.isArray(candTris) || candTris.length === 0) {
              reconstructionGate = { status: 'unavailable', reason: 'candidate_tessellation_empty' };
            } else {
              const g = gateIntentTriangles(candTris, fast.ir);
              reconstructionGate = { status: g.passed ? 'pass' : 'fail', score: g.score, stage: g.stage, checks: g.checks, feedback: g.feedback, mode: 'approximation' };
            }
          }
        }
      } catch (e) {
        reconstructionGate = { status: 'unavailable', reason: `gate_threw_${String(e instanceof Error ? e.message : e).slice(0, 80)}` };
      }
    }

    // ── ACIS / Parasolid 재구성 게이트(dwg/sat/x_t) — STEP 과 동일 계약 ──────────────
    // 평면 ACIS 솔리드는 satImport.reconstructPlanarBody 로 실재구성된 다면체가 곧 작동
    // 바디이므로 SOURCE=CANDIDATE(라운드트립 동일) → 실 passthrough pass/fail. 곡면 ACIS·
    // 폴리페이스 box 는 커널이 없어 faithful 측정 불가 → 정직하게 'unavailable'(가짜 통과 금지).
    if (!reconstructionGate && (fmt === 'sat' || fmt === 'sab' || fmt === 'dwg' || fmt === 'x_t' || fmt === 'xt' || fmt === 'xmt_txt')) {
      const isXt = fmt === 'x_t' || fmt === 'xt' || fmt === 'xmt_txt';
      reconstructionGate = acisReconstructionGate(bridged.assembly, {
        fallbackReason: isXt ? 'parasolid_curved_no_kernel' : 'acis_curved_no_kernel',
        format: isXt ? 'X_T' : 'SAT',
        name,
      });
    }

    // 측정(best-effort, 요청 차단 금지): 게이트 판정을 기록해 실물 업로드 전반의
    // 재구성 통과율을 사후 질의 가능하게 남긴다("만들었다 -> 증명했다" 레버).
    try {
      recordUsageEvent('anon', 'cad_reconstruction_gate', {
        route: 'import-step',
        format: fmt,
        status: reconstructionGate?.status ?? 'none',
        ...(reconstructionGate && 'mode' in reconstructionGate ? { mode: reconstructionGate.mode } : {}),
      });
    } catch { /* never block on measurement */ }

    // preset 응답 계약과 동일(composeIntent·openscad 포함) — 패널·뷰어·패키지 플로우 재사용
    return NextResponse.json({
      ok: true,
      /**
       * ★ 충실도와 고지를 **응답에 싣는다** (260802). 형상을 어떤 근거로 받았는지
       *   모르면 사용자는 질량을 그대로 믿는다 — AABB 폴백은 오차가 **양방향**이다.
       */
      ...(kernelFidelity ? { fidelity: kernelFidelity } : {}),
      ...(kernelWarnings.length ? { fidelityWarnings: kernelWarnings } : {}),
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
      ...(reconstructionGate ? { reconstructionGate } : {}),
    });
  } catch (e) {
    // 빌드 실패해도 브리지 결과는 반환(정직 — 클라가 어셈블리 확인 가능)
    return NextResponse.json({ ok: true, ...(kernelFidelity ? { fidelity: kernelFidelity } : {}), ...(kernelWarnings.length ? { fidelityWarnings: kernelWarnings } : {}), assembly: bridged.assembly, stats: bridged.stats, buildError: String(e instanceof Error ? e.message : e).slice(0, 160) });
  }
}
