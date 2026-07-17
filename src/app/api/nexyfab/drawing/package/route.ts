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
type XlsxMod = { boqXlsxBase64: (a: Assembly, o?: Record<string, unknown>) => string };

let _asm: AsmMod | null = null, _pkg: PkgMod | null = null, _rnd: RenderMod | null = null, _boq: BoqMod | null = null, _pd: PdMod | null = null, _vfy: VerifyMod | null = null, _dxf: DxfMod | null = null, _lx: LxMod | null = null, _xl: XlsxMod | null = null;
async function load() {
  const base = join(process.cwd(), 'scripts', 'drawing-to-3d');
  if (!_lx) _lx = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'landxml-export.mjs')).href)) as LxMod;
  if (!_xl) _xl = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'xlsx-export.mjs')).href)) as XlsxMod;
  if (!_asm) _asm = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'assembly.mjs')).href)) as AsmMod;
  if (!_pkg) _pkg = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'package.mjs')).href)) as PkgMod;
  if (!_rnd) _rnd = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'html-render.mjs')).href)) as RenderMod;
  if (!_boq) _boq = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'boq.mjs')).href)) as BoqMod;
  if (!_pd) _pd = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'pid_dossier.mjs')).href)) as PdMod;
  if (!_vfy) _vfy = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'verify.mjs')).href)) as VerifyMod;
  if (!_dxf) _dxf = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'dxf-export.mjs')).href)) as DxfMod;
  return { asm: _asm, pkg: _pkg, rnd: _rnd, boq: _boq, pd: _pd, vfy: _vfy, dxf: _dxf, lx: _lx, xl: _xl };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`drawing-package:${ip}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let assembly: Assembly, options: Record<string, unknown>;
  try {
    const body = (await req.json()) as { assembly?: Assembly; options?: Record<string, unknown> };
    assembly = body.assembly ?? {};
    options = body.options ?? {};
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!Array.isArray(assembly.parts) || assembly.parts.length === 0) {
    return NextResponse.json({ ok: false, error: 'assembly.parts 가 필요합니다.' }, { status: 400 });
  }

  let mods: { asm: AsmMod; pkg: PkgMod; rnd: RenderMod; boq: BoqMod; pd: PdMod; vfy: VerifyMod; dxf: DxfMod; lx: LxMod | null; xl: XlsxMod | null };
  try { mods = await load(); } catch (e) {
    return NextResponse.json({ ok: false, error: 'pipeline load failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }

  const built = mods.asm.buildAssembly(assembly);
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

  // 2D GA 도면 (건축=축선 구조평면·조경=배치도 모드 포함 · 배관=라우터 결과 그대로 투영)
  // revHistory=개정 이력(입력 원칙) · lang='en'=시트명·표두 EN(본문 KO 유지 명시)
  try {
    files.push({
      name: 'GA_2D_drawing.html', mime: 'text/html',
      content: mods.pkg.ga2dDrawing(assembly, {
        title, domain, pipes: built.pipes?.routes,
        ...(Array.isArray(options.revHistory) ? { revHistory: options.revHistory } : {}),
        ...(options.lang === 'en' ? { lang: 'en' } : {}),
      }),
    });
  } catch (e) { /* skip */ void e; }
  // DXF 평면 (P1 — AutoCAD 편집용, 레이어 분리 R12. 건축·조경·인테리어 + PIPE 레이어)
  try {
    const dxf = mods.dxf.dxfPlan(assembly, domain, built.pipes?.routes, { title, dwgNo: 'NX-GA-001' });
    if (dxf) files.push({ name: 'GA_plan.dxf', mime: 'application/dxf', content: dxf });
  } catch (e) { void e; }
  // LandXML(Wave 1 실무 호환) — 토목 선형: 도로·선형 SW 교환 표준(요소열 단일 소스, 재계산 없음)
  try {
    if (domain === 'civil' && (assembly as { alignment?: unknown }).alignment && mods.lx) {
      const xml = mods.lx.landxmlAlignment(assembly, { name: title.slice(0, 40), project: 'nexyfab' });
      if (xml) files.push({ name: 'alignment.xml', mime: 'application/xml', content: xml });
    }
  } catch (e) { void e; }
  // 내역서 XLSX(Wave 1) — 현장 견적·기성 표준 포맷(단가·금액=공란, 입력 원칙)
  try {
    if (mods.xl) files.push({ name: 'BOQ_내역서.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: mods.xl.boqXlsxBase64(assembly, { domain, title }), b64: true });
  } catch (e) { void e; }
  // 종단면도 DXF(토목 선형 — 종 10× 왜곡 좌표, 주기 명시)
  try {
    if (domain === 'civil' && (assembly as { alignment?: unknown }).alignment) {
      const dxfp = mods.dxf.dxfProfile(assembly);
      if (dxfp) files.push({ name: 'GA_profile.dxf', mime: 'application/dxf', content: dxfp });
    }
  } catch (e) { void e; }
  // 구조/응력 검토
  try { files.push({ name: 'structural.html', mime: 'text/html', content: mods.pkg.structuralReport(assembly, { title, member }) }); } catch (e) { void e; }
  // 물량·작업량 산출서 (BOQ, 금액 제외 — 비기계 분야는 재적 중심·공수 미산출)
  try { files.push({ name: 'BOQ.html', mime: 'text/html', content: mods.boq.boqReport(assembly, { title, domain }) }); } catch (e) { void e; }
  // 설계 설명서 (Dossier) + P&ID 스켈레톤 (계통 기반 — 공정 없는 비기계 분야는 P&ID 제외)
  try { files.push({ name: 'Dossier.html', mime: 'text/html', content: mods.pd.dossierReport(assembly, { title }) }); } catch (e) { void e; }
  if (!nonMech) {
    try { files.push({ name: 'PID_skeleton.html', mime: 'text/html', content: mods.pd.pidSkeleton(assembly, { title }) }); } catch (e) { void e; }
  }
  // GA 3D 계통색 (부품 service/type → 색분류 멀티메시). 실패 시 모노크롬 폴백.
  try {
    files.push({ name: 'GA_3D.html', mime: 'text/html', content: await mods.rnd.renderColoredHtml({ assembly }, { title, subtitle: 'nexyfab 자동생성 계통색 GA' }) });
  } catch {
    try { files.push({ name: 'GA_3D.html', mime: 'text/html', content: await mods.rnd.renderHtml({ assembly }, { title, subtitle: 'nexyfab 자동생성 GA' }) }); } catch (e) { void e; }
  }
  // SCAD
  if (built.openscad) files.push({ name: 'model.scad', mime: 'text/plain', content: built.openscad });

  // FEA 응력해석 (#7) — 형상 STL 실렌더 → TET10 선형정적(runSimpleFEA, beam-theory 폴백).
  // 하중 기본값 = 총질량×g(자중 상당, 상면 등가 — 가정을 리포트에 명시). options.fea===false 로 생략.
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
    } catch (e) { void e; /* FEA 실패는 패키지를 막지 않음 — 파일만 빠짐 */ }
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
    welds: built.welds ?? [], weldTotalMm: built.weldTotalMm ?? 0,
    // 설계 타당성 그물(#2) — 부유·면접촉(매립 제안)·배관 관통/교차 + 종합 판정
    support: built.support ?? null,
    pipes: built.pipes ?? null,
    designOk: built.designOk ?? null,
    consistency,
    note: 'P&ID·Dossier(AI 보조)는 후속. 형상기반 GA 3D·2D 도면·구조·BOQ·SCAD 자동생성.',
  });
}
