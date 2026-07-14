/**
 * chain-reports.mjs — Wave A 검증 체인 결과 → 인쇄양식 HTML 리포트.
 *
 * 대상: 건축 하중경로(loadPathCheck) · 조경 목재·풍하중(landscapeCheck) ·
 * 인테리어 피난·마감(interiorCheck) · 토목 옹벽안정(verifyDomain 결과).
 * 설계 패키지 문서들과 동일한 A4 인쇄 스타일 — 근거·가정·비법정 문구를 결과와 같은 크기로.
 */
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const f = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '-');
const V = (v) => v === 'PASS' ? '<b style="color:#16a34a">PASS ✓</b>' : v === 'FAIL' ? '<b style="color:#dc2626">FAIL ✕</b>' : `<b style="color:#d97706">${esc(v)}</b>`;

const SHELL = (title, sub, body) => `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{margin:0;font-family:'Segoe UI','Malgun Gothic',sans-serif;background:#eef1f4;color:#1f2937;font-size:13px}
.nf-print-bar{position:sticky;top:0;z-index:9;background:#1f2937;color:#fff;padding:7px 16px;font-size:12.5px;display:flex;gap:12px;align-items:center}.nf-print-bar button{background:#2563eb;color:#fff;border:0;padding:5px 13px;border-radius:6px;cursor:pointer}
.sheet{max-width:900px;margin:16px auto;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:0 0 22px}.hd{padding:15px 24px;border-bottom:2px solid #1f2937}.hd h1{margin:0;font-size:18px}.hd .s{color:#64748b;font-size:12px}
h2{font-size:14px;margin:18px 24px 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}table{border-collapse:collapse;margin:6px 24px;font-size:11.5px;width:calc(100% - 48px)}td,th{border:1px solid #cbd5e1;padding:4px 8px;text-align:center}th{background:#f1f5f9}
.kpi{display:flex;gap:8px;flex-wrap:wrap;margin:10px 24px}.kpi div{flex:1;min-width:110px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px}.kpi b{display:block;font-size:16px;color:#2563eb}.kpi span{font-size:10.5px;color:#64748b}
.honest{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;margin:8px 24px;padding:8px 14px;font-size:11.5px;color:#92400e}.note{font-size:11px;color:#94a3b8;padding:6px 24px}
@media print{.nf-print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;border:none;margin:0}}</style></head>
<body><div class="nf-print-bar"><b>${esc(title)}</b><button onclick="print()">🖨 인쇄 / PDF</button></div>
<div class="sheet"><div class="hd"><h1>${esc(title)}</h1><div class="s">${esc(sub)}</div></div>${body}<div class="note" style="border-top:1px solid #e2e8f0;margin-top:10px;padding-top:8px">본 보고서는 KDS 현행 기준에 따라 자동 산출된 결과이며, 최종 설계도서·시공에는 반드시 등록 구조기술자(해당 분야 기술사)의 직접 검토·확인이 필요합니다.</div></div></body></html>`;

const checksTable = (checks) => !checks ? '' : `<table><tr><th>검토</th><th>값</th><th>허용/한계</th><th>비율</th><th>판정</th></tr>${
  Object.entries(checks).map(([k, c]) => `<tr><td>${esc(k)}</td><td>${f(c.fb_MPa ?? c.fv_MPa ?? c.delta_mm ?? c.Mn_kNm ?? c.Vc_kN ?? c.FS ?? c.eps_t ?? c.value ?? c.qmax_kPa ?? '-', 2)}</td><td>${f(c.allow_MPa ?? c.limit_mm ?? c.min_allowed ?? c.phiMn_kNm ?? c.phiVn_kN ?? c.allow ?? c.limit ?? '-', 2)}</td><td>${f(c.ratio, 3)}</td><td>${c.pass === true ? '✓' : c.pass === false ? '✕' : '-'}</td></tr>`).join('')}</table>`;

/** 건축 하중경로 리포트 */
export function loadPathReport(r, { title = '하중경로 검증' } = {}) {
  if (!r?.ok) return SHELL(title, '실패', `<div class="honest">${esc(r?.error ?? '체인 실패')}</div>`);
  const beams = r.beams.map((b) => `<tr><td style="text-align:left">${esc(b.id)}</td><td>${esc(b.section)}</td><td>${b.spanMm}</td><td>${f(b.tribM2)}</td><td>${f(b.wu_kNm)}</td><td>${f(b.Mu_kNm)}${b.MuNeg_kNm != null ? ` / −${f(b.MuNeg_kNm)}` : ''}</td><td>${f(b.Vu_kN)}</td><td>${esc(b.combo)}</td><td>${V(b.verdict)}${b.negVerdict ? `<br><span style="font-size:10px">−M: ${esc(b.negVerdict)}</span>` : ''}</td></tr>`).join('');
  const beamMethod = r.beams[0]?.method ? `<div class="note">해석: ${esc(r.beams[0].method)}</div>` : '';
  const cols = r.columns.map((c) => `<tr><td style="text-align:left">${esc(c.id)}</td><td>${esc(c.section)}</td><td>${f(c.Pu_kN)}</td><td>${f(c.Pservice_kN)}</td><td>${f(c.Mu_kNm)}</td><td>${V(c.verdict)}</td></tr>`).join('');
  const ftg = r.footing?.needInputs
    ? `<div class="honest">기초 검토 생략 — 입력 필요: ${r.footing.needInputs.join(', ')} (${esc(r.footing.note ?? '')})</div>`
    : `<table><tr><th>항목</th><th>판정</th></tr><tr><td>독립기초 (지지력·뚫림·1방향전단)</td><td>${V(r.footing?.verdict)}</td></tr></table>${checksTable(r.footing?.checks)}`;
  return SHELL(`${title} — 건축 하중경로 자동 체인`, `nexyfab · ${esc(r.scope)} · 슬래브 자중(형상)→활하중(KDS)→보→기둥→기초`, `
<div class="kpi"><div><b>${esc(r.loads.usage.label)}</b><span>활하중 ${r.loads.usage.live_kNm2} kN/m² (표 3.2-1)</span></div>
<div><b>${f(r.loads.slab.D_kN, 1)} kN</b><span>슬래브 고정하중/층 (${esc(r.loads.slab.finishNote)})</span></div>
<div><b>${f(r.loads.slab.L_kN, 1)} kN</b><span>활하중/층</span></div></div>
<h2>① 하중 근거</h2><table><tr><th>항목</th><th>값·근거</th></tr>
<tr><td>하중조합</td><td>${esc(r.loads.combo.U1.expr)} / ${esc(r.loads.combo.U2.expr)} — ${esc(r.loads.combo.U1.ref)}</td></tr>
<tr><td>단위중량</td><td>${r.loads.unitWeight.value} kN/m³</td></tr>
<tr><td>기둥 격자</td><td>X ${r.loads.spans.xs_mm.join('·')} / Y ${r.loads.spans.ys_mm.join('·')} mm · ${esc(r.loads.spans.tributary)}</td></tr></table>
<h2>② 보 검토 (rc_beam)</h2><table><tr><th>부재</th><th>단면</th><th>스팬</th><th>분담m²</th><th>wu</th><th>Mu(+/−)</th><th>Vu</th><th>지배조합</th><th>판정</th></tr>${beams}</table>${beamMethod}
${r.beams[0]?.checks ? checksTable(r.beams[0].checks) : ''}
<h2>③ 기둥 검토 (rc_column_pm)</h2><table><tr><th>부재</th><th>단면</th><th>Pu kN</th><th>P사용 kN</th><th>Mu</th><th>판정</th></tr>${cols}</table>
<h2>④ 기초 검토 (isolated_footing)</h2>${ftg}
${r.slabSLS ? `<h2>④b 슬래브 처짐 SLS (Mindlin 판 FEM)</h2>
<table><tr><th>패널</th><th>Ec</th><th>활하중 δ</th><th>전체 δ</th><th>판정</th></tr>
<tr><td>${esc(r.slabSLS.panelMm)}</td><td>${r.slabSLS.Ec_MPa} MPa</td>
<td>${f(r.slabSLS.live.delta_mm)} / ${f(r.slabSLS.live.limit_mm, 1)}mm (${esc(r.slabSLS.live.spec)})</td>
<td>${f(r.slabSLS.total.delta_mm)} / ${f(r.slabSLS.total.limit_mm, 1)}mm (${esc(r.slabSLS.total.spec)})</td>
<td>${V(r.slabSLS.live.pass && r.slabSLS.total.pass ? 'PASS' : 'FAIL')}</td></tr></table>
<div class="note">${esc(r.slabSLS.method)} · ${esc(r.slabSLS.note)}</div>` : ''}
${r.seismic && !r.seismic.error ? `<h2>⑤ 등가정적 지진 (KDS 41 17 00 §7.2)</h2>
<div class="kpi"><div><b>${f(r.seismic.V_kN, 1)} kN</b><span>밑면전단 V (Cs ${r.seismic.Cs} — ${esc(r.seismic.governing)})</span></div>
<div><b>${f(r.seismic.SDS, 3)} / ${f(r.seismic.SD1, 3)}</b><span>SDS / SD1</span></div>
<div><b>${f(r.seismic.Ta_s, 3)} s</b><span>근사주기 Ta</span></div></div>
<table><tr><th>층</th><th>Fx kN</th><th>층전단 kN</th></tr>
${r.seismic.Fx_kN.map((fx, i) => `<tr><td>${i + 1}F</td><td>${f(fx, 1)}</td><td>${f(r.seismic.storyShear_kN[i], 1)}</td></tr>`).join('')}</table>
<table><tr><th>지배기둥 지진조합</th><th>PuE kN</th><th>MuE kN·m</th><th>판정</th></tr>
<tr><td style="font-size:10.5px;text-align:left">${esc(r.seismic.column.method)}</td><td>${f(r.seismic.column.PuE_kN, 1)}</td><td>${f(r.seismic.column.MuE_kNm, 1)}</td><td>${V(r.seismic.column.verdict)}</td></tr></table>
<div class="honest">⚠ ${esc(r.seismic.disclaimer)}</div>` : ''}
${r.wind && !r.wind.error ? `<h2>⑤b 풍하중 (KDS 41 12 00 — ${esc(r.wind.x.method)})</h2>
<div class="kpi"><div><b>${f(Math.max(r.wind.x.baseShear_kN, r.wind.y.baseShear_kN), 1)} kN</b><span>기단전단 (지배방향)</span></div>
<div><b>${f(Math.max(r.wind.x.p_Nm2, r.wind.y.p_Nm2), 0)} N/m²</b><span>설계풍압</span></div>
<div><b>${r.wind.H_m}×${r.wind.B_m}×${r.wind.D_m} m</b><span>H×B×D (형상 파생)</span></div></div>
<table><tr><th>풍향</th><th>방법</th><th>기단전단 kN</th><th>풍압 N/m²</th></tr>
<tr><td>X</td><td>${esc(r.wind.x.method)}</td><td>${f(r.wind.x.baseShear_kN, 1)}</td><td>${f(r.wind.x.p_Nm2, 0)}</td></tr>
<tr><td>Y</td><td>${esc(r.wind.y.method)}</td><td>${f(r.wind.y.baseShear_kN, 1)}</td><td>${f(r.wind.y.p_Nm2, 0)}</td></tr></table>
<table><tr><th>기둥 풍하중 검토 (1.3W)</th><th>PuW kN</th><th>MuW kN·m</th><th>판정</th></tr>
<tr><td style="font-size:10.5px;text-align:left">${esc(r.wind.column.method)}</td><td>${f(r.wind.column.PuW_kN, 1)}</td><td>${f(r.wind.column.MuW_kNm, 1)}</td><td>${V(r.wind.column.verdict)}</td></tr></table>
<div class="note">${esc(r.wind.note)}</div>` : r.wind?.error ? `<div class="honest">풍하중: ${esc(r.wind.error)}</div>` : ''}
${r.rebar ? `<h2>${r.seismic && !r.seismic.error ? '⑥' : '⑤'} 철근 개산 (입력 배근 × 형상 길이)</h2>
<table><tr><th>항목</th><th>산출근거</th><th>중량 kg</th></tr>
${r.rebar.items.map((i) => `<tr><td style="text-align:left">${esc(i.name)}</td><td style="text-align:left;font-size:10.5px;color:#64748b">${esc(i.basis)}</td><td>${f(i.kg, 1)}</td></tr>`).join('')}
<tr style="font-weight:700;background:#f8fafc"><td colspan="2">합계</td><td>${f(r.rebar.totalKg, 1)} (${f(r.rebar.totalTon, 2)} t)</td></tr></table>
<div class="note">${esc(r.rebar.note)}</div>` : ''}
<div class="honest">⚠ ${esc(r.disclaimer)}</div>
<div class="note">출처: ${esc(r.loads.usage.ref)} · 계수 전부 KDS 원문 대조 계산기(draft — 공표예제 게이트 진행 중)</div>`);
}

/** 조경 목재·풍하중 리포트 */
export function landscapeReport(r, { title = '조경 구조 검증' } = {}) {
  if (!r?.ok) return SHELL(title, '실패', `<div class="honest">${esc(r?.error ?? '체인 실패')}</div>`);
  const m = r.member;
  const memberSec = m ? `
<h2>① 목재 부재 검토 (timber_beam — KDS 41 50 10)</h2>
<table><tr><th>부재</th><th>단면</th><th>스팬</th><th>간격</th><th>하중 합</th><th>판정</th></tr>
<tr><td style="text-align:left">${esc(m.id)} ×${m.count}</td><td>${esc(m.section)}</td><td>${m.spanMm}</td><td>${m.spacingMm}</td><td>${f(m.load.total_kNm, 3)} kN/m</td><td>${V(m.verdict)}</td></tr></table>
<table><tr><th>자중</th><th>데크 자중</th><th>활하중</th><th>추가 입력</th></tr>
<tr><td>${f(m.load.self_kNm, 3)}</td><td>${f(m.load.deckSelf_kNm, 3)}</td><td>${f(m.load.live_kNm, 3)} (${esc(m.load.liveRef)})</td><td>${f(m.load.extra_kNm, 3)}</td></tr></table>
${checksTable(m.checks)}
${m.notes ? `<div class="note">${m.notes.map(esc).join('<br>')}</div>` : ''}` : '<div class="honest">장선/서까래(role=joist) 없음 — 부재 검토 생략</div>';
  const c = r.connection;
  const connSec = !c ? '' : c.type === 'unspecified' ? `
<h2>①a 장선↔보 접합부</h2><div class="honest">${esc(c.note)}</div>` : `
<h2>①a 장선↔보 접합부 (${c.type === 'nail' ? '못 — 표 4.4-4' : '볼트 — 표 4.5-2'} · KDS 41 50 30)</h2>
<table><tr><th>철물</th><th>소요(단부반력)</th><th>내력</th><th>비율</th><th>판정</th></tr>
<tr><td>${esc(c.type)}</td><td>${c.demandN} N</td><td>${c.checks?.shear?.capacity_N ?? '—'} N</td><td>${c.checks?.shear?.ratio ?? '—'}</td><td>${V(c.verdict)}</td></tr></table>
${c.notes ? `<div class="note">${c.notes.map(esc).join('<br>')}</div>` : ''}${c.error ? `<div class="honest">${esc(c.error)}</div>` : ''}`;
  const boardSec = r.board ? `
<h2>①b 데크보드 검토</h2>
<table><tr><th>부재</th><th>단면</th><th>스팬(장선간격)</th><th>하중</th><th>판정</th></tr>
<tr><td style="text-align:left">${esc(r.board.id)} ×${r.board.count}</td><td>${esc(r.board.section)}</td><td>${r.board.spanMm}</td><td>${f(r.board.w_kNm, 3)} kN/m</td><td>${V(r.board.verdict)}</td></tr></table>
${checksTable(r.board.checks)}<div class="note">${esc(r.board.note)}</div>` : '';
  const w = r.wind;
  const windSec = !w ? '' : w.skipped ? `<h2>② 풍하중 전도</h2><div class="honest">${esc(w.note)}</div>` : `
<h2>② 풍하중 전도 (강체)</h2>
<div class="kpi"><div><b>${f(w.FS, 2)}</b><span>전도 FS (지배 ${esc(w.worst)} · 임계 ${w.fsLimit})</span></div>
<div><b>${f(w.totalWeight_kN, 2)} kN</b><span>총 자중(형상×밀도)</span></div>
<div><b>${w.pass ? '적합' : `앵커 ${f(w.anchorUpliftPerPost_kN, 2)} kN/본`}</b><span>${w.pass ? '판정' : '소요 인발저항(개산)'}</span></div></div>
<table><tr><th>방향</th><th>투영면적 m²</th><th>풍력 kN</th><th>작용높이 m</th><th>Mo kN·m</th><th>Mr kN·m</th><th>FS</th></tr>
<tr><td>X풍</td><td>${f(w.x.areaM2)}</td><td>${f(w.x.F_kN)}</td><td>${f(w.x.zc_m)}</td><td>${f(w.x.Mo_kNm)}</td><td>${f(w.x.Mr_kNm)}</td><td>${f(w.x.FS)}</td></tr>
<tr><td>Y풍</td><td>${f(w.y.areaM2)}</td><td>${f(w.y.F_kN)}</td><td>${f(w.y.zc_m)}</td><td>${f(w.y.Mo_kNm)}</td><td>${f(w.y.Mr_kNm)}</td><td>${f(w.y.FS)}</td></tr></table>
<div class="note">${esc(w.fsNote)} · ${esc(w.method)}</div>`;
  return SHELL(`${title} — 목재 부재·풍하중`, 'nexyfab · KDS 41 50 10 허용응력×CD×CM(습윤) · 단면·스팬·간격=형상 파생', `
${memberSec}${connSec}${boardSec}${windSec}
<div class="honest">⚠ ${esc(r.disclaimer)}</div>
<div class="note">근거: ${(r.refs ?? []).map(esc).join(' · ')}</div>`);
}

/** 인테리어 피난·마감 리포트 */
function mepSec(r) {
  const li = r.lighting, ve = r.ventilation, el = r.electrical;
  if (!li && !ve && !el) return '';
  const liRow = !li ? '' : li.verdict === 'INFO'
    ? `<tr><td>조명(광속법)</td><td>${li.fixtures}등 (${esc(li.layout)}) · 평균 ${li.avgLuxProvided}lx / 목표 ${li.targetLux}lx · 실지수 ${li.roomIndex}</td></tr>`
    : `<tr><td>조명</td><td>실지수 ${li.roomIndex}(형상) — ${esc(li.note)}</td></tr>`;
  const veRow = !ve ? '' : ve.verdict === 'INFO'
    ? `<tr><td>환기</td><td>${ve.occupants}인 × ${ve.perPersonCMH} = ${ve.requiredCMH} CMH (ACH ${ve.ACH})</td></tr>`
    : `<tr><td>환기</td><td>재실 ${ve.occupants ?? '—'}인·실체적 ${ve.roomVolM3}m³ — ${esc(ve.note)}</td></tr>`;
  const elRow = !el ? '' : el.verdict === 'INFO'
    ? `<tr><td>전기</td><td>${el.totalVA} VA → 분기 ${el.circuits}회로 (${esc(el.basis)})</td></tr>`
    : `<tr><td>전기</td><td>${esc(el.note)}</td></tr>`;
  const notes = [li?.verdict === 'INFO' ? li.note : null, ve?.verdict === 'INFO' ? ve.note : null, el?.verdict === 'INFO' ? el.note : null].filter(Boolean);
  return `<h2>④ 설비 개산 (조명·환기·전기)</h2><table><tr><th>항목</th><th>산출</th></tr>${liRow}${veRow}${elRow}</table>${notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : ''}`;
}

export function interiorReport(r, { title = '피난·마감 검증' } = {}) {
  if (!r?.ok) return SHELL(title, '실패', `<div class="honest">${esc(r?.error ?? '체인 실패')}</div>`);
  const t = r.travel, e = r.egress, fi = r.finishes;
  return SHELL(`${title} — 인테리어`, 'nexyfab · 보행거리 BFS 실측 · 문폭=형상 파생', `
<div class="kpi"><div><b style="color:${t.pass ? '#16a34a' : '#dc2626'}">${f(t.maxTravelM, 1)} m</b><span>최원점 보행거리 (한계 ${t.limitM}m)</span></div>
<div><b>${e?.derived?.doorWidthSumMm ?? '-'} mm</b><span>출입구 유효폭 합(형상)</span></div>
<div><b>${e?.derived?.seatCount ?? '-'}</b><span>좌석 수</span></div>
<div><b>${f(fi.floorM2, 1)} m²</b><span>바닥면적</span></div></div>
<h2>① 보행거리 (격자 BFS)</h2><table><tr><th>항목</th><th>값</th></tr>
<tr><td>최원점 보행거리</td><td>${f(t.maxTravelM, 2)} m → ${V(t.pass ? 'PASS' : 'FAIL')}</td></tr>
<tr><td>미도달 구역</td><td>${f(t.unreachableM2, 2)} m² ${t.unreachableCells > 0 ? '⚠ 배치 확인' : ''}</td></tr>
<tr><td>방법</td><td>${esc(t.method)}</td></tr></table>
<div class="honest">${esc(t.limitNote)}</div>
<h2>② 수용인원·피난폭 (occupancy_egress)</h2>
${e?.checks ? checksTable(e.checks) : `<div class="honest">${esc(e?.error ?? '계산기 미실행')}</div>`}
<table><tr><th>판정</th><th>${V(e?.verdict)}</th></tr></table>
<h2>③ 마감 물량 (개구 공제)</h2><table><tr><th>바닥</th><th>벽(실내 1면)</th><th>천장</th></tr>
<tr><td>${f(fi.floorM2)} m²</td><td>${f(fi.wallM2)} m²</td><td>${f(fi.ceilingM2)} m²</td></tr></table>
<div class="note">${esc(fi.note)}</div>
${mepSec(r)}
<div class="honest">⚠ ${esc(r.disclaimer)}</div>`);
}

/** 토목 옹벽 안정 리포트 (verifyDomain 결과) */
export function retainingWallReport(v, { title = '옹벽 안정 검토' } = {}) {
  if (!v?.ok) return SHELL(title, '실패', `<div class="honest">${esc(v?.error ?? JSON.stringify(v?.needInputs))}</div>`);
  const rows = Object.entries(v.checks ?? {}).map(([k, c]) => `<tr><td>${esc(k)}</td><td>${f(c.FS ?? c.value ?? c.e_m ?? c.qmax_kPa, 2)}</td><td>${f(c.required ?? c.limit ?? c.allow ?? c.min ?? c.limit_m ?? c.allow_kPa, 2)}</td><td>${c.pass ? '✓' : '✕'}</td></tr>`).join('');
  const sz = v.seismic;
  const seismicSec = sz ? (sz.error ? `<div class="honest">지진시: ${esc(sz.error)}</div>` : `
<h2>③ 지진시 검토 (Mononobe-Okabe, kh=${sz.kh})</h2>
<table><tr><th>항목</th><th>값</th></tr><tr><td>KAE</td><td>${sz.Kae}</td></tr><tr><td>지진시 총토압 PAE</td><td>${sz.Pae_kN} kN/m (동적증분 ${sz.dPae_kN})</td></tr><tr><td>벽체 관성력</td><td>${sz.wallInertia_kN} kN/m</td></tr></table>
<table><tr><th>검토</th><th>FS</th><th>기준(표 4.4-1 지진시)</th><th>판정</th></tr>
${Object.entries(sz.checks).map(([k, c]) => `<tr><td>${esc(k)}</td><td>${f(c.FS, 2)}</td><td>${c.min}</td><td>${c.pass ? '✓' : '✕'}</td></tr>`).join('')}</table>
<div class="note">${esc(sz.method)}</div>`) : '';
  return SHELL(`${title} — 전도·활동·지지력`, 'nexyfab · Rankine 주동토압(KDS 11 80 05 의무조항) · 단면=형상 자동 파생', `
<div class="kpi"><div><b>${V(v.verdict)}</b><span>종합 판정</span></div></div>
<h2>① 형상 파생 입력 (사용자 덮어쓰기 불가)</h2><table><tr><th>항목</th><th>값</th></tr>
${Object.entries(v.derived ?? {}).map(([k, val]) => `<tr><td>${esc(k)}</td><td>${f(val, 2)} m</td></tr>`).join('')}</table>
<h2>② 안정 검토</h2><table><tr><th>검토</th><th>값</th><th>기준</th><th>판정</th></tr>${rows}</table>
${seismicSec}
<div class="honest">⚠ ${esc(v.disclaimer ?? '개념 검토(비법정)')}</div>
<div class="note">근거: ${(v.refs ?? []).map(esc).join(' · ')}</div>`);
}
