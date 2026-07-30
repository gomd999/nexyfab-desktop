/**
 * part-sheets.mjs — 부품 단품 제작도 시트(G2, 260718 실시 트랙).
 *
 * BOM 그룹 대표 부품별 제작도: 3면도(정면/평면/측면)+주요 치수+표제란(도번 연번·
 * 시트 n/N — GA 밸룬 번호와 동일 그룹 번호로 연결). 회전체=평면 원+중심선.
 * 공차·표면 거칠기·판금 전개는 후속(GD&T 연동) — 시트에 입력 원칙 명시.
 */
import { partAabb, holeFeature, PARAMS } from './reconstruct.mjs';
import { colorOf } from './assembly.mjs';
import { snapPipe, snapSquareTube, snapTslot, snapBearingUnit } from './std-snap.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/**
 * 제작 치수 표시 — **값을 바꾸지 않는 선에서** 부동소수 잔재만 없앤다 (260802).
 *
 * ⚠ 라이브 도면에 `width=3520.0000000000005` 가 나갔다. 좌표가 아니라 **제작 치수**라
 *   더 나쁘다 — 읽는 사람은 「0.0000000000005mm 까지 관리하라는 건가」로 읽을 수 있다.
 *   실제 값은 3520 이고, 잔재는 형상 생성 중 누적된 부동소수 오차다.
 * ⚠ **반올림으로 값을 바꾸지 않는다.** 소수 4자리로 정리하되, 그래도 달라지는 값은
 *   원값을 그대로 둔다(정말 그 자릿수가 의미 있는 치수일 수 있다).
 */
const dimVal = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v ?? '—';
  const clean = Math.round(v * 1e4) / 1e4;
  // ① 부동소수 잔재(1e-9 이내) — 값이 사실상 같으므로 그냥 정리한다.
  if (Math.abs(clean - v) < 1e-9) return clean;
  /**
   * ② **진짜 무리수**(대각재 길이 등 √ 계산 결과). 실측: 타워크레인 대각재
   *    `width=1881.923804014225`. 값을 죽이면 안 되지만 **제작 도면에 소수 12자리는
   *    의미가 없다** — 그 정밀도로 자를 수 있는 공정이 없다.
   *    소수 2자리로 표시하되 **≈ 를 붙여 근사임을 밝힌다.** 값을 숨기지 않는다.
   */
  return `≈${v.toFixed(2)}`;
};

const fmt = (v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 2 : 0) + 'm' : Math.round(v) + '');

/** 어셈블리 → 그룹 대표 부품 제작도 HTML(전 시트 단일 파일 — @media print 시트 분할). */
export function partSheets(assembly, { title = '부품 제작도', dwgPrefix = 'NX-PT', maxSheets = 24 } = {}) {
  const parts = assembly.parts ?? [];
  // GA 와 동일한 그룹핑(type|role|로컬치수|재질)
  const gIdx = new Map();
  const groups = [];
  /**
   * ⚠ 260728 실측 결함 수정 — 호출 규약이 틀려 **모든 부품에서 던지고 있었다.**
   * `partAabb(i)` 는 **단일 객체** `{type, ...params}` 를 받는다(다른 호출처 10곳 전부 그렇게
   * 부른다). 여기만 `partAabb(p.type, p.params)` 2인자로 불러 `i.type === undefined` 로 매번
   * throw 했고, 아래 catch 가 그것을 삼켜 **dims 가 항상 [0,0,0]** 이 됐다.
   *
   * 결과가 조용해서 더 나빴다: 크기가 다른 부재가 `type|role|0x0x0|material` 로 **한 군에
   * 뭉쳐** 제작도가 대표 1장만 나갔다. 송전탑 99부재(길이 5종 브레이스)가 5군으로 묶였고,
   * 그 길이들이 도면 어디에도 인쇄되지 않아 실시검도 M1 이 "치수 누락"으로 잡고 있었다 —
   * M1 은 제 일을 하고 있었고 원인이 여기였다.
   * (같은 오호출이 `html-render.mjs` 에서 한 번 잡힌 적이 있다 — 재발한 것이다.)
   *
   * 이제 실패를 삼키지 않는다: AABB 를 못 구하면 **부품 id 를 키에 넣어** 서로 다른 부품이
   * 같은 군으로 뭉치지 않게 하고, 그 사실을 `unsized` 로 세어 시트에 표기한다.
   */
  let unsized = 0;
  for (const p of parts) {
    let dims = null;
    try {
      const a = partAabb({ type: p.type, ...p.params });
      dims = [a.max[0] - a.min[0], a.max[1] - a.min[1], a.max[2] - a.min[2]];
    } catch { unsized++; }
    const sizeKey = dims ? dims.map((v) => Math.round(v)).join('x') : `unsized:${p.id ?? p.type}`;
    const key = `${p.type}|${p.role ?? ''}|${sizeKey}|${p.material ?? ''}`;
    if (!gIdx.has(key)) { gIdx.set(key, groups.length); groups.push({ rep: p, dims: dims ?? [0, 0, 0], count: 0, unsized: !dims }); }
    groups[gIdx.get(key)].count++;
  }
  const sheets = groups.slice(0, maxSheets);
  const N = sheets.length;
  const stdOf = (p) => {
    try {
      if (p.role === 'pipe' && p.type === 'cylinder') { const r = snapPipe(p.params.diameter); return r.ok ? `${r.label} ${r.spec}` : ''; }
      if (p.type === 'pillow_block') { const r = snapBearingUnit(p.params.boreDia); return r.ok ? `${r.label} ${r.spec}` : ''; } // R2-⑪
      if (p.type === 'box' && (p.role === 'column' || p.role === 'beam')) {
        if (/alu/i.test(String(p.material ?? ''))) { const r = snapTslot(p.params.width, p.params.depth); return r.ok ? `${r.label} ${r.spec}` : ''; } // R2-⑪
        if (p.params.width === p.params.depth) { const r = snapSquareTube(p.params.width); return r.ok ? `${r.label} ${r.spec}` : ''; }
      }
    } catch { /* 없음 */ }
    return '';
  };
  const sheetHtml = sheets.map((g, i) => {
    const p = g.rep;
    const [dx, dy, dz] = g.dims.map((v) => Math.max(v, 1));
    const isRot = (p.type === 'cylinder' || p.type === 'revolve') ;
    const box = 300; // 뷰 상자 px
    const sc = box / Math.max(dx, dy, dz) * 0.8;
    const vw = (w, h) => `width="${Math.max(60, w * sc + 60).toFixed(0)}" height="${Math.max(60, h * sc + 60).toFixed(0)}"`;
    const rect = (w, h, cx = 30, cy = 30) => `<rect x="${cx}" y="${cy}" width="${(w * sc).toFixed(1)}" height="${(h * sc).toFixed(1)}" fill="#f1f5f9" stroke="${colorOf(p)}" stroke-width="1.4"/>`;
    /**
     * ⚠ 260802 — `y` 가 원값 그대로 나가 `y1="58.400000000000006"` 이 도면에 찍혔다.
     *   **기입 치수가 아니라 SVG 좌표**라 형상에는 영향이 없지만, 16자리 부동소수 잔재는
     *   파일을 키우고 「이만큼 정밀하다」로 오독될 여지를 준다. 좌표는 소수 1자리로 고정한다
     *   (치수 텍스트는 `fmt` 가 따로 반올림한다 — 둘을 섞지 않는다).
     */
    const c1 = (v) => Number(v).toFixed(1);
    const dimH = (w, y, label) => `<line x1="30" y1="${c1(y)}" x2="${(30 + w * sc).toFixed(1)}" y2="${c1(y)}" stroke="#b91c1c" stroke-width=".7"/><text x="${(30 + w * sc / 2).toFixed(1)}" y="${c1(y - 3)}" font-size="10" fill="#b91c1c" text-anchor="middle">${label}</text>`;
    const dimV = (h, x, label) => `<line x1="${x}" y1="30" x2="${x}" y2="${(30 + h * sc).toFixed(1)}" stroke="#b91c1c" stroke-width=".7"/><text x="${x - 4}" y="${(30 + h * sc / 2).toFixed(1)}" font-size="10" fill="#b91c1c" text-anchor="end" transform="rotate(-90 ${x - 4} ${(30 + h * sc / 2).toFixed(1)})">${label}</text>`;
    // FRONT(x-z) · PLAN(x-y | 회전체=원) · SIDE(y-z)
    const front = `<svg ${vw(dx, dz)}>${rect(dx, dz)}${dimH(dx, (30 + dz * sc + 14), fmt(dx))}${dimV(dz, 18, fmt(dz))}${isRot ? `<line x1="${(30 + dx * sc / 2).toFixed(1)}" y1="24" x2="${(30 + dx * sc / 2).toFixed(1)}" y2="${(36 + dz * sc).toFixed(1)}" stroke="#94a3b8" stroke-width=".6" stroke-dasharray="8 2 2 2"/>` : ''}</svg>`;
    const planInner = isRot
      ? `<circle cx="${(30 + dx * sc / 2).toFixed(1)}" cy="${(30 + dy * sc / 2).toFixed(1)}" r="${(Math.min(dx, dy) * sc / 2).toFixed(1)}" fill="#f1f5f9" stroke="${colorOf(p)}" stroke-width="1.4"/><line x1="24" y1="${(30 + dy * sc / 2).toFixed(1)}" x2="${(36 + dx * sc).toFixed(1)}" y2="${(30 + dy * sc / 2).toFixed(1)}" stroke="#94a3b8" stroke-width=".6" stroke-dasharray="8 2 2 2"/><line x1="${(30 + dx * sc / 2).toFixed(1)}" y1="24" x2="${(30 + dx * sc / 2).toFixed(1)}" y2="${(36 + dy * sc).toFixed(1)}" stroke="#94a3b8" stroke-width=".6" stroke-dasharray="8 2 2 2"/><text x="${(30 + dx * sc / 2 + 6).toFixed(1)}" y="${(26 + dy * sc / 2 - 6).toFixed(1)}" font-size="10" fill="#b91c1c">⌀${fmt(Math.min(dx, dy))}</text>`
      : `${rect(dx, dy)}${dimH(dx, (30 + dy * sc + 14), fmt(dx))}${dimV(dy, 18, fmt(dy))}`;
    const plan = `<svg ${vw(dx, dy)}>${planInner}</svg>`;
    const side = `<svg ${vw(dy, dz)}>${rect(dy, dz)}${dimH(dy, (30 + dz * sc + 14), fmt(dy))}</svg>`;
    const dwgNo = `${dwgPrefix}-${String(i + 1).padStart(3, '0')}`;
    const std = stdOf(p);
    // T1 구멍표(hole table, 260719): 제조 피처 어휘와 짝 — 동일 규격 그룹 N×표기(도면 관례)
    let holeTable = '';
    if (p.type === 'plate_with_holes' && (p.params?.holes ?? []).length) {
      const groups = new Map();
      for (const h of p.params.holes) {
        const f = holeFeature(h, p.params.thickness);
        if (!groups.has(f.label)) groups.set(f.label, []);
        groups.get(f.label).push(h);
      }
      const rows = [...groups.entries()].map(([label, hs], gi) => {
        const sym = String.fromCharCode(65 + gi); // A, B, C…
        return `<tr><td>${sym}</td><td>${esc(label)}</td><td>${hs.length}</td><td style="text-align:left">${hs.map((h) => `(${h.x}, ${h.y})`).join(' ')}</td></tr>`;
      }).join('');
      holeTable = `<table class="pt" style="margin-top:6px"><thead><tr><th>기호</th><th>구멍 규격</th><th>수량</th><th>위치 (x, y)</th></tr></thead><tbody>${rows}</tbody></table>
<div class="note">구멍표 — 상면 기준 가공 · 탭=보통나사(형상은 하경 표현, 나사산=표기 전달) · ⌴=카운터보어 ⌵=카운터싱크</div>`;
    }
    return `<div class="psheet"><div class="ph"><b>부품 No.${i + 1}</b> — ${esc(p.id ?? p.type)}${g.count > 1 ? ` (동일 ${g.count}개)` : ''} <span class="sub">GA 밸룬 ${i + 1} 연동</span></div>
<div class="views"><div><div class="vt">FRONT</div>${front}</div><div><div class="vt">PLAN</div>${plan}</div><div><div class="vt">SIDE</div>${side}</div></div>
<table class="pt"><tbody>
<tr><td>Type</td><td>${esc(p.type)}</td><td>재질</td><td>${esc(p.material ?? '-')}</td></tr>
<tr><td>엔벨로프</td><td>${fmt(dx)}×${fmt(dy)}×${fmt(dz)}</td><td>발주 규격</td><td>${esc(std || '- (가공품)')}</td></tr>
<tr><td>도번</td><td data-dwg="${dwgNo}">${dwgNo}</td><td>시트</td><td>${i + 1} / ${N}</td></tr>
${PARAMS[p.type] ? `<tr><td>제작 치수</td><td colspan="3" style="text-align:left" class="nf-paramdims">${PARAMS[p.type].map((k) => `${k}=${dimVal(p.params?.[k])}`).join(' · ')}</td></tr>` : ''}
</tbody></table>${holeTable}
<div class="note">공차·표면 거칠기·용접 상세=입력 원칙(GD&T 연동 후속) · 회전체 실형상은 STEP 참조(본 도면=엔벨로프+주요 치수)</div></div>`;
  }).join('');
  // R2-①(260719): 임포트 STEP 의 AP242 시맨틱 PMI 가 있으면 공차표 표기(어셈블리 수준 —
  // 부품별 형상 연결(shape aspect 매핑)은 v1 범위 외 명시. 값=모델 내장 공차의 판독).
  const gdt = assembly.gdt;
  const gdtHtml = gdt && (gdt.geoTols?.length || gdt.dims?.length)
    ? `<div class="psheet"><div class="ph"><b>공차 판독표 (AP242 시맨틱 PMI)</b> <span class="sub">데이텀 ${esc((gdt.datums ?? []).join(', ') || '—')} · 부품별 형상 매핑=후속(어셈블리 수준 표)</span></div>
${gdt.geoTols?.length ? `<table class="pt" style="margin-top:8px"><thead><tr><th>기호</th><th>공차</th><th>크기(mm)</th><th>데이텀</th><th>이름</th></tr></thead><tbody>
${gdt.geoTols.map((g) => `<tr><td style="font-size:15px">${esc(g.symbol)}</td><td>${esc(g.kind.replace(/_TOLERANCE$/, ''))}</td><td>${g.magnitudeMm ?? '<i>미해석</i>'}</td><td>${esc((g.datums ?? []).join('|') || '—')}${g.modifiers?.length ? ' Ⓜ' : ''}</td><td style="text-align:left">${esc(g.name ?? '')}</td></tr>`).join('')}
</tbody></table>` : ''}
${gdt.dims?.length ? `<table class="pt" style="margin-top:8px"><thead><tr><th>치수</th><th>공칭</th><th>하한</th><th>상한</th></tr></thead><tbody>
${gdt.dims.map((d) => `<tr><td style="text-align:left">${esc(d.name || d.kind)}</td><td>${d.value ?? '—'}</td><td>${d.tol ? d.tol.lower : '—'}</td><td>${d.tol ? d.tol.upper : '—'}</td></tr>`).join('')}
</tbody></table>` : ''}
<div class="note">판독값(결정론 파스) — 그래픽 주석·서피스 텍스처는 범위 외. 발주 전 원 도면 대조.</div></div>`
    : '';
  /**
   * **부재 일람표** — 시트 상한(maxSheets)에 걸려 개별 제작도가 나가지 못한 군 (260728).
   *
   * 종전엔 `groups.slice(0, maxSheets)` 가 나머지를 **조용히 버렸다.** 실측: 현수교 183부재는
   * 57군인데 24군만 발행돼 **33군이 아무 표시 없이 사라졌다**(그 전에는 partAabb 오호출로
   * 전부 한 군에 뭉쳐 있어 이 절단이 드러나지도 않았다). 받는 쪽은 그 부재들이 애초에
   * 없는 줄 안다 — 조용한 절단 금지.
   *
   * 시트를 57장 내는 대신 실제 도면이 쓰는 방식을 쓴다: 나머지를 **표**로 싣는다.
   * 치수가 문서에 실제로 인쇄되므로 실시검도 M1(치수 충분성)도 정직하게 만족된다 —
   * 숫자를 숨긴 채 게이트만 통과시키는 것이 아니다.
   */
  const omitted = groups.slice(maxSheets);
  const scheduleHtml = omitted.length
    ? `<div class="psheet"><div class="ph"><b>부재 일람표</b> — 개별 제작도 미발행 ${omitted.length}종 <span class="sub">시트 상한 ${maxSheets}종 초과분 · 치수는 아래 표가 정본</span></div>
<div class="note" style="color:#b91c1c">이 ${omitted.length}종은 <b>빠뜨린 것이 아니라</b> 시트 상한을 넘어 개별 도면 대신 표로 싣습니다. 제작 치수는 아래 값이 기준입니다.</div>
<table class="pt" style="margin-top:8px"><thead><tr><th>No.</th><th>부재</th><th>Type</th><th>수량</th><th>엔벨로프</th><th>제작 치수</th><th>재질</th></tr></thead><tbody>
${omitted.map((g, k) => {
  const q = g.rep;
  const [ox, oy, oz] = g.dims.map((v) => Math.max(v, 0));
  const dimTxt = PARAMS[q.type]
    ? PARAMS[q.type].map((key) => `${key}=${dimVal(q.params?.[key])}`).join(' · ')
    : '—';
  return `<tr><td>${maxSheets + k + 1}</td><td style="text-align:left">${esc(q.id ?? q.type)}</td><td>${esc(q.type)}</td><td>${g.count}</td><td>${fmt(ox)}×${fmt(oy)}×${fmt(oz)}</td><td style="text-align:left" class="nf-paramdims">${esc(dimTxt)}</td><td>${esc(q.material ?? '-')}</td></tr>`;
}).join('')}
</tbody></table></div>`
    : '';
  const unsizedNote = unsized > 0
    ? `<div class="psheet"><div class="note" style="color:#b91c1c">⚠ 엔벨로프를 산출하지 못한 부재 ${unsized}개 — 그룹핑에서 서로 뭉치지 않도록 부재별로 분리했습니다(치수는 제작 치수 열을 따르세요).</div></div>`
    : '';

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 landscape;margin:10mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937}
.psheet{max-width:1050px;margin:14px auto;background:#fff;border:1px solid #cbd5e1;padding:12px 18px;box-shadow:0 3px 16px rgba(0,0,0,.08)}
.ph{font-size:14px;border-bottom:2px solid #1f2937;padding-bottom:6px}.sub{font-size:11px;color:#64748b;font-weight:400}
.views{display:flex;gap:26px;padding:12px 0;flex-wrap:wrap}.vt{font-size:11px;font-weight:700;color:#475569;margin-bottom:2px}
.pt{border-collapse:collapse;font-size:11px}.pt td{border:1px solid #cbd5e1;padding:3px 10px}.pt td:nth-child(odd){background:#f1f5f9}
.note{font-size:10.5px;color:#94a3b8;margin-top:6px}
@media print{body{background:#fff}.psheet{box-shadow:none;border:none;page-break-after:always;margin:0}}</style></head>
<body><div style="max-width:1050px;margin:14px auto;font-size:15px;font-weight:700">${esc(title)} — 그룹 대표 ${N}종${omitted.length ? ` + 일람표 ${omitted.length}종` : ''}(총 부품 ${parts.length} · ${groups.length}종)</div>${gdtHtml}${sheetHtml}${scheduleHtml}${unsizedNote}</body></html>`;
}
