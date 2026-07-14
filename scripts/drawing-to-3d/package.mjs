/**
 * 설계 패키지 자동생성 — 임의 어셈블리(parts[])에서 2D GA 도면·구조 리포트·계통색 GA 3D
 * 를 범용 생성한다. skid/tank 하드코딩 생성기를 어셈블리 파라메트릭으로 일반화.
 * (P&ID·Dossier 는 공정 의미·서술 필요 → AI 보조 후속. 여기선 형상기반 3종.)
 */
import { partAabb } from './reconstruct.mjs';
import { structuralCheck } from './structural.mjs';
import { colorOf } from './assembly.mjs';

// 부품 type → 기본 재질 라벨(도면 BOM). 색은 colorOf(assembly.mjs) 단일 소스 — service/role/추론/type 순.
const TYPE_MAT = {
  box: 'STS', plate_with_holes: '판재', stepped_plate: '판재', base_plate: '판재', l_bracket: '브래킷', bent_sheet: '판금',
  flange: '플랜지', tube: '관', rect_tube: '각관', cylinder: '봉/실린더', gusset: '거셋',
  spur_gear: '기어', hex_bolt: '볼트', sheet_profile: '판금', wall_with_openings: '벽체',
};
const styleOf = (p) => ({ c: colorOf(p), mat: p.material || TYPE_MAT[p.type] || '-' });

// 배치 후 축정렬 AABB(회전 무시 근사 — 도면 엔벨로프용)
function placed(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0 } = part.at ?? {};
  return { x: a.min[0] + tx, y: a.min[1] + ty, z: a.min[2] + tz, dx: a.max[0] - a.min[0], dy: a.max[1] - a.min[1], dz: a.max[2] - a.min[2] };
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
  // 외곽 치수
  el.push(`<line x1="${X(x0)}" y1="${(M + Dm * S + 18).toFixed(1)}" x2="${X(x1)}" y2="${(M + Dm * S + 18).toFixed(1)}" stroke="#dc2626" stroke-width=".6"/><text x="${(+X(x0) + +X(x1)) / 2}" y="${(M + Dm * S + 32).toFixed(1)}" font-size="10" text-anchor="middle" fill="#dc2626" font-family="sans-serif">${Math.round(Wm)}</text>`);
  el.push(`<line x1="${M - 16}" y1="${Y(y0)}" x2="${M - 16}" y2="${Y(y1)}" stroke="#dc2626" stroke-width=".6"/><text x="${M - 22}" y="${(+Y(y0) + +Y(y1)) / 2}" font-size="10" text-anchor="end" fill="#dc2626" font-family="sans-serif" transform="rotate(-90 ${M - 22} ${(+Y(y0) + +Y(y1)) / 2})">${Math.round(Dm)}</text>`);
  return `<svg viewBox="0 0 ${M + Wm * S + 50} ${M + Dm * S + 50}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff"><text x="${M}" y="24" font-size="13" font-weight="700" font-family="sans-serif">배치 평면도</text>${el.join('')}<text x="${M}" y="${(M + Dm * S + 46).toFixed(1)}" font-size="9.5" fill="#64748b" font-family="sans-serif">범례: ▨데크보드 · ┅장선 · ─보 · ⊕기둥 · 치수 mm</text></svg>`;
}

/** 어셈블리 → 2D GA 도면 HTML (정면·평면 2뷰 + 전체치수 + 밸룬 + BOM, 인쇄양식).
 *  domain='building' → 축선 구조평면 추가 / 'landscape' → 배치 평면도 추가 (관례도면 모드 ③) */
export function ga2dDrawing(assembly, { title = '설계 GA 도면', dwg = 'NX-GA-001', domain } = {}) {
  const parts = (assembly.parts ?? []).map((p, i) => ({ p, i, box: placed(p), st: styleOf(p) }));
  if (!parts.length) return '<!DOCTYPE html><body>빈 어셈블리</body>';
  const bx0 = Math.min(...parts.map(o => o.box.x)), bx1 = Math.max(...parts.map(o => o.box.x + o.box.dx));
  const by0 = Math.min(...parts.map(o => o.box.y)), by1 = Math.max(...parts.map(o => o.box.y + o.box.dy));
  const bz0 = Math.min(...parts.map(o => o.box.z)), bz1 = Math.max(...parts.map(o => o.box.z + o.box.dz));
  const W = bx1 - bx0, D = by1 - by0, H = bz1 - bz0;
  const S = Math.min(360 / Math.max(W, 1), 460 / Math.max(H, 1), 0.5);
  const gap = 80, ox = 70, oy = 46;
  const fw = W * S, fh = H * S, pd = D * S;
  const px = (x, o) => (o + (x - bx0) * S).toFixed(1);
  const pz = (z) => (oy + fh - (z - bz0) * S).toFixed(1);
  const rects = [], balloons = [];
  const sx0 = ox + fw + gap;
  for (const { p, i, box, st } of parts) {
    // FRONT (x→right, z→up)
    rects.push(`<rect x="${px(box.x, ox)}" y="${pz(box.z + box.dz)}" width="${(box.dx * S).toFixed(1)}" height="${(box.dz * S).toFixed(1)}" fill="${st.c}22" stroke="${st.c}" stroke-width="1"/>`);
    const bx = +px(box.x + box.dx / 2, ox), byy = +pz(box.z + box.dz) - 9;
    balloons.push(`<circle cx="${bx}" cy="${byy}" r="8" fill="#fff" stroke="#0f172a"/><text x="${bx}" y="${byy + 3}" font-size="9" text-anchor="middle" fill="#0f172a" font-family="sans-serif">${i + 1}</text>`);
    const ds = dimStr(p.type, p.params);
    if (ds) balloons.push(`<text x="${bx}" y="${(+pz(box.z) + 10).toFixed(1)}" font-size="7.3" text-anchor="middle" fill="#475569" font-family="sans-serif">${esc(ds)}</text>`);
    // PLAN (x→right, y→down) at side
    rects.push(`<rect x="${px(box.x, sx0)}" y="${(oy + (box.y - by0) * S).toFixed(1)}" width="${(box.dx * S).toFixed(1)}" height="${(box.dy * S).toFixed(1)}" fill="${st.c}22" stroke="${st.c}" stroke-width=".9"/>`);
  }
  const dimH = (x1, x2, y, t) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#dc2626" stroke-width=".6"/><text x="${(+x1 + +x2) / 2}" y="${+y - 3}" font-size="9.5" text-anchor="middle" fill="#dc2626">${t}</text>`;
  const dimV = (x, y1, y2, t) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#dc2626" stroke-width=".6"/><text x="${+x - 4}" y="${(+y1 + +y2) / 2}" font-size="9.5" text-anchor="end" fill="#dc2626" transform="rotate(-90 ${+x - 4} ${(+y1 + +y2) / 2})">${t}</text>`;
  const svg = `<svg viewBox="0 0 ${sx0 + fw + 60} ${oy + fh + pd + 60}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">
  <text x="${ox}" y="${oy - 10}" font-size="12" font-weight="700" font-family="sans-serif">정면도 FRONT</text>
  <text x="${sx0}" y="${oy - 10}" font-size="12" font-weight="700" font-family="sans-serif">평면도 PLAN</text>
  <rect x="${ox}" y="${oy}" width="${fw}" height="${fh}" fill="none" stroke="#0f172a" stroke-width="1.4"/>
  ${rects.join('')}
  ${dimH(px(bx0, ox), px(bx1, ox), (oy + fh + 18).toFixed(1), `${Math.round(W)}`)}
  ${dimV((ox - 18).toFixed(1), pz(bz1), pz(bz0), `${Math.round(H)} (H)`)}
  ${dimH(px(bx0, sx0), px(bx1, sx0), (oy + pd + 18).toFixed(1), `${Math.round(W)}`)}
  ${balloons.join('')}</svg>`;
  // 관례도면 모드 (③): 건축=축선 구조평면 · 조경=배치 평면도
  let domainSvg = '';
  try {
    if (domain === 'building') domainSvg = axesPlanSvg(parts) ?? '';
    else if (domain === 'landscape') domainSvg = landscapePlanSvg(parts) ?? '';
  } catch { domainSvg = ''; }
  const bom = parts.map(({ p, i, box, st }) => `<tr><td>${i + 1}</td><td style="text-align:left">${esc(p.id ?? p.type)}</td><td>${esc(p.type)}</td><td>${Math.round(box.dx)}×${Math.round(box.dy)}×${Math.round(box.dz)}</td><td>${esc(st.mat)}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A3 landscape;margin:8mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937}
.sheet{max-width:1180px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1)}.hd{display:flex;justify-content:space-between;align-items:flex-end;padding:12px 20px;border-bottom:2px solid #1f2937}.hd h1{font-size:16px;margin:0}.sub{font-size:11px;color:#64748b}.wrap{padding:8px 16px}
table{border-collapse:collapse;width:calc(100% - 40px);margin:0 20px 14px;font-size:11px}td,th{border:1px solid #cbd5e1;padding:3px 8px;text-align:center}th{background:#f1f5f9}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body>${PRINT_BAR('설계 GA 도면 (A3)')}<div class="sheet"><div class="hd"><div><h1>${esc(title)} — 일반배치도 (GA)</h1><div class="sub">nexyfab drawing-to-3d 자동생성 · 부품 ${parts.length}종</div></div><div class="sub">DWG ${esc(dwg)} · mm · 3rd angle</div></div>
<div class="wrap">${svg}</div>${domainSvg ? `<div class="wrap" style="border-top:1px solid #e2e8f0">${domainSvg}</div>` : ''}<table><thead><tr><th>No.</th><th>품명</th><th>Type</th><th>엔벨로프(mm)</th><th>재질</th></tr></thead><tbody>${bom}</tbody></table>
<div class="sub" style="padding:4px 20px 12px;color:#94a3b8">⚠ 자동생성 GA(비법정) · 부품 엔벨로프 기준 · 상세치수·공차는 후속.</div><div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div></body></html>`;
}

/** 구조검토 결과 → HTML 리포트 (structuralCheck 출력 기반, 인쇄양식) */
export function structuralReport(assembly, { title = '구조/응력 검토', member } = {}) {
  const s = structuralCheck(assembly, member ? { member } : {});
  const f = (n, d = 1) => (typeof n === 'number' ? n.toFixed(d) : '-');
  const v = ok => ok ? '<span style="color:#16a34a;font-weight:700">적합 ✓</span>' : '<span style="color:#dc2626;font-weight:700">검토 ✕</span>';
  const supRows = s.supports.map((x, i) => `<tr><td>지지 ${i + 1}</td><td>(${Math.round(x.pos[0])}, ${Math.round(x.pos[1])})</td><td>${f(x.loadKg)} kg${x.uplift ? ' ⚠uplift' : ''}</td></tr>`).join('');
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
${mem}<h2>④ 전도 (Tip-over)</h2><table><tr><th>검토</th><th>결과</th><th>기준</th><th>판정</th></tr>
<tr><td>정적 전도각</td><td>${f(s.tipover.staticAngleDeg, 1)}°</td><td>≥15°</td><td>${v(s.tipover.staticAngleDeg >= 15)}</td></tr>
<tr><td>${s.tipover.seismicG}g 전도 FS</td><td>${f(s.tipover.seismicFS, 2)}</td><td>≥1.5</td><td>${v(s.tipover.seismicFS >= 1.5)}</td></tr></table>
${s.warnings.length ? `<div class="card warn"><b>⚠ 경고:</b><ul style="margin:4px 0">${s.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '<div class="card">경고 없음 — 자동검토 기준 이내.</div>'}
<div class="note">⚠ 개념 해석(비법정) · 강체/단순보 근사 · 상세 FEA·좌굴·용접·현지 지진은 후속.</div><div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div></body></html>`;
}
