/**
 * 물량·작업량 산출서 (BOQ, Bill of Quantities) — 형상에서 결정론적으로 물량을 산출.
 * ⚠️ 금액(₩) 미산출 = 실단가·노임·지역·시점 데이터 없이는 날조이므로 뺀다(정직).
 *    물량(질량·면적·길이·수량·용접·구멍·절곡) = 형상에서 확정. 공수(hr) = 표준 원단위 × 물량(개산).
 *    금액은 사용자가 단가를 입력할 때만("입력단가 기준" 명시).
 * 재사용: partVolume/DENSITY(structural), welds(buildAssembly). eng-knowledge BOQ 룰엔진 사상.
 */
import { partVolume, DENSITY } from './structural.mjs';
import { buildAssembly } from './assembly.mjs';
import { gearPoly, sheetPoly, hexPts, polyArea, polyPerimeter, boltDims } from './reconstruct.mjs';
import { takeoff } from '../engineering-core/quantity/takeoff.mjs';

const A = Math.PI / 4;
// 부품 표면적 mm² (도장·산세·도금 물량)
function surfaceMm2(type, p) {
  switch (type) {
    case 'box': return 2 * (p.width * p.depth + p.depth * p.height + p.width * p.height);
    case 'plate_with_holes': case 'stepped_plate': return 2 * (p.width * p.depth) + 2 * (p.width + p.depth) * (p.thickness ?? 3);
    case 'base_plate': return 2 * (p.width * p.depth) + 2 * (p.width + p.depth) * p.thickness;
    case 'l_bracket': return 2 * (p.legA * p.width + p.legB * p.width) + p.thickness * 2 * (p.legA + p.legB + p.width);
    case 'bent_sheet': return 2 * (p.length * (p.webWidth + 2 * p.flangeHeight));
    case 'flange': return 2 * A * (p.outerDia ** 2) + Math.PI * p.outerDia * p.thickness;
    case 'tube': return Math.PI * p.outerDia * p.length + Math.PI * p.innerDia * p.length + 2 * A * (p.outerDia ** 2 - p.innerDia ** 2);
    case 'rect_tube': return 2 * (p.width + p.height) * p.length + 2 * ((p.width - 2 * p.wallThk) + (p.height - 2 * p.wallThk)) * p.length;
    case 'cylinder': return Math.PI * p.diameter * p.length + 2 * A * p.diameter ** 2;
    case 'gusset': return p.legA * p.legB + p.thickness * (p.legA + p.legB + Math.hypot(p.legA, p.legB));
    case 'spur_gear': {
      const poly = gearPoly(p);
      return 2 * (polyArea(poly) - A * (p.boreDia ?? 0) ** 2) + polyPerimeter(poly) * p.thickness + Math.PI * (p.boreDia ?? 0) * p.thickness;
    }
    case 'hex_bolt': {
      const { af, hh } = boltDims(p);
      return 2 * (Math.sqrt(3) / 2) * af ** 2 + polyPerimeter(hexPts(af)) * hh + Math.PI * p.threadDia * p.length;
    }
    case 'sheet_profile': {
      const poly = sheetPoly(p);
      return 2 * polyArea(poly) + polyPerimeter(poly) * p.width;
    }
    case 'wall_with_openings': {
      const face = p.length * p.height - (p.openings ?? []).reduce((s, o) => s + o.w * o.h, 0);
      return 2 * face + 2 * (p.length + p.height) * p.thickness; // 양면(개구 공제) + 둘레 엣지
    }
    default: return 0;
  }
}
const holeCount = (type, p) => type === 'plate_with_holes' ? (p.holes?.length ?? 0) : type === 'flange' ? (p.boltCount ?? 0) : type === 'base_plate' ? 4 : type === 'spur_gear' && p.boreDia > 0 ? 1 : 0;
const bendCount = (type, p) => type === 'bent_sheet' ? 2 : type === 'l_bracket' ? 1 : type === 'sheet_profile' ? (p?.angles ?? []).filter((a) => a !== 0).length : 0;
const isLinear = (type) => type === 'rect_tube' || type === 'tube' || type === 'cylinder';
const linearLenMm = (type, p) => type === 'rect_tube' || type === 'tube' ? p.length : type === 'cylinder' ? p.length : 0;

// 표준 원단위 (hr/단위) — 개산 가정. 사용자/현장 조정 대상.
export const STD_RATES = { weldPerM: 0.15, drillPerHole: 0.03, bendPerBend: 0.10, assyPerPart: 0.20, surfacePerM2: 0.12, cutPerCut: 0.05 };

/** 어셈블리 → 물량·작업량 (금액 제외). 비기계 도메인은 부피(재적 m³) 중심 물량. */
export function computeBOQ(assembly, { material = 'STS316', rates = STD_RATES } = {}) {
  const built = buildAssembly(assembly);
  const parts = assembly.parts ?? [];
  const items = parts.map((p) => {
    const rho = (DENSITY[p.material ?? material] ?? DENSITY.STS316) / 1e9;
    const volMm3 = partVolume(p.type, p.params);
    // qty(260718): 동일 부품 반복 수(대표 1개 배치 — STEP 대표화 임포트). 물량=1개분×qty.
    const qty = Math.max(1, Math.round(Number(p.qty) || 1));
    const massKg = volMm3 * rho * qty;
    return { id: p.id ?? p.type, type: p.type, material: p.material ?? material, qty, massKg: +massKg.toFixed(2), volM3: +(volMm3 * qty / 1e9).toFixed(4), surfaceM2: +(surfaceMm2(p.type, p.params) * qty / 1e6).toFixed(3), holes: holeCount(p.type, p.params) * qty, bends: bendCount(p.type, p.params) * qty, linearLenM: +(linearLenMm(p.type, p.params) * qty / 1000).toFixed(2) };
  });
  // 재질별 집계 (콘크리트 m³·목재 재적 m³ 등 비기계 물량 단위)
  const byMaterial = {};
  for (const it of items) {
    const k = it.material;
    byMaterial[k] = byMaterial[k] ?? { massKg: 0, volM3: 0, surfaceM2: 0, count: 0 };
    byMaterial[k].massKg = +(byMaterial[k].massKg + it.massKg).toFixed(1);
    byMaterial[k].volM3 = +(byMaterial[k].volM3 + it.volM3).toFixed(4);
    byMaterial[k].surfaceM2 = +(byMaterial[k].surfaceM2 + it.surfaceM2).toFixed(2);
    byMaterial[k].count++;
  }
  const sum = (k) => items.reduce((s, x) => s + (x[k] || 0), 0);
  const totalMassKg = +sum('massKg').toFixed(1);
  const surfaceM2 = +sum('surfaceM2').toFixed(2);
  const tubeLenM = +items.filter(x => x.linearLenM).reduce((s, x) => s + x.linearLenM, 0).toFixed(2);
  const holes = sum('holes'), bends = sum('bends');
  const cutCount = parts.filter(p => isLinear(p.type)).length * 2 + parts.filter(p => ['plate_with_holes', 'stepped_plate', 'base_plate', 'l_bracket', 'gusset', 'bent_sheet', 'sheet_profile', 'spur_gear'].includes(p.type)).length;
  const weldTotalMm = built.ok ? (built.weldTotalMm ?? 0) : 0;
  const weldJoints = built.ok ? (built.welds?.length ?? 0) : 0;
  const weldAreaMm2 = built.ok ? (built.welds ?? []).reduce((s, w) => s + (Number(w.throatAreaMm2) || 0), 0) : 0;

  // 배관 물량(#6 확산) — 라우트 길이는 형상(라우터) 결정론이라 물량 산출 가능(날조 아님).
  // 부속류(엘보 개소만 계상)·행거·보온은 미포함 명시.
  let piping = null;
  if (built.ok && built.pipes && built.pipes.routes.length) {
    const segLen = (pts) => { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]); return L; };
    // 티 계상(잔여후보 ④): 한 라인 끝점이 다른 라인 세그먼트 위(끝점 아님)에 접속 = 티.
    // 이경 접속(관경 상이)=이경 티로 함께 계상(리듀서 상세 후속 명시).
    const p2s = (P, A, B) => { // 점-세그먼트 거리
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * ab[0] + (P[1] - A[1]) * ab[1] + (P[2] - A[2]) * ab[2]) / Math.max(1e-9, ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
      const q = [A[0] + ab[0] * t, A[1] + ab[1] * t, A[2] + ab[2] * t];
      return { d: Math.hypot(P[0] - q[0], P[1] - q[1], P[2] - q[2]), t };
    };
    let tees = 0, reducingTees = 0;
    const rts = built.pipes.routes;
    for (const a of rts) {
      for (const P of [a.pts[0], a.pts[a.pts.length - 1]]) {
        for (const b of rts) {
          if (b === a) continue;
          const endNear = [b.pts[0], b.pts[b.pts.length - 1]].some((E) => Math.hypot(P[0] - E[0], P[1] - E[1], P[2] - E[2]) <= (a.d + b.d));
          if (endNear) continue; // 끝점-끝점 = 티 아님(직결/엘보)
          let hit = false;
          for (let i = 0; i < b.pts.length - 1 && !hit; i++) hit = p2s(P, b.pts[i], b.pts[i + 1]).d <= (a.d + b.d) / 2 + 2;
          if (hit) { tees++; if (a.d !== b.d) reducingTees++; break; }
        }
      }
    }
    const lines = built.pipes.routes.map((r) => ({ label: r.label, service: r.service ?? '-', dn: r.d, lengthM: +(segLen(r.pts) / 1000).toFixed(2), elbows: Math.max(0, r.pts.length - 2) }));
    const byService = {};
    for (const l of lines) {
      byService[l.service] = byService[l.service] ?? { lengthM: 0, lines: 0 };
      byService[l.service].lengthM = +(byService[l.service].lengthM + l.lengthM).toFixed(2);
      byService[l.service].lines++;
    }
    piping = {
      lines, byService,
      totalM: +lines.reduce((s, l) => s + l.lengthM, 0).toFixed(2),
      elbows: lines.reduce((s, l) => s + l.elbows, 0),
      tees, reducingTees,
      sleeves: built.pipes.sleeves?.length ?? 0,
      unrouted: built.pipes.errors.length,
    };
  }

  const labor = {
    용접: +((weldTotalMm / 1000) * rates.weldPerM).toFixed(1),
    절단: +(cutCount * rates.cutPerCut).toFixed(1),
    드릴: +(holes * rates.drillPerHole).toFixed(1),
    절곡: +(bends * rates.bendPerBend).toFixed(1),
    조립: +(parts.length * rates.assyPerPart).toFixed(1),
    표면처리: +(surfaceM2 * rates.surfacePerM2).toFixed(1),
  };
  labor.합계 = +Object.values(labor).reduce((s, v) => s + v, 0).toFixed(1);

  return {
    parts: parts.length, items, byMaterial, totalMassKg, totalVolM3: +sum('volM3').toFixed(3), surfaceM2, tubeLenM, holes, bends, cutCount,
    weld: { totalMm: weldTotalMm, totalM: +(weldTotalMm / 1000).toFixed(2), joints: weldJoints, throatAreaMm2: Math.round(weldAreaMm2) },
    piping,
    laborHr: labor,
    note: '물량=형상 결정론 · 공수=표준 원단위×물량(개산) · 금액 미산출(실단가 없으면 날조).',
  };
}

// 배관 물량 섹션 HTML (mech·비기계 공용) — piping 없으면 빈 문자열.
function pipingSection(b, headNo) {
  if (!b.piping) return '';
  const rows = b.piping.lines.map((l) => `<tr><td style="text-align:left">${esc(l.label)}</td><td>${esc(l.service)}</td><td>DN${l.dn}</td><td>${l.lengthM}</td><td>${l.elbows}</td></tr>`).join('');
  return `<h2>${headNo} 배관 물량 (자동 라우팅 실측)</h2>
<table><tr><th>라인</th><th>계통</th><th>관경</th><th>길이(m)</th><th>엘보</th></tr>${rows}
<tr style="font-weight:700;background:#f8fafc"><td colspan="3">합계</td><td>${b.piping.totalM}</td><td>${b.piping.elbows}</td></tr></table>
<div class="note">라우트 길이=결정론 실측 · 티 ${b.piping.tees}개소(이경 티 ${b.piping.reducingTees} 포함 — 리듀서 상세 후속) · 관통 슬리브 ${b.piping.sleeves}개소 · 행거·보온·구배 여유 미포함${b.piping.unrouted ? ` · ⚠미라우팅 ${b.piping.unrouted}라인(물량 제외)` : ''}.</div>`;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
/**
 * BOQ HTML 리포트 (인쇄양식). 금액 없음 — 물량·용접·가공·공수만.
 * 비기계 도메인(building/landscape/interior/civil)은 재적(m³) 중심 물량표 —
 * 용접·드릴·공수(금속가공 원단위)는 표시하지 않는다(분야 원단위 없이 공수 산출=날조).
 */
export function boqReport(assembly, { title = '물량·작업량 산출서', rates, domain } = {}) {
  const b = computeBOQ(assembly, rates ? { rates } : {});
  const dom = domain ?? assembly.domain ?? 'mech';
  const nonMech = ['building', 'landscape', 'interior', 'civil', 'bridge'].includes(dom);
  const f = (n, d = 2) => Number(n).toFixed(d);
  const rows = b.items.map((x) => `<tr><td style="text-align:left">${esc(x.id)}</td><td>${esc(x.type)}</td><td>${esc(x.material)}</td><td>${f(x.massKg)}</td><td>${f(x.surfaceM2, 3)}</td><td>${x.linearLenM || '-'}</td><td>${x.holes || '-'}</td><td>${x.bends || '-'}</td></tr>`).join('');
  const laborRows = Object.entries(b.laborHr).filter(([k]) => k !== '합계').map(([k, v]) => `<tr><td style="text-align:left">${k}</td><td>${v} hr</td></tr>`).join('');
  if (nonMech) {
    const matRows = Object.entries(b.byMaterial).map(([m, v]) => `<tr><td style="text-align:left">${esc(m)}</td><td>${v.count}</td><td>${f(v.volM3, 3)}</td><td>${f(v.massKg, 1)}</td><td>${f(v.surfaceM2)}</td></tr>`).join('');
    const nmRows = b.items.map((x) => `<tr><td style="text-align:left">${esc(x.id)}</td><td>${esc(x.type)}</td><td>${esc(x.material)}</td><td>${f(x.volM3, 4)}</td><td>${f(x.massKg)}</td><td>${f(x.surfaceM2, 3)}</td></tr>`).join('');
    // C2: 규칙 기반 형상-밖 물량(터파기·거푸집·되메우기…) — 수량 룰엔진(civilTakeoff 메타) 합본, 산출근거 전항목 공개
    let ruleSection = '';
    if (Array.isArray(assembly.civilTakeoff) && assembly.civilTakeoff.length) {
      try {
        const to = takeoff(assembly.civilTakeoff);
        const ruleRows = to.elements.flatMap((el) => el.items.map((it) =>
          `<tr><td style="text-align:left">${esc(el.elementId)}</td><td style="text-align:left">${esc(it.item)}</td><td>${esc(it.spec)}</td><td>${it.qty}</td><td>${esc(it.unit)}</td><td style="text-align:left;font-size:10px;color:#64748b">${esc(it.basis)}</td></tr>`)).join('');
        const assum = to.elements.flatMap((el) => el.assumptions ?? []);
        ruleSection = `<h2>③ 규칙 물량 (토공·거푸집 — 수량 룰엔진)</h2>
<table><tr><th>요소</th><th>항목</th><th>규격</th><th>수량</th><th>단위</th><th>산출근거</th></tr>${ruleRows}</table>
${assum.length ? `<div class="note">가정: ${assum.map(esc).join(' · ')}</div>` : ''}`;
      } catch { ruleSection = ''; }
    }
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.nf-print-bar{position:sticky;top:0;z-index:9;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center}.nf-print-bar button{background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:14px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}table{border-collapse:collapse;margin:6px 24px;font-size:11.5px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 8px;text-align:center}th{background:#f1f5f9}
.kpi{display:flex;gap:8px;flex-wrap:wrap;margin:10px 24px}.kpi div{flex:1;min-width:100px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px}.kpi b{display:block;font-size:17px;color:#2563eb}.kpi span{font-size:10.5px;color:#64748b}
.honest{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;margin:8px 24px;padding:8px 14px;font-size:11.5px;color:#92400e}.note{font-size:11px;color:#94a3b8;padding:6px 24px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="nf-print-bar"><b>물량 산출서 (BOQ) — ${esc(dom)}</b><button onclick="print()">🖨 인쇄 / PDF</button></div>
<div class="sheet"><div class="hd"><h1>${esc(title)} — 물량 산출서 (BOQ)</h1><div class="s">nexyfab · 형상기반 물량 결정론 산출 · 분야 ${esc(dom)} · 금액 미산출(비법정)</div></div>
<div class="honest">⚠ <b>금액(₩)·공수는 산출하지 않습니다</b> — 이 분야의 실단가·표준품셈 데이터 없이는 날조이기 때문. <b>물량(부피·질량·표면적)은 형상에서 확정</b>. 철근·마감·기초 등 형상 밖 물량은 미포함(별도 산정 대상).</div>
<div class="kpi"><div><b>${f(b.totalVolM3, 2)} m³</b><span>총 부피(재적)</span></div><div><b>${(b.totalMassKg / 1000).toFixed(1)} t</b><span>총 질량</span></div><div><b>${b.surfaceM2} ㎡</b><span>표면적(거푸집·마감 개산)</span></div><div><b>${b.parts}</b><span>부재 수</span></div></div>
<h2>① 재질별 집계</h2><table><tr><th>재질</th><th>부재</th><th>부피(m³)</th><th>질량(kg)</th><th>표면적(㎡)</th></tr>${matRows}</table>
<h2>② 부재별 물량</h2><table><tr><th>부재</th><th>Type</th><th>재질</th><th>부피(m³)</th><th>질량(kg)</th><th>표면적(㎡)</th></tr>${nmRows}</table>
${pipingSection(b, '②b')}
${ruleSection}
<div class="note">⚠ 물량=형상 결정론(신뢰) · 규칙 물량=설계수량(표준품셈 할증·품 미적용) · 표면적=거푸집/도장/마감 개산(공제 미반영) · 철근·배근·마감재는 형상 외 — 미산출 · 비법정 참고자료.${assembly.alignment ? ' · <b>선형 주의</b>: 부재별 물량=현(chord) 분할 부품 기준(접합 트림 포함), 규칙 물량=중심선 호장 기준 — 두 기준 차이(트림·현 근사)는 정상이며 정밀 콘크리트량은 규칙 물량이 기준.' : ''}</div>
<div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div></body></html>`;
  }
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.nf-print-bar{position:sticky;top:0;z-index:9;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center}.nf-print-bar button{background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:14px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}table{border-collapse:collapse;margin:6px 24px;font-size:11.5px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 8px;text-align:center}th{background:#f1f5f9}
.kpi{display:flex;gap:8px;flex-wrap:wrap;margin:10px 24px}.kpi div{flex:1;min-width:100px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px}.kpi b{display:block;font-size:17px;color:#2563eb}.kpi span{font-size:10.5px;color:#64748b}
.honest{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;margin:8px 24px;padding:8px 14px;font-size:11.5px;color:#92400e}.note{font-size:11px;color:#94a3b8;padding:6px 24px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="nf-print-bar"><b>물량·작업량 산출서 (BOQ)</b><button onclick="print()">🖨 인쇄 / PDF</button></div>
<div class="sheet"><div class="hd"><h1>${esc(title)} — 물량·작업량 산출서 (BOQ)</h1><div class="s">nexyfab · 형상기반 물량 결정론 산출 · 금액 미산출(비법정)</div></div>
<div class="honest">⚠ <b>금액(₩)은 산출하지 않습니다</b> — 실 자재단가·노임·지역·시점 데이터 없이는 날조이기 때문. <b>물량은 형상에서 확정</b>, <b>공수(hr)는 표준 원단위×물량 개산</b>(현장 조정 대상). 자재단가를 입력하면 그때만 금액 계산(입력단가 기준).</div>
<div class="kpi"><div><b>${b.totalMassKg} kg</b><span>총 자재 질량</span></div><div><b>${b.surfaceM2} ㎡</b><span>표면적(도장·산세)</span></div><div><b>${b.weld.totalM} m</b><span>총 용접선(${b.weld.joints}조인트)</span></div><div><b>${b.laborHr.합계} hr</b><span>공수 합계(개산)</span></div></div>
<h2>① 부품별 물량</h2><table><tr><th>부품</th><th>Type</th><th>재질</th><th>질량(kg)</th><th>표면적(㎡)</th><th>길이(m)</th><th>홀</th><th>절곡</th></tr>${rows}
<tr style="font-weight:700;background:#f8fafc"><td colspan="3">합계 (${b.parts}부품)</td><td>${b.totalMassKg}</td><td>${b.surfaceM2}</td><td>${b.tubeLenM || '-'}</td><td>${b.holes || '-'}</td><td>${b.bends || '-'}</td></tr></table>
<h2>② 용접·가공 물량</h2><table><tr><th>항목</th><th>물량</th></tr>
<tr><td>용접선 길이</td><td>${b.weld.totalM} m (${b.weld.totalMm} mm)</td></tr><tr><td>용접 조인트</td><td>${b.weld.joints} 개</td></tr><tr><td>용접 목두께 면적</td><td>${b.weld.throatAreaMm2.toLocaleString()} mm²</td></tr>
<tr><td>절단</td><td>${b.cutCount} 회</td></tr><tr><td>드릴 홀</td><td>${b.holes} 개</td></tr><tr><td>절곡</td><td>${b.bends} 회</td></tr></table>
${pipingSection(b, '②b')}
<h2>③ 공수 (표준 원단위 개산, hr)</h2><table><tr><th>작업</th><th>공수</th></tr>${laborRows}<tr style="font-weight:700;background:#f8fafc"><td>합계</td><td>${b.laborHr.합계} hr</td></tr></table>
<div class="note">⚠ 물량=형상 결정론(신뢰) · 공수=표준 원단위(용접 ${STD_RATES.weldPerM}h/m·드릴 ${STD_RATES.drillPerHole}h/홀 등) 개산 → 현장/작업방식 따라 조정 · 금액 미산출 · 용접량은 AABB 접촉 개산(정밀은 조인트 선언 후속).</div>
<div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div></body></html>`;
}
