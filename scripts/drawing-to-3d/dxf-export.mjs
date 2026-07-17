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
import { pickScale, staLabel, staStep } from './package.mjs';
import { chainAt } from './alignment-geom.mjs';

const g = (code, val) => `${code}\n${val}\n`;
// 대축척(km급) 주석 크기 — 모델공간 1:1(mm) 유지, 문자고·오프셋만 도면 축척(1:N)에 비례.
// 기준: 1:100에서 문자고 250mm(기존값) — K = N/100 (하한 1).
const annotK = (extentW, extentH) => {
  const N = pickScale(Math.max(extentW, 1), Math.max(extentH, 1), 380, 260);
  return { N, K: Math.max(1, N / 100) };
};

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
// R12 ARC — 각도는 항상 CCW(50=시작, 51=끝, deg). cw 호는 각도 스왑으로 방출(§F).
const arcEnt = (layer, cx, cy, r, a0deg, a1deg, ltype) =>
  g(0, 'ARC') + g(8, layer) + (ltype ? g(6, ltype) : '') + g(10, cx) + g(20, cy) + g(30, 0) + g(40, r) + g(50, a0deg) + g(51, a1deg);
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
  ['BNDRY', 6, 'CENTER'], ['CONTOUR', 32, 'CONTINUOUS'],
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
  const { N, K } = annotK(xs[xs.length - 1] - xs[0], ys[ys.length - 1] - ys[0]);
  const EXT = 800 * K, TH = 250 * K; // 축선 연장·문자 높이(mm) — 도면 축척 비례
  let e = '';
  // 축선 + 버블
  xs.forEach((x, i) => {
    e += line('AXIS', x, ys[0] - EXT, x, ys[ys.length - 1] + EXT, 'CENTER');
    e += circle('AXIS', x, ys[ys.length - 1] + EXT + 350 * K, 300 * K) + text('AXIS', x - 120 * K, ys[ys.length - 1] + EXT + 230 * K, TH, `X${i + 1}`);
  });
  ys.forEach((y, j) => {
    e += line('AXIS', xs[0] - EXT, y, xs[xs.length - 1] + EXT, y, 'CENTER');
    e += circle('AXIS', xs[0] - EXT - 350 * K, y, 300 * K) + text('AXIS', xs[0] - EXT - 500 * K, y - 120 * K, TH, String.fromCharCode(89 /*Y*/) + (j + 1));
  });
  // 심선 치수 (선+문자 단순표기)
  for (let i = 1; i < xs.length; i++) {
    const y = ys[ys.length - 1] + EXT + 900 * K;
    e += line('DIM', xs[i - 1], y, xs[i], y) + text('DIM', (xs[i - 1] + xs[i]) / 2 - 300 * K, y + 80 * K, TH, String(Math.round(xs[i] - xs[i - 1])));
  }
  for (let j = 1; j < ys.length; j++) {
    const x = xs[0] - EXT - 900 * K;
    e += line('DIM', x, ys[j - 1], x, ys[j]) + text('DIM', x - 700 * K, (ys[j - 1] + ys[j]) / 2, TH, String(Math.round(ys[j] - ys[j - 1])));
  }
  e += text('TXT', xs[0], ys[0] - EXT - 1200 * K, TH, `SCALE 1:${N} (annot) - model 1:1 mm`);
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
  e += text('TXT', xs[0], ys[0] - EXT - 700 * K, TH, `STRUCTURAL PLAN (mm) - auto-generated, dims=centerline, non-statutory`);
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
  const { N, K } = annotK(x1 - x0, y1 - y0);
  e += line('DIM', x0, y0 - 500 * K, x1, y0 - 500 * K) + text('DIM', (x0 + x1) / 2 - 300 * K, y0 - 420 * K, 200 * K, String(Math.round(x1 - x0)));
  e += line('DIM', x0 - 500 * K, y0, x0 - 500 * K, y1) + text('DIM', x0 - 1100 * K, (y0 + y1) / 2, 200 * K, String(Math.round(y1 - y0)));
  e += siteEntities(assembly, 200 * K);
  e += text('TXT', x0, y0 - 900 * K, 200 * K, `LANDSCAPE PLAN (mm) - SCALE 1:${N} (annot) - auto-generated, non-statutory`);
  return shell(e);
}

// 부지 경계·등고 DXF(④ — 입력 시만). BNDRY=일점쇄선, CONTOUR=표고 라벨.
function siteEntities(assembly, TH) {
  let e = '';
  const b = assembly.siteBoundary;
  if (Array.isArray(b) && b.length >= 3) {
    for (let i = 0; i < b.length; i++) { const [x1, y1] = b[i], [x2, y2] = b[(i + 1) % b.length]; e += line('BNDRY', x1, y1, x2, y2, 'CENTER'); }
    e += text('BNDRY', b[0][0], b[0][1] + TH, TH, 'SITE BOUNDARY');
  }
  for (const ct of assembly.contours ?? []) {
    if (!Array.isArray(ct.pts) || ct.pts.length < 2) continue;
    for (let i = 0; i < ct.pts.length - 1; i++) e += line('CONTOUR', ct.pts[i][0], ct.pts[i][1], ct.pts[i + 1][0], ct.pts[i + 1][1]);
    const [ex, ey] = ct.pts[ct.pts.length - 1];
    e += text('CONTOUR', ex, ey, TH * 0.8, `EL.${Number(ct.elevM).toFixed(1)}`);
  }
  return e;
}

/** 토목: 선형 평면 DXF — 부재 외곽 + 중심선(AXIS) + 측점(STA) + 주석 축척 비례. km급 연장.
 *  alignment(IP 폴리라인)가 있으면 중심선·벽 밴드(±halfW)·IP·STA 를 폴리라인 기준으로. */
export function dxfCivilPlan(assembly) {
  const al = assembly.alignment;
  if (al?.elements?.length) {
    const deg = (r) => ((r * 180) / Math.PI + 360) % 360;
    // 경계: 직선 끝점 + 호 8점 샘플
    const bp = [];
    for (const el2 of al.elements) {
      if (el2.type === 'line') bp.push(el2.p0, el2.p1);
      else for (let k = 0; k <= 8; k++) { const a = el2.a0 + (el2.a1 - el2.a0) * (k / 8); bp.push([el2.c[0] + el2.R * Math.cos(a), el2.c[1] + el2.R * Math.sin(a)]); }
    }
    const x0 = Math.min(...bp.map((q) => q[0])), x1 = Math.max(...bp.map((q) => q[0]));
    const y0 = Math.min(...bp.map((q) => q[1])), y1 = Math.max(...bp.map((q) => q[1]));
    const { N, K } = annotK(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    const TH = 200 * K, hw = al.halfWidthMm ?? 1000;
    let e = '';
    for (const el2 of al.elements) {
      if (el2.type === 'line') {
        const L = el2.len || 1;
        const nx = -(el2.p1[1] - el2.p0[1]) / L, ny = (el2.p1[0] - el2.p0[0]) / L;
        e += line('AXIS', el2.p0[0], el2.p0[1], el2.p1[0], el2.p1[1], 'CENTER');
        for (const sgn of [1, -1]) e += line('WALL', el2.p0[0] + sgn * nx * hw, el2.p0[1] + sgn * ny * hw, el2.p1[0] + sgn * nx * hw, el2.p1[1] + sgn * ny * hw);
      } else {
        const [aS, aE] = el2.ccw ? [deg(el2.a0), deg(el2.a1)] : [deg(el2.a1), deg(el2.a0)];
        e += arcEnt('AXIS', el2.c[0], el2.c[1], el2.R, aS, aE, 'CENTER');
        for (const dR of [hw, -hw]) e += arcEnt('WALL', el2.c[0], el2.c[1], el2.R + dR, aS, aE);
      }
    }
    const step = staStep(al.totalMm);
    for (let s = 0; ; s += step) {
      const t = Math.min(s, al.totalMm);
      const { p, dir } = chainAt(al.elements, t);
      const nx = -dir[1], ny = dir[0];
      e += line('DIM', p[0] - nx * (hw + 300 * K), p[1] - ny * (hw + 300 * K), p[0] + nx * (hw + 300 * K), p[1] + ny * (hw + 300 * K));
      e += text('DIM', p[0] + nx * (hw + 450 * K), p[1] + ny * (hw + 450 * K), TH, `STA ${staLabel(t)}`);
      if (t >= al.totalMm) break;
    }
    for (const ct of al.curveTable ?? []) {
      if (ct.ipXY) e += circle('AXIS', ct.ipXY[0], ct.ipXY[1], 120 * K) + text('AXIS', ct.ipXY[0] + 160 * K, ct.ipXY[1] + 160 * K, TH, `IP${ct.ip} R=${Math.round(ct.R)}`);
      for (const [sm, lab] of [[ct.BCmm, 'BC'], [ct.ECmm, 'EC']]) {
        const { p, dir } = chainAt(al.elements, sm);
        const nx = -dir[1], ny = dir[0];
        e += line('DIM', p[0] - nx * (hw + 200 * K), p[1] - ny * (hw + 200 * K), p[0] + nx * (hw + 200 * K), p[1] + ny * (hw + 200 * K));
        e += text('DIM', p[0] - nx * (hw + 400 * K), p[1] - ny * (hw + 400 * K), TH * 0.85, `${lab} ${staLabel(sm)}`);
      }
    }
    for (let i = 1; i < (al.ips?.length ?? 0) - 1; i++) {
      if ((al.curveTable ?? []).some((ct) => ct.ip === i)) continue;
      e += circle('AXIS', al.ips[i][0], al.ips[i][1], 100 * K) + text('AXIS', al.ips[i][0] + 140 * K, al.ips[i][1] + 140 * K, TH, `IP${i}`);
    }
    e += siteEntities(assembly, TH);
    e += text('TXT', x0, y0 - 900 * K, TH, `CIVIL ALIGNMENT PLAN (mm) - SCALE 1:${N} (annot) - band=schematic +/-${Math.round(hw)}mm - arcs=true R - non-statutory`);
    return shell(e);
  }
  const parts = (assembly.parts ?? []).map((p) => ({ p, b: box(p) }));
  if (!parts.length) return null;
  const x0 = Math.min(...parts.map((o) => o.b.x)), x1 = Math.max(...parts.map((o) => o.b.x + o.b.dx));
  const y0 = Math.min(...parts.map((o) => o.b.y)), y1 = Math.max(...parts.map((o) => o.b.y + o.b.dy));
  const Wm = x1 - x0, Dm = y1 - y0;
  const { N, K } = annotK(Wm, Dm);
  const TH = 200 * K;
  let e = '';
  for (const o of parts) e += rect(o.p.role === 'wall' ? 'WALL' : 'SLAB', o.b.x, o.b.y, o.b.dx, o.b.dy, o.p.role === 'wall' ? undefined : 'DASHED');
  // 중심선 + 측점(장축 기준)
  const alongY = Dm >= Wm;
  const Lmm = alongY ? Dm : Wm;
  const step = staStep(Lmm);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (alongY) e += line('AXIS', cx, y0 - 300 * K, cx, y1 + 300 * K, 'CENTER');
  else e += line('AXIS', x0 - 300 * K, cy, x1 + 300 * K, cy, 'CENTER');
  for (let s = 0; ; s += step) {
    const t = Math.min(s, Lmm);
    if (alongY) e += line('DIM', cx - 150 * K, y0 + t, cx + 150 * K, y0 + t) + text('DIM', cx + 200 * K, y0 + t - 60 * K, TH, `STA ${staLabel(t)}`);
    else e += line('DIM', x0 + t, cy - 150 * K, x0 + t, cy + 150 * K) + text('DIM', x0 + t - 60 * K, cy + 200 * K, TH, `STA ${staLabel(t)}`);
    if (t >= Lmm) break;
  }
  e += line('DIM', x0, y0 - 500 * K, x1, y0 - 500 * K) + text('DIM', (x0 + x1) / 2 - 300 * K, y0 - 420 * K, TH, String(Math.round(Wm)));
  e += siteEntities(assembly, TH);
  e += text('TXT', x0, y0 - 900 * K, TH, `CIVIL PLAN (mm) - SCALE 1:${N} (annot) - STA every ${Math.round(step / 1000)}m - non-statutory`);
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

// §F 실좌표(TM 등) 대응 — assembly.origin = { E, N }(mm) 입력 시 DXF 전체를 오프셋 방출.
// SVG 는 로컬 유지(라벨에 원점 표기) — 대좌표 정밀도는 double(mm)로 충분.
function applyOrigin(dxf, assembly) {
  const o = assembly?.origin;
  if (!dxf || !(Number(o?.E) || Number(o?.N))) return dxf;
  const E = Number(o.E) || 0, N = Number(o.N) || 0;
  // 좌표 그룹코드(10/11/12/13=x, 20/21/22/23=y)만 시프트 — R12 라인 단위 치환
  const lines = dxf.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const code = lines[i].trim();
    if (['10', '11', '12', '13'].includes(code)) lines[i + 1] = String(Number(lines[i + 1]) + E);
    else if (['20', '21', '22', '23'].includes(code)) lines[i + 1] = String(Number(lines[i + 1]) + N);
  }
  return lines.join('\n').replace('ENTITIES\n', `ENTITIES\n${g(0, 'TEXT') + g(8, 'TXT') + g(10, E) + g(20, N - 2000) + g(30, 0) + g(40, 300) + g(1, `ORIGIN OFFSET E=${E} N=${N} (mm) - real-coordinate emission`)}`);
}

/** 도메인 → DXF (없으면 null). pipes = buildAssembly().pipes.routes — 라우터 단일 결과 재사용(정합). */
export function dxfPlan(assembly, domain, pipes) {
  const d0 = dxfPlanLocal(assembly, domain, pipes);
  return applyOrigin(d0, assembly);
}
function dxfPlanLocal(assembly, domain, pipes) {
  if (domain === 'building') { const d = dxfBuildingPlan(assembly); return d && pipes?.length ? injectPipes(d, pipes) : d; }
  if (domain === 'landscape') { const d = dxfLandscapePlan(assembly); return d && pipes?.length ? injectPipes(d, pipes) : d; }
  if (domain === 'interior') return dxfInteriorPlan(assembly, pipes);
  if (domain === 'civil') { const d = dxfCivilPlan(assembly); return d && pipes?.length ? injectPipes(d, pipes) : d; }
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
    const ents = (entSec.match(/^(LINE|CIRCLE|TEXT|SOLID|ARC)$/gm) ?? []).length;
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
  check('civil 500m run+STA', dxfCivilPlan(buildAssemblyTemplate('civil', 'retaining_wall_run', { length: 500000 })), 20);
  {
    const curved = dxfCivilPlan(buildAssemblyTemplate('civil', 'retaining_wall_alignment', { curves: [{ ip: 1, R: 30000 }] }));
    const arcs = (curved.match(/^ARC$/gm) ?? []).length;
    console.log(`${arcs >= 3 ? 'OK' : 'FAIL'} civil alignment R30m: ARC ${arcs}본(중심선+밴드 2)`);
    check('civil alignment+curve', curved, 20);
  }
  console.log(`dxf-export self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
