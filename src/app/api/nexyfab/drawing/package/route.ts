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
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import JSZip from 'jszip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Assembly = { name?: string; parts?: Array<Record<string, unknown>> };
type Built = { ok: boolean; openscad?: string; structural?: unknown; interferences?: unknown[]; welds?: unknown[]; weldTotalMm?: number; gateErrors?: string[] };
type AsmMod = { buildAssembly: (a: Assembly) => Built };
type PkgMod = { ga2dDrawing: (a: Assembly, o?: Record<string, unknown>) => string; structuralReport: (a: Assembly, o?: Record<string, unknown>) => string };
type BoqMod = { boqReport: (a: Assembly, o?: Record<string, unknown>) => string };
type PdMod = { dossierReport: (a: Assembly, o?: Record<string, unknown>) => string; pidSkeleton: (a: Assembly, o?: Record<string, unknown>) => string };
type RenderMod = { renderHtml: (spec: unknown, o?: Record<string, unknown>) => Promise<string>; renderColoredHtml: (spec: unknown, o?: Record<string, unknown>) => Promise<string> };
type VerifyMod = { renderStl: (scad: string) => Promise<Uint8Array> };

let _asm: AsmMod | null = null, _pkg: PkgMod | null = null, _rnd: RenderMod | null = null, _boq: BoqMod | null = null, _pd: PdMod | null = null, _vfy: VerifyMod | null = null;
async function load() {
  const base = join(process.cwd(), 'scripts', 'drawing-to-3d');
  if (!_asm) _asm = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'assembly.mjs')).href)) as AsmMod;
  if (!_pkg) _pkg = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'package.mjs')).href)) as PkgMod;
  if (!_rnd) _rnd = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'html-render.mjs')).href)) as RenderMod;
  if (!_boq) _boq = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'boq.mjs')).href)) as BoqMod;
  if (!_pd) _pd = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'pid_dossier.mjs')).href)) as PdMod;
  if (!_vfy) _vfy = (await import(/* webpackIgnore: true */ pathToFileURL(join(base, 'verify.mjs')).href)) as VerifyMod;
  return { asm: _asm, pkg: _pkg, rnd: _rnd, boq: _boq, pd: _pd, vfy: _vfy };
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

  let mods: { asm: AsmMod; pkg: PkgMod; rnd: RenderMod; boq: BoqMod; pd: PdMod; vfy: VerifyMod };
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
  const nonMech = ['building', 'landscape', 'interior', 'civil'].includes(domain);
  const files: Array<{ name: string; mime: string; content: string }> = [];

  // 2D GA 도면
  try { files.push({ name: 'GA_2D_drawing.html', mime: 'text/html', content: mods.pkg.ga2dDrawing(assembly, { title }) }); } catch (e) { /* skip */ void e; }
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

  // zip 묶음 (한 파일 다운로드). 실패 시 files 로 폴백.
  let zipBase64: string | null = null;
  try {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.content);
    zipBase64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  } catch { zipBase64 = null; }

  return NextResponse.json({
    ok: true,
    zipBase64,
    fileNames: files.map((f) => f.name),
    files: zipBase64 ? undefined : files, // zip 성공 시 개별 content 생략(페이로드↓)
    structural: built.structural ?? null,
    interferences: built.interferences ?? [],
    welds: built.welds ?? [], weldTotalMm: built.weldTotalMm ?? 0,
    note: 'P&ID·Dossier(AI 보조)는 후속. 형상기반 GA 3D·2D 도면·구조·BOQ·SCAD 자동생성.',
  });
}
