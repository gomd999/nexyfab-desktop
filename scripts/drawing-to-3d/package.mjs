/**
 * 설계 패키지 자동생성 — 임의 어셈블리(parts[])에서 2D GA 도면·구조 리포트·계통색 GA 3D
 * 를 범용 생성한다. skid/tank 하드코딩 생성기를 어셈블리 파라메트릭으로 일반화.
 * (P&ID·Dossier 는 공정 의미·서술 필요 → AI 보조 후속. 여기선 형상기반 3종.)
 */
import { structuralCheck } from './structural.mjs';
import { colorOf, placedAabb } from './assembly.mjs';
import { partAabb } from './reconstruct.mjs';
import { runCalculator, calculators } from '../engineering-core/registry.mjs';
import { retainingWallSectionSvg } from './section-drawings.mjs';
import { rebarBBS } from './rebar-bbs.mjs';
import { takeoff as takeoffRules } from '../engineering-core/quantity/takeoff.mjs';
const EPS_XS = 1e-6;

// 부품 type → 기본 재질 라벨(도면 BOM). 색은 colorOf(assembly.mjs) 단일 소스 — service/role/추론/type 순.
const TYPE_MAT = {
  box: 'STS', plate_with_holes: '판재', stepped_plate: '판재', base_plate: '판재', l_bracket: '브래킷', bent_sheet: '판금',
  flange: '플랜지', tube: '관', rect_tube: '각관', cylinder: '봉/실린더', gusset: '거셋',
  spur_gear: '기어', hex_bolt: '볼트', sheet_profile: '판금', wall_with_openings: '벽체',
};
const styleOf = (p) => ({ c: colorOf(p), mat: p.material || TYPE_MAT[p.type] || '-' });

// 배치 후 축정렬 AABB — placedAabb(회전 정확) 단일 소스. ⚠구현이 "회전 무시 근사"였을 때
// rz=90 벽이 GA 외형을 6300→10650으로 부풀렸다(정합 게이트 W 대조가 검출, 260717).
function placed(part) {
  const b = placedAabb(part);
  return { x: b.min[0], y: b.min[1], z: b.min[2], dx: b.max[0] - b.min[0], dy: b.max[1] - b.min[1], dz: b.max[2] - b.min[2] };
}

// 부품 주요치수 문자열 (도면 치수기입용)
function dimStr(type, p) {
  switch (type) {
    case 'box': return `${p.width}×${p.depth}×${p.height}`;
    case 'base_plate': case 'plate_with_holes': case 'stepped_plate': return `${p.width}×${p.depth} t${p.thickness}`;
    case 'tube': return `⌀${p.outerDia}×${p.length} t${Math.round((p.outerDia - p.innerDia) / 2)}`;
    case 'rect_tube': return `${p.width}×${p.height}×${p.length} t${p.wallThk}`;
    case 'cylinder': return `⌀${p.diameter}×${p.length}`;
    case 'flange': return `⌀${p.outerDia} ${p.boltCount}-⌀${p.boltHoleD}`;
    case 'l_bracket': return `${p.legA}×${p.legB} t${p.thickness}`;
    case 'gusset': return `${p.legA}×${p.legB} t${p.thickness}`;
    case 'bent_sheet': return `${p.length}×${p.webWidth} t${p.thickness}`;
    case 'spur_gear': return `m${p.module} z${p.teeth} t${p.thickness}${p.boreDia > 0 ? ` ⌀${p.boreDia}` : ''}`;
    case 'hex_bolt': return `M${p.threadDia}×${p.length}`;
    case 'sheet_profile': return `t${p.thickness} L${p.width} ${p.segments?.length ?? 0}면`;
    case 'wall_with_openings': return `${p.length}×${p.height} t${p.thickness}${p.openings?.length ? ` 개구${p.openings.length}` : ''}`;
    default: return '';
  }
}
const PRINT_BAR = (label) => `<div class="nf-print-bar" style="position:sticky;top:0;z-index:99;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center"><b>${label}</b><button onclick="print()" style="background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer">🖨 인쇄 / PDF</button></div>`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ── 대축척 도면 코어(260717) — km급 토목·조경·건축 도면 지원 ────────────────────
// 기계 스케일(수 m) 가정 제거: ①표준 축척(1:N) 자동 선정 — A3 100% 인쇄 기준 실축척
// ②치수 표기 자동 단위(mm→m→km) ③스케일바·방위 ④측점(STA) 라벨.
export const STD_SCALES = [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2500, 5000, 10000];
const PX_PER_PAPER_MM = 1180 / 420; // sheet 1180px = A3 폭 420mm ⇒ 인쇄 100%에서 1:N 실축척
export function pickScale(extentWmm, extentHmm = 0, paperWmm = 170, paperHmm = 200) {
  return STD_SCALES.find((n) => extentWmm / n <= paperWmm && extentHmm / n <= paperHmm) ?? STD_SCALES[STD_SCALES.length - 1];
}
/** 길이 표기 자동 단위 — <10 m=mm 정수 · <1 km=m(2자리) · 이상=km(3자리). */
export function fmtLen(mm) {
  if (!Number.isFinite(mm)) return '-';
  const a = Math.abs(mm);
  if (a < 10000) return String(Math.round(mm));
  if (a < 1_000_000) return `${Math.round(mm / 10) / 100}m`;
  return `${Math.round(mm / 1000) / 1000}km`;
}
/** 측점(STA) 라벨 — 0+000 형식(km+m). */
export function staLabel(mm) { const m = Math.round(mm / 1000); return `${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, '0')}`; }
/** 측점 간격 — 연장에 따라 10/50/100 m. */
export const staStep = (extentMm) => (extentMm <= 100_000 ? 10_000 : extentMm <= 500_000 ? 50_000 : 100_000);
// 스케일바 — 눈금=1·2·5×10^k 계열(연장/4 근방), 흑백 교대 2칸
function scaleBarSvg(x, y, S, extentMm) {
  const target = Math.max(1, extentMm / 4);
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const base = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= target) ?? pow;
  const segPx = (base / 2) * S;
  let el = '';
  for (let i = 0; i < 2; i++) el += `<rect x="${(x + i * segPx).toFixed(1)}" y="${y}" width="${segPx.toFixed(1)}" height="5" fill="${i % 2 ? '#fff' : '#1f2937'}" stroke="#1f2937" stroke-width=".6"/>`;
  el += `<text x="${x}" y="${y - 3}" font-size="8.5" font-family="sans-serif">0</text>`;
  el += `<text x="${(x + 2 * segPx).toFixed(1)}" y="${y - 3}" font-size="8.5" text-anchor="end" font-family="sans-serif">${fmtLen(base)}${Math.abs(base) < 10000 ? 'mm' : ''}</text>`;
  return el;
}
const northSvg = (x, y) => `<g font-family="sans-serif"><circle cx="${x}" cy="${y}" r="10" fill="#fff" stroke="#1f2937" stroke-width=".8"/><path d="M ${x} ${y - 7} L ${x + 4} ${y + 5} L ${x} ${y + 2} L ${x - 4} ${y + 5} Z" fill="#1f2937"/><text x="${x}" y="${y - 13}" font-size="8.5" text-anchor="middle">N</text></g>`;

/**
 * 건축 축선 평면도 SVG (관례도면 모드 — Wave C ③): 기둥 중심선 축선(Ⓧ①…·Ⓨⓐ…),
 * 심선 스팬치수, 기둥=채운 사각, 보=이중선, 슬래브 외곽 점선.
 */
function axesPlanSvg(parts) {
  const cols = parts.filter((o) => o.p.role === 'column');
  const beams = parts.filter((o) => o.p.role === 'beam');
  const slabs = parts.filter((o) => o.p.role === 'slab');
  if (!cols.length) return null;
  // 1개 층만 (최하층 z0 기준)
  const z0 = Math.min(...cols.map((o) => o.box.z));
  const fCols = cols.filter((o) => Math.abs(o.box.z - z0) < 1);
  const uniq = (arr, tol = 50) => { const out = []; for (const v of arr.slice().sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > tol) out.push(v); return out; };
  const xs = uniq(fCols.map((o) => o.box.x + o.box.dx / 2));
  const ys = uniq(fCols.map((o) => o.box.y + o.box.dy / 2));
  if (xs.length < 2 || ys.length < 2) return null;
  const M = 90; // 여백(축선 라벨 공간)
  const Wm = xs[xs.length - 1] - xs[0], Dm = ys[ys.length - 1] - ys[0];
  const S = Math.min(760 / Wm, 520 / Dm);
  const X = (v) => (M + (v - xs[0]) * S).toFixed(1);
  const Y = (v) => (M + (v - ys[0]) * S).toFixed(1);
  const el = [];
  const circled = (n) => String.fromCharCode(0x2460 + n); // ①②…
  const alpha = (n) => String.fromCharCode(65 + n); // A B…
  // 축선 (일점쇄선 근사: dash)
  for (const [i, x] of xs.entries()) {
    el.push(`<line x1="${X(x)}" y1="${M - 34}" x2="${X(x)}" y2="${(M + Dm * S + 30).toFixed(1)}" stroke="#dc2626" stroke-width=".7" stroke-dasharray="14 4 3 4"/>`);
    el.push(`<circle cx="${X(x)}" cy="${M - 46}" r="11" fill="#fff" stroke="#dc2626"/><text x="${X(x)}" y="${M - 42}" font-size="11" text-anchor="middle" fill="#dc2626" font-family="sans-serif">${circled(i)}</text>`);
  }
  for (const [j, y] of ys.entries()) {
    el.push(`<line x1="${M - 34}" y1="${Y(y)}" x2="${(M + Wm * S + 30).toFixed(1)}" y2="${Y(y)}" stroke="#dc2626" stroke-width=".7" stroke-dasharray="14 4 3 4"/>`);
    el.push(`<circle cx="${M - 46}" cy="${Y(y)}" r="11" fill="#fff" stroke="#dc2626"/><text x="${M - 46}" y="${(+Y(y) + 4).toFixed(1)}" font-size="11" text-anchor="middle" fill="#dc2626" font-family="sans-serif">${alpha(j)}</text>`);
  }
  // 심선 스팬 치수 (상단·좌측)
  for (let i = 1; i < xs.length; i++) {
    const x0 = +X(xs[i - 1]), x1 = +X(xs[i]);
    el.push(`<line x1="${x0}" y1="${M - 20}" x2="${x1}" y2="${M - 20}" stroke="#1f2937" stroke-width=".6"/><text x="${(x0 + x1) / 2}" y="${M - 24}" font-size="10" text-anchor="middle" font-family="sans-serif">${Math.round(xs[i] - xs[i - 1])}</text>`);
  }
  for (let j = 1; j < ys.length; j++) {
    const y0 = +Y(ys[j - 1]), y1 = +Y(ys[j]);
    el.push(`<line x1="${M - 20}" y1="${y0}" x2="${M - 20}" y2="${y1}" stroke="#1f2937" stroke-width=".6"/><text x="${M - 24}" y="${(y0 + y1) / 2}" font-size="10" text-anchor="end" font-family="sans-serif" transform="rotate(-90 ${M - 24} ${(y0 + y1) / 2})">${Math.round(ys[j] - ys[j - 1])}</text>`);
  }
  // 슬래브 외곽(점선)
  const sl = slabs[0];
  if (sl) el.push(`<rect x="${X(sl.box.x + 0)}" y="${Y(sl.box.y)}" width="${(sl.box.dx * S).toFixed(1)}" height="${(sl.box.dy * S).toFixed(1)}" fill="none" stroke="#94a3b8" stroke-width=".8" stroke-dasharray="6 4"/>`);
  // 보 (이중선) — 최하층
  for (const o of beams.filter((b) => Math.abs(b.box.z - Math.min(...beams.map((x) => x.box.z))) < 1)) {
    const b = o.box;
    el.push(`<rect x="${X(b.x)}" y="${Y(b.y)}" width="${(b.dx * S).toFixed(1)}" height="${(b.dy * S).toFixed(1)}" fill="none" stroke="#0e7490" stroke-width="1"/>`);
  }
  // 기둥 (채움) + 단면 표기
  const c0 = fCols[0];
  for (const o of fCols) {
    const b = o.box;
    el.push(`<rect x="${X(b.x)}" y="${Y(b.y)}" width="${(b.dx * S).toFixed(1)}" height="${(b.dy * S).toFixed(1)}" fill="#475569" stroke="#1f2937" stroke-width=".8"/>`);
  }
  el.push(`<text x="${M}" y="${(M + Dm * S + 52).toFixed(1)}" font-size="10" fill="#475569" font-family="sans-serif">기둥 ${Math.round(c0.box.dx)}×${Math.round(c0.box.dy)} · 축선치수=심선(mm) · 구조 평면(최하층)</text>`);
  return `<svg viewBox="0 0 ${M + Wm * S + 70} ${M + Dm * S + 70}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff"><text x="${M}" y="24" font-size="13" font-weight="700" font-family="sans-serif">구조 평면도 (축선)</text>${el.join('')}</svg>`;
}

/** 조경 배치도 SVG (관례도면 모드): 평면 심볼 — 데크보드 해치·장선 점선·기둥 심볼·외곽 치수. */
function landscapePlanSvg(parts) {
  const all = parts;
  if (!all.length) return null;
  const x0 = Math.min(...all.map((o) => o.box.x)), x1 = Math.max(...all.map((o) => o.box.x + o.box.dx));
  const y0 = Math.min(...all.map((o) => o.box.y)), y1 = Math.max(...all.map((o) => o.box.y + o.box.dy));
  const M = 60, Wm = x1 - x0, Dm = y1 - y0;
  const S = Math.min(760 / Math.max(Wm, 1), 520 / Math.max(Dm, 1));
  const X = (v) => (M + (v - x0) * S).toFixed(1);
  const Y = (v) => (M + (v - y0) * S).toFixed(1);
  const el = [];
  // 데크보드(위→아래 순서로 해치), 장선(점선), 보(실선), 기둥(원+십자)
  for (const o of all) {
    const b = o.box, r = o.p.role;
    if (r === 'deck') el.push(`<rect x="${X(b.x)}" y="${Y(b.y)}" width="${(b.dx * S).toFixed(1)}" height="${(b.dy * S).toFixed(1)}" fill="#d6b98c55" stroke="#a16207" stroke-width=".5"/>`);
    else if (r === 'joist') el.push(`<rect x="${X(b.x)}" y="${Y(b.y)}" width="${(b.dx * S).toFixed(1)}" height="${(b.dy * S).toFixed(1)}" fill="none" stroke="#854d0e" stroke-width=".7" stroke-dasharray="5 3"/>`);
    else if (r === 'beam') el.push(`<rect x="${X(b.x)}" y="${Y(b.y)}" width="${(b.dx * S).toFixed(1)}" height="${(b.dy * S).toFixed(1)}" fill="none" stroke="#0e7490" stroke-width="1.1"/>`);
    else if (r === 'column') {
      const cx = +X(b.x + b.dx / 2), cy = +Y(b.y + b.dy / 2), rr = Math.max(4, (b.dx * S) / 2);
      el.push(`<circle cx="${cx}" cy="${cy}" r="${rr.toFixed(1)}" fill="#fff" stroke="#475569" stroke-width="1.2"/><line x1="${cx - rr}" y1="${cy}" x2="${cx + rr}" y2="${cy}" stroke="#475569" stroke-width=".6"/><line x1="${cx}" y1="${cy - rr}" x2="${cx}" y2="${cy + rr}" stroke="#475569" stroke-width=".6"/>`);
    }
  }
  // 외곽 치수(자동 단위) + 스케일바
  el.push(`<line x1="${X(x0)}" y1="${(M + Dm * S + 18).toFixed(1)}" x2="${X(x1)}" y2="${(M + Dm * S + 18).toFixed(1)}" stroke="#dc2626" stroke-width=".6"/><text x="${(+X(x0) + +X(x1)) / 2}" y="${(M + Dm * S + 32).toFixed(1)}" font-size="10" text-anchor="middle" fill="#dc2626" font-family="sans-serif">${fmtLen(Wm)}</text>`);
  el.push(`<line x1="${M - 16}" y1="${Y(y0)}" x2="${M - 16}" y2="${Y(y1)}" stroke="#dc2626" stroke-width=".6"/><text x="${M - 22}" y="${(+Y(y0) + +Y(y1)) / 2}" font-size="10" text-anchor="end" fill="#dc2626" font-family="sans-serif" transform="rotate(-90 ${M - 22} ${(+Y(y0) + +Y(y1)) / 2})">${fmtLen(Dm)}</text>`);
  el.push(scaleBarSvg(M, M + Dm * S + 44, S, Math.max(Wm, Dm)));
  // 범례는 스케일바(+44) 아래 별도 행(+68) — 동일 y 겹침(260717 예시 배터리 검출) 방지
  return `<svg viewBox="0 0 ${M + Wm * S + 50} ${M + Dm * S + 84}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff"><text x="${M}" y="24" font-size="13" font-weight="700" font-family="sans-serif">배치 평면도</text>${el.join('')}<text x="${M}" y="${(M + Dm * S + 68).toFixed(1)}" font-size="9.5" fill="#64748b" font-family="sans-serif">범례: ▨데크보드 · ┅장선 · ─보 · ⊕기둥 · 치수 mm</text></svg>`;
}

// ── 선형(alignment)·종단·시트분할·부지 오버레이 (260717 순차 ①~④) ────────────────
// 폴리라인 체이니지 보간 — alignment-geom 단일 소스(§0.3: 재구현 금지, dxf-export 공유).
// ⚠`export { x } from`은 로컬 바인딩을 안 만든다 — 내부 사용처가 있으므로 import 후 재수출.
import { chainPoint, chainAt, clipElements } from './alignment-geom.mjs';
export { chainPoint };
const polyArea2 = (pts) => Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

/** 부지 경계·등고 오버레이(④ — 입력 시만, 지형 지어내지 않음). X/Y=좌표 매퍼. */
function siteOverlaySvg(X, Y, site) {
  if (!site) return '';
  const el = [];
  if (Array.isArray(site.boundary) && site.boundary.length >= 3) {
    const pts = site.boundary.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
    el.push(`<polygon points="${pts}" fill="none" stroke="#9333ea" stroke-width="1.4" stroke-dasharray="18 5 4 5"/>`);
    const [lx, ly] = site.boundary[0];
    el.push(`<text x="${X(lx)}" y="${(+Y(ly) - 5).toFixed(1)}" font-size="9" fill="#9333ea" font-family="sans-serif">대지경계선 · A=${(polyArea2(site.boundary) / 1e6).toFixed(1)}m²</text>`);
  }
  for (const ct of site.contours ?? []) {
    if (!Array.isArray(ct.pts) || ct.pts.length < 2) continue;
    const pts = ct.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
    el.push(`<polyline points="${pts}" fill="none" stroke="#a16207" stroke-width=".8" opacity=".8"/>`);
    const [ex, ey] = ct.pts[ct.pts.length - 1];
    el.push(`<text x="${X(ex)}" y="${Y(ey)}" font-size="8" fill="#a16207" font-family="sans-serif">EL.${Number(ct.elevM).toFixed(1)}</text>`);
  }
  return el.join('');
}

// SVG 원호 path — 방향 플래그는 중간점 통과로 결정(y 반전 좌표계에서도 견고)
function svgArcPath(X, Y, S, pStart, pEnd, pMid, Rmm) {
  const sx = +X(pStart[0]), sy = +Y(pStart[1]);
  const ex = +X(pEnd[0]), ey = +Y(pEnd[1]);
  const mx = +X(pMid[0]), my = +Y(pMid[1]);
  const Rs = Rmm * S;
  const cross = (ex - sx) * (my - sy) - (ey - sy) * (mx - sx);
  const sweep = cross > 0 ? 1 : 0;
  // large-arc: 시위 중점→중간점 거리가 R 초과면 대호(반원 초과)
  const chordMidX = (sx + ex) / 2, chordMidY = (sy + ey) / 2;
  const large = Math.hypot(mx - chordMidX, my - chordMidY) > Rs ? 1 : 0;
  return `M ${sx} ${sy} A ${Rs.toFixed(2)} ${Rs.toFixed(2)} 0 ${large} ${sweep} ${ex} ${ey}`;
}
const arcPointAt = (elArc, frac) => {
  const a = elArc.a0 + (elArc.a1 - elArc.a0) * frac;
  return [elArc.c[0] + elArc.R * Math.cos(a), elArc.c[1] + elArc.R * Math.sin(a)];
};
// 오프셋(±off) 포인트 — 호는 반경 R∓off(ccw 기준 좌측 법선=중심 방향) 동심호
const arcOffsetPointAt = (elArc, frac, off) => {
  const a = elArc.a0 + (elArc.a1 - elArc.a0) * frac;
  const Ro = elArc.R + (elArc.ccw ? -off : off); // 좌측(+n) 오프셋: ccw 는 중심쪽=반경 감소
  return [elArc.c[0] + Ro * Math.cos(a), elArc.c[1] + Ro * Math.sin(a)];
};

/** 선형 평면(① 요소열: 직선+진짜 원호) — 윈도(staFrom~staTo) 지원(③ 시트 분할·매치라인). */
function alignmentPlanSvg(assembly, { staFrom = 0, staTo = null, sheetNo = 0, sheetCount = 0, fixedN = null, fixedS = null } = {}) {
  const al = assembly.alignment;
  const elements = al?.elements ?? null;
  if (!elements?.length) return null;
  const total = al.totalMm;
  const s0 = Math.max(0, staFrom), s1 = staTo == null ? total : Math.min(total, staTo);
  const sub = clipElements(elements, s0, s1);
  // 경계 산정: 직선 끝점 + 호 8점 샘플
  const boundsPts = [];
  for (const e of sub) {
    if (e.type === 'line') boundsPts.push(e.p0, e.p1);
    else for (let k = 0; k <= 8; k++) boundsPts.push(arcPointAt(e, k / 8));
  }
  const hw = al.halfWidthMm ?? 1000;
  const extra = (assembly.siteBoundary && sheetCount === 0 ? assembly.siteBoundary : []).concat((sheetCount === 0 ? (assembly.contours ?? []) : []).flatMap((c) => c.pts ?? []));
  const allPts = boundsPts.concat(extra);
  const pad = hw + 2500;
  const x0 = Math.min(...allPts.map((p) => p[0])) - pad, x1 = Math.max(...allPts.map((p) => p[0])) + pad;
  const y0 = Math.min(...allPts.map((p) => p[1])) - pad, y1 = Math.max(...allPts.map((p) => p[1])) + pad;
  const Wm = Math.max(1, x1 - x0), Dm = Math.max(1, y1 - y0);
  const M = 70;
  // 상세 시트 축척 통일(260717 예시 배터리: 잔여 구간 시트만 1:200 으로 튀는 문제) —
  // 시트 계획이 전 윈도 실측 후 fixedS(최소 fit)·fixedN(최대 표준 축척)을 재주입한다.
  const S = fixedS ?? Math.min(760 / Wm, 430 / Dm);
  const N = fixedN ?? pickScale(Wm, Dm, 360, 230);
  const X = (v) => (M + (v - x0) * S).toFixed(1);
  const Y = (v) => (M + (y1 - v) * S).toFixed(1); // 북=위 관례(y 반전)
  const el = [];
  el.push(siteOverlaySvg(X, Y, sheetCount === 0 ? { boundary: assembly.siteBoundary, contours: assembly.contours } : null));
  // 벽 밴드(±halfW 도식 — 부재 상세는 단면도) + 중심선: 직선=선분 · 호=동심 원호(진짜 원호)
  for (const e of sub) {
    if (e.type === 'line') {
      const L = e.len || 1;
      const nx = -(e.p1[1] - e.p0[1]) / L, ny = (e.p1[0] - e.p0[0]) / L;
      for (const sgn of [1, -1]) el.push(`<line x1="${X(e.p0[0] + sgn * nx * hw)}" y1="${Y(e.p0[1] + sgn * ny * hw)}" x2="${X(e.p1[0] + sgn * nx * hw)}" y2="${Y(e.p1[1] + sgn * ny * hw)}" stroke="#78716c" stroke-width="1.1"/>`);
      el.push(`<line x1="${X(e.p0[0])}" y1="${Y(e.p0[1])}" x2="${X(e.p1[0])}" y2="${Y(e.p1[1])}" stroke="#dc2626" stroke-width=".8" stroke-dasharray="16 4 3 4"/>`);
    } else {
      for (const sgn of [1, -1]) {
        const Ro = e.R + (e.ccw ? -sgn * hw : sgn * hw);
        el.push(`<path d="${svgArcPath(X, Y, S, arcOffsetPointAt(e, 0, sgn * hw), arcOffsetPointAt(e, 1, sgn * hw), arcOffsetPointAt(e, 0.5, sgn * hw), Ro)}" fill="none" stroke="#78716c" stroke-width="1.1"/>`);
      }
      el.push(`<path d="${svgArcPath(X, Y, S, arcPointAt(e, 0), arcPointAt(e, 1), arcPointAt(e, 0.5), e.R)}" fill="none" stroke="#dc2626" stroke-width=".8" stroke-dasharray="16 4 3 4"/>`);
    }
  }
  // 측점(STA) — 윈도 내부만, 접선 법선 방향 틱(chainAt 단일 소스)
  const step = staStep(total);
  // ⚠종점 측점 버그 이력: 조건 s≤s1+1 이 step 비배수 종점을 배제 — t=min(s,s1) 방출 후 종료
  for (let s = Math.ceil(s0 / step) * step; ; s += step) {
    const t = Math.min(s, s1);
    const { p, dir } = chainAt(elements, t);
    const nx = -dir[1], ny = dir[0];
    el.push(`<line x1="${X(p[0] - nx * (hw + 600))}" y1="${Y(p[1] - ny * (hw + 600))}" x2="${X(p[0] + nx * (hw + 600))}" y2="${Y(p[1] + ny * (hw + 600))}" stroke="#dc2626" stroke-width=".7"/>`);
    el.push(`<text x="${X(p[0] + nx * (hw + 900))}" y="${Y(p[1] + ny * (hw + 900))}" font-size="8.5" fill="#dc2626" font-family="sans-serif">STA ${staLabel(t)}</text>`);
    if (t >= s1 - 1e-6) break;
  }
  // IP 마커(교각·R) + BC/EC 틱 — curveTable 단일 소스
  for (const ct of al.curveTable ?? []) {
    if (ct.BCmm > s1 || ct.ECmm < s0) continue;
    if (ct.ipXY) {
      el.push(`<circle cx="${X(ct.ipXY[0])}" cy="${Y(ct.ipXY[1])}" r="5" fill="#fff" stroke="#0f172a" stroke-width="1"/>`);
      el.push(`<text x="${(+X(ct.ipXY[0]) + 8).toFixed(1)}" y="${(+Y(ct.ipXY[1]) - 8).toFixed(1)}" font-size="9" font-weight="700" font-family="sans-serif">IP${ct.ip} Δ=${Math.abs(ct.deltaDeg).toFixed(1)}° R=${fmtLen(ct.R)}</text>`);
    }
    for (const [sm, lab] of [[ct.BCmm, 'BC'], [ct.ECmm, 'EC']]) {
      if (sm < s0 || sm > s1) continue;
      const { p, dir } = chainAt(elements, sm);
      const nx = -dir[1], ny = dir[0];
      el.push(`<line x1="${X(p[0] - nx * (hw + 400))}" y1="${Y(p[1] - ny * (hw + 400))}" x2="${X(p[0] + nx * (hw + 400))}" y2="${Y(p[1] + ny * (hw + 400))}" stroke="#0f172a" stroke-width=".9"/>`);
      el.push(`<text x="${X(p[0] - nx * (hw + 800))}" y="${Y(p[1] - ny * (hw + 800))}" font-size="8" fill="#0f172a" font-family="sans-serif">${lab} ${staLabel(sm)}</text>`);
    }
  }
  // 세그먼트 IP(곡선 없는 굴절점) 마커 — ips 중 curveTable 에 없는 내부점(Δ=꺾임각 표기)
  for (let i = 1; i < (al.ips?.length ?? 0) - 1; i++) {
    if ((al.curveTable ?? []).some((ct) => ct.ip === i)) continue;
    const [ix, iy] = al.ips[i];
    const b1 = Math.atan2(iy - al.ips[i - 1][1], ix - al.ips[i - 1][0]);
    const b2 = Math.atan2(al.ips[i + 1][1] - iy, al.ips[i + 1][0] - ix);
    let dd = ((b2 - b1) * 180) / Math.PI; while (dd > 180) dd -= 360; while (dd <= -180) dd += 360;
    el.push(`<circle cx="${X(ix)}" cy="${Y(iy)}" r="4" fill="#fff" stroke="#64748b" stroke-width="1"/>`);
    el.push(`<text x="${(+X(ix) + 7).toFixed(1)}" y="${(+Y(iy) - 7).toFixed(1)}" font-size="8.5" fill="#64748b" font-family="sans-serif">IP${i} Δ=${Math.abs(dd).toFixed(1)}°</text>`);
  }
  // 구조물 마커(§1-2) — 회전 사각 심볼+라벨(chainAt 단일 소스, 일람표와 동일 STA 표기)
  for (const st2 of al.structures ?? []) {
    if (st2.sta < s0 || st2.sta > s1) continue;
    const { p, dir } = chainAt(elements, st2.sta);
    const nx = -dir[1], ny = dir[0];
    const halfAlong = Math.max(st2.alongMm / 2, 300), halfPerp = st2.type === 'culvert' ? hw + 1500 : 450;
    const cx0 = st2.type === 'catch_basin' ? p[0] + nx * (hw + 700 + halfAlong) : p[0];
    const cy0 = st2.type === 'catch_basin' ? p[1] + ny * (hw + 700 + halfAlong) : p[1];
    if (st2.type !== 'expansion_joint') {
      const cor = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => `${X(cx0 + dir[0] * a * halfAlong + nx * b * halfPerp)},${Y(cy0 + dir[1] * a * halfAlong + ny * b * halfPerp)}`).join(' ');
      el.push(`<polygon points="${cor}" fill="#33415522" stroke="#334155" stroke-width="1.2"/>`);
    } else {
      el.push(`<line x1="${X(p[0] - nx * (hw + 300))}" y1="${Y(p[1] - ny * (hw + 300))}" x2="${X(p[0] + nx * (hw + 300))}" y2="${Y(p[1] + ny * (hw + 300))}" stroke="#334155" stroke-width="1.6" stroke-dasharray="3 3"/>`);
    }
    const tag = st2.type === 'culvert' ? 'CULV' : st2.type === 'catch_basin' ? 'CB' : 'EJ';
    el.push(`<text x="${X(cx0 + nx * (halfPerp + 700))}" y="${Y(cy0 + ny * (halfPerp + 700))}" font-size="8.5" font-weight="700" fill="#334155" font-family="sans-serif">${tag} STA ${staLabel(st2.sta)}</text>`);
  }
  // 매치라인(③) — 윈도 경계
  for (const [s, present] of [[s0, s0 > 0], [s1, s1 < total]]) {
    if (!present) continue;
    const { p, dir } = chainAt(elements, s);
    const nx = -dir[1], ny = dir[0];
    el.push(`<line x1="${X(p[0] - nx * (hw + 2000))}" y1="${Y(p[1] - ny * (hw + 2000))}" x2="${X(p[0] + nx * (hw + 2000))}" y2="${Y(p[1] + ny * (hw + 2000))}" stroke="#0f172a" stroke-width="1.6" stroke-dasharray="10 6"/>`);
    el.push(`<text x="${X(p[0] + nx * (hw + 2300))}" y="${Y(p[1] + ny * (hw + 2300))}" font-size="9.5" font-weight="700" font-family="sans-serif">MATCH LINE STA ${staLabel(s)}</text>`);
  }
  el.push(scaleBarSvg(M, M + Dm * S + 40, S, Math.max(Wm, Dm)));
  el.push(northSvg(M + Wm * S + 30, M - 16));
  const title = sheetCount > 0 ? `선형 평면도 — 시트 ${sheetNo}/${sheetCount} · STA ${staLabel(s0)}~${staLabel(s1)}` : `선형 평면도 (연장 ${fmtLen(total)} · 측점 ${fmtLen(step)} 간격)`;
  const svg = `<svg viewBox="0 0 ${M + Wm * S + 90} ${M + Dm * S + 66}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff"><text x="${M}" y="24" font-size="13" font-weight="700" font-family="sans-serif">${title} · SCALE 1:${N}(A3)</text>${el.join('')}
<text x="${M}" y="${(M + Dm * S + 58).toFixed(1)}" font-size="8.5" fill="#64748b" font-family="sans-serif">${esc(al.note ?? '')}</text></svg>`;
  return { svg, N, S, s0, s1 };
}

/** ③ 시트 분할 계획 — 전체도 + 상세 시트 n장(≤6, 반개구간 윈도·match line). */
function alignmentSheetPlan(assembly) {
  const al = assembly.alignment;
  if (!al?.elements?.length) return null;
  const full = alignmentPlanSvg(assembly);
  const total = al.totalMm;
  const DETAIL = [100, 200, 250, 500, 1000, 2500, 5000];
  const Nd = DETAIL.find((n) => Math.ceil(total / (360 * n)) <= 6) ?? DETAIL[DETAIL.length - 1];
  const cover = 360 * Nd;
  const count = Math.ceil(total / cover);
  const details = [];
  if (count > 1) {
    // 2패스: ①윈도별 fit 실측 → ②전 시트 동일 축척(fixedN=최대 표준·fixedS=최소 fit)으로
    // 재렌더 — 잔여 구간 시트만 축척이 튀는 불일치 방지(도면집 관례=상세 동일 축척)
    const probe = [];
    for (let i = 0; i < count; i++) {
      const d = alignmentPlanSvg(assembly, { staFrom: i * cover, staTo: Math.min(total, (i + 1) * cover), sheetNo: i + 1, sheetCount: count });
      if (d) probe.push({ i, d });
    }
    const Nuni = Math.max(...probe.map((q) => q.d.N));
    const Suni = Math.min(...probe.map((q) => q.d.S));
    for (const { i } of probe) {
      const d = alignmentPlanSvg(assembly, { staFrom: i * cover, staTo: Math.min(total, (i + 1) * cover), sheetNo: i + 1, sheetCount: count, fixedN: Nuni, fixedS: Suni });
      if (d) details.push(d);
    }
  }
  return { full, details };
}

/**
 * §2-1~2-4 토목 선형 도면집(시트 팩) — sheetRegistry(도번 단일 부여)·표제란(REV 스탬프
 * 대기 span)·도면 목록표·일반주기(실행된 계산기 refs 만 — 근거 없는 일반문구 금지)·
 * 페이지 분리(@media print). 역방향 게이트는 packageConsistencyCheck 가 data-dwg /
 * data-sta-from/to 를 재파싱해 대조(생성≠검증).
 */
// §후속 ⑤ EN 도면 라벨 — 시트명·표두·표제란만 이원화(본문 상세 주기=KO 유지 명시). 시트명 키.
const SHEET_EN = {
  '도면 목록표': 'Drawing List', '일반배치도(GA)': 'General Arrangement', '선형 평면 전체도': 'Alignment Plan (Overall)',
  '곡선표': 'Curve Table', '구조물 일람표': 'Structure Schedule', '종단면도': 'Profile', '토공량·유토곡선': 'Earthwork & Mass Haul',
  '일반주기': 'General Notes',
  '거더 배치 평면도': 'Girder Layout Plan', '표준 횡단면도': 'Typical Cross Section', '거더 일람표': 'Girder Schedule',
  '철근 물량표(BBS)': 'Bar Bending Schedule',
  '검측 체크리스트(참고 서식)': 'Inspection Checklist (reference)',
};
function civilSheetPack(assembly, { mainScaleN, revHistory = null, lang = 'ko' } = {}) {
  const en = lang === 'en';
  const T = (ko2) => (en ? (SHEET_EN[ko2] ?? ko2) : ko2);
  const al = assembly.alignment;
  const used = [];
  const reg = [];
  const seqByCode = {};
  const nextDwg = (code) => { seqByCode[code] = (seqByCode[code] ?? 0) + 1; return `NX-CIV-${code}-${String(seqByCode[code]).padStart(2, '0')}`; };
  const sections = [];
  const addSheet = (code, name, scaleTxt, body, attrs = '') => {
    const no = nextDwg(code);
    reg.push({ no, name, scaleTxt });
    sections.push(`<section class="sheet-page" data-dwg="${no}"${attrs}><div class="wrap">${body}</div><div class="tb">${en ? 'DWG' : '도번'} <b>${no}</b> · ${esc(T(name))} · ${esc(scaleTxt)} · REV <span class="nf-rev">—</span></div></section>`);
    return no;
  };
  // 메인 GA 시트(본문에서 렌더) — 도번은 여기(단일 부여처)서
  const mainDwg = nextDwg('GA');
  reg.push({ no: mainDwg, name: '일반배치도(GA)', scaleTxt: `1:${mainScaleN}` });
  const plan = alignmentSheetPlan(assembly);
  if (plan) {
    addSheet('PL', '선형 평면 전체도', `1:${plan.full.N}`, plan.full.svg);
    plan.details.forEach((d, i) => addSheet('PL', `선형 평면 상세 ${i + 1} (STA ${staLabel(d.s0)}~${staLabel(d.s1)})`, `1:${d.N}`, d.svg, ` data-sta-from="${Math.round(d.s0)}" data-sta-to="${Math.round(d.s1)}"`));
  }
  const ctBody = curveTableSheet(al);
  if (ctBody) addSheet('CT', '곡선표', '—', ctBody);
  const stBody = structureTableSheet(al, used);
  if (stBody) addSheet('ST', '구조물 일람표', '—', stBody);
  const pfBody = profileSvg(assembly);
  if (pfBody) addSheet('PF', '종단면도', '종 10× 왜곡(시트 명기)', pfBody);
  // §B 횡단면도(XS) — 표준횡단 + 계획고 변곡점별 대표 STA(상한 8, 초과=등간격 대표 명시).
  // 벽고=종단 계획고와 동일 소스(profile.design) — 정합 8번째 축. RW 안정 시트와 STA 공유.
  if (assembly.retainingWall) {
    const rw = assembly.retainingWall;
    const dsg = assembly.profile?.design ?? [];
    let xsStas = [...new Set(dsg.map((q) => Math.max(0, Math.min(al.totalMm, q.staMm))))].sort((a, b) => a - b);
    let xsNote = '';
    if (xsStas.length > 8) { const stp = Math.ceil(xsStas.length / 8); xsStas = xsStas.filter((_, i) => i % stp === 0).slice(0, 8); xsNote = ' · 변곡점 8+ — 등간격 대표 추출(명시)'; }
    const elevAt = (sMm) => {
      for (let i = 1; i < dsg.length; i++) if (sMm <= dsg[i].staMm + EPS_XS) {
        const a = dsg[i - 1], b = dsg[i];
        const t = (sMm - a.staMm) / Math.max(1e-9, b.staMm - a.staMm);
        return a.elevMm + (b.elevMm - a.elevMm) * Math.max(0, Math.min(1, t));
      }
      return dsg[dsg.length - 1]?.elevMm ?? rw.H * 1000;
    };
    const unit = (mm) => `${fmtLen(mm)}${Math.abs(mm) < 10000 ? ' mm' : ''}`; // <10m 표기 단위 명시
    const bodies = xsStas.map((sMm) => {
      const Hmm = elevAt(sMm);
      const svg = retainingWallSectionSvg({ H: Hmm, baseWidth: rw.baseWidth * 1000, baseThickness: rw.baseThickness * 1000, stemThickness: rw.stemThickness * 1000, toeLength: rw.toeLength * 1000 });
      return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:320px"><div style="font-size:11.5px;font-weight:700">STA ${staLabel(sMm)} · H=${unit(Hmm)}</div>${svg}</div>`;
    }).join('');
    addSheet('XS', `횡단면도 (대표 ${xsStas.length}단면${xsNote})`, '단면별 자동', `<div>${bodies}</div><div style="font-size:10px;color:#94a3b8">벽고=종단 계획고 동일 소스(profile.design 보간) · 치수 단위 mm(1만 이상 자동 m/km) · 배근 상세 후속</div>`);
    // 옹벽 안정 검토 시트(잔여후보 ①) — XS 대표 STA 와 동일 단면에 retaining_wall_stability
    // (KDS 11 80 05 Rankine 의무조항) 자동 실행. 지반 정수(γ·φ·μ·qa)=입력 원칙(soil 미입력=정직 게이트).
    const soil = assembly.soil;
    const need = ['gammaBackfill', 'phiBackfill', 'baseFriction', 'allowableBearing'].filter((k) => !(Number(soil?.[k]) > 0));
    if (need.length) {
      addSheet('RW', '옹벽 안정 검토 — 입력 대기', '—', `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400e">
지반 정수 입력 필요(기본값 날조 금지 — 정직 생략): <b>soil { ${need.join(', ')} }</b><br>
입력 시 XS 대표 ${xsStas.length}단면 각각에 전도·활동·지지력 FS(KDS 11 80 05 표 4.4-1)를 자동 검토합니다. 고급 입력(JSON)의 "soil" 키로 전달.</div>`);
    } else {
      used.push('retaining_wall_stability');
      const rows = xsStas.map((sMm) => {
        const Hm = elevAt(sMm) / 1000;
        try {
          const r = runCalculator('retaining_wall_stability', {
            H: Hm, stemThickness: rw.stemThickness, baseWidth: rw.baseWidth, baseThickness: rw.baseThickness, toeLength: rw.toeLength,
            gammaBackfill: +soil.gammaBackfill, phiBackfill: +soil.phiBackfill, baseFriction: +soil.baseFriction, allowableBearing: +soil.allowableBearing,
            ...(Number(soil.surcharge) >= 0 ? { surcharge: +soil.surcharge } : {}),
          });
          const c = r.checks ?? {};
          const fs = (k) => c[k]?.FS != null ? Number(c[k].FS).toFixed(2) : '—';
          const V = r.verdict === 'PASS' ? '<b style="color:#16a34a">PASS</b>' : `<b style="color:#dc2626">${esc(r.verdict ?? 'FAIL')}</b>`;
          return `<tr><td>STA ${staLabel(sMm)}</td><td>${(Hm).toFixed(2)} m</td><td>${fs('overturning')}</td><td>${fs('sliding')}</td><td>${fs('bearing') !== '—' ? fs('bearing') : (c.bearing?.qmax_kPa != null ? Number(c.bearing.qmax_kPa).toFixed(0) + ' kPa' : '—')}</td><td>${V}</td></tr>`;
        } catch (e) { return `<tr><td>STA ${staLabel(sMm)}</td><td>${Hm.toFixed(2)} m</td><td colspan="4" style="text-align:left;color:#92400e">판정 불가: ${esc(String(e?.message ?? e).slice(0, 70))}</td></tr>`; }
      }).join('');
      addSheet('RW', `옹벽 안정 검토 (대표 ${xsStas.length}단면 — KDS 11 80 05)`, '—', `<table style="border-collapse:collapse;width:100%;font-size:11.5px">
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">측점</th><th style="border:1px solid #cbd5e1;padding:3px 8px">벽고 H</th><th style="border:1px solid #cbd5e1;padding:3px 8px">전도 FS</th><th style="border:1px solid #cbd5e1;padding:3px 8px">활동 FS</th><th style="border:1px solid #cbd5e1;padding:3px 8px">지지력</th><th style="border:1px solid #cbd5e1;padding:3px 8px">판정</th></tr>${rows.replaceAll('<td>', '<td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">')}</table>
<div style="font-size:10px;color:#94a3b8;padding:3px 0">Rankine 주동토압(KDS 11 80 05 §1.7.3(2) 의무조항) · 기준 FS=표 4.4-1(활동 1.5·전도 2.0·지지력 3.0) · 지반 정수=입력값(γ=${soil.gammaBackfill}·φ=${soil.phiBackfill}°·μ=${soil.baseFriction}·qa=${soil.allowableBearing}kPa) · 단면=XS 와 동일 소스</div>`);
    }
  }
  const ewBody = earthworkSheet(assembly, used);
  if (ewBody) addSheet('EW', '토공량·유토곡선', '—', ewBody);
  // 철근 물량표(BBS, Wave 3) — rebar 입력 시만(배근=입력 원칙, 자동 설계 아님)
  if (assembly.rebar && assembly.retainingWall) {
    const bb = rebarBBS(assembly.retainingWall, assembly.rebar);
    if (bb.ok) {
      const td = (v, alignL) => `<td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:${alignL ? 'left' : 'center'}">${v}</td>`;
      const rws = bb.rows.map((q) => `<tr>${td(q.loc, 1)}${td('D' + q.dia)}${td('@' + q.spacingMm)}${td(q.count)}${td(q.lenM.toFixed(2))}${td(q.totalM.toFixed(1))}${td(q.unitKgM.toFixed(3))}${td(q.kg.toFixed(1))}</tr>`).join('');
      addSheet('RB', '철근 물량표(BBS)', '—', `<table style="border-collapse:collapse;width:100%;font-size:11.5px">
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">부위</th><th style="border:1px solid #cbd5e1;padding:3px 8px">호칭</th><th style="border:1px solid #cbd5e1;padding:3px 8px">간격</th><th style="border:1px solid #cbd5e1;padding:3px 8px">본수/단수</th><th style="border:1px solid #cbd5e1;padding:3px 8px">1본 길이(m)</th><th style="border:1px solid #cbd5e1;padding:3px 8px">총길이(m)</th><th style="border:1px solid #cbd5e1;padding:3px 8px">단중(kg/m)</th><th style="border:1px solid #cbd5e1;padding:3px 8px">중량(kg)</th></tr>${rws}
<tr style="background:#f8fafc;font-weight:700"><td colspan="7" style="border:1px solid #cbd5e1;padding:3px 8px;text-align:right">합계</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${bb.totalKg.toFixed(1)}</td></tr></table>
<div style="font-size:10px;color:#94a3b8;padding:3px 0">${bb.notes.map((n) => esc(n)).join(' · ')}</div>`);
    } else {
      addSheet('RB', '철근 물량표(BBS) — 입력 대기', '—', `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:8px 14px;font-size:11.5px;color:#92400e">${bb.errors.map((n) => esc(n)).join('<br>')}</div>`);
    }
  }
  // ── Wave 4 시공 문서(비법정 — 시공계획·발주처 양식이 정본임을 명시) ──
  const con = assembly.construction;
  if (con && Number(con.pourCapacityM3PerDay) > 0 && Array.isArray(assembly.civilTakeoff)) {
    try {
      const to = takeoffRules(assembly.civilTakeoff);
      const totalC = (to.boq ?? []).find((q) => q.item.includes('구체'))?.qty ?? 0;
      if (totalC > 0) {
        const cap = Number(con.pourCapacityM3PerDay);
        const n = Math.max(1, Math.ceil(totalC / cap));
        const per = al.totalMm / n;
        const tdp = (v) => `<td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${v}</td>`;
        const rws = Array.from({ length: n }, (_, i) => `<tr>${tdp(i + 1)}${tdp(`STA ${staLabel(i * per)} ~ ${staLabel(Math.min(al.totalMm, (i + 1) * per))}`)}${tdp((totalC / n).toFixed(1))}${tdp(i < n - 1 ? `STA ${staLabel((i + 1) * per)}` : '—')}</tr>`).join('');
        addSheet('PO', `타설 분할 계획 (구체 ${totalC.toFixed(1)}㎥ · ${n}회)`, '—', `<table style="border-collapse:collapse;width:100%;font-size:11.5px">
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">회차</th><th style="border:1px solid #cbd5e1;padding:3px 8px">구간</th><th style="border:1px solid #cbd5e1;padding:3px 8px">물량(㎥)</th><th style="border:1px solid #cbd5e1;padding:3px 8px">시공이음(제안)</th></tr>${rws}</table>
<div style="font-size:10px;color:#94a3b8;padding:3px 0">1일 타설능력 ${cap}㎥=입력값 · 구간 물량=연장 등분(등단면 근사 명시 — 벽고 변화 시 재배분 필요) · 시공이음 위치=제안(확정=시공계획·감리 협의) · 비법정 참고</div>`);
      }
    } catch { /* 룰 실패=시트 생략 */ }
  }
  if (con && con.inspectionChecklist) {
    const IC_ROWS = [
      ['터파기', '기초 지반 확인(지내력·이토 제거)·터파기 깊이/폭·배수 상태'],
      ['버림 콘크리트', '두께·평탄성·먹매김 확인'],
      ['배근', '호칭·간격·피복·이음 위치/길이·결속 상태(BBS 시트 대조)'],
      ['거푸집', '치수·수직도·박리제·긴결재·청소 상태'],
      ['콘크리트 타설', '호칭강도 송장 확인·슬럼프·다짐·시공이음 처리·타설 높이'],
      ['양생', '양생 방법·기간·초기 동해/급건조 방지'],
      ['되메우기', '뒤채움 재료·다짐(층다짐 두께)·배수공(유공관·배수구) 설치'],
    ];
    const tdi = (v, l) => `<td style="border:1px solid #cbd5e1;padding:4px 8px;text-align:${l ? 'left' : 'center'}">${v}</td>`;
    const rws = IC_ROWS.map(([a, b]) => `<tr>${tdi(a)}${tdi(b, 1)}${tdi('□')}${tdi('')}</tr>`).join('');
    addSheet('IC', '검측 체크리스트(참고 서식)', '—', `<table style="border-collapse:collapse;width:100%;font-size:11.5px">
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">공종</th><th style="border:1px solid #cbd5e1;padding:3px 8px">검측 항목(관례)</th><th style="border:1px solid #cbd5e1;padding:3px 8px">확인</th><th style="border:1px solid #cbd5e1;padding:3px 8px">비고</th></tr>${rws}</table>
<div style="font-size:10px;color:#94a3b8;padding:3px 0">참고 서식(관례 항목) — 발주처·감리 지정 검측 양식이 정본이며 본 서식은 대체하지 않음 · 항목별 기준값은 시방서 확인</div>`);
  }
  addSheet('GN', '일반주기', '—', generalNotesSheet(used));
  // 도면 목록표 — 레지스트리에서 직접 생성(맨 앞 배치), 자기 자신 포함
  const dlNo = nextDwg('DL');
  reg.unshift({ no: dlNo, name: '도면 목록표', scaleTxt: '—' });
  const dlRows = reg.map((r, i) => `<tr><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${i + 1}</td><td style="border:1px solid #cbd5e1;padding:3px 8px">${r.no}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:left">${esc(T(r.name))}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${esc(r.scaleTxt)}</td></tr>`).join('');
  // REV 이력표(§후속 ④) — 이력=입력 원칙(options.revHistory, 날짜·사유 날조 금지) + 현재 REV 행 자동
  const revRows = (Array.isArray(revHistory) ? revHistory : [])
    .map((r) => `<tr><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${esc(String(r.rev ?? ''))}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${esc(String(r.date ?? ''))}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:left">${esc(String(r.note ?? ''))}</td></tr>`).join('')
    + `<tr style="background:#f8fafc"><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center"><span class="nf-rev">—</span></td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${en ? 'current' : '현재'}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:left">${en ? 'This issue (auto)' : '본 발행(자동)'}</td></tr>`;
  const revTable = `<table style="border-collapse:collapse;width:60%;font-size:11px;margin-top:10px"><caption style="text-align:left;font-size:12px;font-weight:700;padding:3px 0">${en ? 'Revision History' : '개정 이력'} ${Array.isArray(revHistory) && revHistory.length ? '' : en ? '(no prior issues supplied)' : '(이전 발행 이력 미입력 — 입력 원칙)'}</caption>
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">REV</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'Date' : '일자'}</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'Description' : '내용'}</th></tr>${revRows}</table>`;
  const dlBody = `<table style="border-collapse:collapse;width:100%;font-size:11.5px"><caption style="text-align:left;font-size:13px;font-weight:700;padding:4px 0">${en ? `Drawing List (${reg.length} sheets · single REV — consistency-gated)` : `도면 목록표 (총 ${reg.length}매 · 전 시트 동일 REV — 자동 정합 게이트 대상)`}</caption>
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">No.</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'DWG No.' : '도번'}</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'Title' : '도면명'}</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'Scale' : '축척'}</th></tr>${dlRows}</table>${revTable}${en ? '<div style="font-size:10px;color:#94a3b8;padding:4px 0">Sheet titles/headers in EN — detailed notes remain KO (bilingual full pass = follow-up).</div>' : ''}`;
  const dlSection = `<section class="sheet-page" data-dwg="${dlNo}"><div class="wrap">${dlBody}</div><div class="tb">도번 <b>${dlNo}</b> · 도면 목록표 · REV <span class="nf-rev">—</span></div></section>`;
  return { html: dlSection + sections.join(''), mainDwg, sheetCount: reg.length };
}

/** 교량 시트팩(260717 배터리 갭 해소) — 거더교: 목록표·거더 배치 평면·표준 횡단·일람표·일반주기.
 *  전 수치=bridgeMeta(결정론 템플릿 단일 소스). 단면=관례 비례(명시) — 구조검토는 eng-core 교량 체인 후속. */
function bridgeSheetPack(assembly, { mainScaleN, revHistory = null, lang = 'ko' } = {}) {
  const bm = assembly.bridgeMeta;
  if (!bm) return null;
  const en = lang === 'en';
  const T = (ko2) => (en ? (SHEET_EN[ko2] ?? ko2) : ko2);
  const reg = [];
  const seqByCode = {};
  const nextDwg = (code) => { seqByCode[code] = (seqByCode[code] ?? 0) + 1; return `NX-BRG-${code}-${String(seqByCode[code]).padStart(2, '0')}`; };
  const sections = [];
  const addSheet = (code, name, scaleTxt, body) => {
    const no = nextDwg(code);
    reg.push({ no, name, scaleTxt });
    sections.push(`<section class="sheet-page" data-dwg="${no}"><div class="wrap">${body}</div><div class="tb">${en ? 'DWG' : '도번'} <b>${no}</b> · ${esc(T(name))} · ${esc(scaleTxt)} · REV <span class="nf-rev">—</span></div></section>`);
  };
  const mainDwg = nextDwg('GA');
  reg.push({ no: mainDwg, name: '일반배치도(GA)', scaleTxt: `1:${mainScaleN}` });
  const { span, nGirders: n, girderSpacing: s, girderH: Hg, deckThk: dt, overhang: oh, deckW, section: sec } = bm;

  // ── PL 거더 배치 평면(축선) ──
  {
    const M = 70, Wm = span, Dm = deckW;
    const S = Math.min(760 / Wm, 380 / Dm);
    const N = pickScale(Wm, Dm, 360, 200);
    const X = (v) => (M + v * S).toFixed(1), Y = (v) => (M + v * S).toFixed(1);
    const el = [];
    el.push(`<rect x="${X(0)}" y="${Y(0)}" width="${(span * S).toFixed(1)}" height="${(deckW * S).toFixed(1)}" fill="none" stroke="#0f172a" stroke-width="1.4"/>`);
    for (let i = 0; i < n; i++) {
      const gy = oh + i * s;
      el.push(`<line x1="${X(0)}" y1="${Y(gy)}" x2="${X(span)}" y2="${Y(gy)}" stroke="#dc2626" stroke-width="1" stroke-dasharray="14 4 3 4"/>`);
      el.push(`<text x="${X(span) - 2}" y="${(+Y(gy) - 3).toFixed(1)}" font-size="8.5" text-anchor="end" fill="#dc2626" font-family="sans-serif">G${i + 1}</text>`);
    }
    for (const gx of [0, span / 2 - 150, span - 300]) for (let i = 0; i < n - 1; i++) {
      el.push(`<rect x="${X(gx)}" y="${Y(oh + i * s + 100)}" width="${(300 * S).toFixed(1)}" height="${((s - 200) * S).toFixed(1)}" fill="#94a3b822" stroke="#64748b" stroke-width=".8"/>`);
    }
    el.push(`<line x1="${X(0)}" y1="${(+Y(deckW) + 18).toFixed(1)}" x2="${X(span)}" y2="${(+Y(deckW) + 18).toFixed(1)}" stroke="#dc2626" stroke-width=".6"/><text x="${(+X(0) + +X(span)) / 2}" y="${(+Y(deckW) + 15).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="#dc2626" font-family="sans-serif">${fmtLen(span)} (지간 CL)</text>`);
    el.push(`<line x1="${(+X(0) - 18).toFixed(1)}" y1="${Y(0)}" x2="${(+X(0) - 18).toFixed(1)}" y2="${Y(oh)}" stroke="#dc2626" stroke-width=".6"/><text x="${(+X(0) - 24).toFixed(1)}" y="${(+Y(oh / 2) + 3).toFixed(1)}" font-size="8" text-anchor="end" fill="#dc2626" font-family="sans-serif">${Math.round(oh)}</text>`);
    if (n > 1) el.push(`<line x1="${(+X(0) - 18).toFixed(1)}" y1="${Y(oh)}" x2="${(+X(0) - 18).toFixed(1)}" y2="${Y(oh + s)}" stroke="#dc2626" stroke-width=".6"/><text x="${(+X(0) - 24).toFixed(1)}" y="${(+Y(oh + s / 2) + 3).toFixed(1)}" font-size="8" text-anchor="end" fill="#dc2626" font-family="sans-serif">${Math.round(s)}</text>`);
    el.push(scaleBarSvg(M, +Y(deckW) + 34, S, Math.max(Wm, Dm)));
    const svg = `<svg viewBox="0 0 ${M + Wm * S + 60} ${M + Dm * S + 80}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">
<text x="${M}" y="22" font-size="13" font-weight="700" font-family="sans-serif">${esc(T('거더 배치 평면도'))} · SCALE 1:${N}(A3)</text>${el.join('')}
<text x="${M}" y="${(M + Dm * S + 72).toFixed(1)}" font-size="8.5" fill="#64748b" font-family="sans-serif">거더 ${n}본 @${Math.round(s)}mm · 내민 ${Math.round(oh)}mm · 가로보 3열(단부 2·중앙 1) · 축선=거더 중심(일점쇄선)</text></svg>`;
    addSheet('PL', '거더 배치 평면도', `1:${N}`, svg);
  }

  // ── XS 표준 횡단면(정밀 I형 단면 — bridgeMeta.section 동일 소스) ──
  {
    const M = 70, Wm = deckW, Hm = Hg + dt;
    const S = Math.min(760 / Wm, 360 / Hm);
    const N = pickScale(Wm, Hm, 360, 180);
    const X = (v) => (M + v * S).toFixed(1);
    const Yv = (z) => (30 + (Hm - z) * S).toFixed(1); // z=0 거더 하단, 위로 증가
    const el = [];
    el.push(`<rect x="${X(0)}" y="${Yv(Hm)}" width="${(deckW * S).toFixed(1)}" height="${(dt * S).toFixed(1)}" fill="#cbd5e155" stroke="#0f172a" stroke-width="1.2"/>`);
    const iPoly = (c) => {
      const { topW, topT, webT, webH, botW, botT } = sec;
      const p = [
        [c - topW / 2, Hg], [c + topW / 2, Hg], [c + topW / 2, Hg - topT], [c + webT / 2, Hg - topT],
        [c + webT / 2, botT], [c + botW / 2, botT], [c + botW / 2, 0], [c - botW / 2, 0],
        [c - botW / 2, botT], [c - webT / 2, botT], [c - webT / 2, Hg - topT], [c - topW / 2, Hg - topT],
      ];
      return p.map(([x, z]) => `${X(x)},${Yv(z)}`).join(' ');
    };
    for (let i = 0; i < n; i++) el.push(`<polygon points="${iPoly(oh + i * s)}" fill="#e2e8f0" stroke="#0f172a" stroke-width="1"/>`);
    el.push(`<line x1="${X(0)}" y1="${(+Yv(0) + 16).toFixed(1)}" x2="${X(deckW)}" y2="${(+Yv(0) + 16).toFixed(1)}" stroke="#dc2626" stroke-width=".6"/><text x="${(+X(0) + +X(deckW)) / 2}" y="${(+Yv(0) + 13).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="#dc2626" font-family="sans-serif">${fmtLen(deckW)}</text>`);
    el.push(`<line x1="${(+X(deckW) + 14).toFixed(1)}" y1="${Yv(0)}" x2="${(+X(deckW) + 14).toFixed(1)}" y2="${Yv(Hg)}" stroke="#dc2626" stroke-width=".6"/><text x="${(+X(deckW) + 24).toFixed(1)}" y="${(+Yv(Hg / 2) + 3).toFixed(1)}" font-size="8.5" fill="#dc2626" font-family="sans-serif">H=${Math.round(Hg)}</text>`);
    el.push(`<line x1="${(+X(deckW) + 14).toFixed(1)}" y1="${Yv(Hg)}" x2="${(+X(deckW) + 14).toFixed(1)}" y2="${Yv(Hm)}" stroke="#dc2626" stroke-width=".6"/><text x="${(+X(deckW) + 24).toFixed(1)}" y="${(+Yv(Hg + dt / 2) + 3).toFixed(1)}" font-size="8.5" fill="#dc2626" font-family="sans-serif">t=${Math.round(dt)}</text>`);
    const svg = `<svg viewBox="0 0 ${M + Wm * S + 120} ${60 + Hm * S + 60}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">
<text x="${M}" y="20" font-size="13" font-weight="700" font-family="sans-serif">${esc(T('표준 횡단면도'))} · SCALE 1:${N}(A3)</text>${el.join('')}
<text x="${M}" y="${(60 + Hm * S + 48).toFixed(1)}" font-size="8.5" fill="#64748b" font-family="sans-serif">I형 단면=관례 비례(상부폭 0.35H·하부 0.30H·플랜지 0.12H·복부 max(200, 0.10H)) — 구조 단면은 설계검토로 확정(비법정)</text></svg>`;
    addSheet('XS', '표준 횡단면도', `1:${N}`, svg);
  }

  // ── ST 거더 일람표 ──
  {
    const td = (v) => `<td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${v}</td>`;
    const rows = Array.from({ length: n }, (_, i) => `<tr>${td(`G${i + 1}`)}${td(fmtLen(span))}${td(Math.round(Hg))}${td(Math.round(s))}${td(`${sec.topW}/${sec.botW}`)}${td(`${sec.topT}/${sec.webT}`)}${td('concrete')}</tr>`).join('');
    addSheet('ST', '거더 일람표', '—', `<table style="border-collapse:collapse;width:100%;font-size:11.5px">
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">거더</th><th style="border:1px solid #cbd5e1;padding:3px 8px">지간</th><th style="border:1px solid #cbd5e1;padding:3px 8px">춤 H(mm)</th><th style="border:1px solid #cbd5e1;padding:3px 8px">간격(mm)</th><th style="border:1px solid #cbd5e1;padding:3px 8px">플랜지폭 상/하</th><th style="border:1px solid #cbd5e1;padding:3px 8px">플랜지t/복부t</th><th style="border:1px solid #cbd5e1;padding:3px 8px">재질</th></tr>${rows}</table>
<div style="font-size:10px;color:#94a3b8;padding:3px 0">가로보 ${3 * (n - 1)}개(3열×${n - 1}) 300×${Math.round(Hg * 0.6)} · 바닥판 t${Math.round(dt)}·폭 ${fmtLen(deckW)} · 전 수치=bridgeMeta 단일 소스 · 분배계수·받침·내진 검토=eng-core 교량 계산기 체인(별도 실행)</div>`);
  }
  addSheet('GN', '일반주기', '—', generalNotesSheet([]));
  // DL 목록표 + 개정 이력(civil 과 동일 규약 — 정합 게이트 공용)
  const dlNo = nextDwg('DL');
  reg.unshift({ no: dlNo, name: '도면 목록표', scaleTxt: '—' });
  const dlRows = reg.map((r, i) => `<tr><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${i + 1}</td><td style="border:1px solid #cbd5e1;padding:3px 8px">${r.no}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:left">${esc(T(r.name))}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${esc(r.scaleTxt)}</td></tr>`).join('');
  const revRows = (Array.isArray(revHistory) ? revHistory : [])
    .map((r) => `<tr><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${esc(String(r.rev ?? ''))}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${esc(String(r.date ?? ''))}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:left">${esc(String(r.note ?? ''))}</td></tr>`).join('')
    + `<tr style="background:#f8fafc"><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center"><span class="nf-rev">—</span></td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${en ? 'current' : '현재'}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:left">${en ? 'This issue (auto)' : '본 발행(자동)'}</td></tr>`;
  const dlBody = `<table style="border-collapse:collapse;width:100%;font-size:11.5px"><caption style="text-align:left;font-size:13px;font-weight:700;padding:4px 0">${en ? `Drawing List (${reg.length} sheets · single REV — consistency-gated)` : `도면 목록표 (총 ${reg.length}매 · 전 시트 동일 REV — 자동 정합 게이트 대상)`}</caption>
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">No.</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'DWG No.' : '도번'}</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'Title' : '도면명'}</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'Scale' : '축척'}</th></tr>${dlRows}</table>
<table style="border-collapse:collapse;width:60%;font-size:11px;margin-top:10px"><caption style="text-align:left;font-size:12px;font-weight:700;padding:3px 0">${en ? 'Revision History' : '개정 이력'}</caption>
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">REV</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'Date' : '일자'}</th><th style="border:1px solid #cbd5e1;padding:3px 8px">${en ? 'Description' : '내용'}</th></tr>${revRows}</table>`;
  const dlSection = `<section class="sheet-page" data-dwg="${dlNo}"><div class="wrap">${dlBody}</div><div class="tb">${en ? 'DWG' : '도번'} <b>${dlNo}</b> · ${esc(T('도면 목록표'))} · REV <span class="nf-rev">—</span></div></section>`;
  return { html: dlSection + sections.join(''), mainDwg, sheetCount: reg.length };
}

/** §2-4 일반주기 — 실행된 계산기의 refs(원문 조항)만 수집·정렬(근거 없는 일반문구 금지). */
function generalNotesSheet(usedIds) {
  const refs = new Set();
  for (const id of usedIds) for (const r of calculators[id]?.refs ?? []) refs.add(r);
  const rows = [...refs].sort().map((r) => `<li style="margin:2px 0">${esc(r)}</li>`).join('');
  return `<div><div style="font-size:13px;font-weight:700;padding:4px 0">일반주기 (General Notes)</div>
<ol style="font-size:11.5px;line-height:1.7;padding-left:18px">
<li>본 도면집은 nexyfab drawing-to-3d 가 단일 어셈블리 정의에서 자동 생성 — 전 시트 동일 REV(정합 게이트 검증).</li>
<li>비법정 개념 설계 — 최종 설계도서·시공에는 등록 기술자(해당 분야 기술사) 검토·확인 필요.</li>
<li>물량·측점=중심선 호장 기준 · 3D=현 근사(새그 공차) · 곡선=원곡선+클로소이드(폐합 자기검증).</li>
${rows ? `<li>적용 기준(실행된 검증 계산기의 원문 근거만 수록):<ul style="padding-left:16px">${rows}</ul></li>` : '<li>본 도면집 생성 시 실행된 검증 계산기 없음 — 적용 기준 목록 생략(근거 없는 인용 금지).</li>'}
</ol></div>`;
}

/** ④ 부지 계획도 블록 — siteBoundary/contours 입력 시만 별도 시트(조경·비선형 토목용). */
function siteOverlayBlock(assembly) {
  const boundary = assembly.siteBoundary, contours = assembly.contours ?? [];
  const has = (Array.isArray(boundary) && boundary.length >= 3) || contours.some((c) => Array.isArray(c.pts) && c.pts.length >= 2);
  if (!has) return '';
  const pts = (Array.isArray(boundary) ? boundary : []).concat(contours.flatMap((c) => c.pts ?? []));
  const x0 = Math.min(...pts.map((p) => p[0])) - 2000, x1 = Math.max(...pts.map((p) => p[0])) + 2000;
  const y0 = Math.min(...pts.map((p) => p[1])) - 2000, y1 = Math.max(...pts.map((p) => p[1])) + 2000;
  const Wm = Math.max(1, x1 - x0), Dm = Math.max(1, y1 - y0);
  const M = 60;
  const S = Math.min(760 / Wm, 430 / Dm);
  const N = pickScale(Wm, Dm, 360, 230);
  const X = (v) => (M + (v - x0) * S).toFixed(1);
  const Y = (v) => (M + (y1 - v) * S).toFixed(1);
  return `<svg viewBox="0 0 ${M + Wm * S + 70} ${M + Dm * S + 60}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">
<text x="${M}" y="24" font-size="13" font-weight="700" font-family="sans-serif">부지 계획도 · SCALE 1:${N}(A3)</text>
${siteOverlaySvg(X, Y, { boundary, contours })}
${scaleBarSvg(M, M + Dm * S + 36, S, Math.max(Wm, Dm))}${northSvg(M + Wm * S + 26, M - 12)}
<text x="${M}" y="${(M + Dm * S + 54).toFixed(1)}" font-size="8.5" fill="#64748b" font-family="sans-serif">경계·등고=입력 데이터 표기(측량 성과 아님·지형 미생성 — 정직)</text></svg>`;
}

/** 구조물 일람표(§1-2) — STA·종류·규격·검토. culvert=box_culvert_frame 자동 체인
 *  (cover·gammaSoil·K 미입력=needInputs 정직 게이트). 수량 룰=culvert 타입 미지원 명시(§E). */
function structureTableSheet(al, used = []) {
  if (!al?.structures?.length) return '';
  const rows = al.structures.map((st, i) => {
    const spec = st.type === 'culvert' ? `내공 ${fmtLen(st.innerWmm)}×${fmtLen(st.innerHmm)} t${st.thkMm}` : st.type === 'catch_basin' ? `${fmtLen(st.alongMm)}각 깊이 1200` : '—';
    let check = '<span style="color:#64748b">검증 미지원(마커만)</span>';
    if (st.type === 'culvert') {
      const need = ['cover', 'gammaSoil', 'K'].filter((k) => !(Number(st.params?.[k]) > 0 || Number(st.params?.[k]) === 0 && k === 'cover'));
      if (need.length) check = `<span style="color:#d97706">입력 필요: ${need.join('·')}</span>`;
      else {
        try {
          used.push('box_culvert_frame');
          const r = runCalculator('box_culvert_frame', {
            innerWidth: st.innerWmm / 1000, innerHeight: st.innerHmm / 1000, wallThk: st.thkMm / 1000,
            cover: +st.params.cover, gammaSoil: +st.params.gammaSoil, K: +st.params.K,
            ...(Number(st.params.surcharge) >= 0 ? { surcharge: +st.params.surcharge } : {}),
          });
          check = r.verdict === 'FAIL' ? '<b style="color:#dc2626">FAIL</b>' : `<b style="color:#16a34a">${esc(r.verdict ?? 'INFO')}</b> <span style="font-size:10px;color:#64748b">(box_culvert_frame)</span>`;
        } catch (e) { check = `<span style="color:#d97706">판정 불가: ${esc(String(e?.message ?? e).slice(0, 60))}</span>`; }
      }
    }
    return `<tr><td>${i + 1}</td><td>STA ${staLabel(st.sta)}</td><td>${esc(st.type)}</td><td>${spec}</td><td style="text-align:left">${check}</td></tr>`;
  }).join('');
  return `<div style="padding:6px 0"><table style="border-collapse:collapse;width:100%;font-size:11.5px"><caption style="text-align:left;font-size:13px;font-weight:700;padding:4px 0">구조물 일람표</caption>
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">No.</th><th style="border:1px solid #cbd5e1;padding:3px 8px">측점</th><th style="border:1px solid #cbd5e1;padding:3px 8px">종류</th><th style="border:1px solid #cbd5e1;padding:3px 8px">규격</th><th style="border:1px solid #cbd5e1;padding:3px 8px">검토</th></tr>${rows.replaceAll('<td>', '<td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">')}</table>
<div style="font-size:10px;color:#94a3b8;padding:3px 0">암거=벽 개구 분절(개구 명세) · 하중 입력(cover·γ·K)=프로젝트 결정(지어내지 않음) · 암거 수량=culvert 룰(BOQ 규칙 물량 — 산식 공개) · 마구리·날개벽 상세 후속</div></div>`;
}

/** 곡선표(§1-1) — IP·Δ·R·TL·L·BC/EC. 표기값 자기정합: EC 표기=원값 반올림(표기끼리 연산 금지). */
function curveTableSheet(al) {
  if (!al?.curveTable?.length) return '';
  const hasSpiral = al.curveTable.some((ct) => ct.Ls > 0);
  const rows = al.curveTable.map((ct) => {
    const base = `<tr><td>IP${ct.ip}</td><td>${Math.abs(ct.deltaDeg).toFixed(1)}° (${ct.deltaDeg > 0 ? '좌' : '우'})</td><td>${fmtLen(ct.R)}</td>`;
    if (hasSpiral) {
      return base + `<td>${ct.Ls ? fmtLen(ct.Ls) : '—'}</td><td>${ct.A ? Math.round(ct.A) : '—'}</td><td>${fmtLen(ct.TLmm)}</td><td>${fmtLen(ct.Lmm)}</td><td>${ct.TSmm != null ? staLabel(ct.TSmm) : staLabel(ct.BCmm)}</td><td>${ct.SCmm != null ? staLabel(ct.SCmm) : '—'}</td><td>${ct.CSmm != null ? staLabel(ct.CSmm) : '—'}</td><td>${ct.STmm != null ? staLabel(ct.STmm) : staLabel(ct.ECmm)}</td></tr>`;
    }
    return base + `<td>${fmtLen(ct.TLmm)}</td><td>${fmtLen(ct.Lmm)}</td><td>${staLabel(ct.BCmm)}</td><td>${staLabel(ct.ECmm)}</td></tr>`;
  }).join('');
  const head = hasSpiral
    ? '<th>IP</th><th>교각 Δ</th><th>R</th><th>Ls</th><th>A</th><th>TL</th><th>CL</th><th>TS</th><th>SC</th><th>CS</th><th>ST</th>'
    : '<th>IP</th><th>교각 Δ</th><th>R</th><th>TL</th><th>CL</th><th>BC</th><th>EC</th>';
  return `<div style="padding:6px 0"><table style="border-collapse:collapse;width:100%;font-size:11.5px"><caption style="text-align:left;font-size:13px;font-weight:700;padding:4px 0">곡선표 (${hasSpiral ? '단곡선+완화곡선(클로소이드)' : '단곡선'})</caption>
<tr style="background:#f1f5f9">${head.replaceAll('<th>', '<th style="border:1px solid #cbd5e1;padding:3px 8px">')}</tr>${rows.replaceAll('<td>', '<td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">')}</table>
<div style="font-size:10px;color:#94a3b8;padding:3px 0">TL=${hasSpiral ? '(R+p)tan(Δ/2)+k(Fresnel 급수 폐형)' : 'R·tan(Δ/2)'} · A=√(R·Ls) · STA 표기=m 반올림(원값 계산 후 반올림 — 표기끼리 연산 금지)${hasSpiral ? ' · 완화곡선 형상=정밀 폴리라인(길이오차<0.5mm·현 방위≤0.5° 명시)' : ''}</div></div>`;
}

/**
 * §1-4 토공량·유토곡선 — 지반선(파생 또는 입력) 존재 구간만. 단면=폐형
 * A=|d|·w+n·d²(양측 사면 사다리꼴), 절↔성 전환은 0점 선형보간 분할(폐형).
 * 불균등 간격 그대로 평균단면법(재샘플 금지 — 보간 오차 이중화 방지). mass_haul 연계.
 * 기면고·기면폭·사면경사=입력 원칙(미입력=생략 — 기본값 날조 금지).
 */
function earthworkSheet(assembly, used = []) {
  const pf = assembly.profile, ew = assembly.earthwork;
  if (!pf?.ground || pf.ground.length < 2) {
    return ew ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:8px 14px;font-size:11.5px;color:#92400e;margin:6px 0">토공량: 지반선 없음(등고 입력 또는 profileGround 필요) — 생략(정직)</div>` : '';
  }
  const F = Number(ew?.formationElevM), w = Number(ew?.widthM), n = Number(ew?.slopeN);
  if (!Number.isFinite(F) || !(w > 0) || !(n >= 0)) {
    return `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:8px 14px;font-size:11.5px;color:#92400e;margin:6px 0">토공량: 입력 필요 — earthwork {formationElevM(기면고), widthM(기면폭), slopeN(사면 1:n)} · 기본값 날조 금지로 생략</div>`;
  }
  const secs = pf.ground.map((g) => ({ staM: g.staMm / 1000, d: (g.elevMm - F * 1000) / 1000 })); // d>0=절토
  const A = (d) => Math.abs(d) * w + n * d * d;
  const stations = [];
  let cut = 0, fill = 0;
  for (let i = 1; i < secs.length; i++) {
    const a = secs[i - 1], b = secs[i];
    const spans = [];
    if ((a.d > 0 && b.d < 0) || (a.d < 0 && b.d > 0)) {
      const t = Math.abs(a.d) / (Math.abs(a.d) + Math.abs(b.d)); // 0점 선형보간(폐형)
      const sz = a.staM + t * (b.staM - a.staM);
      spans.push([a, { staM: sz, d: 0 }], [{ staM: sz, d: 0 }, b]);
    } else spans.push([a, b]);
    let segCut = 0, segFill = 0;
    for (const [p1, p2] of spans) {
      const V = ((A(p1.d) + A(p2.d)) / 2) * (p2.staM - p1.staM);
      if ((p1.d + p2.d) / 2 >= 0) segCut += V; else segFill += V;
    }
    cut += segCut; fill += segFill;
    stations.push({ sta_m: +b.staM.toFixed(2), cut_m3: +segCut.toFixed(2), fill_m3: +segFill.toFixed(2) });
  }
  let mh = null;
  try { mh = runCalculator('mass_haul', { stations, ...(Number(ew.shrinkC) > 0 ? { shrinkC: +ew.shrinkC } : {}) }); used.push('mass_haul'); } catch { mh = null; }
  // 자기정합: Σ구간 = 총계(원값 EPS)
  const sumCut = stations.reduce((s, q) => s + q.cut_m3, 0);
  const selfOk = Math.abs(sumCut - +cut.toFixed(2)) < 0.05 * stations.length;
  // 유토곡선 SVG
  let curveSvg = '';
  if (mh?.curve?.length > 1) {
    const xs = mh.curve.map((q) => q.sta_m), ys = mh.curve.map((q) => q.cum_m3);
    const xMax = Math.max(...xs), yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
    const PW = 760, PH = 120, M2 = 70;
    const Xc = (v) => (M2 + (v / Math.max(1e-9, xMax)) * PW).toFixed(1);
    const Yc = (v) => (20 + ((yMax - v) / Math.max(1e-9, yMax - yMin)) * PH).toFixed(1);
    curveSvg = `<svg viewBox="0 0 ${M2 + PW + 30} ${PH + 60}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">
<text x="${M2}" y="14" font-size="12" font-weight="700" font-family="sans-serif">유토곡선 (누적토량 — mass_haul)</text>
<line x1="${M2}" y1="${Yc(0)}" x2="${+Xc(xMax)}" y2="${Yc(0)}" stroke="#94a3b8" stroke-width=".7"/>
<polyline points="${mh.curve.map((q) => `${Xc(q.sta_m)},${Yc(q.cum_m3)}`).join(' ')}" fill="none" stroke="#dc2626" stroke-width="1.4"/>
${(mh.checks.haul.balancePoints_m ?? []).map((b) => `<line x1="${Xc(b)}" y1="20" x2="${Xc(b)}" y2="${20 + PH}" stroke="#2563eb" stroke-width=".8" stroke-dasharray="4 3"/><text x="${Xc(b)}" y="${PH + 34}" font-size="8" text-anchor="middle" fill="#2563eb" font-family="sans-serif">균형 ${b}m</text>`).join('')}
<text x="${M2}" y="${PH + 50}" font-size="8.5" fill="#64748b" font-family="sans-serif">${(mh.notes ?? []).map(esc).join(' · ')}</text></svg>`;
  }
  return `<div style="padding:6px 0"><table style="border-collapse:collapse;width:100%;font-size:11.5px"><caption style="text-align:left;font-size:13px;font-weight:700;padding:4px 0">토공량 (평균단면법 — 불균등 측점 그대로)</caption>
<tr style="background:#f1f5f9"><th style="border:1px solid #cbd5e1;padding:3px 8px">절토(m³)</th><th style="border:1px solid #cbd5e1;padding:3px 8px">성토(m³)</th><th style="border:1px solid #cbd5e1;padding:3px 8px">잉여/부족</th><th style="border:1px solid #cbd5e1;padding:3px 8px">구간 수</th><th style="border:1px solid #cbd5e1;padding:3px 8px">자기정합</th></tr>
<tr><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${cut.toFixed(1)}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${fill.toFixed(1)}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${mh ? `${mh.checks.summary.surplus_m3} m³ (${esc(mh.checks.summary.balance)})` : '-'}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${stations.length}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">${selfOk ? '✓' : '⚠'}</td></tr></table>
${curveSvg}
<div style="font-size:10px;color:#94a3b8;padding:3px 0">단면 A=|d|·w+n·d²(기면폭 ${w}m·사면 1:${n}·기면고 EL.${F}m — 전부 입력값) · 절↔성 전환=0점 보간 분할(폐형) · 평균단면법=근사 명시(프리즘/등고법 후속) · ${esc(pf.groundNote ?? '')}</div></div>`;
}

/** ② 종단면도 — 계획고(설계선) + 지반선(입력 시만). 종 왜곡 10×(V=H/10) 명기. */
function profileSvg(assembly) {
  const al = assembly.alignment, pf = assembly.profile;
  if (!al || !pf?.design?.length) return '';
  const total = al.totalMm;
  // 기준면 불일치 감지(정확도 감사 260717): 설계선=상대 벽고(형상 파생) vs 지반선=절대 EL
  // (등고 파생) — 같은 축에 그리면 오해(벽고 3m 가 EL.12m 아래 지반처럼 보임).
  // 혼합 시 이중 축(좌=EL 지반 / 우=벽고 설계)으로 분리 + 경고 명기.
  const mixedDatum = !!(pf.ground?.length && (pf.designNote ?? '').includes('형상 파생'));
  const dPts = pf.design, gPts = pf.ground ?? [];
  const dMin = Math.min(0, ...dPts.map((q) => q.elevMm)) - 500, dMax = Math.max(...dPts.map((q) => q.elevMm)) + 500;
  const allPts = mixedDatum ? dPts : dPts.concat(gPts);
  const eMin = mixedDatum ? dMin : Math.min(0, ...allPts.map((q) => q.elevMm)) - 500;
  const eMax = mixedDatum ? dMax : Math.max(...allPts.map((q) => q.elevMm)) + 500;
  const gMin = gPts.length ? Math.min(...gPts.map((q) => q.elevMm)) - 500 : 0;
  const gMax = gPts.length ? Math.max(...gPts.map((q) => q.elevMm)) + 500 : 1;
  const M = 80, PW = 760, PH = 170;
  const Sx = PW / total, Sy = PH / Math.max(1, eMax - eMin);
  const X = (s) => (M + s * Sx).toFixed(1);
  const Y = (e) => (30 + (eMax - e) * Sy).toFixed(1);
  // 지반선 전용 축(혼합 시) — 같은 픽셀 밴드에 EL 범위 매핑
  const Yg = mixedDatum ? (e) => (30 + ((gMax - e) / Math.max(1, gMax - gMin)) * PH).toFixed(1) : Y;
  const el = [];
  // 격자: STA + 표고
  const step = staStep(total);
  for (let s = 0; s <= total + 1; s += step) {
    const t = Math.min(s, total);
    el.push(`<line x1="${X(t)}" y1="30" x2="${X(t)}" y2="${30 + PH}" stroke="#e2e8f0" stroke-width=".6"/>`);
    el.push(`<text x="${X(t)}" y="${30 + PH + 14}" font-size="8" text-anchor="middle" fill="#475569" font-family="sans-serif">${staLabel(t)}</text>`);
    if (t >= total) break;
  }
  // 표고 그리드 nice-step(1·2·5×10^k) — 4~8줄이 되는 최소 스텝(잔여후보 ②)
  {
    const span = Math.max(1, eMax - eMin);
    const pow = Math.pow(10, Math.floor(Math.log10(span / 5)));
    const gstep = [1, 2, 5, 10].map((m) => m * pow).find((v) => span / v <= 8) ?? pow * 10;
    for (let e = Math.ceil(eMin / gstep) * gstep; e <= eMax; e += gstep) {
      el.push(`<line x1="${M}" y1="${Y(e)}" x2="${M + PW}" y2="${Y(e)}" stroke="#e2e8f0" stroke-width=".6"/>`);
      el.push(`<text x="${M - 6}" y="${(+Y(e) + 3).toFixed(1)}" font-size="8" text-anchor="end" fill="#475569" font-family="sans-serif">${mixedDatum ? '' : 'EL.'}${(e / 1000).toFixed(1)}</text>`);
    }
  }
  el.push(`<polyline points="${pf.design.map((q) => `${X(q.staMm)},${Y(q.elevMm)}`).join(' ')}" fill="none" stroke="#2563eb" stroke-width="1.6"/>`);
  if (pf.ground?.length) el.push(`<polyline points="${pf.ground.map((q) => `${X(q.staMm)},${Yg(q.elevMm)}`).join(' ')}" fill="none" stroke="#a16207" stroke-width="1.1" stroke-dasharray="6 4"/>`);
  if (mixedDatum) {
    el.push(`<text x="${M + PW}" y="${Yg(gMax - 500)}" font-size="8" text-anchor="end" fill="#a16207" font-family="sans-serif">지반축 EL.${((gMax - 500) / 1000).toFixed(1)}</text>`);
    el.push(`<text x="${M + PW}" y="${Yg(gMin + 500)}" font-size="8" text-anchor="end" fill="#a16207" font-family="sans-serif">EL.${((gMin + 500) / 1000).toFixed(1)}</text>`);
    el.push(`<rect x="${M}" y="30" width="${PW}" height="14" fill="#fffbeb"/><text x="${M + 4}" y="41" font-size="9" fill="#92400e" font-family="sans-serif">⚠ 기준면 불일치 — 설계선=상대 벽고(좌축)·지반선=절대 EL(우축, 별도 축) · 동일 축 비교는 profileDesign 절대표고 입력 시</text>`);
  }
  // 구조물 위치 마커(§1-2, 3자 대조: 평면·일람표와 동일 STA 라벨)
  for (const st of al.structures ?? []) {
    el.push(`<line x1="${X(st.sta)}" y1="30" x2="${X(st.sta)}" y2="${30 + PH}" stroke="#334155" stroke-width="1" stroke-dasharray="4 3"/>`);
    // 라벨=차트 상단 안쪽(260717 예시 배터리: 하단 +26 은 주석(+30)과 겹침) — 경고 배너(y30~44)와도 분리
    el.push(`<text x="${X(st.sta)}" y="56" font-size="7.5" text-anchor="middle" fill="#334155" font-family="sans-serif">${st.type === 'culvert' ? 'CULV' : st.type === 'catch_basin' ? 'CB' : 'EJ'} STA ${staLabel(st.sta)}</text>`);
  }
  const Nh = pickScale(total, 1, 360, 999);
  return `<svg viewBox="0 0 ${M + PW + 40} ${30 + PH + 40}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">
<text x="${M}" y="18" font-size="13" font-weight="700" font-family="sans-serif">종단면도 · H 1:${Nh} / V 1:${Math.max(1, Math.round(Nh / 10))} (종 10× 왜곡)</text>${el.join('')}
<text x="${M}" y="${30 + PH + 30}" font-size="8.5" fill="#64748b" font-family="sans-serif">설계선(청): ${esc(pf.designNote ?? '')} · ${pf.ground?.length ? `지반선(갈, 파선): ${esc(pf.groundNote ?? '입력')}` : '지반선=입력 시 표기(지형을 지어내지 않음)'}</text></svg>`;
}

/** 토목: 선형 평면도 SVG — 부재 평면 + 중심선 + 측점(STA 0+000) + 스케일바. km급 연장 대응. */
function civilPlanSvg(parts) {
  if (!parts.length) return null;
  const x0 = Math.min(...parts.map((o) => o.box.x)), x1 = Math.max(...parts.map((o) => o.box.x + o.box.dx));
  const y0 = Math.min(...parts.map((o) => o.box.y)), y1 = Math.max(...parts.map((o) => o.box.y + o.box.dy));
  const Wm = Math.max(1, x1 - x0), Dm = Math.max(1, y1 - y0);
  const alongY = Dm >= Wm; // 장축 = 선형 방향
  const Lmm = alongY ? Dm : Wm;
  const M = 70;
  const S = Math.min(760 / Wm, 460 / Dm);
  const X = (v) => (M + (v - x0) * S).toFixed(1);
  const Y = (v) => (M + (v - y0) * S).toFixed(1);
  const el = [];
  const ROLE_FILL = { wall: '#78716c55', base: '#57534e33' };
  for (const o of parts) {
    el.push(`<rect x="${X(o.box.x)}" y="${Y(o.box.y)}" width="${(o.box.dx * S).toFixed(1)}" height="${(o.box.dy * S).toFixed(1)}" fill="${ROLE_FILL[o.p.role] ?? '#9aa7b522'}" stroke="${o.st.c}" stroke-width=".9"/>`);
  }
  // 중심선(일점쇄선) + 측점
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (alongY) el.push(`<line x1="${X(cx)}" y1="${(+Y(y0) - 14).toFixed(1)}" x2="${X(cx)}" y2="${(+Y(y1) + 14).toFixed(1)}" stroke="#dc2626" stroke-width=".7" stroke-dasharray="16 4 3 4"/>`);
  else el.push(`<line x1="${(+X(x0) - 14).toFixed(1)}" y1="${Y(cy)}" x2="${(+X(x1) + 14).toFixed(1)}" y2="${Y(cy)}" stroke="#dc2626" stroke-width=".7" stroke-dasharray="16 4 3 4"/>`);
  const step = staStep(Lmm);
  for (let s = 0; ; s += step) {
    const t = Math.min(s, Lmm);
    if (alongY) {
      const yy = +Y(y0 + t);
      el.push(`<line x1="${(+X(cx) - 7).toFixed(1)}" y1="${yy}" x2="${(+X(cx) + 7).toFixed(1)}" y2="${yy}" stroke="#dc2626" stroke-width=".8"/>`);
      el.push(`<text x="${(+X(cx) + 10).toFixed(1)}" y="${(yy + 3).toFixed(1)}" font-size="8.5" fill="#dc2626" font-family="sans-serif">STA ${staLabel(t)}</text>`);
    } else {
      const xx = +X(x0 + t);
      el.push(`<line x1="${xx}" y1="${(+Y(cy) - 7).toFixed(1)}" x2="${xx}" y2="${(+Y(cy) + 7).toFixed(1)}" stroke="#dc2626" stroke-width=".8"/>`);
      el.push(`<text x="${xx}" y="${(+Y(cy) - 10).toFixed(1)}" font-size="8.5" fill="#dc2626" text-anchor="middle" font-family="sans-serif">STA ${staLabel(t)}</text>`);
    }
    if (t >= Lmm) break;
  }
  // 외곽 치수(자동 단위) + 스케일바 + 방위
  el.push(`<line x1="${X(x0)}" y1="${(M + Dm * S + 20).toFixed(1)}" x2="${X(x1)}" y2="${(M + Dm * S + 20).toFixed(1)}" stroke="#dc2626" stroke-width=".6"/><text x="${(+X(x0) + +X(x1)) / 2}" y="${(M + Dm * S + 34).toFixed(1)}" font-size="10" text-anchor="middle" fill="#dc2626" font-family="sans-serif">${fmtLen(Wm)}</text>`);
  el.push(`<line x1="${M - 16}" y1="${Y(y0)}" x2="${M - 16}" y2="${Y(y1)}" stroke="#dc2626" stroke-width=".6"/><text x="${M - 22}" y="${(+Y(y0) + +Y(y1)) / 2}" font-size="10" text-anchor="end" fill="#dc2626" font-family="sans-serif" transform="rotate(-90 ${M - 22} ${(+Y(y0) + +Y(y1)) / 2})">${fmtLen(Dm)}</text>`);
  el.push(scaleBarSvg(M, M + Dm * S + 52, S, Math.max(Wm, Dm)));
  el.push(northSvg(M + Wm * S + 30, M - 20));
  return `<svg viewBox="0 0 ${M + Wm * S + 70} ${M + Dm * S + 80}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff"><text x="${M}" y="24" font-size="13" font-weight="700" font-family="sans-serif">선형 평면도 (측점 ${fmtLen(step)} 간격)</text>${el.join('')}</svg>`;
}

/** 어셈블리 → 2D GA 도면 HTML (정면·평면 2뷰 + 전체치수 + 밸룬 + BOM, 인쇄양식).
 *  domain='building' → 축선 구조평면 / 'landscape' → 배치 평면도 / 'civil' → 선형 평면(측점)
 *  pipes = buildAssembly().pipes.routes — 라우터의 단일 결과를 그대로 투영(재계산 금지 — 정합)
 *  축척: 표준 축척(1:N) 자동 선정 — A3 100% 인쇄 기준 실축척(표제란 명기), km급 대응. */
export function ga2dDrawing(assembly, { title = '설계 GA 도면', dwg = 'NX-GA-001', domain, pipes, revHistory, lang } = {}) {
  const parts = (assembly.parts ?? []).map((p, i) => ({ p, i, box: placed(p), st: styleOf(p) }));
  if (!parts.length) return '<!DOCTYPE html><body>빈 어셈블리</body>';
  const bx0 = Math.min(...parts.map(o => o.box.x)), bx1 = Math.max(...parts.map(o => o.box.x + o.box.dx));
  const by0 = Math.min(...parts.map(o => o.box.y)), by1 = Math.max(...parts.map(o => o.box.y + o.box.dy));
  const bz0 = Math.min(...parts.map(o => o.box.z)), bz1 = Math.max(...parts.map(o => o.box.z + o.box.dz));
  const W = bx1 - bx0, D = by1 - by0, H = bz1 - bz0;
  // 표준 축척 자동 선정(뷰당 지면 170×200 paper-mm) — S = 인쇄 100% 기준 px/모델mm
  const N = pickScale(Math.max(W, 1), Math.max(H, D, 1));
  const S = PX_PER_PAPER_MM / N;
  const gap = 80, ox = 70, oy = 46;
  // 부품 그룹(type|role|규격|재질) — 대량 부품 도면의 밸룬·BOM 간축(동일 부재=동일 번호 관례)
  // 그룹 키 = **로컬 규격**(회전 무관 부재 치수) 2유효숫자 양자화 — 선형 현/트림 미세차와
  // 회전 AABB 스프레드로 그룹이 전부 갈라져 BOM 이 부품 수만큼 늘던 것 교정
  // (⚠이력 260717: 1.3km 72부품→70행. 월드 AABB 키도 회전 때문에 무력 — 로컬 기준이 정답).
  const q2 = (v) => (Number.isFinite(v) && v > 0 ? Number(v).toPrecision(2) : String(v));
  const localDims = (p2) => {
    try { const a = partAabb({ type: p2.type, ...p2.params }); return [a.max[0] - a.min[0], a.max[1] - a.min[1], a.max[2] - a.min[2]]; }
    catch { return [0, 0, 0]; }
  };
  const gIdx = new Map();
  const groups = [];
  for (const o of parts) {
    const key = `${o.p.type}|${o.p.role ?? ''}|${localDims(o.p).map(q2).join('x')}|${o.st.mat}`;
    if (!gIdx.has(key)) { gIdx.set(key, groups.length); groups.push({ rep: o, count: 0 }); }
    o.gi = gIdx.get(key);
    groups[o.gi].count++;
  }
  const MANY = parts.length > 40; // 다부품: 대표 부품만 밸룬·개별 치수문자 생략(판독성)
  const fw = W * S, fh = H * S, pd = D * S;
  const px = (x, o) => (o + (x - bx0) * S).toFixed(1);
  const pz = (z) => (oy + fh - (z - bz0) * S).toFixed(1);
  const rects = [], balloons = [], dimLabels = [], balloonPts = [];
  const sx0 = ox + fw + gap;
  for (const o of parts) {
    const { p, box, st } = o;
    // FRONT (x→right, z→up)
    rects.push(`<rect x="${px(box.x, ox)}" y="${pz(box.z + box.dz)}" width="${(box.dx * S).toFixed(1)}" height="${(box.dz * S).toFixed(1)}" fill="${st.c}22" stroke="${st.c}" stroke-width="1"/>`);
    // 밸룬 = 그룹 번호(동일 부재 동일 번호) — 다부품 도면은 그룹 대표에만
    if (!MANY || groups[o.gi].rep === o) {
      const bx = +px(box.x + box.dx / 2, ox), byy = +pz(box.z + box.dz) - 9;
      balloonPts.push({ bx, byy, label: o.gi + 1 });
      const ds = dimStr(p.type, p.params);
      // 부품별 치수문자는 기계 도면만: 비기계(벽·바닥 다수가 z=0)는 하단에 문자가 뭉개져
      // 판독 불가(260717 예시 배터리 검출) — 규격은 BOM 열이 단일 소스.
      if (ds && !MANY && (!domain || domain === 'mech')) dimLabels.push({ bx, dy: +pz(box.z) + 10, ds });
    }
    // PLAN (x→right, y→down) at side
    const vertAxis = (p.type === 'cylinder' || p.type === 'revolve') && !p.at?.rx && !p.at?.ry;
    if (vertAxis) {
      // 수직 회전체: 평면=원 + 중심선 십자(일점쇄선 — 코퍼스 도면 관례 260718)
      const ccx = +px(box.x + box.dx / 2, sx0), ccy = oy + (box.y - by0 + box.dy / 2) * S;
      const rr = (Math.min(box.dx, box.dy) * S) / 2;
      rects.push(`<circle cx="${ccx}" cy="${ccy.toFixed(1)}" r="${rr.toFixed(1)}" fill="${st.c}22" stroke="${st.c}" stroke-width=".9"/>`);
      rects.push(`<line x1="${(ccx - rr - 4).toFixed(1)}" y1="${ccy.toFixed(1)}" x2="${(ccx + rr + 4).toFixed(1)}" y2="${ccy.toFixed(1)}" stroke="#94a3b8" stroke-width=".5" stroke-dasharray="8 2 2 2"/>`);
      rects.push(`<line x1="${ccx}" y1="${(ccy - rr - 4).toFixed(1)}" x2="${ccx}" y2="${(ccy + rr + 4).toFixed(1)}" stroke="#94a3b8" stroke-width=".5" stroke-dasharray="8 2 2 2"/>`);
      // FRONT 세로 중심선
      rects.push(`<line x1="${px(box.x + box.dx / 2, ox)}" y1="${(+pz(box.z + box.dz) - 4).toFixed(1)}" x2="${px(box.x + box.dx / 2, ox)}" y2="${(+pz(box.z) + 4).toFixed(1)}" stroke="#94a3b8" stroke-width=".5" stroke-dasharray="8 2 2 2"/>`);
    } else {
      rects.push(`<rect x="${px(box.x, sx0)}" y="${(oy + (box.y - by0) * S).toFixed(1)}" width="${(box.dx * S).toFixed(1)}" height="${(box.dy * S).toFixed(1)}" fill="${st.c}22" stroke="${st.c}" stroke-width=".9"/>`);
      // 수평 회전체(ry): FRONT 가로 중심선(축선)
      if ((p.type === 'cylinder' || p.type === 'revolve') && p.at?.ry) {
        const cz = +pz(box.z + box.dz / 2);
        rects.push(`<line x1="${(+px(box.x, ox) - 4).toFixed(1)}" y1="${cz.toFixed(1)}" x2="${(+px(box.x + box.dx, ox) + 4).toFixed(1)}" y2="${cz.toFixed(1)}" stroke="#94a3b8" stroke-width=".5" stroke-dasharray="8 2 2 2"/>`);
      }
    }
  }
  // 밸룬 충돌 회피(260717 예시 배터리: 욕실 소형 기구 군집에서 밸룬 뭉침) —
  // 기존 배치와 16px 내로 겹치면 위로 18px 씩 밀고, 이동분은 리더선으로 원위치 연결
  {
    const placed = [];
    const free = (x, y) => !placed.some((q) => Math.abs(q.x - x) < 17 && Math.abs(q.y - y) < 17);
    for (const B of balloonPts) {
      const x0 = B.bx, y0 = B.byy;
      let fx = x0, fy = y0;
      if (!free(x0, y0)) {
        // 좌우 발산 우선(도면 리더 관례) — 세로 단일 스택은 군집에서 제목까지 침범
        outer: for (const dy of [0, -18, -36]) {
          for (const dx of [0, 20, -20, 40, -40, 60, -60]) {
            const cy = y0 + dy;
            if (cy < 30) continue; // 뷰 제목·상단 클리핑 회피
            if (free(x0 + dx, cy)) { fx = x0 + dx; fy = cy; break outer; }
          }
        }
      }
      placed.push({ x: fx, y: fy });
      if (Math.hypot(fx - x0, fy - y0) > 10) balloons.push(`<line x1="${fx.toFixed(1)}" y1="${(fy + (fy < y0 ? 8 : -8)).toFixed(1)}" x2="${x0.toFixed(1)}" y2="${y0.toFixed(1)}" stroke="#0f172a" stroke-width=".6"/>`);
      balloons.push(`<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="8" fill="#fff" stroke="#0f172a"/><text x="${fx.toFixed(1)}" y="${(fy + 3).toFixed(1)}" font-size="9" text-anchor="middle" fill="#0f172a" font-family="sans-serif">${B.label}</text>`);
    }
  }
  // 치수문자 충돌 회피(260717 예시 배터리): ①엔벨로프 치수대(+18)와 겹치는 바닥 부품은
  // 2행째(+30)로 강하 ②같은 높이대(±7px)에서 x-겹침은 그리디 행 패킹(행 간 10px)
  {
    dimLabels.sort((a, b) => a.dy - b.dy || a.bx - b.bx);
    const bands = [];
    for (const L of dimLabels) {
      if (L.dy > oy + fh - 1 && L.dy < oy + fh + 26) L.dy = oy + fh + 30;
      let band = bands.find((b) => Math.abs(b.y0 - L.dy) <= 7);
      if (!band) { band = { y0: L.dy, rows: [] }; bands.push(band); }
      const w = L.ds.length * 4.2 + 6;
      let ri = band.rows.findIndex((end) => L.bx - w / 2 > end);
      if (ri < 0) { ri = band.rows.length; band.rows.push(-Infinity); }
      band.rows[ri] = L.bx + w / 2;
      balloons.push(`<text x="${L.bx}" y="${(band.y0 + ri * 10).toFixed(1)}" font-size="7.3" text-anchor="middle" fill="#475569" font-family="sans-serif">${esc(L.ds)}</text>`);
    }
  }
  // 배관 오버레이(#6): FRONT(x,z)·PLAN(x,y) 폴리라인 — 라우팅된 실경로만(재계산 없음)
  const pipeLines = [];
  for (const rt of pipes ?? []) {
    const c = rt.col ?? '#64748b';
    const fPts = rt.pts.map((p) => `${px(p[0], ox)},${pz(p[2])}`).join(' ');
    const pPts = rt.pts.map((p) => `${px(p[0], sx0)},${(oy + (p[1] - by0) * S).toFixed(1)}`).join(' ');
    pipeLines.push(`<polyline points="${fPts}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" opacity=".85"/>`);
    pipeLines.push(`<polyline points="${pPts}" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round" opacity=".85"/>`);
    const [lx, ly, lz] = rt.pts[0];
    pipeLines.push(`<text x="${px(lx, ox)}" y="${(+pz(lz) - 4).toFixed(1)}" font-size="7.5" fill="${c}" font-family="sans-serif">${esc(rt.label ?? '')}</text>`);
  }
  const dimH = (x1, x2, y, t) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#dc2626" stroke-width=".6"/><text x="${(+x1 + +x2) / 2}" y="${+y - 3}" font-size="9.5" text-anchor="middle" fill="#dc2626">${t}</text>`;
  const dimV = (x, y1, y2, t) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#dc2626" stroke-width=".6"/><text x="${+x - 4}" y="${(+y1 + +y2) / 2}" font-size="9.5" text-anchor="end" fill="#dc2626" transform="rotate(-90 ${+x - 4} ${(+y1 + +y2) / 2})">${t}</text>`;
  const pipeHead = pipes?.length ? 90 : 0; // 오버헤드 코리도 배관이 정면도 위로 나가는 만큼 캔버스 확장
  const svg = `<svg viewBox="0 ${-pipeHead} ${sx0 + fw + 60} ${oy + fh + pd + 60 + pipeHead}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">
  <text x="${ox}" y="${oy - 26}" font-size="12" font-weight="700" font-family="sans-serif">정면도 FRONT</text>
  <text x="${sx0}" y="${oy - 26}" font-size="12" font-weight="700" font-family="sans-serif">평면도 PLAN</text>
  <rect x="${ox}" y="${oy}" width="${fw}" height="${fh}" fill="none" stroke="#0f172a" stroke-width="1.4"/>
  ${rects.join('')}
  ${dimH(px(bx0, ox), px(bx1, ox), (oy + fh + 18).toFixed(1), fmtLen(W))}
  ${dimV((ox - 18).toFixed(1), pz(bz1), pz(bz0), `${fmtLen(H)} (H)`)}
  ${dimH(px(bx0, sx0), px(bx1, sx0), (oy + pd + 18).toFixed(1), fmtLen(W))}
  ${dimV((sx0 - 18).toFixed(1), (oy).toFixed(1), (oy + pd).toFixed(1), fmtLen(D))}
  ${domain && domain !== 'mech' ? scaleBarSvg(ox, oy + fh + 42, S, Math.max(W, H)) + northSvg(sx0 + fw + 30, oy - 20) : ''}
  ${pipeLines.join('')}
  ${balloons.join('')}</svg>`;
  // 관례도면 모드 (③): 건축=축선 구조평면 · 조경=배치 평면도(+경계·등고) ·
  // 토목=선형 도면집(§2 시트 팩: 목록표·평면·곡선표·일람·종단·토공·일반주기) / 직선 run: 측점 평면
  let domainSvg = '';
  let sheetsHtml = '';
  let dwgNo = dwg;
  try {
    if (domain === 'building') domainSvg = axesPlanSvg(parts) ?? '';
    else if (domain === 'landscape') domainSvg = (landscapePlanSvg(parts) ?? '') + siteOverlayBlock(assembly);
    else if (domain === 'civil') {
      if (assembly.alignment) {
        const pack = civilSheetPack(assembly, { mainScaleN: N, revHistory, lang });
        sheetsHtml = pack.html;
        dwgNo = pack.mainDwg;
      } else domainSvg = (civilPlanSvg(parts) ?? '') + siteOverlayBlock(assembly);
    } else if (domain === 'bridge' && assembly.bridgeMeta) {
      // 교량 시트팩(260717 배터리 갭 해소): 목록표·거더 배치·표준 횡단·일람표·일반주기
      const pack = bridgeSheetPack(assembly, { mainScaleN: N, revHistory, lang });
      if (pack) { sheetsHtml = pack.html; dwgNo = pack.mainDwg; }
    }
  } catch { domainSvg = ''; sheetsHtml = ''; }
  // BOM = 그룹 단위(규격·재질 동일 부재 수량 집계) — 대량 부품 도면 판독성
  const bom = groups.map((g, gi) => {
    const { p, box, st } = g.rep;
    return `<tr><td>${gi + 1}</td><td style="text-align:left">${esc(p.id ?? p.type)}${g.count > 1 ? ' 외' : ''}</td><td>${esc(p.type)}</td><td>${fmtLen(box.dx)}×${fmtLen(box.dy)}×${fmtLen(box.dz)}</td><td>${esc(st.mat)}</td><td>${g.count}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A3 landscape;margin:8mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937}
.sheet{max-width:1180px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1)}.hd{display:flex;justify-content:space-between;align-items:flex-end;padding:12px 20px;border-bottom:2px solid #1f2937}.hd h1{font-size:16px;margin:0}.sub{font-size:11px;color:#64748b}.wrap{padding:8px 16px}
table{border-collapse:collapse;width:calc(100% - 40px);margin:0 20px 14px;font-size:11px}td,th{border:1px solid #cbd5e1;padding:3px 8px;text-align:center}th{background:#f1f5f9}
.sheet-page{max-width:1180px;margin:14px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:10px 16px 6px}
.tb{border-top:2px solid #1f2937;margin-top:8px;padding:6px 4px;font-size:11px;color:#334155;display:flex;gap:14px;flex-wrap:wrap}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}.sheet-page{box-shadow:none;border:none;margin:0;page-break-after:always}}</style></head>
<body>${PRINT_BAR('설계 GA 도면 (A3)')}<div class="sheet"><div class="hd"><div><h1>${esc(title)} — 일반배치도 (GA)</h1><div class="sub">nexyfab drawing-to-3d 자동생성 · 부품 ${parts.length}(그룹 ${groups.length})</div></div><div class="sub">DWG ${esc(dwgNo)} · <b>SCALE 1:${N}</b> (A3 100% 인쇄 기준 · 화면=가변) · 표기 mm(대형 자동 m/km) · 3rd angle · REV <span class="nf-rev">—</span></div></div>
<div class="wrap">${svg}</div>${domainSvg ? `<div class="wrap" style="border-top:1px solid #e2e8f0">${domainSvg}</div>` : ''}<table><thead><tr><th>No.</th><th>품명(대표)</th><th>Type</th><th>규격(엔벨로프)</th><th>재질</th><th>수량</th></tr></thead><tbody>${bom}</tbody></table>
<div class="sub" style="padding:4px 20px 12px;color:#94a3b8">⚠ 자동생성 GA(비법정) · 부품 엔벨로프 기준 · 상세치수·공차는 후속.</div><div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div>${sheetsHtml}</body></html>`;
}

/** 구조검토 결과 → HTML 리포트 (structuralCheck 출력 기반, 인쇄양식) */
export function structuralReport(assembly, { title = '구조/응력 검토', member } = {}) {
  const s = structuralCheck(assembly, member ? { member } : {});
  const f = (n, d = 1) => (typeof n === 'number' ? n.toFixed(d) : '-');
  const v = ok => ok ? '<span style="color:#16a34a;font-weight:700">적합 ✓</span>' : '<span style="color:#dc2626;font-weight:700">검토 ✕</span>';
  // 선형(alignment) 구조물 — 4점 강체 반력·코너 전도 모델은 연속 기초에 부적합(정확도 감사 260717):
  // 무의미한 수치 인쇄 대신 m당 자중 + 정식 검토 경로(옹벽 안정 체인) 안내로 대체(정직)
  if (assembly.alignment?.totalMm > 0) {
    const wPerM = s.totalMassKg / (assembly.alignment.totalMm / 1000);
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:14px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}table{border-collapse:collapse;margin:6px 24px;font-size:12px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 9px;text-align:center}th{background:#f1f5f9}
.card{margin:8px 24px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;line-height:1.8}.honest{margin:8px 24px;padding:9px 14px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e}.note{font-size:11px;color:#64748b;padding:6px 24px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body>${PRINT_BAR('구조 검토 — 선형 구조물 (A4)')}<div class="sheet"><div class="hd"><h1>${esc(title)} — 선형 구조물 자중 집계</h1><div class="s">nexyfab structural · 연속 기초 선형(연장 ${fmtLen(assembly.alignment.totalMm)})</div></div>
<div class="card">총 질량 <b>${f(s.totalMassKg)} kg</b> · <b>m당 자중 ${f(wPerM)} kg/m</b> · 부품 ${s.massBreakdown?.length ?? '-'}</div>
${(s.massBreakdown ?? []).length ? `<h2>질량 내역 (부품별 — 합계=총계 정합)</h2><table><tr><th>부품</th><th>질량(kg)</th></tr>${s.massBreakdown.map((r) => `<tr><td style="text-align:left">${esc(r.id)}</td><td>${f(r.massKg)}</td></tr>`).join('')}<tr style="font-weight:700;background:#f8fafc"><td>합계</td><td>${f(s.totalMassKg)}</td></tr></table>` : ''}
<div class="honest">⚠ 선형(연속 기초) 구조물 — 4점 강체 반력·코너 전도 모델은 부적합해 산출하지 않음(정직).
안정 검토(전도·활동·지지력·지진 M-O)는 <b>옹벽 안정 체인(verify-domain · retaining_wall_stability)</b>이 단면 기준으로 수행 — retainingWall 메타 자동 파생 연결됨. 부등 벽고 구간은 횡단면도(XS) 대표 단면별 검토 권장.</div>
<div class="note">질량=현 분할 부품 기준(접합 트림 포함 — 중심선 호장 물량은 BOQ 규칙 물량 참조) · 비법정.</div></div></body></html>`;
  }
  const supRows = s.supports.map((x, i) => `<tr><td>지지 ${i + 1}</td><td>(${Math.round(x.pos[0])}, ${Math.round(x.pos[1])})</td><td>${f(x.loadKg)} kg${x.uplift ? ' ⚠uplift' : ''}</td></tr>`).join('');
  // ② 질량 내역 — 표시값 합계=총계 정합(최대잔여법, 위시빌더 845≠835 자기모순 방지)
  const massRows = (s.massBreakdown ?? []).map((r) => `<tr><td style="text-align:left">${esc(r.id)}</td><td>${f(r.massKg)}</td></tr>`).join('');
  const massTable = massRows ? `<h2>② 질량 내역 (부품별)</h2><table><tr><th>부품</th><th>질량(kg)</th></tr>${massRows}
<tr style="font-weight:700;background:#f8fafc"><td>합계</td><td>${f(s.totalMassKg)}</td></tr></table>
<div class="note">표시값(0.1kg) 합계 = 총계 ${s.massSumCheck ? '정합 ✓ (최대잔여법 라운딩)' : '⚠불일치 — 산출 버그, 신뢰 금지'}</div>` : '';
  const mem = s.member ? `<h2>③ 부재 검토</h2><table><tr><th>단면</th><th>스팬</th><th>σ</th><th>허용</th><th>이용률</th><th>δ</th><th>판정</th></tr>
  <tr><td>${esc(s.member.section)}</td><td>${s.member.spanMm}mm</td><td>${f(s.member.sigmaMPa)} MPa</td><td>${f(s.member.allowMPa)} MPa</td><td>${f(s.member.utilization, 2)}</td><td>${f(s.member.deflMm, 2)}/${f(s.member.deflLimitMm)}mm</td><td>${v(s.member.pass)}</td></tr></table>` : '';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:14px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}table{border-collapse:collapse;margin:6px 24px;font-size:12px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 9px;text-align:center}th{background:#f1f5f9}
.card{margin:8px 24px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;line-height:1.8}.warn{background:#fef2f2;border-color:#fecaca;color:#991b1b}.note{font-size:11px;color:#64748b;padding:6px 24px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body>${PRINT_BAR('구조/응력 검토 (A4)')}<div class="sheet"><div class="hd"><h1>${esc(title)} — 구조/응력 자동검토</h1><div class="s">nexyfab structural · 형상기반 자동산출 · ${esc(s.method)}</div></div>
<div class="card">총 질량 <b>${f(s.totalMassKg)} kg</b> · 무게중심 높이 <b>${f(s.cgHeightM, 2)} m</b> · 최대 지지반력 <b>${f(s.maxSupportKg)} kg</b></div>
<h2>① 지지 반력</h2><table><tr><th>지지점</th><th>위치(x,y)</th><th>반력</th></tr>${supRows}</table>
${massTable}${mem}<h2>④ 전도 (Tip-over)</h2><table><tr><th>검토</th><th>결과</th><th>기준</th><th>판정</th></tr>
<tr><td>정적 전도각</td><td>${f(s.tipover.staticAngleDeg, 1)}°</td><td>≥15°</td><td>${v(s.tipover.staticAngleDeg >= 15)}</td></tr>
<tr><td>${s.tipover.seismicG}g 전도 FS</td><td>${f(s.tipover.seismicFS, 2)}</td><td>≥1.5</td><td>${v(s.tipover.seismicFS >= 1.5)}</td></tr></table>
${s.warnings.length ? `<div class="card warn"><b>⚠ 경고:</b><ul style="margin:4px 0">${s.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '<div class="card">경고 없음 — 자동검토 기준 이내.</div>'}
<div class="note">⚠ 개념 해석(비법정) · 강체/단순보 근사 · 상세 FEA·좌굴·용접·현지 지진은 후속.</div><div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div></body></html>`;
}

// ── 산출물 크로스 정합 게이트 (#7, 위시빌더 3차 최대 발견의 일반화) ──────────────
// 위시빌더에서 "인덱스 카드=REV B 숫자 vs 링크된 도면=REV C"·"GA 1740×760 vs DETAIL
// 1740×680" 드리프트가 최대 결함이었다. 방지책 2단:
//   ① packageStamp — 전 HTML 에 같은 REV/기준(질량·외형·부품수)을 기계가독으로 박는다
//   ② packageConsistencyCheck — 생성 직후 각 문서가 실제로 인쇄한 숫자를 회수해 기준과 대조

/** HTML 에 nf-basis 메타 + 가시 REV 푸터 삽입. basis = { rev, massKg, env:[W,D,H], parts } */
export function packageStamp(html, basis) {
  const attr = JSON.stringify(basis).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const meta = `<meta name="nf-basis" content="${attr}">`;
  const footer = `<div style="max-width:900px;margin:6px auto 14px;font-size:10px;color:#94a3b8;text-align:center">REV ${esc(basis.rev)} · 기준: 질량 ${basis.massKg}kg · 외형 ${basis.env.map(Math.round).join('×')}mm · 부품 ${basis.parts} — 전 산출물 단일 기준(자동 정합 게이트)</div>`;
  let out = html.includes('</head>') ? html.replace('</head>', meta + '</head>') : meta + html;
  out = out.includes('</body>') ? out.replace('</body>', footer + '</body>') : out + footer;
  // 시트 표제란 REV 채움(§2-1) — 도번·REV 는 단일 basis 에서만 주입(수기 문자열 금지)
  out = out.replaceAll('<span class="nf-rev">—</span>', `<span class="nf-rev">${esc(basis.rev)}</span>`);
  return out;
}

/**
 * 산출물 간 숫자 대조 — 각 문서가 "실제로 인쇄한" 값을 정규식으로 회수해 기준과 대조.
 * hasFluid=true 면 구조(운전질량, 유체 포함) vs BOQ(자재질량) 는 정의가 달라 대조 생략(정직).
 * @returns { pass, checks: [{file, metric, value, expect, tol, pass, note?}] }
 */
export function packageConsistencyCheck(files, basis, { hasFluid = false, alignment = null } = {}) {
  const get = (name) => files.find((f) => f.name === name)?.content ?? '';
  const num = (src, re) => { const m = src.match(re); return m ? parseFloat(m[1]) : null; };
  const checks = [];
  const add = (file, metric, value, expect, tol, note) => {
    if (value === null || expect === null) return; // 문서 부재/패턴 부재 = 대조 불가(스킵, 오탐 금지)
    checks.push({ file, metric, value, expect: +expect.toFixed(2), tol: +tol.toFixed(2), pass: Math.abs(value - expect) <= tol, ...(note ? { note } : {}) });
  };
  const stMass = num(get('structural.html'), /총 질량 <b>([\d.]+) kg/);
  add('structural.html', 'totalMassKg', stMass, basis.massKg, Math.max(0.2, basis.massKg * 0.005));
  const boqHtml = get('BOQ.html');
  const boqKg = num(boqHtml, /<b>([\d.]+) kg<\/b><span>총 자재 질량/);
  const boqT = num(boqHtml, /<b>([\d.]+) t<\/b><span>총 질량/);
  const boqMass = boqKg ?? (boqT !== null ? boqT * 1000 : null);
  const tPad = boqKg === null && boqT !== null ? 55 : 0; // t 표시(0.1t 라운딩) 경유 회수는 ±50kg 여유
  const dosMass = num(get('Dossier.html'), /<b>([\d.]+) kg<\/b><span>총 질량/);
  if (boqMass !== null && dosMass !== null) add('Dossier.html↔BOQ.html', 'totalMassKg', dosMass, boqMass, Math.max(0.5, boqMass * 0.01, tPad));
  if (!hasFluid) add('BOQ.html', 'totalMassKg(vs 구조)', boqMass, basis.massKg, Math.max(0.5, basis.massKg * 0.01, tPad));
  else if (boqMass !== null) checks.push({ file: 'BOQ.html', metric: 'totalMassKg', value: boqMass, expect: basis.massKg, tol: 0, pass: true, note: '유체(운전질량) 포함차 — 자재질량 대 운전질량은 정의가 달라 대조 생략' });
  // GA 치수는 자동 단위(fmtLen: mm/m/km) — 회수 후 mm 로 역변환, 허용오차=표기 라운딩 단위
  const parseLen = (s) => { const m = String(s ?? '').match(/^([\d.]+)(km|m)?$/); if (!m) return null; const v = parseFloat(m[1]); return m[2] === 'km' ? v * 1e6 : m[2] === 'm' ? v * 1000 : v; };
  const lenTol = (mm) => (Math.abs(mm) < 10000 ? 1 : Math.abs(mm) < 1_000_000 ? 6 : 501);
  const gaHtml = get('GA_2D_drawing.html');
  const mH = gaHtml.match(/>([\d.]+(?:km|m)?) \(H\)</);
  add('GA_2D_drawing.html', 'H(mm)', mH ? parseLen(mH[1]) : null, basis.env[2], lenTol(basis.env[2]));
  // W 대조 — FRONT 하단 치수(첫 dimH). 배관 오버레이가 있어도 치수는 부품 엔벨로프 기준.
  const mW = gaHtml.match(/text-anchor="middle" fill="#dc2626">([\d.]+(?:km|m)?)</);
  add('GA_2D_drawing.html', 'W(mm)', mW ? parseLen(mW[1]) : null, basis.env[0], lenTol(basis.env[0]));
  // 선형 3자 대조(§1-2·2-3): ①문서가 인쇄한 최대 STA ↔ 총연장 ②구조물 STA 라벨이
  // 평면·종단·일람표에 모두 존재(≥3회) — 생성≠검증(재파싱 회수)
  if (alignment?.totalMm > 0) {
    const stas = [...gaHtml.matchAll(/STA (\d+)\+(\d{3})/g)].map((m) => (+m[1] * 1000 + +m[2]) * 1000);
    add('GA_2D_drawing.html', 'maxSTA(mm)', stas.length ? Math.max(...stas) : null, alignment.totalMm, 501);
    for (const st of alignment.structures ?? []) {
      const label = `STA ${staLabel(st.sta)}`;
      const cnt = (gaHtml.match(new RegExp(label.replace('+', '\\+'), 'g')) ?? []).length;
      checks.push({ file: 'GA_2D_drawing.html', metric: `구조물 ${st.type}@${label} 3자(평면·종단·일람)`, value: cnt, expect: 3, tol: 99, pass: cnt >= 3 });
    }
  }
  // §2 도서 역방향 게이트: data-dwg 재파싱 — 도번 유일·목록표 매수 일치·상세 윈도 무결·REV 채움
  // (도메인 불문 — 시트팩(NX-CIV/NX-BRG…)이 있으면 항상 검사, 없으면 자동 스킵)
  {
    const dwgs = [...gaHtml.matchAll(/data-dwg="(NX-[A-Z]+-[A-Z]+-\d+)"/g)].map((m) => m[1]);
    if (dwgs.length) {
      const uniq = new Set(dwgs);
      checks.push({ file: 'GA_2D_drawing.html', metric: '도번 유일성', value: dwgs.length, expect: uniq.size, tol: 0, pass: dwgs.length === uniq.size });
      const dlCount = Number(gaHtml.match(/도면 목록표 \(총 (\d+)매/)?.[1] ?? NaN);
      checks.push({ file: 'GA_2D_drawing.html', metric: '목록표 매수=실시트(GA 본시트 +1)', value: dwgs.length + 1, expect: dlCount, tol: 0, pass: dwgs.length + 1 === dlCount });
      const wins = [...gaHtml.matchAll(/data-sta-from="(\d+)" data-sta-to="(\d+)"/g)].map((m) => [+m[1], +m[2]]).sort((a, b) => a[0] - b[0]);
      if (wins.length) {
        let okWin = Math.abs(wins[0][0]) <= 1 && Math.abs(wins[wins.length - 1][1] - alignment.totalMm) <= 1;
        for (let i = 1; i < wins.length; i++) if (Math.abs(wins[i][0] - wins[i - 1][1]) > 1) okWin = false;
        checks.push({ file: 'GA_2D_drawing.html', metric: '상세 시트 윈도 무결(틈·겹침 0)', value: wins.length, expect: wins.length, tol: 0, pass: okWin });
      }
      const unfilled = (gaHtml.match(/<span class="nf-rev">—<\/span>/g) ?? []).length;
      checks.push({ file: 'GA_2D_drawing.html', metric: 'REV 스탬프 채움', value: unfilled, expect: 0, tol: 0, pass: unfilled === 0 });
    }
  }
  return { pass: checks.every((c) => c.pass), checks, rev: basis.rev };
}
