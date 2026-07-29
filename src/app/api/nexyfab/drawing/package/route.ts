/**
 * POST /api/nexyfab/drawing/package
 *
 * 설계 패키지 자동생성 — 어셈블리(parts[]) → 형상기반 산출물 일괄 생성:
 *   GA 3D(html) · 2D GA 도면(html) · 구조/응력 검토(html) · SCAD · STEP(선택).
 * buildAssembly(게이트·간섭·용접·structural·composeIntent) + package.mjs(2D·구조) +
 * html-render.mjs(GA 3D). 결과는 {files:[{name, mime, content}]} 로 반환 → 클라가 다운로드.
 *
 * P&ID·Dossier 는 공정 의미·서술 필요(AI 보조) → 후속. 여기선 형상기반 3~4종.
 * caller: { assembly, options? } → { ok, files, structural, interferences, welds }
 */
import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import JSZip from 'jszip';
import iconv from 'iconv-lite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Assembly = { name?: string; parts?: Array<Record<string, unknown>>; pipes?: Array<Record<string, unknown>> };
type Support = { supported: string[]; floating: string[]; faceContacts: Array<{ part: string; on: string; gapMm: number; suggestTzMm: number }> };
type Pipes = { routes: Array<{ label: string; pts: number[][]; d: number; col?: string }>; errors: string[]; notes: string[]; obstacleViolations: unknown[]; sleeves?: Array<{ route: string; through: string; d: number; note: string }>; crossViolations: unknown[] } | null;
type Built = {
  ok: boolean; openscad?: string; structural?: unknown; interferences?: unknown[]; welds?: unknown[]; weldTotalMm?: number; gateErrors?: string[];
  parts?: Array<{ id: string; aabb: { min: number[]; max: number[] } }>;
  support?: Support; pipes?: Pipes; designOk?: boolean;
  // 메시 부울 2차가 원본 AABB 과탐을 해제했을 때의 추적값(감추지 않는다 — 260728)
  interferencesRaw?: number; interferencesDemoted?: number; interferenceBasis?: string;
  interferencesUnrefined?: number;
  interferenceProfile?: { allLatticePairs: boolean; maxIntersectMm3: number | null; measured: number };
};
type Basis = { rev: string; massKg: number; env: number[]; parts: number };
type AsmMod = { buildAssembly: (a: Assembly) => Built };
type PkgMod = {
  ga2dDrawing: (a: Assembly, o?: Record<string, unknown>) => string; structuralReport: (a: Assembly, o?: Record<string, unknown>) => string;
  packageStamp: (html: string, basis: Basis) => string;
  packageConsistencyCheck: (files: Array<{ name: string; content: string }>, basis: Basis, o?: { hasFluid?: boolean; alignment?: unknown }) => { pass: boolean; checks: unknown[]; rev: string };
};
type BoqMod = { boqReport: (a: Assembly, o?: Record<string, unknown>) => string };
type PdMod = { dossierReport: (a: Assembly, o?: Record<string, unknown>) => string; pidSkeleton: (a: Assembly, o?: Record<string, unknown>) => string };
type RenderMod = { renderHtml: (spec: unknown, o?: Record<string, unknown>) => Promise<string>; renderColoredHtml: (spec: unknown, o?: Record<string, unknown>) => Promise<string> };
type VerifyMod = { renderStl: (scad: string) => Promise<Uint8Array> };
type DxfMod = { dxfPlan: (a: Assembly, domain: string, pipes?: unknown[], opts?: Record<string, unknown>) => string | null; dxfProfile: (a: Assembly) => string | null };
type LxMod = { landxmlAlignment: (a: Assembly, o?: Record<string, unknown>) => string | null };
type IfcMod = { ifcExport: (a: Assembly, o?: Record<string, unknown>) => string | null; ifcAlignment43: (a: Assembly, o?: Record<string, unknown>) => string | null };
type XlsxMod = { boqXlsxBase64: (a: Assembly, o?: Record<string, unknown>) => string };
// P0 웹 도면집 동급화(260719b): MCP generate_package 와 동일 구성 — 부품도·제작사양서·
// 완성도·A1 라운드트립·B1 메시 부울·T2 실시 검도(웹 우선 탑재)
type PsMod = { partSheets: (a: Assembly, o?: Record<string, unknown>) => string };
type FspMod = { fabricationSpec: (a: Assembly, o?: Record<string, unknown>) => Promise<string> };
type DcMod = {
  checkDrawingCompleteness: (html: string, o?: Record<string, unknown>) => unknown;
  checkDxfLayers: (dxf: string) => unknown;
  /** 260728 §7-3 — 적용 가능성 규칙은 이 모듈에만 있다(두 발생지 공유). */
  completenessApplicability?: (a: Assembly, built?: unknown) => Record<string, boolean>;
};
type ExecutionGate = { score: string; ok: boolean; items: unknown[]; failed: string[]; na: string[]; note: string };
type EgMod = {
  checkExecutionReadiness: (a: Assembly, o?: { gaHtml?: string; sheetsHtml?: string; welds?: unknown[] }) => ExecutionGate;
  executionReportHtml?: (g: ExecutionGate, o?: { title?: string }) => string;
};
type RtMod = { stepRoundTrip: (a: Assembly) => Promise<unknown> };
type IrMod = {
  refineInterferencesMesh: (a: Assembly, i: unknown[], o?: Record<string, unknown>) => Promise<unknown>;
  applyInterferenceRefinement: (built: Built, refine: unknown) => Built;
};
type FaMod = { autoFasteners: (a: Assembly) => unknown };
// 일반인용 결과 요약(260719) — 전문가 산출물을 쉬운 말 5섹션 1페이지로. 새 계산 없음(기존 모듈 재사용).
type EsMod = { easySummary: (a: Assembly, o?: Record<string, unknown>) => string };
// B2 앞문(260721): 분야 템플릿 → 결정론 어셈블리. templateId 지정 시 assembly 를 대신 합성.
type TemplateAsm = Assembly & { domain?: string; ok?: boolean; error?: string; message?: string; paramErrors?: unknown[]; alignmentErrors?: unknown[] };
type TplMod = { buildAssemblyTemplate: (domain: string, id: string, params?: Record<string, unknown>) => TemplateAsm | null; listAssemblyTemplates: (domain?: string) => unknown[] };

let _asm: AsmMod | null = null, _pkg: PkgMod | null = null, _rnd: RenderMod | null = null, _boq: BoqMod | null = null, _pd: PdMod | null = null, _vfy: VerifyMod | null = null, _dxf: DxfMod | null = null, _lx: LxMod | null = null, _xl: XlsxMod | null = null, _ifc: IfcMod | null = null;
let _ps: PsMod | null = null, _fsp: FspMod | null = null, _dc: DcMod | null = null, _eg: EgMod | null = null, _rt: RtMod | null = null, _ir: IrMod | null = null, _fa: FaMod | null = null, _es: EsMod | null = null;
async function load() {
  const base = join(process.cwd(), 'scripts', 'drawing-to-3d');
  if (!_lx) _lx = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'landxml-export.mjs')).href)) as LxMod;
  if (!_xl) _xl = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'xlsx-export.mjs')).href)) as XlsxMod;
  if (!_ifc) _ifc = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'ifc-export.mjs')).href)) as IfcMod;
  if (!_asm) _asm = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'assembly.mjs')).href)) as AsmMod;
  if (!_pkg) _pkg = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'package.mjs')).href)) as PkgMod;
  if (!_rnd) _rnd = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'html-render.mjs')).href)) as RenderMod;
  if (!_boq) _boq = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'boq.mjs')).href)) as BoqMod;
  if (!_pd) _pd = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'pid_dossier.mjs')).href)) as PdMod;
  if (!_vfy) _vfy = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'verify.mjs')).href)) as VerifyMod;
  if (!_dxf) _dxf = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'dxf-export.mjs')).href)) as DxfMod;
  if (!_ps) _ps = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'part-sheets.mjs')).href)) as PsMod;
  if (!_fsp) _fsp = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'fab-spec.mjs')).href)) as FspMod;
  if (!_dc) _dc = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'drawing-completeness.mjs')).href)) as DcMod;
  if (!_eg) _eg = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'execution-gate.mjs')).href)) as EgMod;
  if (!_rt) _rt = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'roundtrip.mjs')).href)) as RtMod;
  if (!_ir) _ir = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'interference-refine.mjs')).href)) as IrMod;
  if (!_fa) _fa = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'fastener-auto.mjs')).href)) as FaMod;
  if (!_es) _es = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'easy-summary.mjs')).href)) as EsMod;
  return { asm: _asm, pkg: _pkg, rnd: _rnd, boq: _boq, pd: _pd, vfy: _vfy, dxf: _dxf, lx: _lx, xl: _xl, ifc: _ifc, ps: _ps, fsp: _fsp, dc: _dc, eg: _eg, rt: _rt, ir: _ir, fa: _fa, es: _es };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-package:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let assembly: Assembly, options: Record<string, unknown>;
  let verifyParams: Record<string, unknown> = {};
  let tpl: { templateId?: string; domain?: string; params?: Record<string, unknown> } = {};
  try {
    const body = (await req.json()) as { assembly?: Assembly; options?: Record<string, unknown>; templateId?: string; domain?: string; params?: Record<string, unknown>; verifyParams?: Record<string, unknown> };
    assembly = body.assembly ?? {};
    options = body.options ?? {};
    if (typeof body.templateId === 'string') tpl = { templateId: body.templateId, domain: body.domain, params: body.params };
    // ⚠ 260729: 안전검토·코드대조에 **params 를 한 번도 넘기지 않았다**(`{}` 고정).
    //   R·V0·usage 같은 지배 입력이 있어도 도달하지 않아 모든 패키지의 안전검토가
    //   "입력 필요"로 나갔다 — MCP 쪽에서 고친 `verifyParams` 결함의 웹 쪽 쌍둥이다
    //   (두 생성 사이트는 대칭이어야 한다). 검증용 입력은 템플릿 빌드용 `params` 와
    //   구분해서 받는다 — 섞으면 템플릿 게이트가 모르는 키를 거부한다.
    verifyParams = (body.verifyParams && typeof body.verifyParams === 'object') ? body.verifyParams : {};
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // B2 앞문: templateId 가 오면 분야 템플릿을 결정론 합성해 assembly 를 대신 만든다(4면 통일).
  // 입력값 불가는 기본값으로 덮지 않고 정직 거부(paramErrors) — 나머지 파이프라인은 동일.
  if (tpl.templateId) {
    if (typeof tpl.domain !== 'string') {
      return NextResponse.json({ ok: false, error: 'templateId 사용 시 domain 이 필요합니다 (예: building/rc_frame).' }, { status: 400 });
    }
    try {
      const tm = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'domain-assemblies.mjs')).href)) as TplMod;
      const asm = tm.buildAssemblyTemplate(tpl.domain, tpl.templateId, tpl.params ?? {});
      if (!asm) return NextResponse.json({ ok: false, error: `unknown template '${tpl.domain}/${tpl.templateId}'` }, { status: 404 });
      if (asm.ok === false || (Array.isArray(asm.alignmentErrors) && asm.alignmentErrors.length > 0)) {
        return NextResponse.json({ ok: false, stage: 'params', error: asm.error ?? 'invalid_params', paramErrors: asm.paramErrors ?? asm.alignmentErrors ?? [], message: asm.message }, { status: 200 });
      }
      assembly = asm as Assembly;
    } catch (e) {
      return NextResponse.json({ ok: false, error: 'template load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
    }
  }

  if (!Array.isArray(assembly.parts) || assembly.parts.length === 0) {
    return NextResponse.json({ ok: false, error: 'assembly.parts 또는 templateId+domain 이 필요합니다.' }, { status: 400 });
  }

  let mods: { asm: AsmMod; pkg: PkgMod; rnd: RenderMod; boq: BoqMod; pd: PdMod; vfy: VerifyMod; dxf: DxfMod; lx: LxMod | null; xl: XlsxMod | null; ifc: IfcMod | null; ps: PsMod | null; fsp: FspMod | null; dc: DcMod | null; eg: EgMod | null; rt: RtMod | null; ir: IrMod | null; fa: FaMod | null; es: EsMod | null };
  try { mods = await load(); } catch (e) {
    return NextResponse.json({ ok: false, error: 'pipeline load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }

  let built = mods.asm.buildAssembly(assembly);
  if (!built.ok) {
    return NextResponse.json({ ok: false, stage: 'gate', gateErrors: built.gateErrors ?? [] }, { status: 200 });
  }

  const title = typeof options.title === 'string' ? options.title : (assembly.name ?? '설계');
  const member = options.member as Record<string, unknown> | undefined;
  // 분야: assembly.domain(도메인 어셈블리 템플릿) 또는 options.domain — BOQ 물량단위·P&ID 유무를 정한다 (#6)
  const domain = (typeof (assembly as { domain?: unknown }).domain === 'string' ? (assembly as { domain: string }).domain : undefined)
    ?? (typeof options.domain === 'string' ? options.domain : undefined) ?? 'mech';
  const nonMech = ['building', 'landscape', 'interior', 'civil', 'bridge'].includes(domain);
  const files: Array<{ name: string; mime: string; content: string; b64?: boolean }> = [];
  /**
   * **생성에 실패한** 산출물. 목록에서 그냥 빠지면 받는 쪽은 "원래 없는 것"으로 읽는다 —
   * 물량 산출서가 없으면 견적을 못 받는데도 그렇다(260728 §7-5).
   */
  const outputsFailed: string[] = [];

  // 2D GA 도면 (건축=축선 구조평면·조경=배치도 모드 포함 · 배관=라우터 결과 그대로 투영)
  // revHistory=개정 이력(입력 원칙) · lang='en'=시트명·표두 EN(본문 KO 유지 명시)
  // P0(260719b): welds 전달 — 용접 지시선(nf-weldarrow)+일람이 웹 도면집에도 실배치(MCP 동급)
  let gaHtml = '';
  let completeness: unknown = null;
  try {
    files.push({
      name: 'GA_2D_drawing.html', mime: 'text/html',
      content: mods.pkg.ga2dDrawing(assembly, {
        title, domain, pipes: built.pipes?.routes, welds: built.welds,
        // REV(#3, 260719): 옵션 입력 이력 우선, 없으면 편집 자동 축적(asm.revisions) 반영
        ...(Array.isArray(options.revHistory)
          ? { revHistory: options.revHistory }
          : Array.isArray((assembly as { revisions?: Array<{ at?: number; kind?: string; target?: string; note?: string }> }).revisions)
            ? { revHistory: (assembly as { revisions: Array<{ at?: number; kind?: string; target?: string; note?: string }> }).revisions.map((r, i) => ({ rev: String(i + 1), date: r.at ? new Date(r.at).toISOString().slice(0, 10) : '', note: `${r.kind ?? 'edit'} ${r.target ?? ''} ${r.note ?? ''}`.trim().slice(0, 90) })) }
            : {}),
        ...(options.lang === 'en' ? { lang: 'en' } : {}),
      }),
    });
    gaHtml = files[files.length - 1].content;
    try {
      const applicability = mods.dc?.completenessApplicability?.(assembly, built);
      completeness = mods.dc?.checkDrawingCompleteness(gaHtml, applicability ? { applicability } : {}) ?? null;
    } catch (e) { void e; }
  } catch (e) { /* skip */ void e; }
  // P0(260719b): 부품 제작도(구멍표·제작치수 행 — M1/M2 단일 소스) + 제작 사양서(MCP 동급)
  let sheetsHtml = '';
  try {
    if (mods.ps) {
      sheetsHtml = mods.ps.partSheets(assembly, { title: title + ' — 부품 제작도' });
      files.push({ name: '부품제작도.html', mime: 'text/html', content: sheetsHtml });
    }
  } catch (e) { void e; outputsFailed.push('부품제작도.html'); }
  try {
    if (mods.fsp) files.push({ name: '제작사양서.html', mime: 'text/html', content: await mods.fsp.fabricationSpec(assembly, { title: title + ' — 제작 사양서' }) });
  } catch (e) { void e; outputsFailed.push('제작사양서.html'); }
  // DXF 평면 (P1 — AutoCAD 편집용, 레이어 분리 R12. 건축·조경·인테리어 + PIPE 레이어)
  try {
    const dxf = mods.dxf.dxfPlan(assembly, domain, built.pipes?.routes, { title, dwgNo: 'NX-GA-001' });
    if (dxf) files.push({ name: 'GA_plan.dxf', mime: 'application/dxf', content: dxf });
  } catch (e) { void e; outputsFailed.push('GA_plan.dxf'); }
  // LandXML(Wave 1 실무 호환) — 토목 선형: 도로·선형 SW 교환 표준(요소열 단일 소스, 재계산 없음)
  try {
    if (domain === 'civil' && (assembly as { alignment?: unknown }).alignment && mods.lx) {
      const xml = mods.lx.landxmlAlignment(assembly, { name: title.slice(0, 40), project: 'nexyfab' });
      if (xml) files.push({ name: 'alignment.xml', mime: 'application/xml', content: xml });
      // IFC4.3 IfcAlignment(인프라 BIM 정식 경로 — buildingSMART 샘플 앵커, 시맨틱 선형)
      if (mods.ifc) {
        const a43 = mods.ifc.ifcAlignment43(assembly, { name: title.slice(0, 40), rev: createHash('sha1').update(JSON.stringify({ a: assembly, d: domain })).digest('hex').slice(0, 8) });
        if (a43) files.push({ name: 'alignment43.ifc', mime: 'application/x-step', content: a43 });
      }
    }
  } catch (e) { void e; outputsFailed.push('alignment43.ifc'); }
  // IFC4(BIM 발주 대응 — LOD200 형상+분류, 비기계 도메인) — 결정론 GlobalId(재생성 동일)
  try {
    if (nonMech && mods.ifc) {
      const ifcStr = mods.ifc.ifcExport(assembly, { name: title.slice(0, 40), rev: createHash('sha1').update(JSON.stringify({ a: assembly, d: domain })).digest('hex').slice(0, 8) });
      if (ifcStr) files.push({ name: 'assembly.ifc', mime: 'application/x-step', content: ifcStr });
    }
  } catch (e) { void e; outputsFailed.push('assembly.ifc'); }
  // 내역서 XLSX(Wave 1) — 현장 견적·기성 표준 포맷(단가·금액=공란, 입력 원칙)
  try {
    if (mods.xl) files.push({ name: 'BOQ_내역서.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: mods.xl.boqXlsxBase64(assembly, { domain, title }), b64: true });
  } catch (e) { void e; outputsFailed.push('BOQ_내역서.xlsx'); }
  // 종단면도 DXF(토목 선형 — 종 10× 왜곡 좌표, 주기 명시)
  try {
    if (domain === 'civil' && (assembly as { alignment?: unknown }).alignment) {
      const dxfp = mods.dxf.dxfProfile(assembly);
      if (dxfp) files.push({ name: 'GA_profile.dxf', mime: 'application/dxf', content: dxfp });
    }
  } catch (e) { void e; outputsFailed.push('GA_profile.dxf'); }
  // 구조/응력 검토
  try { files.push({ name: 'structural.html', mime: 'text/html', content: mods.pkg.structuralReport(assembly, { title, member }) }); } catch (e) { void e; outputsFailed.push('structural.html'); }
  // domainSafety 는 아래 쉬운요약.html 호출에 그대로 전달된다 — feaSummary와 동일 이유:
  // structural(강체 전도)만으로는 코드 위반(정원 초과·출구 부족 등)을 못 잡는다(260723 도그푸딩
  // 3차 발견: 안전검토.html엔 FAIL이 정확히 뜨는데 쉬운요약엔 이 판정이 안 넘어가 "이상 없음"이었다).
  let domainSafety: { label: string; ok: boolean; failed: string[] } | null = null;
  // codeVerification(옹벽·암거 KDS 대조)도 같은 이유로 쉬운요약에 전달한다 — domainSafety는
  // interior/landscape/bridge/building 담당이라 civil은 어느 쪽으로도 소비자 문서에 도달하지
  // 못했다(260723 A-7 전수감사: 활동 FS 미달 옹벽이 검증.html=FAIL, 쉬운요약="이상 없음").
  let codeVerification: { label: string; ok: boolean; failed: string[]; decisive: boolean } | null = null;
  /** 검증을 **못 돌린** 항목 — null 로 숨기지 않고 소비자 문서까지 전달한다(260728 §7-5). */
  const verificationUnavailable: string[] = [];
  // MCP 와 동일 — 부재 휨/처짐 미검토는 "이상 없음"이 아니라 "판정 불가"다(260728).
  {
    const mu = (built.structural as { memberUnavailable?: { messageKo?: string } } | undefined)?.memberUnavailable;
    if (mu?.messageKo) verificationUnavailable.push(mu.messageKo);
  }
  // ③ 형상+검증: 어셈블리 검증 메타(옹벽 등) → 분야 KDS 계산기 실행값(전도·활동·지지력…). 메타 없으면 미생성(정직).
  try {
    const dv = (await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), 'scripts', 'drawing-to-3d', 'domain-dossier-verify.mjs')).href)) as {
      verificationReportHtml: (a: Assembly, o?: { title?: string; params?: Record<string, unknown> }) => string | null;
      domainSafetyReportHtml: (a: Assembly, o?: { title?: string; params?: Record<string, unknown> }) => string | null;
      domainSafetyVerdict: (a: Assembly, params?: Record<string, unknown>) => { label: string; ok: boolean; failed: string[] } | null;
      codeVerificationVerdict: (a: Assembly, params?: Record<string, unknown>) => { label: string; ok: boolean; failed: string[]; decisive: boolean } | null;
    };
    const vh = dv.verificationReportHtml(assembly, { title, params: verifyParams });
    if (vh) files.push({ name: '검증.html', mime: 'text/html', content: vh });
    codeVerification = dv.codeVerificationVerdict(assembly, verifyParams);
    // ③b 도메인 안전검토(인테리어 피난·조경 목재·교량 활하중·건축 하중경로) — 이 웹
    // 패키지 라우트도 MCP generate_package와 별개 구현이라 같은 배선이 빠져있었다
    // (도그푸딩 발견: 인테리어/조경/교량 도세가 안전검토 없이 나가던 문제의 두 번째
    // 발생지 — 이쪽이 실제 웹사이트 "패키지 다운로드"가 쓰는 경로).
    const sh = dv.domainSafetyReportHtml(assembly, { title, params: verifyParams });
    if (sh) files.push({ name: '안전검토.html', mime: 'text/html', content: sh });
    domainSafety = dv.domainSafetyVerdict(assembly, verifyParams);
  } catch (e) {
    // ⚠ 여기서 조용히 삼키면 안전 판정이 사라지고 쉬운요약은 "걸린 안전 경고는 없습니다"로
    // 나간다 — 835eec40 이 고친 것과 같은 결말에 도달하는 다른 경로(배선 부재가 아니라 예외).
    // '이상 없음'과 '확인 못 함'은 다른 말이므로 그 구별을 소비자까지 전달한다(260728 §7-5).
    verificationUnavailable.push(
      `코드 대조 검증·도메인 안전검토: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`,
    );
  }
  // 물량·작업량 산출서 (BOQ, 금액 제외 — 비기계 분야는 재적 중심·공수 미산출)
  try { files.push({ name: 'BOQ.html', mime: 'text/html', content: mods.boq.boqReport(assembly, { title, domain }) }); } catch (e) { void e; outputsFailed.push('BOQ.html'); }
  // 설계 설명서 (Dossier) + P&ID 스켈레톤 (계통 기반 — 공정 없는 비기계 분야는 P&ID 제외)
  try { files.push({ name: 'Dossier.html', mime: 'text/html', content: mods.pd.dossierReport(assembly, { title }) }); } catch (e) { void e; outputsFailed.push('Dossier.html'); }
  if (!nonMech) {
    try { files.push({ name: 'PID_skeleton.html', mime: 'text/html', content: mods.pd.pidSkeleton(assembly, { title }) }); } catch (e) { void e; outputsFailed.push('PID_skeleton.html'); }
  }
  // GA 3D 계통색 (부품 service/type → 색분류 멀티메시). 실패 시 모노크롬 폴백.
  try {
    files.push({ name: 'GA_3D.html', mime: 'text/html', content: await mods.rnd.renderColoredHtml({ assembly }, { title, subtitle: 'nexyfab 자동생성 계통색 GA' }) });
  } catch {
    try { files.push({ name: 'GA_3D.html', mime: 'text/html', content: await mods.rnd.renderHtml({ assembly }, { title, subtitle: 'nexyfab 자동생성 GA' }) }); } catch (e) { void e; outputsFailed.push('GA_3D.html'); }
  }
  // SCAD
  if (built.openscad) files.push({ name: 'model.scad', mime: 'text/plain', content: built.openscad });

  // FEA 응력해석 (#7) — 형상 STL 실렌더 → TET10 선형정적(runSimpleFEA, beam-theory 폴백).
  // 하중 기본값 = 총질량×g(자중 상당, 상면 등가 — 가정을 리포트에 명시). options.fea===false 로 생략.
  // feaSummary 는 아래 쉬운요약.html 호출에 그대로 전달된다 — structural(강체 전도/CG)과
  // FEA(응력)는 독립 계산이라, 여기서 안 넘기면 FEA가 위험해도 쉬운요약이 "이상 없음"으로
  // 표시할 수 있었다(도그푸딩 발견: 65t 등가하중 철판이 FEA 안전율 0.49인데 쉬운요약은
  // structural만 보고 통과 표시).
  let feaSummary: { safetyFactor: number; method?: string } | null = null;
  if (options.fea !== false && built.openscad) {
    try {
      const { feaFromStl, feaReportHtml, FEA_MATERIALS } = await import('@/app/[lang]/shape-generator/analysis/feaPackage');
      const stl = await mods.vfy.renderStl(built.openscad);
      const totalMassKg = (built.structural as { totalMassKg?: number } | null)?.totalMassKg ?? 0;
      const loadKg = typeof options.feaLoadKg === 'number' && options.feaLoadKg > 0 ? options.feaLoadKg : totalMassKg;
      // 재료: options.feaMaterial 우선, 없으면 부품 material 최빈값
      let materialKey = typeof options.feaMaterial === 'string' && options.feaMaterial in FEA_MATERIALS ? options.feaMaterial : '';
      if (!materialKey) {
        const counts = new Map<string, number>();
        for (const p of assembly.parts) {
          const m = typeof p.material === 'string' ? p.material : '';
          if (m && m in FEA_MATERIALS) counts.set(m, (counts.get(m) ?? 0) + 1);
        }
        materialKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'STS316';
      }
      // 혼합 재질 경고 (보완 #9) — TET10은 단일 물성: 최빈값 근사임을 리포트에 명시
      const allMats = [...new Set(assembly.parts.map((p) => (typeof p.material === 'string' ? p.material : '')).filter(Boolean))];
      const mixedNote = allMats.length > 1 ? ` ⚠혼합 재질(${allMats.join('·')}) — 최빈값 단일 물성 근사, 부위별 강성차 미반영` : '';
      const loadNote = (typeof options.feaLoadKg === 'number' && options.feaLoadKg > 0
        ? `사용자 지정 ${options.feaLoadKg} kg`
        : `총질량 ${totalMassKg} kg × g — 자중 상당을 상면 등가 하중으로(보수적 개산)`) + mixedNote;
      const out = feaFromStl({ stl, materialKey, loadN: loadKg * 9.81, loadNote });
      files.push({ name: 'FEA.html', mime: 'text/html', content: feaReportHtml(out, { title }) });
      if (Number.isFinite(out.result?.safetyFactor)) {
        feaSummary = { safetyFactor: out.result.safetyFactor, method: out.result.method };
      }
    } catch (e) { void e; outputsFailed.push('FEA.html'); /* FEA 실패는 패키지를 막지 않음 — 파일만 빠짐 */ }
  }

  // P0(260719b) 검증 3종(MCP 동급+T2 웹 우선) — options.verify===false 로 생략 가능
  //   A1 라운드트립(STEP 재임포트 실측↔폐형 예측) · B1 의심쌍 메시 부울(잔여 간섭 시)
  //   · T2 실시 검도 M1~M6(GA+부품도 기입 치수 결정론 대조) → 검도 리포트 동봉
  let roundtrip: unknown = null, interferenceRefine: unknown = null;
  let executionGate: ReturnType<EgMod['checkExecutionReadiness']> | null = null;
  // 체결 자동(260719b): 플랜지 짝 볼트 세트 — 검증과 무관하게 항상 산출(보고 전용)
  let fasteners: unknown = null;
  try { fasteners = mods.fa ? mods.fa.autoFasteners(assembly) : null; } catch (e) { void e; }
  if (options.verify !== false) {
    try { roundtrip = mods.rt ? await mods.rt.stepRoundTrip(assembly) : null; } catch (e) { roundtrip = { error: String(e instanceof Error ? e.message : e).slice(0, 120) }; }
    if ((built.interferences ?? []).length && mods.ir) {
      try { interferenceRefine = await mods.ir.refineInterferencesMesh(assembly, built.interferences ?? []); } catch (e) { interferenceRefine = { error: String(e instanceof Error ? e.message : e).slice(0, 120) }; }
      // 260728: MCP 와 동일 — 정제 결과를 되돌려 응답·쉬운요약이 원본 AABB 과탐을 쓰지 않게.
      if (mods.ir.applyInterferenceRefinement) built = mods.ir.applyInterferenceRefinement(built, interferenceRefine);
      if (built.interferencesUnrefined) {
        verificationUnavailable.push(`부품 겹침 2차 정밀검증: ${built.interferencesUnrefined}쌍이 성능 예산 초과로 미검증 — 보수(겹침) 판정을 유지했습니다. 확정된 겹침과 구별해서 보세요.`);
      }
    }
    try {
      executionGate = mods.eg ? mods.eg.checkExecutionReadiness(assembly, { gaHtml, sheetsHtml, welds: built.welds ?? [] }) : null;
      // 리포트 렌더러는 execution-gate.mjs 로 올렸다 — MCP 발생지와 같은 소스(260728).
      if (executionGate && mods.eg?.executionReportHtml) {
        files.push({
          name: '실시검도리포트.html', mime: 'text/html',
          content: mods.eg.executionReportHtml(executionGate, { title }),
        });
      }
    } catch (e) { void e; outputsFailed.push('실시검도리포트.html'); }
  }

  // REV 스탬프 + 산출물 크로스 정합 게이트 (#7 — 위시빌더 "카드=REV B vs 도면=REV C" 재발 방지)
  const rev = createHash('sha1').update(JSON.stringify({ a: assembly, d: domain })).digest('hex').slice(0, 8);
  const st = built.structural as { totalMassKg?: number } | null;
  const aabbs = built.parts ?? [];
  const env = [0, 1, 2].map((k) =>
    aabbs.length ? Math.max(...aabbs.map((p) => p.aabb.max[k])) - Math.min(...aabbs.map((p) => p.aabb.min[k])) : 0);
  const basis: Basis = { rev, massKg: st?.totalMassKg ?? 0, env, parts: assembly.parts.length };
  let consistency: { pass: boolean; checks: unknown[]; rev: string } | null = null;
  try {
    for (const f of files) if (f.mime === 'text/html') f.content = mods.pkg.packageStamp(f.content, basis);
    // DXF 표제란 REV 치환(Wave 1 — HTML nf-rev 스팬과 동일 발행 규약)
    for (const f of files) if (f.name.endsWith('.dxf')) f.content = f.content.replaceAll('NF-REV-PENDING', rev);
    const hasFluid = assembly.parts.some((p) => !!(p as { fluid?: unknown }).fluid);
    const alignment = (assembly as { alignment?: unknown }).alignment ?? null;
    consistency = mods.pkg.packageConsistencyCheck(files, basis, { hasFluid, alignment });
  } catch (e) { void e; /* 정합 게이트 실패는 패키지를 막지 않되 consistency=null 로 정직 표기 */ }

  // 일반인용 쉬운 요약(260719) — 위 산출물 전부가 정해진 뒤 마지막에 동봉해야 파일 용도 안내가
  // 실제 동봉 목록과 일치한다(없는 파일 안내=거짓말). 검도 결과는 있을 때만 전달(옵션).
  // 260728 §6-3: 스탬프·정합 게이트 **뒤로** 옮겼다 — 문서 간 수치 불일치를 요약에 실으려면
  // 그 판정이 먼저 확정돼야 한다. 정합 검사는 쉬운요약 자신을 읽지 않으므로 순서 이동은 안전하고,
  // 파일 용도 안내가 실제 목록과 일치한다는 성질도 그대로다(자기 자신은 종전에도 목록에 없다).
  try {
    if (mods.es) {
      files.push({
        name: '쉬운요약.html', mime: 'text/html',
        content: mods.pkg.packageStamp(mods.es.easySummary(assembly, {
          title, domain,
          // MCP 와 동일 — 요약이 buildAssembly 를 다시 부르면 해제된 과탐이 되살아난다.
          built,
          fileNames: files.map((f) => f.name),
          ...(executionGate ? { executionGate } : {}),
          ...(feaSummary ? { fea: feaSummary } : {}),
          ...(domainSafety ? { domainSafety } : {}),
          ...(codeVerification ? { codeVerification } : {}),
          ...(consistency ? { consistency } : {}),
          ...(verificationUnavailable.length ? { verificationUnavailable } : {}),
          ...(completeness ? { completeness } : {}),
          ...(outputsFailed.length ? { outputsFailed } : {}),
        }), basis), // 늦게 만든 만큼 개별 스탬프 — 위 루프는 이미 지나갔다
      });
    }
  } catch (e) {
    void e;
    // ⚠ 이 문서가 **모든 안전 판정을 소비자에게 나르는** 유일한 표면이다. 실패하면 옹벽
    // KDS·도메인 안전검토·정합·구비요건이 통째로 도달하지 못한다. 실패 사실을 적을 자리가
    // 바로 그 문서 안이라, 응답 JSON 이 유일한 통로다(260728 §7-5).
    outputsFailed.push('쉬운요약.html (안전 판정 전달 문서 — 이 실패는 판정이 소비자에게 도달하지 못했다는 뜻)');
  }

  // 커스텀 생성기 스캐폴드 (#9 — 위시빌더 "단일 소스 → 전 도면 재생성" 워크플로우의 제품화)
  try {
    files.push({
      name: 'generator.mjs', mime: 'text/javascript',
      content: `#!/usr/bin/env node
/**
 * ${title.replace(/\*\//g, '')} — nexyfab 설계 패키지 재생성기 (자동 동봉 · REV ${rev})
 * 어셈블리 정의가 이 파일에 내장돼 있습니다(단일 소스). ASSEMBLY 를 수정한 뒤 실행하면
 * nexyfab 공개 API 가 전 산출물(GA 3D/2D·구조·BOQ·Dossier·FEA…)을 다시 생성합니다 —
 * 문서와 도면이 항상 같은 정의에서 나오므로 수기 전사 드리프트가 없습니다.
 * usage: node generator.mjs [--out design_package.zip]   (Node 18+ · 네트워크 필요 · rate 4회/분)
 */
const ASSEMBLY = ${JSON.stringify(assembly, null, 2)};
const OPTIONS = ${JSON.stringify({ title, domain }, null, 2)};
const API = process.env.NEXYFAB_API ?? 'https://nexyfab.com/api/nexyfab/drawing/package';
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'design_package.zip';
const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assembly: ASSEMBLY, options: OPTIONS }) });
if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
const data = await res.json();
if (!data.ok) { console.error('실패:', data.error ?? (data.gateErrors ?? []).join('; ')); process.exit(1); }
const { writeFileSync } = await import('node:fs');
if (data.zipBase64) { writeFileSync(out, Buffer.from(data.zipBase64, 'base64')); console.log('저장:', out, '· REV:', data.rev); }
else for (const f of data.files ?? []) { writeFileSync(f.name, f.content); console.log('저장:', f.name); }
if (data.consistency && !data.consistency.pass) console.warn('⚠ 산출물 정합 불일치:', JSON.stringify(data.consistency.checks));
if (data.support?.floating?.length) console.warn('⚠ 부유 부품(설치 불가 신호):', data.support.floating.join(', '));
if (data.pipes?.errors?.length) console.warn('⚠ 배관 라우팅 실패:', data.pipes.errors.join(' / '));
`,
    });
  } catch (e) { void e; }

  // zip 묶음 (한 파일 다운로드). 실패 시 files 로 폴백.
  let zipBase64: string | null = null;
  try {
    const zip = new JSZip();
    for (const f of files) {
      // DXF=cp949 인코딩(Wave 1 — $DWGCODEPAGE ANSI_949 와 정합: AutoCAD 한글 주기·표제란)
      if (f.name.endsWith('.dxf')) zip.file(f.name, iconv.encode(f.content, 'cp949'));
      else if (f.b64) zip.file(f.name, f.content, { base64: true }); // XLSX 등 바이너리
      else zip.file(f.name, f.content);
    }
    zipBase64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  } catch { zipBase64 = null; }

  return NextResponse.json({
    ok: true,
    rev,
    zipBase64,
    fileNames: files.map((f) => f.name),
    files: zipBase64 ? undefined : files, // zip 성공 시 개별 content 생략(페이로드↓)
    structural: built.structural ?? null,
    interferences: built.interferences ?? [],
    // MCP 와 동일 — 좁혀진 숫자의 근거를 함께 준다(원본을 감추지 않는다).
    ...(built.interferenceBasis ? {
      interferencesRaw: built.interferencesRaw, interferencesDemoted: built.interferencesDemoted,
      ...(built.interferencesUnrefined ? { interferencesUnrefined: built.interferencesUnrefined } : {}),
      ...(built.interferenceProfile ? { interferenceProfile: built.interferenceProfile } : {}),
      interferenceBasis: built.interferenceBasis,
    } : {}),
    welds: built.welds ?? [], weldTotalMm: built.weldTotalMm ?? 0,
    // 설계 타당성 그물(#2) — 부유·면접촉(매립 제안)·배관 관통/교차 + 종합 판정
    support: built.support ?? null,
    pipes: built.pipes ?? null,
    designOk: built.designOk ?? null,
    consistency,
    verificationUnavailable,
    outputsFailed,
    // P0(260719b): 검증 3종+완성도 — MCP generate_package 와 동일 필드(웹 동급화)
    completeness,
    roundtrip,
    interferenceRefine,
    executionGate,
    fasteners,
    note: 'P&ID·Dossier(AI 보조)는 후속. 형상기반 GA 3D·2D 도면·구조·BOQ·SCAD 자동생성 + A1/B1/M1~M6 검증 동봉.',
  });
}
