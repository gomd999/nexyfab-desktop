/**
 * part-sheets.mjs — 부품 단품 제작도 시트(G2, 260718 실시 트랙).
 *
 * BOM 그룹 대표 부품별 제작도: 3면도(정면/평면/측면)+주요 치수+표제란(도번 연번·
 * 시트 n/N — GA 밸룬 번호와 동일 그룹 번호로 연결). 회전체=평면 원+중심선.
 * 공차·표면 거칠기·판금 전개는 후속(GD&T 연동) — 시트에 입력 원칙 명시.
 */
import { partAabb } from './reconstruct.mjs';
import { colorOf } from './assembly.mjs';
import { snapPipe, snapSquareTube } from './std-snap.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 2 : 0) + 'm' : Math.round(v) + '');

/** 어셈블리 → 그룹 대표 부품 제작도 HTML(전 시트 단일 파일 — @media print 시트 분할). */
export function partSheets(assembly, { title = '부품 제작도', dwgPrefix = 'NX-PT', maxSheets = 24 } = {}) {
  const parts = assembly.parts ?? [];
  // GA 와 동일한 그룹핑(type|role|로컬치수|재질)
  const gIdx = new Map();
  const groups = [];
  for (const p of parts) {
    let dims = [0, 0, 0];
    try { const a = partAabb(p.type, p.params); dims = [a.max[0] - a.min[0], a.max[1] - a.min[1], a.max[2] - a.min[2]]; } catch { /* skip */ }
    const key = `${p.type}|${p.role ?? ''}|${dims.map((v) => Math.round(v)).join('x')}|${p.material ?? ''}`;
    if (!gIdx.has(key)) { gIdx.set(key, groups.length); groups.push({ rep: p, dims, count: 0 }); }
    groups[gIdx.get(key)].count++;
  }
  const sheets = groups.slice(0, maxSheets);
  const N = sheets.length;
  const stdOf = (p) => {
    try {
      if (p.role === 'pipe' && p.type === 'cylinder') { const r = snapPipe(p.params.diameter); return r.ok ? `${r.label} ${r.spec}` : ''; }
      if (p.type === 'box' && (p.role === 'column' || p.role === 'beam') && p.params.width === p.params.depth) { const r = snapSquareTube(p.params.width); return r.ok ? `${r.label} ${r.spec}` : ''; }
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
    const dimH = (w, y, label) => `<line x1="30" y1="${y}" x2="${(30 + w * sc).toFixed(1)}" y2="${y}" stroke="#b91c1c" stroke-width=".7"/><text x="${(30 + w * sc / 2).toFixed(1)}" y="${y - 3}" font-size="10" fill="#b91c1c" text-anchor="middle">${label}</text>`;
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
    return `<div class="psheet"><div class="ph"><b>부품 No.${i + 1}</b> — ${esc(p.id ?? p.type)}${g.count > 1 ? ` (동일 ${g.count}개)` : ''} <span class="sub">GA 밸룬 ${i + 1} 연동</span></div>
<div class="views"><div><div class="vt">FRONT</div>${front}</div><div><div class="vt">PLAN</div>${plan}</div><div><div class="vt">SIDE</div>${side}</div></div>
<table class="pt"><tbody>
<tr><td>Type</td><td>${esc(p.type)}</td><td>재질</td><td>${esc(p.material ?? '-')}</td></tr>
<tr><td>엔벨로프</td><td>${fmt(dx)}×${fmt(dy)}×${fmt(dz)}</td><td>발주 규격</td><td>${esc(std || '- (가공품)')}</td></tr>
<tr><td>도번</td><td data-dwg="${dwgNo}">${dwgNo}</td><td>시트</td><td>${i + 1} / ${N}</td></tr>
</tbody></table>
<div class="note">공차·표면 거칠기·용접 상세=입력 원칙(GD&T 연동 후속) · 회전체 실형상은 STEP 참조(본 도면=엔벨로프+주요 치수)</div></div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 landscape;margin:10mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937}
.psheet{max-width:1050px;margin:14px auto;background:#fff;border:1px solid #cbd5e1;padding:12px 18px;box-shadow:0 3px 16px rgba(0,0,0,.08)}
.ph{font-size:14px;border-bottom:2px solid #1f2937;padding-bottom:6px}.sub{font-size:11px;color:#64748b;font-weight:400}
.views{display:flex;gap:26px;padding:12px 0;flex-wrap:wrap}.vt{font-size:11px;font-weight:700;color:#475569;margin-bottom:2px}
.pt{border-collapse:collapse;font-size:11px}.pt td{border:1px solid #cbd5e1;padding:3px 10px}.pt td:nth-child(odd){background:#f1f5f9}
.note{font-size:10.5px;color:#94a3b8;margin-top:6px}
@media print{body{background:#fff}.psheet{box-shadow:none;border:none;page-break-after:always;margin:0}}</style></head>
<body><div style="max-width:1050px;margin:14px auto;font-size:15px;font-weight:700">${esc(title)} — 그룹 대표 ${N}종(총 부품 ${parts.length})</div>${sheetHtml}</body></html>`;
}
