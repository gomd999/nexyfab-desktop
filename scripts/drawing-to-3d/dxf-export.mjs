/**
 * dxf-export.mjs — GA 평면을 AutoCAD 호환 DXF(R12 ASCII)로 방출 (P1 #1).
 *
 * 실무자가 AutoCAD/LibreCAD에서 열어 바로 수정할 수 있도록 **레이어 분리**:
 *   AXIS(축선, CENTER 선종·적색) · COLUMN(기둥) · BEAM(보) · SLAB(슬래브 외곽, DASHED)
 *   · JOIST/DECK(조경) · DIM(치수) · TXT(주기)
 * 단위 mm · 평면(XY, Y=북). R12 선택 이유: 전 CAD 호환 최대공약수(의존 라이브러리 0).
 * 치수는 선+문자 단순표기(연관 치수 아님 — 명시). 검증: 섹션 균형·레이어 참조 self-test.
 */
import { partAabb } from './reconstruct.mjs';

const g = (code, val) => `${code}\n${val}\n`;

function box(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0, rz = 0 } = part.at ?? {};
  if (rz === 90) {
    return { x: tx - a.max[1], y: ty + a.min[0], dx: a.max[1] - a.min[1], dy: a.max[0] - a.min[0], z: a.min[2] + tz, dz: a.max[2] - a.min[2] };
  }
  return { x: a.min[0] + tx, y: a.min[1] + ty, dx: a.max[0] - a.min[0], dy: a.max[1] - a.min[1], z: a.min[2] + tz, dz: a.max[2] - a.min[2] };
}

// ── 엔티티 빌더 ──────────────────────────────────────────────────────────────
const line = (layer, x1, y1, x2, y2, ltype) =>
  g(0, 'LINE') + g(8, layer) + (ltype ? g(6, ltype) : '') + g(10, x1) + g(20, y1) + g(30, 0) + g(11, x2) + g(21, y2) + g(31, 0);
const circle = (layer, x, y, r) => g(0, 'CIRCLE') + g(8, layer) + g(10, x) + g(20, y) + g(30, 0) + g(40, r);
const text = (layer, x, y, h, s) => g(0, 'TEXT') + g(8, layer) + g(10, x) + g(20, y) + g(30, 0) + g(40, h) + g(1, s);
const solid = (layer, x, y, dx, dy) => // SOLID 정점 순서: 3·4번째 스왑 (DXF 관례)
  g(0, 'SOLID') + g(8, layer) + g(10, x) + g(20, y) + g(30, 0) + g(11, x + dx) + g(21, y) + g(31, 0) + g(12, x) + g(22, y + dy) + g(32, 0) + g(13, x + dx) + g(23, y + dy) + g(33, 0);
const rect = (layer, x, y, dx, dy, ltype) =>
  line(layer, x, y, x + dx, y, ltype) + line(layer, x + dx, y, x + dx, y + dy, ltype) + line(layer, x + dx, y + dy, x, y + dy, ltype) + line(layer, x, y + dy, x, y, ltype);

// ── 파일 골격 ────────────────────────────────────────────────────────────────
const LAYERS = [
  ['AXIS', 1, 'CENTER'], ['COLUMN', 7, 'CONTINUOUS'], ['BEAM', 4, 'CONTINUOUS'], ['SLAB', 8, 'DASHED'],
  ['JOIST', 32, 'DASHED'], ['DECK', 30, 'CONTINUOUS'], ['WALL', 7, 'CONTINUOUS'], ['DIM', 1, 'CONTINUOUS'], ['TXT', 7, 'CONTINUOUS'],
  ['PIPE', 6, 'CONTINUOUS'], ['FIXTURE', 3, 'CONTINUOUS'], ['FURN', 8, 'DASHED'],
];
function shell(entities) {
  let s = '';
  s += g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1009') + g(9, '$INSUNITS') + g(70, 4) + g(0, 'ENDSEC');
  s += g(0, 'SECTION') + g(2, 'TABLES');
  s += g(0, 'TABLE') + g(2, 'LTYPE') + g(70, 3);
  s += g(0, 'LTYPE') + g(2, 'CONTINUOUS') + g(70, 0) + g(3, 'Solid line') + g(72, 65) + g(73, 0) + g(40, 0);
  s += g(0, 'LTYPE') + g(2, 'CENTER') + g(70, 0) + g(3, 'Center ____ _ ____') + g(72, 65) + g(73, 4) + g(40, 50.8) + g(49, 31.75) + g(49, -6.35) + g(49, 6.35) + g(49, -6.35);
  s += g(0, 'LTYPE') + g(2, 'DASHED') + g(70, 0) + g(3, 'Dashed __ __ __') + g(72, 65) + g(73, 2) + g(40, 19.05) + g(49, 12.7) + g(49, -6.35);
  s += g(0, 'ENDTAB');
  s += g(0, 'TABLE') + g(2, 'LAYER') + g(70, LAYERS.length);
  for (const [name, color, ltype] of LAYERS) s += g(0, 'LAYER') + g(2, name) + g(70, 0) + g(62, color) + g(6, ltype);
  s += g(0, 'ENDTAB') + g(0, 'ENDSEC');
  s += g(0, 'SECTION') + g(2, 'ENTITIES') + entities + g(0, 'ENDSEC') + g(0, 'EOF');
  return s;
}

const uniq = (arr, tol = 50) => { const out = []; for (const v of arr.slice().sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > tol) out.push(v); return out; };

/** 건축: 축선 구조평면 DXF — 축선(CENTER)+버블·심선치수·기둥(SOLID)·보·슬래브(DASHED). */
export function dxfBuildingPlan(assembly) {
  const parts = (assembly.parts ?? []).map((p) => ({ p, b: box(p) }));
  const cols = parts.filter((o) => o.p.role === 'column');
  if (!cols.length) return null;
  const z0 = Math.min(...cols.map((o) => o.b.z));
  const fCols = cols.filter((o) => Math.abs(o.b.z - z0) < 1);
  const xs = uniq(fCols.map((o) => o.b.x + o.b.dx / 2));
  const ys = uniq(fCols.map((o) => o.b.y + o.b.dy / 2));
  if (xs.length < 2 || ys.length < 2) return null;
  const EXT = 800, TH = 250; // 축선 연장·문자 높이(mm)
  let e = '';
  // 축선 + 버블
  xs.forEach((x, i) => {
    e += line('AXIS', x, ys[0] - EXT, x, ys[ys.length - 1] + EXT, 'CENTER');
    e += circle('AXIS', x, ys[ys.length - 1] + EXT + 350, 300) + text('AXIS', x - 120, ys[ys.length - 1] + EXT + 230, TH, `X${i + 1}`);
  });
  ys.forEach((y, j) => {
    e += line('AXIS', xs[0] - EXT, y, xs[xs.length - 1] + EXT, y, 'CENTER');
    e += circle('AXIS', xs[0] - EXT - 350, y, 300) + text('AXIS', xs[0] - EXT - 500, y - 120, TH, String.fromCharCode(89 /*Y*/) + (j + 1));
  });
  // 심선 치수 (선+문자 단순표기)
  for (let i = 1; i < xs.length; i++) {
    const y = ys[ys.length - 1] + EXT + 900;
    e += line('DIM', xs[i - 1], y, xs[i], y) + text('DIM', (xs[i - 1] + xs[i]) / 2 - 300, y + 80, TH, String(Math.round(xs[i] - xs[i - 1])));
  }
  for (let j = 1; j < ys.length; j++) {
    const x = xs[0] - EXT - 900;
    e += line('DIM', x, ys[j - 1], x, ys[j]) + text('DIM', x - 700, (ys[j - 1] + ys[j]) / 2, TH, String(Math.round(ys[j] - ys[j - 1])));
  }
  // 슬래브 외곽 (최하층 1장, DASHED)
  const slab = parts.filter((o) => o.p.role === 'slab').sort((a, b) => a.b.z - b.b.z)[0];
  if (slab) e += rect('SLAB', slab.b.x, slab.b.y, slab.b.dx, slab.b.dy, 'DASHED');
  // 보 (최하층) — 외곽선
  const beams = parts.filter((o) => o.p.role === 'beam');
  if (beams.length) {
    const bz = Math.min(...beams.map((o) => o.b.z));
    for (const o of beams.filter((b) => Math.abs(b.b.z - bz) < 1)) e += rect('BEAM', o.b.x, o.b.y, o.b.dx, o.b.dy);
  }
  // 기둥 — 채움(SOLID)+외곽
  for (const o of fCols) { e += solid('COLUMN', o.b.x, o.b.y, o.b.dx, o.b.dy) + rect('COLUMN', o.b.x, o.b.y, o.b.dx, o.b.dy); }
  e += text('TXT', xs[0], ys[0] - EXT - 700, TH, `STRUCTURAL PLAN (mm) - auto-generated, dims=centerline, non-statutory`);
  return shell(e);
}

/** 조경: 배치 평면 DXF — 데크/장선/보/기둥 레이어 분리 + 외곽 치수. */
export function dxfLandscapePlan(assembly) {
  const parts = (assembly.parts ?? []).map((p) => ({ p, b: box(p) }));
  if (!parts.length) return null;
  let e = '';
  for (const o of parts) {
    const r = o.p.role;
    if (r === 'deck') e += rect('DECK', o.b.x, o.b.y, o.b.dx, o.b.dy);
    else if (r === 'joist') e += rect('JOIST', o.b.x, o.b.y, o.b.dx, o.b.dy, 'DASHED');
    else if (r === 'beam') e += rect('BEAM', o.b.x, o.b.y, o.b.dx, o.b.dy);
    else if (r === 'column') {
      const cx = o.b.x + o.b.dx / 2, cy = o.b.y + o.b.dy / 2, rr = Math.max(o.b.dx, o.b.dy) / 2;
      e += circle('COLUMN', cx, cy, rr) + line('COLUMN', cx - rr, cy, cx + rr, cy) + line('COLUMN', cx, cy - rr, cx, cy + rr);
    } else e += rect('WALL', o.b.x, o.b.y, o.b.dx, o.b.dy);
  }
  const x0 = Math.min(...parts.map((o) => o.b.x)), x1 = Math.max(...parts.map((o) => o.b.x + o.b.dx));
  const y0 = Math.min(...parts.map((o) => o.b.y)), y1 = Math.max(...parts.map((o) => o.b.y + o.b.dy));
  e += line('DIM', x0, y0 - 500, x1, y0 - 500) + text('DIM', (x0 + x1) / 2 - 300, y0 - 420, 200, String(Math.round(x1 - x0)));
  e += line('DIM', x0 - 500, y0, x0 - 500, y1) + text('DIM', x0 - 1100, (y0 + y1) / 2, 200, String(Math.round(y1 - y0)));
  e += text('TXT', x0, y0 - 900, 200, 'LANDSCAPE PLAN (mm) - auto-generated, non-statutory');
  return shell(e);
}

/** 배관 라우트(autoRoutePipes 결과) → PIPE 레이어 평면 폴리라인 + 라벨. 기계 배관 어휘의 DXF 반영. */
function pipeEntities(pipes) {
  let e = '';
  for (const rt of pipes ?? []) {
    for (let i = 0; i < rt.pts.length - 1; i++) {
      const a = rt.pts[i], b = rt.pts[i + 1];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) continue; // 수직(z) 세그먼트는 평면 투영서 점
      e += line('PIPE', a[0], a[1], b[0], b[1]);
    }
    e += text('PIPE', rt.pts[0][0] + 60, rt.pts[0][1] + 60, 120, `${rt.label ?? 'pipe'} DN${rt.d ?? 26}`);
  }
  return e;
}

/** 인테리어: 평면 DXF — 벽(WALL)·설비(FIXTURE)·가구(FURN)·배관(PIPE)·외곽 치수. */
export function dxfInteriorPlan(assembly, pipes) {
  const parts = (assembly.parts ?? []).map((p) => ({ p, b: box(p) }));
  const walls = parts.filter((o) => o.p.role === 'wall');
  if (!walls.length) return null;
  const FIX = new Set(['toilet', 'basin', 'bathtub', 'sink', 'stack']);
  let e = '';
  for (const o of parts) {
    const r = o.p.role;
    if (r === 'wall') e += rect('WALL', o.b.x, o.b.y, o.b.dx, o.b.dy);
    else if (FIX.has(r)) {
      e += rect('FIXTURE', o.b.x, o.b.y, o.b.dx, o.b.dy);
      if (r === 'stack') e += circle('FIXTURE', o.b.x + o.b.dx / 2, o.b.y + o.b.dy / 2, o.b.dx / 2);
    } else if (r && r !== 'floor') e += rect('FURN', o.b.x, o.b.y, o.b.dx, o.b.dy, 'DASHED');
  }
  e += pipeEntities(pipes);
  const x0 = Math.min(...walls.map((o) => o.b.x)), x1 = Math.max(...walls.map((o) => o.b.x + o.b.dx));
  const y0 = Math.min(...walls.map((o) => o.b.y)), y1 = Math.max(...walls.map((o) => o.b.y + o.b.dy));
  e += line('DIM', x0, y0 - 500, x1, y0 - 500) + text('DIM', (x0 + x1) / 2 - 300, y0 - 420, 200, String(Math.round(x1 - x0)));
  e += line('DIM', x0 - 500, y0, x0 - 500, y1) + text('DIM', x0 - 1100, (y0 + y1) / 2, 200, String(Math.round(y1 - y0)));
  e += text('TXT', x0, y0 - 900, 200, 'INTERIOR PLAN (mm) - auto-generated, MEP pipes=schematic run, non-statutory');
  return shell(e);
}

/** 도메인 → DXF (없으면 null). pipes = buildAssembly().pipes.routes — 라우터 단일 결과 재사용(정합). */
export function dxfPlan(assembly, domain, pipes) {
  if (domain === 'building') { const d = dxfBuildingPlan(assembly); return d && pipes?.length ? injectPipes(d, pipes) : d; }
  if (domain === 'landscape') { const d = dxfLandscapePlan(assembly); return d && pipes?.length ? injectPipes(d, pipes) : d; }
  if (domain === 'interior') return dxfInteriorPlan(assembly, pipes);
  return null;
}
// 기존 셸의 ENTITIES 끝에 PIPE 엔티티 삽입(섹션 균형 유지)
function injectPipes(dxf, pipes) {
  const marker = g(0, 'ENDSEC') + g(0, 'EOF');
  const tail = dxf.lastIndexOf(marker);
  if (tail < 0) return dxf;
  return dxf.slice(0, tail) + pipeEntities(pipes) + dxf.slice(tail);
}

// --- self-test: 구조 무결성(섹션 균형·EOF·레이어 참조·엔티티 수) ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('dxf-export.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  let pass = 0, fail = 0;
  const check = (nm, dxf, minEnt) => {
    const sec = (dxf.match(/^SECTION$/gm) ?? []).length, end = (dxf.match(/^ENDSEC$/gm) ?? []).length;
    const eof = dxf.trimEnd().endsWith('EOF');
    const entSec = dxf.slice(dxf.indexOf('ENTITIES'));
    const ents = (entSec.match(/^(LINE|CIRCLE|TEXT|SOLID)$/gm) ?? []).length;
    const layersUsed = [...new Set([...entSec.matchAll(/^8\n(\w+)$/gm)].map((m) => m[1]))];
    const undeclared = layersUsed.filter((l) => !LAYERS.some(([n]) => n === l));
    const ok = sec === end && eof && ents >= minEnt && undeclared.length === 0;
    console.log(`${ok ? 'OK' : 'FAIL'} ${nm}: 섹션 ${sec}/${end} · EOF ${eof} · 엔티티 ${ents} · 미선언레이어 ${undeclared.join(',') || '없음'}`);
    ok ? pass++ : fail++;
  };
  check('building 3×2×2', dxfBuildingPlan(buildAssemblyTemplate('building', 'rc_frame', { baysX: 3, baysY: 2, floors: 2 })), 60);
  check('landscape deck', dxfLandscapePlan(buildAssemblyTemplate('landscape', 'timber_deck', {})), 30);
  check('landscape pergola', dxfLandscapePlan(buildAssemblyTemplate('landscape', 'pergola', {})), 20);
  {
    const { buildAssembly } = await import('./assembly.mjs');
    const asm = buildAssemblyTemplate('interior', 'studio_unit', {});
    const built = buildAssembly(asm);
    check('interior studio+MEP', dxfInteriorPlan(asm, built.pipes?.routes), 40);
  }
  console.log(`dxf-export self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
