/**
 * 설계 패키지 — Dossier(설계 설명서) + P&ID 스켈레톤 범용 생성.
 * 순수 형상엔 공정 의미가 없으므로 **부품 service 태그(colorOf 자동추론)** 로 계통을 잡는다.
 * Dossier = BOQ·구조·부품구성 사실 자동요약 + 계통 기반 서술(결정론). P&ID = 계통 흐름 스켈레톤.
 * ⚠️ 정밀 P&ID(밸브·계장·인터록)·풍부한 서술은 AI 보조 후속. 여기선 형상·계통 기반 결정론.
 */
import { computeBOQ } from './boq.mjs';
import { structuralCheck } from './structural.mjs';
import { colorOf, COLOR_LABEL, buildAssembly } from './assembly.mjs';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const SERVICE_KO = { feed: '피드/입수', hp: '고압', permeate: '투과/출수', concentrate: '농축/드레인', motor: '구동(펌프·모터)', panel: '제어', frame: '프레임/구조', sludge: '슬러지', supply: '급수(MEP)', drain: '배수(MEP)', vent: '통기(MEP)', stack: 'PS/입상관' };
// 부품 → 계통 키 (colorOf 색을 역매핑)
const COL_SVC = { '#2563eb': 'feed', '#dc2626': 'hp', '#0891b2': 'permeate', '#ea580c': 'concentrate', '#4d7c0f': 'motor', '#59606b': 'panel', '#3f4756': 'frame', '#5b6472': 'frame', '#8a5a2b': 'sludge', '#0284c7': 'supply', '#92400e': 'drain', '#0d9488': 'vent', '#7c2d12': 'stack' };
const svcOf = (p) => COL_SVC[colorOf(p)] || 'equipment';

function groupBySvc(parts) {
  const g = {};
  for (const p of parts) { const s = svcOf(p); (g[s] ??= []).push(p); }
  return g;
}
const PB = (label, page) => `<style>${page}@media print{.nf-print-bar{display:none!important}body{background:#fff!important}.sheet,.doc{box-shadow:none!important;border:none!important;margin:0!important}}</style><div class="nf-print-bar" style="position:sticky;top:0;z-index:99;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center"><b>${label}</b><button onclick="print()" style="background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer">🖨 인쇄 / PDF</button></div>`;

/** 배관(MEP·프로세스) 요약 섹션 — pipes[] 선언 어셈블리만. 라우팅·슬리브는 buildAssembly 단일 결과. */
function mepSection(assembly) {
  if (!Array.isArray(assembly.pipes) || !assembly.pipes.length) return '';
  try {
    const P = buildAssembly(assembly)?.pipes;
    if (!P) return '';
    const rows = P.routes.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(SERVICE_KO[r.service] ?? r.service ?? '-')}</td><td>DN${r.d}</td><td>${r.pts.length - 1}세그먼트(엘보 ${Math.max(0, r.pts.length - 2)})</td></tr>`).join('');
    const sl = P.sleeves.map((s) => `<tr><td>${esc(s.route)}</td><td>${esc(s.through)}</td><td>${esc(s.note)}</td></tr>`).join('');
    return `<h2>5. 배관 (MEP·프로세스 — 자동 라우팅)</h2>
<table><tr><th>라인</th><th>계통</th><th>관경</th><th>경로</th></tr>${rows}</table>
${sl ? `<div style="font-size:12px;margin:4px 0 2px"><b>관통 슬리브 명세</b> (벽·바닥 관통 = 위반 아님·시공 명세)</div><table><tr><th>라인</th><th>관통 부재</th><th>비고</th></tr>${sl}` + '</table>' : ''}
${P.errors.length ? `<div class="risk">⚠ 라우팅 실패 ${P.errors.length}건: ${esc(P.errors.join(' / '))}</div>` : ''}
<div class="note" style="padding:2px 0">경로=결정론 자동 라우팅(관통·교차 게이트) · 관경·접속 위치=개산 · 구배·트랩·통기 미모델 — 시공도 아님.</div>`;
  } catch { return ''; }
}

/** 설계 설명서(Dossier) — 사실 자동요약 + 계통 서술. */
export function dossierReport(assembly, { title = '설계', member } = {}) {
  const parts = assembly.parts ?? [];
  const boq = computeBOQ(assembly);
  // ⚠ 260728: 종전에는 여기서 `{ member: { section:'SHS50x50x3', spanMm:1000 } }` 를
  // **어떤 어셈블리에든 지어내 넘겼다.** 그 결과가 "부재 이용률"로 인쇄됐다.
  //
  // 실측(301부재 아치 — 실제 부재는 120×120 각재, 간격 400mm): 지어낸 50×50×3 각관이
  // 지간 1000mm 로 188,714kg 를 받는 것으로 계산돼 **이용률 452** 가 문서에 찍혔고,
  // "부재 SHS50x50x3 초과 — 단면 상향 필요" 경고까지 떴다 — **설계에 존재하지 않는
  // 부재를 키우라는 지시**다. 이 레포의 제1원칙("입력을 지어내지 않는다") 정면 위반.
  //
  // 이제 지어내지 않는다. 호출자가 선언하면 그것으로 검토하고, 아니면 검토하지 않고
  // 미검토 사실을 적는다(structuralCheck.memberUnavailable).
  const st = structuralCheck(assembly, member ? { member } : {});
  const g = groupBySvc(parts);
  const svcList = Object.keys(g).filter(s => s !== 'frame').map(s => SERVICE_KO[s] || s);
  const f = (n, d = 1) => Number(n).toFixed(d);
  const compRows = Object.entries(g).map(([s, ps]) => `<tr><td><b>${esc(SERVICE_KO[s] || s)}</b></td><td>${ps.length}</td><td style="text-align:left">${ps.map(p => esc(p.id ?? p.type)).join(', ')}</td></tr>`).join('');
  const warn = st.warnings.length;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)} 설계 설명서</title>
<style>@page{size:A4;margin:14mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;color:#1f2937;background:#eef1f4;line-height:1.6;font-size:13px}
.nf-print-bar button{cursor:pointer}.doc{max-width:900px;margin:18px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:30px 42px 44px}
h1{font-size:22px;margin:0 0 3px}.lede{color:#64748b;font-size:13px;margin:0 0 10px}
h2{font-size:16px;margin:24px 0 6px;padding-bottom:5px;border-bottom:2px solid #1f2937}
.kpi{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.kpi div{flex:1;min-width:110px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px}.kpi b{display:block;font-size:18px;color:#2563eb}.kpi span{font-size:11px;color:#64748b}
.easy{background:#eff6ff;border-left:4px solid #2563eb;padding:9px 14px;border-radius:0 8px 8px 0;margin:8px 0;font-size:13.5px}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin:8px 0}th,td{border:1px solid #e2e8f0;padding:6px 10px;text-align:center}th{background:#f1f5f9}
.risk{border-left:4px solid ${warn ? '#dc2626' : '#16a34a'};background:${warn ? '#fef2f2' : '#f0fdf4'};padding:9px 14px;border-radius:0 8px 8px 0;margin:8px 0;font-size:13px}
.note{font-size:11px;color:#94a3b8;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px}</style></head>
<body>${PB(esc(title) + ' 설계 설명서', '@page{size:A4;margin:14mm}')}<div class="doc">
<h1>${esc(title)} — 설계 설명서 (Dossier)</h1><p class="lede">nexyfab 자동생성 · 형상·물량·구조 사실 요약 · 개념/비법정</p>
<div class="kpi"><div><b>${parts.length}</b><span>부품 수</span></div><div><b>${f(boq.totalMassKg)} kg</b><span>총 질량</span></div><div><b>${boq.weld.totalM} m</b><span>용접선</span></div><div><b>${f(st.cgHeightM, 2)} m</b><span>무게중심</span></div></div>
<h2>1. 개요</h2>
<div class="easy">이 설계는 <b>${parts.length}개 부품</b>(계통: ${svcList.length ? esc(svcList.join(' · ')) : '구조 중심'})으로 구성된 어셈블리입니다. 총 질량 <b>${f(boq.totalMassKg)} kg</b>, 무게중심 <b>${f(st.cgHeightM, 2)} m</b>. ${g.motor ? '구동부(펌프·모터)와 ' : ''}${g.feed || g.permeate ? '유체 계통을 포함한 프로세스 구성입니다.' : '구조·기구 중심 구성입니다.'}</div>
<h2>2. 계통별 구성</h2><table><tr><th>계통</th><th>부품수</th><th>부품</th></tr>${compRows}</table>
<h2>3. 구조 안전성</h2>
<div class="risk"><b>${warn ? '⚠ 검토 필요' : '🟢 자동검토 기준 이내'}:</b> 무게중심 ${f(st.cgHeightM, 2)}m · ${st.tipover.seismicG}g 전도 FS <b>${f(st.tipover.seismicFS, 2)}</b>(기준 ≥1.5)${st.member ? ` · 부재 이용률 ${f(st.member.utilization, 2)}(${esc(st.member.section)} 지간 ${st.member.spanMm}mm — 선언값)` : ''}. ${warn ? esc(st.warnings.join(' / ')) : '경고 없음.'}${st.memberUnavailable ? `<div style="margin-top:6px;font-size:12px;color:#92400e">⚠ ${esc(st.memberUnavailable.messageKo.replace(/\*\*/g, ''))}</div>` : ''}</div>
<h2>4. 물량 요약 (금액 제외)</h2><table><tr><th>총 질량</th><th>표면적</th><th>용접선</th><th>홀</th><th>공수(개산)</th></tr>
<tr><td>${f(boq.totalMassKg)} kg</td><td>${boq.surfaceM2} ㎡</td><td>${boq.weld.totalM} m (${boq.weld.joints}조인트)</td><td>${boq.holes}</td><td>${boq.laborHr.합계} hr</td></tr></table>
${mepSection(assembly)}
<div class="note">⚠ 개념/GA(비법정) · 물량=형상 결정론·공수=표준원단위 개산·금액 미산출 · 서술은 계통 기반 자동(정밀 서술·시장/특허는 AI 리서치 후속). 상세=GA 도면·구조검토·BOQ 별첨.</div>
<div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div></body></html>`;
}

/** P&ID 스켈레톤 — 계통 흐름 블록도(밸브·계장은 개념). 정밀 P&ID는 AI/공정입력 후속. */
export function pidSkeleton(assembly, { title = '설계', pipes = null } = {}) {
  const parts = assembly.parts ?? [];
  const g = groupBySvc(parts);
  const order = ['feed', 'motor', 'hp', 'equipment', 'permeate', 'concentrate', 'sludge', 'panel'];
  const present = order.filter(s => g[s]?.length);
  const W = 1000, H = 300, Y = 150;
  const n = present.filter(s => s !== 'panel').length || 1;
  const step = (W - 160) / n;
  const el = [];
  const svcCol = { feed: '#2563eb', hp: '#dc2626', permeate: '#0891b2', concentrate: '#ea580c', motor: '#4d7c0f', equipment: '#5b6472', sludge: '#8a5a2b' };
  let x = 90, prev = null;
  el.push(`<text x="${W / 2}" y="28" font-size="16" font-weight="700" text-anchor="middle" font-family="Segoe UI,sans-serif">${esc(title)} — P&amp;ID 스켈레톤 (계통 흐름)</text>`);
  el.push(`<text x="${W / 2}" y="46" font-size="10.5" fill="#64748b" text-anchor="middle" font-family="Segoe UI,sans-serif">부품 service 태그 기반 개념 흐름 · 밸브·계장·인터록은 정밀 P&amp;ID(AI/공정입력) 후속</text>`);
  for (const s of present) {
    if (s === 'panel') continue;
    const c = svcCol[s] || '#5b6472';
    el.push(`<rect x="${x}" y="${Y - 34}" width="120" height="68" rx="8" fill="#fff" stroke="${c}" stroke-width="1.8"/>`);
    el.push(`<text x="${x + 60}" y="${Y - 6}" font-size="11.5" font-weight="700" text-anchor="middle" fill="${c}" font-family="Segoe UI,sans-serif">${esc(SERVICE_KO[s] || s)}</text>`);
    el.push(`<text x="${x + 60}" y="${Y + 12}" font-size="9" text-anchor="middle" fill="#475569" font-family="Segoe UI,sans-serif">${(g[s] || []).length}부품</text>`);
    el.push(`<circle cx="${x + 60}" cy="${Y - 60}" r="15" fill="#fff" stroke="#0b5cff" stroke-width="1.4"/><text x="${x + 60}" y="${Y - 56}" font-size="8.5" text-anchor="middle" fill="#0b5cff">계측</text>`);
    if (prev !== null) {
      el.push(`<line x1="${prev}" y1="${Y}" x2="${x}" y2="${Y}" stroke="${c}" stroke-width="2.5" marker-end="url(#ar)"/>`);
      const mx = (prev + x) / 2; // 보타이 밸브 심볼(사양=입력 원칙)
      el.push(`<path d="M ${mx - 9} ${Y - 7} L ${mx + 9} ${Y + 7} L ${mx + 9} ${Y - 7} L ${mx - 9} ${Y + 7} Z" fill="#fff" stroke="#1f2937" stroke-width="1.1"/>`);
    }
    prev = x + 120; x += step;
  }
  if (g.panel) el.push(`<rect x="${W / 2 - 110}" y="${H - 46}" width="220" height="34" rx="6" fill="#eef2ff" stroke="#0b5cff" stroke-width="1.4"/><text x="${W / 2}" y="${H - 25}" font-size="11" font-weight="700" text-anchor="middle" fill="#0b5cff">PLC / HMI (제어)</text>`);
  // G4 정식화(260718): 라인 리스트(pipes → 라인 넘버 계통-호칭경, G1 스냅) + ISA 계기 태그 제안
  let lineListHtml = '';
  if (Array.isArray(pipes) && pipes.length) {
    let snapPipeFn = null;
    try { snapPipeFn = (globalThis.__nfSnapPipe ??= null); } catch { /* noop */ }
    const rows = pipes.map((pp, i) => {
      const svc = pp.service ?? '-';
      const num = `${String(svc).toUpperCase().slice(0, 4)}-${String(i + 1).padStart(2, '0')}`;
      return `<tr><td>${num}</td><td>${esc(SERVICE_KO[svc] ?? svc)}</td><td>${pp.dn ? pp.dn + 'A' : (pp.d ? 'Ø' + pp.d + ' (호칭경 스냅=G1 감사 참조)' : '-')}</td><td>${esc(pp.material ?? 'STS316L')}</td><td>입력 원칙</td></tr>`;
    }).join('');
    lineListHtml = `<div class="wrap"><b style="font-size:12px">라인 리스트</b><table style="border-collapse:collapse;width:100%;font-size:11px;margin-top:4px"><thead><tr><th style="border:1px solid #cbd5e1;background:#f1f5f9">라인 No.</th><th style="border:1px solid #cbd5e1;background:#f1f5f9">계통</th><th style="border:1px solid #cbd5e1;background:#f1f5f9">호칭경</th><th style="border:1px solid #cbd5e1;background:#f1f5f9">재질</th><th style="border:1px solid #cbd5e1;background:#f1f5f9">보온/트레이싱</th></tr></thead><tbody>${rows.replace(/<td>/g, '<td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:center">')}</tbody></table></div>`;
  }
  const gaugeParts = (assembly.parts ?? []).filter((p) => /gauge/.test(p.id ?? ''));
  const instrRows = gaugeParts.slice(0, 12).map((p, i) => `<tr><td style="border:1px solid #cbd5e1;padding:3px 8px">PI-${101 + i}</td><td style="border:1px solid #cbd5e1;padding:3px 8px;text-align:left">${esc(p.id)}</td><td style="border:1px solid #cbd5e1;padding:3px 8px">압력계(제안 — 태그·레인지 확정=입력)</td></tr>`).join('');
  const instrHtml = gaugeParts.length
    ? `<div class="wrap"><b style="font-size:12px">계기 리스트(ISA 태그 제안)</b><table style="border-collapse:collapse;font-size:11px;margin-top:4px"><thead><tr><th style="border:1px solid #cbd5e1;background:#f1f5f9">TAG</th><th style="border:1px solid #cbd5e1;background:#f1f5f9">부품</th><th style="border:1px solid #cbd5e1;background:#f1f5f9">비고</th></tr></thead><tbody>${instrRows}</tbody></table></div>`
    : `<div class="wrap" style="font-size:11px;color:#94a3b8">계기 부품 미배치 — 계기 리스트는 배치 후 자동 제안</div>`;
  // 밸브 심볼(보타이) — 라인 화살표 중앙(계통 수 기준)
  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff"><defs><marker id="ar" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><polygon points="0,0 8,4 0,8" fill="#1f2937"/></marker></defs>${el.join('')}</svg>`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)} P&ID</title>
<style>@page{size:A3 landscape;margin:8mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937}.sheet{max-width:1100px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 14px}.wrap{padding:8px 16px}.note{font-size:11px;color:#94a3b8;padding:8px 20px}</style></head>
<body>${PB(esc(title) + ' P&ID 스켈레톤 (A3)', '@page{size:A3 landscape;margin:8mm}')}<div class="sheet"><div class="wrap">${svg}</div>
${lineListHtml}${instrHtml}
<div class="note">⚠ <b>P&ID(1차 정식화·비법정)</b> — 계통 흐름+라인 리스트(G1 규격 스냅)+계기 태그 제안. <b>인터록·제어 로직·태그 확정·밸브 사양은 공정 입력 원칙</b>. 계통: ${present.map(s => esc(SERVICE_KO[s] || s)).join(' → ')}.</div><div class="note" style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:6px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div></body></html>`;
}
