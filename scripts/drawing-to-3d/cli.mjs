#!/usr/bin/env node
/**
 * NexyFab CAD CLI (260719) — MCP 서버와 동일한 도구면(callTool)을 명령행으로.
 * text/이미지→2D도안→3D 1차→2차→자율 수정 파이프라인 전 구간을 스크립트/CI 에서 사용.
 *
 * 사용:
 *   node cli.mjs list                                    # 도구·명령 목록
 *   node cli.mjs <tool> --json '<args JSON>'             # 임의 도구 직접 호출(MCP 와 동일)
 *   node cli.mjs <tool> --json-file args.json
 * 편의 명령(어셈블리 파일 기반):
 *   node cli.mjs assemble "설명" --out asm.json           # AI 생성(GEMINI_API_KEY)
 *   node cli.mjs build asm.json                           # 결정론 재빌드·게이트 요약
 *   node cli.mjs edit-part asm.json <partId> "지시" [--face z+] [--out next.json]
 *   node cli.mjs face-drag asm.json <partId> --face z+ (--delta 50 | --target 200) [--out next.json]
 *   node cli.mjs part-op asm.json --op duplicate|delete|translate|fillet --ids a,b [--dx --dy --dz | --r 5 | --offset x,y,z] [--out next.json]
 *   node cli.mjs lod asm.json [--level 1]                 # 1차 골격 빌드 요약
 *   node cli.mjs step asm.json --out model.step           # B-rep STEP(부품별 컴파운드·filletMm 반영)
 *   node cli.mjs html asm.json --out ga3d.html            # 오프라인 3D 뷰어
 *   node cli.mjs preview asm.json --out <dir> [--views iso,side,top]  # 헤드리스 렌더→PNG(배치 검증용 눈)
 *   node cli.mjs loft loftspec.json --out part.json      # ⓒ 프로파일+스테이션 → 매끈한 곡면 mesh 부품
 *   node cli.mjs constraints asm.json --out resolved.json # ⓑ 관계배치 구속 해석(좌표 확정)
 *   node cli.mjs package asm.json --out <dir> [--step] [--title "제목"]  # 실시 도서 세트(어셈블리→도시에)
 *   node cli.mjs templates [domain]                                     # 분야 어셈블리 템플릿 목록(형상 합성기 앞문)
 *   node cli.mjs dossier <domain> <templateId> --out <dir> [--step] [--params '{..}']  # 템플릿→완제 도시에 원샷
 * 다분야(토목·인테리어·건설·조경, 원격 전용 — NEXYFAB_API_KEY 필요):
 *   node cli.mjs domain <civil|interior|construction|landscape> "브리프 텍스트" [--out pkg.json]  # 자유 브리프→LLM 계획
 *   node cli.mjs domain civil --fixture steel-beam [--out pkg.json]                                # 결정론 픽스처
 * NEW 하드 능력(FEA·검증 역설계·AI 함대=원격 전용, 코드체크=로컬 오프라인):
 *   node cli.mjs fea asm.json --load 500 [--material steel] [--precise]     # 간이 FEA(원격 — 서버 OpenSCAD/gmsh)
 *   node cli.mjs fea --scad part.scad --load 500                            # scad 직접 입력
 *   node cli.mjs reconstruct part.stl [--format stl]  # 검증된 역설계(STL→reverse-engineer / STEP·DWG·SAT→import-step; 원격)
 *   node cli.mjs fleet part.stl [--attempts 3]                              # AI 재구성 함대(원격+Pro·비용)
 *   node cli.mjs codecheck features.json              # 코드체크/감리 41룰(로컬·오프라인·키 불필요) | --list 카탈로그
 * 분야 검증 체인(전부 로컬·오프라인·키 불필요 — 어셈블리 기반):
 *   node cli.mjs interior asm.json [--params '{..}']   # 인테리어 피난·마감(보행거리 BFS+수용인원+물량)
 *   node cli.mjs landscape asm.json [--params '{..}']  # 조경 목재부재+풍하중 전도
 *   node cli.mjs bridge asm.json [--params '{..}']     # 교량(meta 자동 디스패치: 거더/아치/트러스/사장/현수/계단)
 *   node cli.mjs loadpath asm.json [--params '{..}']   # 건축 하중경로(슬래브→보→기둥→기초) | --list 활하중 용도표
 * 출력: 결과 JSON 을 stdout(기계 파싱), 파일은 --out 경로. 비법정(제작용 실시도서+검토 계산서).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { callTool, tools } from './mcp-server.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
// 원격 모드: NEXYFAB_API_KEY(Pro 이상 발급) 설정 시 5개 도구를 호스팅 API 로 호출
const REMOTE_ROUTE = {
  text_to_assembly: '/api/nexyfab/drawing/assemble/',
  compose_3d: '/api/nexyfab/drawing/compose/',
  edit_part: '/api/nexyfab/drawing/edit-part/',
  face_drag: '/api/nexyfab/drawing/face-drag/',
  part_op: '/api/nexyfab/drawing/part-op/',
  domain_design: '/api/nexyfab/domain-design/',
};
/** Remote-only tools: no local engine in scripts/ (domain checks live server-side). */
const REMOTE_ONLY = new Set(['domain_design']);
const DOMAINS = ['civil', 'interior', 'construction', 'landscape'];
const API_KEY = process.env.NEXYFAB_API_KEY;
const API_URL = (process.env.NEXYFAB_API_URL ?? 'https://nexyfab.com').replace(/\/$/, '');
// TTY 프리티 출력(파이프=순수 JSON 유지 — 기계 파싱 불변). --raw 로 강제 순수.
const useTty = process.stdout.isTTY && !argv.includes('--raw');
const C = useTty
  ? { g: '\x1b[32m', r: '\x1b[31m', b: '\x1b[36m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m', B: '\x1b[1m' }
  : { g: '', r: '', b: '', y: '', d: '', x: '', B: '' };
function pretty(r) {
  if (!useTty || !r || typeof r !== 'object') return;
  const ok = r.ok !== false;
  const seg = [ok ? `${C.g}✔ 통과${C.x}` : `${C.r}✘ 거부/실패${C.x}`];
  if (r.error) seg.push(`${C.r}${r.error}${C.x}`);
  if (Array.isArray(r.gateErrors) && r.gateErrors.length) seg.push(`${C.r}게이트 ${r.gateErrors.length}${C.x}`);
  if (Array.isArray(r.interferences)) seg.push(`간섭 ${r.interferences.length ? C.r : C.g}${r.interferences.length}${C.x}`);
  if (Array.isArray(r.floating)) seg.push(`부유 ${r.floating.length ? C.y : C.g}${r.floating.length}${C.x}`);
  if (typeof r.massKg === 'number') seg.push(`질량 ${C.b}${r.massKg}kg${C.x}`);
  if (r.structural?.totalMassKg != null) seg.push(`질량 ${C.b}${r.structural.totalMassKg}kg${C.x}`);
  if (r.completeness) seg.push(`도면 완성도 ${C.b}${r.completeness.score}${C.x}`);
  if (r.c9) seg.push(`DXF C9 ${r.c9.pass ? C.g + 'pass' : C.r + 'fail'}${C.x}`);
  if (r.patch) seg.push(`패치 ${C.b}${JSON.stringify(r.patch)}${C.x}`);
  if (r.face?.face) seg.push(`면 ${C.b}${r.face.face}${C.x}`);
  if (r.subsetParts != null) seg.push(`LOD ${C.b}${r.subsetParts}/${r.totalParts}${C.x}`);
  if (Array.isArray(r.files)) seg.push(`파일 ${C.b}${r.files.length}${C.x}`);
  // domain_design summary
  if (r.domain) seg.push(`${C.b}${r.domain}${C.x}`);
  if (Array.isArray(r.gates)) {
    const p = r.gates.filter((g) => g.pass).length;
    seg.push(`게이트 ${p === r.gates.length ? C.g : C.r}${p}/${r.gates.length}${C.x}`);
  }
  if (r.refusal) seg.push(`${C.r}${r.refusal.stage}: ${(r.refusal.failedGateIds ?? []).join(',') || (r.refusal.reason ?? '').slice(0, 48)}${C.x}`);
  process.stdout.write(`${C.B}◆ nexyfab${API_KEY ? `${C.d}(remote)${C.x}` : ''}${C.x} ${seg.join(` ${C.d}·${C.x} `)}\n`);
}
const flag = (name, def = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name) => argv.includes(`--${name}`);
const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
const loadAsm = (p) => JSON.parse(readFileSync(resolve(p), 'utf8'));
const saveAsmMaybe = (r) => {
  const o = flag('out');
  if (!o) return {};
  if (r?.package) { writeFileSync(resolve(o), JSON.stringify(r.package, null, 1)); return { savedPackage: resolve(o) }; }
  if (r?.assembly) { writeFileSync(resolve(o), JSON.stringify(r.assembly, null, 1)); return { savedAssembly: resolve(o) }; }
  return {};
};
// 요약(대형 필드 절단 — 전체는 --full)
const summarize = (r) => {
  if (has('full') || !r || typeof r !== 'object') return r;
  const c = { ...r };
  for (const k of ['openscad', 'scad', 'step', 'reportHtml', 'topScad']) if (typeof c[k] === 'string') c[k] = `<${c[k].length} chars — --full 로 전체>`;
  if (Array.isArray(c.parts) && c.parts.length > 8) c.parts = [...c.parts.slice(0, 8), `…+${c.parts.length - 8}`];
  if (c.assembly?.parts?.length > 0) c.assembly = `<assembly ${c.assembly.parts.length} parts — --out 으로 저장>`;
  // domain_design: gates 는 id/pass/reason 만(전체 metrics 는 --full), package 는 --out 저장 안내.
  if (Array.isArray(c.gates)) c.gates = c.gates.map((g) => ({ id: g.id, pass: g.pass, ...(g.reason ? { reason: g.reason } : {}) }));
  if (c.package && flag('out')) c.package = `<package — ${flag('out')} 로 저장>`;
  return c;
};

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') {
    process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split('*/')[0] + '*/\n');
    return;
  }
  if (cmd === 'list') {
    out({ tools: tools.map((t) => ({ name: t.name, desc: t.description.slice(0, 90) + '…' })) });
    return;
  }
  // 편의 명령 → 도구 호출 매핑
  let name = cmd, args = null;
  if (cmd === 'assemble') {
    name = 'text_to_assembly'; args = { description: argv[1] };
  } else if (cmd === 'build') {
    name = 'build_assembly'; args = { assembly: loadAsm(argv[1]) };
  } else if (cmd === 'edit-part') {
    name = 'edit_part';
    args = { assembly: loadAsm(argv[1]), partId: argv[2], instruction: argv[3], ...(flag('face') ? { face: { face: flag('face') } } : {}) };
  } else if (cmd === 'face-drag') {
    name = 'face_drag';
    args = {
      assembly: loadAsm(argv[1]), partId: argv[2], face: flag('face'),
      ...(flag('delta') ? { deltaMm: parseFloat(flag('delta')) } : {}),
      ...(flag('target') ? { targetMm: parseFloat(flag('target')) } : {}),
    };
  } else if (cmd === 'part-op') {
    name = 'part_op';
    const opts = {};
    for (const k of ['dx', 'dy', 'dz', 'r']) if (flag(k)) opts[k] = parseFloat(flag(k));
    if (flag('offset')) opts.offset = flag('offset').split(',').map(Number);
    args = { assembly: loadAsm(argv[1]), op: flag('op'), partIds: (flag('ids') ?? '').split(',').filter(Boolean), opts };
  } else if (cmd === 'lod') {
    name = 'lod_assembly'; args = { assembly: loadAsm(argv[1]), level: parseInt(flag('level', '1'), 10) };
  } else if (cmd === 'step') {
    const asm = loadAsm(argv[1]);
    const { buildAssembly } = await import('./assembly.mjs');
    const built = buildAssembly(asm);
    if (!built.ok) { out({ ok: false, gateErrors: built.gateErrors }); process.exitCode = 1; return; }
    name = 'export_step'; args = { intent: built.composeIntent, outPath: resolve(flag('out', 'model.step')) };
  } else if (cmd === 'html') {
    name = 'html_render'; args = { assembly: loadAsm(argv[1]), outPath: resolve(flag('out', 'model.html')), title: flag('title', 'NexyFab 3D') };
  } else if (cmd === 'package') {
    name = 'generate_package';
    args = { assembly: loadAsm(argv[1]), outDir: resolve(flag('out', 'nexyfab-package')), title: flag('title'), withStep: has('step') };
  } else if (cmd === 'preview') {
    name = 'render_preview';
    args = { assembly: loadAsm(argv[1]), outDir: resolve(flag('out', 'nexyfab-preview')), ...(flag('views') ? { views: flag('views').split(',') } : {}) };
  } else if (cmd === 'loft') {
    name = 'loft_part';
    args = JSON.parse(readFileSync(resolve(argv[1]), 'utf8')); // 로프트/스윕 스펙 JSON (단일 또는 {bodies:[...]})
    if (flag('out')) { const r = await callTool(name, args); writeFileSync(resolve(flag('out')), JSON.stringify(r.assembly ?? r.part, null, 1)); out({ ok: r.ok, saved: resolve(flag('out')), parts: r.parts ?? 1, volumeMm3: r.volumeMm3, triCount: r.triCount }); return; }
  } else if (cmd === 'constraints') {
    name = 'resolve_constraints';
    args = { assembly: loadAsm(argv[1]) };
    if (flag('out')) { const r = await callTool(name, args); writeFileSync(resolve(flag('out')), JSON.stringify(r.assembly, null, 1)); out({ ok: r.ok, savedAssembly: resolve(flag('out')), parts: r.assembly.parts.length }); return; }
  } else if (cmd === 'templates') {
    name = 'list_templates';
    args = argv[1] && !argv[1].startsWith('--') ? { domain: argv[1] } : {};
  } else if (cmd === 'dossier') {
    name = 'generate_domain_package';
    const domain = argv[1];
    const templateId = argv[2];
    if (!domain || !templateId || domain.startsWith('--') || templateId.startsWith('--')) {
      out({ ok: false, error: 'usage: node cli.mjs dossier <domain> <templateId> --out <dir> [--step] [--params \'{"...":..}\'] — 목록: node cli.mjs templates [domain]' });
      process.exitCode = 1;
      return;
    }
    args = {
      domain, templateId,
      ...(flag('params') ? { params: JSON.parse(flag('params')) } : {}),
      outDir: resolve(flag('out', 'nexyfab-dossier')),
      ...(flag('title') ? { title: flag('title') } : {}),
      withStep: has('step'),
    };
  } else if (cmd === 'fea') {
    name = 'analyze_fea';
    const loadKg = parseFloat(flag('load') ?? flag('loadKg') ?? '');
    const base = { materialKey: flag('material', 'steel'), loadKg, precise: has('precise') };
    if (flag('scad')) {
      args = { scad: readFileSync(resolve(flag('scad')), 'utf8'), ...base };
    } else if (argv[1] && !argv[1].startsWith('--')) {
      const { buildAssembly } = await import('./assembly.mjs');
      const built = buildAssembly(loadAsm(argv[1]));
      if (!built.ok) { out({ ok: false, gateErrors: built.gateErrors }); process.exitCode = 1; return; }
      args = { scad: built.openscad, ...base };
    } else {
      out({ ok: false, error: 'usage: node cli.mjs fea <asm.json> | --scad file.scad  --load <kg> [--material steel] [--precise]' });
      process.exitCode = 1; return;
    }
  } else if (cmd === 'reconstruct') {
    name = 'reconstruct_verify';
    if (!argv[1] || argv[1].startsWith('--')) { out({ ok: false, error: 'usage: node cli.mjs reconstruct <file .stl|.step|.iges|.ifc|.dwg|.sat|.x_t> [--format stl]' }); process.exitCode = 1; return; }
    args = { file: resolve(argv[1]), ...(flag('format') ? { format: flag('format') } : {}) };
  } else if (cmd === 'fleet') {
    name = 'reconstruct_fleet';
    if (!argv[1] || argv[1].startsWith('--')) { out({ ok: false, error: 'usage: node cli.mjs fleet <file.stl> [--attempts 3]' }); process.exitCode = 1; return; }
    args = { file: resolve(argv[1]), ...(flag('attempts') ? { attempts: parseInt(flag('attempts'), 10) } : {}) };
  } else if (cmd === 'codecheck') {
    name = 'code_check';
    if (has('list')) args = { list: true };
    else if (argv[1] && !argv[1].startsWith('--')) args = { features: JSON.parse(readFileSync(resolve(argv[1]), 'utf8')) };
    else if (flag('json')) args = { features: JSON.parse(flag('json')) };
    else { out({ ok: false, error: "usage: node cli.mjs codecheck <features.json> | --json '{...}' | --list" }); process.exitCode = 1; return; }
  } else if (cmd === 'interior' || cmd === 'landscape' || cmd === 'bridge') {
    // 분야 검증 체인(로컬·순수 mjs — 키 불필요). 어셈블리 파일 + 선택 params.
    name = cmd === 'interior' ? 'interior_check' : cmd === 'landscape' ? 'landscape_check' : 'bridge_check';
    if (!argv[1] || argv[1].startsWith('--')) { out({ ok: false, error: `usage: node cli.mjs ${cmd} <asm.json> [--params '{...}']` }); process.exitCode = 1; return; }
    args = { assembly: loadAsm(argv[1]), ...(flag('params') ? { params: JSON.parse(flag('params')) } : {}) };
  } else if (cmd === 'loadpath') {
    name = 'load_path';
    if (has('list')) args = { list: true };
    else if (argv[1] && !argv[1].startsWith('--')) args = { assembly: loadAsm(argv[1]), ...(flag('params') ? { params: JSON.parse(flag('params')) } : {}) };
    else { out({ ok: false, error: "usage: node cli.mjs loadpath <asm.json> [--params '{...}'] | --list" }); process.exitCode = 1; return; }
  } else if (cmd === 'domain') {
    name = 'domain_design';
    const domain = argv[1];
    if (!DOMAINS.includes(domain)) {
      out({ ok: false, error: `domain 은 ${DOMAINS.join('|')} 중 하나 — 예: node cli.mjs domain civil "6m 강재 보 20kN/m"` });
      process.exitCode = 1;
      return;
    }
    const briefText = argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined;
    const fixture = flag('fixture');
    args = {
      domain,
      brief: {
        id: flag('id', `${domain}-cli`),
        ...(briefText ? { text: briefText } : {}),
        ...(fixture ? { params: { fixture } } : {}),
      },
    };
  } else {
    // 임의 도구 직접 호출(MCP 동일)
    const j = flag('json') ?? (flag('json-file') ? readFileSync(resolve(flag('json-file')), 'utf8') : null);
    if (!j) { out({ ok: false, error: `알 수 없는 명령 '${cmd}' — node cli.mjs help` }); process.exitCode = 1; return; }
    args = JSON.parse(j);
  }
  let r;
  if (REMOTE_ONLY.has(name) && !API_KEY) {
    out({ ok: false, error: `'${cmd}' 는 원격 전용 — NEXYFAB_API_KEY 설정 필요(Pro 이상, nexyfab.com → 계정 → API Keys)` });
    process.exitCode = 1;
    return;
  }
  if (API_KEY && REMOTE_ROUTE[name]) {
    const res = await fetch(API_URL + REMOTE_ROUTE[name], {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(args),
    });
    r = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  } else {
    r = await callTool(name, args);
  }
  const extra = saveAsmMaybe(r);
  pretty(r);
  out({ ...summarize(r), ...extra });
  if (r && r.ok === false) process.exitCode = 1;
}

main().catch((e) => { out({ ok: false, error: String(e?.message ?? e) }); process.exit(1); });
