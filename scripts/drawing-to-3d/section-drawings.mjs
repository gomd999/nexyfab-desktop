/**
 * section-drawings.mjs — 도면 완결 A: 토목 단면도·교량 일반도·인테리어 평면도 (SVG).
 *
 * 전부 형상 파라미터에서 결정론 생성 — 치수선은 실제 값. 배근은 "개념 표기"로만
 * (본수·간격은 계산 결과 연동 시 표기, 없으면 위치만 — 지어내지 않음 명시).
 * 좌표계: SVG y-하향 → 도면은 상향이 자연 → 내부에서 뒤집기. 단위 mm.
 */

const H = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function svgShell(w, h, content, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="'Segoe UI',sans-serif">
<style>.dim{stroke:#2563eb;stroke-width:1;fill:none}.dimt{fill:#2563eb;font-size:${Math.max(w, h) * 0.022}px;text-anchor:middle}.out{stroke:#111;stroke-width:2;fill:#f8fafc}.out2{stroke:#111;stroke-width:2;fill:#e2e8f0}.rebar{stroke:#dc2626;stroke-width:1.2;fill:none;stroke-dasharray:4 3}.ttl{font-size:${Math.max(w, h) * 0.03}px;font-weight:700;fill:#111}.note{font-size:${Math.max(w, h) * 0.018}px;fill:#64748b}</style>
<text x="${w / 2}" y="${Math.max(w, h) * 0.045}" class="ttl" text-anchor="middle">${H(title)}</text>
${content}</svg>`;
}

/** 치수선 (수평/수직) */
function dim(x1, y1, x2, y2, label, off = 24) {
  const horiz = Math.abs(y2 - y1) < 0.5;
  if (horiz) {
    const y = y1 + off;
    return `<g><line class="dim" x1="${x1}" y1="${y1 + 4}" x2="${x1}" y2="${y + 4}"/><line class="dim" x1="${x2}" y1="${y2 + 4}" x2="${x2}" y2="${y + 4}"/><line class="dim" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><text class="dimt" x="${(x1 + x2) / 2}" y="${y - 4}">${H(label)}</text></g>`;
  }
  const x = x1 + off;
  return `<g><line class="dim" x1="${x1 + 4}" y1="${y1}" x2="${x + 4}" y2="${y1}"/><line class="dim" x1="${x2 + 4}" y1="${y2}" x2="${x + 4}" y2="${y2}"/><line class="dim" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><text class="dimt" x="${x + 4}" y="${(y1 + y2) / 2}" transform="rotate(90 ${x + 12} ${(y1 + y2) / 2})">${H(label)}</text></g>`;
}

/** ① 옹벽 단면도 (역T: 벽체+저판+앞굽) — params mm */
export function retainingWallSectionSvg(p, opts = {}) {
  const { H: Hw = 3000, baseWidth = 2000, baseThickness = 400, stemThickness = 300, toeLength = 600 } = p;
  const M = 90, S = 520 / Math.max(Hw, baseWidth); // 스케일
  const bw = baseWidth * S, bt = baseThickness * S, st = stemThickness * S, tl = toeLength * S, hh = Hw * S;
  const W = bw + 2 * M + 90, Ht = hh + 2 * M + 60;
  const x0 = M, yBase = Ht - M; // 저판 하단
  const stemX = x0 + tl;
  const body = `
<rect class="out" x="${x0}" y="${yBase - bt}" width="${bw}" height="${bt}"/>
<rect class="out" x="${stemX}" y="${yBase - hh}" width="${st}" height="${hh - bt}"/>
${opts.rebar !== false ? `
<path class="rebar" d="M ${stemX + 6} ${yBase - hh + 8} V ${yBase - 10} H ${x0 + bw - 8}"/>
<path class="rebar" d="M ${x0 + 8} ${yBase - bt + 6} H ${x0 + bw - 8}"/>
<text class="note" x="${stemX + st + 8}" y="${yBase - hh + 24}">주철근(개념 위치 — 본수·간격은 배근 입력 연동)</text>` : ''}
${dim(x0, yBase, x0 + bw, yBase, `${baseWidth}`, 30)}
${dim(x0, yBase, stemX, yBase, `${toeLength}`, 56)}
${dim(stemX + st, yBase - hh, stemX + st, yBase, `${Hw}`, 30)}
${dim(stemX, yBase - hh, stemX + st, yBase - hh, `${stemThickness}`, -14)}
<text class="note" x="${x0}" y="${Ht - 12}">치수 mm · 개념 단면(비법정) — 배근 상세는 구조기술사 확정</text>`;
  return svgShell(W, Ht, body, opts.title ?? '옹벽 표준 단면도 (역T)');
}

/** ② 암거 단면도 (단일 셀 박스) — m 입력 */
export function boxCulvertSectionSvg(p, opts = {}) {
  const Bi = (p.innerWidth ?? 4) * 1000, Hi = (p.innerHeight ?? 4) * 1000;
  const t = (p.wallThk ?? 0.35) * 1000, tt = (p.topThk ?? p.wallThk ?? 0.4) * 1000, tb = (p.botThk ?? p.wallThk ?? 0.45) * 1000;
  const OW = Bi + 2 * t, OH = Hi + tt + tb;
  const M = 90, S = 520 / Math.max(OW, OH);
  const W = OW * S + 2 * M + 90, Ht = OH * S + 2 * M + 60;
  const x0 = M, y0 = M + 30;
  const body = `
<rect class="out" x="${x0}" y="${y0}" width="${OW * S}" height="${OH * S}"/>
<rect fill="#fff" stroke="#111" stroke-width="2" x="${x0 + t * S}" y="${y0 + tt * S}" width="${Bi * S}" height="${Hi * S}"/>
${opts.rebar !== false ? `
<rect class="rebar" x="${x0 + 45 * S * 10}" y="${y0 + 45 * S * 10}" width="${(OW - 900) * S}" height="${(OH - 900) * S}"/>
<text class="note" x="${x0 + 8}" y="${y0 - 8}">외측 주철근(개념) — 우각부 헌치·배근 상세 별도</text>` : ''}
${dim(x0, y0 + OH * S, x0 + OW * S, y0 + OH * S, `${Math.round(OW)}`, 30)}
${dim(x0 + t * S, y0 + OH * S, x0 + t * S + Bi * S, y0 + OH * S, `내폭 ${Math.round(Bi)}`, 56)}
${dim(x0 + OW * S, y0, x0 + OW * S, y0 + OH * S, `${Math.round(OH)}`, 30)}
${dim(x0, y0, x0 + t * S, y0, `${Math.round(t)}`, -14)}
<text class="note" x="${x0}" y="${Ht - 12}">치수 mm · 상판 ${Math.round(tt)}·저판 ${Math.round(tb)}·벽 ${Math.round(t)} — 개념 단면(비법정)</text>`;
  return svgShell(W, Ht, body, opts.title ?? '박스 암거 단면도');
}

/** ③ 교량 일반도 — 횡단면(거더 배치+바닥판) + 종단(지간) */
export function bridgeGeneralSvg(bm, opts = {}) {
  const { span = 30000, nGirders = 4, girderSpacing = 2500, girderH = 1800, deckThk = 240, overhang = 1100, deckW } = bm;
  const DW = deckW ?? girderSpacing * (nGirders - 1) + 2 * overhang;
  const sec = bm.section ?? { topW: Math.round(0.35 * girderH), botW: Math.round(0.3 * girderH), topT: Math.round(0.12 * girderH), botT: Math.round(0.12 * girderH), webT: Math.max(200, Math.round(0.1 * girderH)) };
  const M = 80, S1 = 560 / DW;
  const W = 760, Ht = 560;
  // 횡단면 (상단)
  const y0 = 70, dh = deckThk * S1, gh = girderH * S1;
  let girders = '';
  for (let i = 0; i < nGirders; i++) {
    const cx = M + (overhang + i * girderSpacing) * S1;
    const tw = sec.topW * S1, bw2 = sec.botW * S1, wt = sec.webT * S1, ft = sec.topT * S1, fb = sec.botT * S1;
    girders += `<path class="out2" d="M ${cx - tw / 2} ${y0 + dh} h ${tw} v ${ft} h ${-(tw - wt) / 2} V ${y0 + dh + gh - fb} h ${(bw2 - wt) / 2} v ${fb} h ${-bw2} v ${-fb} h ${(bw2 - wt) / 2} V ${y0 + dh + ft} h ${-(tw - wt) / 2} z"/>`;
  }
  const cross = `
<rect class="out" x="${M}" y="${y0}" width="${DW * S1}" height="${dh}"/>
${girders}
${dim(M, y0 + dh + gh, M + DW * S1, y0 + dh + gh, `${Math.round(DW)}`, 34)}
${dim(M + overhang * S1, y0 + dh + gh, M + (overhang + girderSpacing) * S1, y0 + dh + gh, `${girderSpacing}`, 60)}
${dim(M + DW * S1, y0, M + DW * S1, y0 + dh + gh, `${girderH + deckThk}`, 26)}
<text class="note" x="${M}" y="${y0 - 10}">횡단면 — 거더 ${nGirders}본 @${girderSpacing}</text>`;
  // 종단 (하단)
  const y1 = 340, S2 = 600 / span;
  const elev = `
<rect class="out" x="${M}" y="${y1}" width="${span * S2}" height="${(deckThk + girderH) * S2 * 6}"/>
<polygon class="out2" points="${M - 16},${y1 + 90} ${M + 16},${y1 + 90} ${M},${y1 + 60}"/>
<polygon class="out2" points="${M + span * S2 - 16},${y1 + 90} ${M + span * S2 + 16},${y1 + 90} ${M + span * S2},${y1 + 60}"/>
${dim(M, y1 + 100, M + span * S2, y1 + 100, `지간 L = ${span}`, 26)}
<text class="note" x="${M}" y="${y1 - 10}">종단면 — 단순지지(받침 개념 표기)</text>
<text class="note" x="${M}" y="${Ht - 14}">치수 mm · 일반도(비법정) — 받침·신축이음·방호 상세 별도</text>`;
  return svgShell(W, Ht, cross + elev, opts.title ?? '거더교 일반도');
}

/** ④ 인테리어 평면도 — 벽·문·가구·치수 + 피난 오버레이(최원점·출구 방향) */
export function interiorPlanSvg(assembly, opts = {}) {
  const rb = assembly?.roomBounds;
  if (!rb?.W || !rb?.D) return svgShell(400, 120, '<text class="note" x="20" y="70">roomBounds 필요</text>', '인테리어 평면도');
  const M = 80, S = 560 / Math.max(rb.W, rb.D);
  const W = rb.W * S + 2 * M + 60, Ht = rb.D * S + 2 * M + 70;
  const x0 = M, y0 = M;
  const px = (x) => x0 + x * S, py = (y) => y0 + y * S;
  let items = '';
  for (const p of assembly.parts ?? []) {
    const at = p.at ?? {};
    if (p.role === 'table' || p.role === 'chair' || p.role === 'counter') {
      const w = (p.params?.width ?? p.params?.diameter ?? 600), d = (p.params?.depth ?? p.params?.diameter ?? 600);
      items += `<rect x="${px(at.tx ?? 0)}" y="${py(at.ty ?? 0)}" width="${w * S}" height="${d * S}" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.2"/>`;
    }
  }
  // 벽(외곽) + 문(출구)
  let doors = '';
  for (const ex of assembly.exits ?? []) {
    const wdt = (ex.widthMm ?? 900) * S;
    doors += `<line x1="${px(ex.x) - wdt / 2}" y1="${py(ex.y ?? 0)}" x2="${px(ex.x) + wdt / 2}" y2="${py(ex.y ?? 0)}" stroke="#16a34a" stroke-width="6"/>
<text class="note" x="${px(ex.x)}" y="${py(ex.y ?? 0) - 8}" text-anchor="middle" fill="#16a34a">출구 ${ex.widthMm ?? 900}</text>`;
  }
  // 피난 오버레이: 최원점 + 출구 방향 화살표
  let egress = '';
  const fp = opts.farthestPointMm;
  if (Array.isArray(fp)) {
    const ex0 = (assembly.exits ?? [])[0];
    egress = `<circle cx="${px(fp[0])}" cy="${py(fp[1])}" r="9" fill="none" stroke="#dc2626" stroke-width="2.5"/>
<text class="note" x="${px(fp[0]) + 12}" y="${py(fp[1]) - 6}" fill="#dc2626">최원점${opts.maxTravelM ? ` ${opts.maxTravelM}m` : ''}</text>
${ex0 ? `<line class="rebar" x1="${px(fp[0])}" y1="${py(fp[1])}" x2="${px(ex0.x)}" y2="${py(ex0.y ?? 0)}"/>` : ''}`;
  }
  const body = `
<rect class="out" x="${x0}" y="${y0}" width="${rb.W * S}" height="${rb.D * S}" fill="#fff"/>
${items}${doors}${egress}
${dim(x0, y0 + rb.D * S, x0 + rb.W * S, y0 + rb.D * S, `${rb.W}`, 30)}
${dim(x0 + rb.W * S, y0, x0 + rb.W * S, y0 + rb.D * S, `${rb.D}`, 26)}
<text class="note" x="${x0}" y="${Ht - 12}">치수 mm · 피난선=최단경로 개념(격자 실측은 리포트) · 비법정</text>`;
  return svgShell(W, Ht, body, opts.title ?? '인테리어 평면도');
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('section-drawings.mjs');
if (isMain) {
  let ok = 0, tot = 0;
  const chk = (n, svg, ...must) => { tot++; if (must.every((m) => svg.includes(m))) ok++; else console.log('✗', n); };
  chk('옹벽', retainingWallSectionSvg({ H: 3000, baseWidth: 2000, baseThickness: 400, stemThickness: 300, toeLength: 600 }), '3000', '2000', '개념 단면');
  chk('암거', boxCulvertSectionSvg({ innerWidth: 4, innerHeight: 4, wallThk: 0.35, topThk: 0.4, botThk: 0.45 }), '내폭 4000', '4700');
  chk('교량', bridgeGeneralSvg({ span: 30000, nGirders: 4, girderSpacing: 2500, girderH: 1800, deckThk: 240, overhang: 1100 }), '지간 L = 30000', '거더 4본');
  const asm = { roomBounds: { W: 8000, D: 6000 }, exits: [{ x: 4000, y: 0, widthMm: 1000 }], parts: [{ role: 'table', params: { width: 800, depth: 800 }, at: { tx: 2000, ty: 2000 } }] };
  chk('인테리어', interiorPlanSvg(asm, { farthestPointMm: [7500, 5500], maxTravelM: 9.6 }), '8000', '최원점 9.6m', '출구 1000');
  console.log(`section-drawings self-test: ${ok}/${tot}${ok === tot ? ' PASS' : ' FAIL'}`);
  if (ok !== tot) process.exit(1);
}

/** ⑤ RC 보 배근 단면 상세도 — As(mm²)+철근 호칭 → 본수·배치 결정론(피복·간격 검사). */
export function rebarSectionSvg(p, opts = {}) {
  const { b = 300, h = 600, As = 0, barDia = 22, cover = 40, stirrupDia = 10 } = p;
  const area1 = Math.PI * barDia * barDia / 4;
  const n = As > 0 ? Math.ceil(As / area1) : 0;
  const clearMin = Math.max(25, barDia); // KDS 순간격 관례(25mm·db)
  const usableW = b - 2 * (cover + stirrupDia) - barDia;
  const maxPerRow = Math.max(2, Math.floor(usableW / (barDia + clearMin)) + 1);
  const rows = n > 0 ? Math.ceil(n / maxPerRow) : 0;
  const M = 70, S = 380 / Math.max(b, h);
  const W = b * S + 2 * M + 80, Ht = h * S + 2 * M + 60;
  const x0 = M, y0 = M;
  let bars = '';
  let placed = 0;
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(maxPerRow, n - placed);
    for (let i = 0; i < inRow; i++) {
      const cx = x0 + (cover + stirrupDia + barDia / 2) * S + (inRow > 1 ? i * ((b - 2 * (cover + stirrupDia) - barDia) / (inRow - 1)) * S : (b / 2 - cover - stirrupDia - barDia / 2) * S);
      const cy = y0 + (h - cover - stirrupDia - barDia / 2 - r * (barDia + clearMin)) * S;
      bars += `<circle cx="${cx}" cy="${cy}" r="${(barDia / 2) * S}" fill="#dc2626"/>`;
      placed++;
    }
  }
  const spacingOk = n <= 1 || usableW / Math.max(1, Math.min(n, maxPerRow) - 1) >= barDia + clearMin;
  const body = `
<rect class="out" x="${x0}" y="${y0}" width="${b * S}" height="${h * S}"/>
<rect fill="none" stroke="#16a34a" stroke-width="1.5" x="${x0 + cover * S}" y="${y0 + cover * S}" width="${(b - 2 * cover) * S}" height="${(h - 2 * cover) * S}" rx="${6 * S}"/>
${bars}
${dim(x0, y0 + h * S, x0 + b * S, y0 + h * S, `${b}`, 28)}
${dim(x0 + b * S, y0, x0 + b * S, y0 + h * S, `${h}`, 24)}
<text class="note" x="${x0}" y="${Ht - 30}">인장철근 ${n}-D${barDia} (As,req ${Math.round(As)} → As,prov ${Math.round(n * area1)}mm²) · ${rows}단 · 스터럽 D${stirrupDia}(초록)</text>
<text class="note" x="${x0}" y="${Ht - 12}">피복 ${cover} · 순간격 ${spacingOk ? '적합' : '⚠ 부족 — 단수·지름 조정 필요'}(≥max(25,db)) · 개념 배치(비법정)</text>`;
  return svgShell(W, Ht, body, opts.title ?? `보 배근 단면 ${b}×${h}`);
}

/**
 * 배근 전개도(입면) — 보/기둥. 실시도면 소스용 SVG.
 * 보: 상/하부 주근 라인 + 스터럽 틱(단부 s1 구간·중앙 s2 구간 — KDS 전단설계 관례 배치,
 *     구간장은 입력(기본 L/4 명시)) + 치수선. 정착/이음 위치는 표기만(상세 설계 별도 명시).
 * 기둥: 주근 수직 라인 + 띠철근 틱(단부 밀집 s1·중앙 s2) — 이음 구간 표기.
 * 전 치수 = 입력값 그대로(지어내지 않음). 판정 없음(도면 소스) — 간격 적정성은 계산기 몫.
 */
export function rebarElevationSvg(p, opts = {}) {
  const type = p.type === 'column' ? 'column' : 'beam';
  const L = Number(p.L_mm) > 0 ? p.L_mm : 6000;          // 보 경간 또는 기둥 층고
  const h = Number(p.h_mm) > 0 ? p.h_mm : 600;           // 단면 깊이(보) / 폭(기둥 표기)
  const s1 = Number(p.sEnd_mm) > 0 ? p.sEnd_mm : 150;    // 단부 간격
  const s2 = Number(p.sMid_mm) > 0 ? p.sMid_mm : 300;    // 중앙 간격
  const endLen = Number(p.endZone_mm) > 0 ? p.endZone_mm : Math.round(L / 4); // 단부 구간(기본 L/4 관례 — 명시)
  const topBars = String(p.topBars ?? '2-D22');
  const botBars = String(p.botBars ?? '4-D22');
  const tie = String(p.stirrup ?? 'D10');
  const title = p.title ?? (type === 'beam' ? '보 배근 전개도(입면)' : '기둥 배근 전개도(입면)');
  const scale = 760 / L;
  const hh = Math.min(180, h * scale * 2.2);
  const M = 60, W = 760 + 2 * M, Ht = hh + 2 * M + 90;
  const x0 = M, y0 = M + 20;
  const cov = 10; // 표현용 오프셋(px) — 도면 표기이지 실피복 아님(라벨로 명시)
  // 스터럽/띠 틱: 단부(양측 endLen, s1) + 중앙(s2)
  let ticks = '';
  const tickAt = (xmm) => {
    const x = x0 + xmm * scale;
    ticks += type === 'beam'
      ? `<line x1="${x}" y1="${y0 + cov}" x2="${x}" y2="${y0 + hh - cov}" stroke="#0ea5e9" stroke-width="1"/>`
      : `<line x1="${x0 + cov}" y1="${y0 + xmm * 0}" x2="${x0 + cov}" y2="0" stroke="none"/>`;
  };
  if (type === 'beam') {
    for (let x = s1; x < endLen; x += s1) tickAt(x);
    for (let x = L - s1; x > L - endLen; x -= s1) tickAt(x);
    for (let x = endLen + s2 / 2; x <= L - endLen; x += s2) tickAt(x);
  }
  let colTicks = '';
  if (type === 'column') {
    const yScale = 760 / L; // 기둥은 세로로 — 재사용 위해 가로 그리드 유지: 눕혀 그린 뒤 회전 대신 가로 표현 명시
    for (let x = s1; x < endLen; x += s1) { const xx = x0 + x * yScale; colTicks += `<line x1="${xx}" y1="${y0 + cov}" x2="${xx}" y2="${y0 + hh - cov}" stroke="#0ea5e9" stroke-width="1"/>`; }
    for (let x = L - s1; x > L - endLen; x -= s1) { const xx = x0 + x * yScale; colTicks += `<line x1="${xx}" y1="${y0 + cov}" x2="${xx}" y2="${y0 + hh - cov}" stroke="#0ea5e9" stroke-width="1"/>`; }
    for (let x = endLen + s2 / 2; x <= L - endLen; x += s2) { const xx = x0 + x * yScale; colTicks += `<line x1="${xx}" y1="${y0 + cov}" x2="${xx}" y2="${y0 + hh - cov}" stroke="#0ea5e9" stroke-width="1"/>`; }
  }
  const endPx = endLen * scale;
  const dim = (xa, xb, y, label) =>
    `<line x1="${xa}" y1="${y}" x2="${xb}" y2="${y}" stroke="#475569" stroke-width="0.8"/>` +
    `<line x1="${xa}" y1="${y - 4}" x2="${xa}" y2="${y + 4}" stroke="#475569" stroke-width="0.8"/>` +
    `<line x1="${xb}" y1="${y - 4}" x2="${xb}" y2="${y + 4}" stroke="#475569" stroke-width="0.8"/>` +
    `<text x="${(xa + xb) / 2}" y="${y - 6}" text-anchor="middle" font-size="11" fill="#334155">${label}</text>`;
  const dy = y0 + hh + 28;
  const labelAxis = type === 'beam' ? '경간' : '층고(눕힌 표현 — 표기 명시)';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Ht}" font-family="system-ui">
<style>.out{fill:#f8fafc;stroke:#0f172a;stroke-width:1.6}.bar{stroke:#dc2626;stroke-width:2.5}</style>
<text x="${W / 2}" y="24" text-anchor="middle" font-size="14" font-weight="700" fill="#0f172a">${title}</text>
<rect class="out" x="${x0}" y="${y0}" width="${760}" height="${hh}"/>
<line class="bar" x1="${x0 + 6}" y1="${y0 + cov}" x2="${x0 + 754}" y2="${y0 + cov}"/>
<line class="bar" x1="${x0 + 6}" y1="${y0 + hh - cov}" x2="${x0 + 754}" y2="${y0 + hh - cov}"/>
${type === 'beam' ? ticks : colTicks}
<text x="${x0 + 8}" y="${y0 + cov - 5}" font-size="11" fill="#dc2626">상부 ${topBars}</text>
<text x="${x0 + 8}" y="${y0 + hh - cov + 14}" font-size="11" fill="#dc2626">하부 ${botBars}</text>
<text x="${x0 + endPx / 2}" y="${y0 - 6}" text-anchor="middle" font-size="11" fill="#0ea5e9">${tie}@${s1}</text>
<text x="${x0 + 380}" y="${y0 - 6}" text-anchor="middle" font-size="11" fill="#0ea5e9">${tie}@${s2}</text>
<text x="${x0 + 760 - endPx / 2}" y="${y0 - 6}" text-anchor="middle" font-size="11" fill="#0ea5e9">${tie}@${s1}</text>
${dim(x0, x0 + endPx, dy, `단부 ${endLen}`)}
${dim(x0 + endPx, x0 + 760 - endPx, dy, `중앙 ${L - 2 * endLen}`)}
${dim(x0 + 760 - endPx, x0 + 760, dy, `단부 ${endLen}`)}
${dim(x0, x0 + 760, dy + 26, `${labelAxis} L=${L}`)}
<text x="${x0}" y="${Ht - 8}" font-size="10" fill="#64748b">표현용 개략 축척 — 정착·이음 상세는 KDS 14 20 52 별도 설계 명시. 단부구간 ${Number(p.endZone_mm) > 0 ? '입력값' : 'L/4 기본(관례 명시)'}.</text>
</svg>`;
  return svg;
}
