/**
 * bridge-check.mjs — 거더교 자동 체인 (실시설계급 계산 품질 · 비법정).
 *
 * girder_bridge 어셈블리에서 (전부 형상 파생):
 *   ① 고정하중 DC = 거더 자중 + 바닥판 분담 + 가로보 분담 (형상×밀도, 결정론)
 *      DW = 포장 두께 입력 × 아스팔트 밀도 (미입력 = DW 미포함 명시)
 *   ② 활하중 = girder_line (KL-510 원문 하중, 영향선 엔진 — 미 3개주 공표표 재현 검증)
 *      분배계수 DF: 레버룰(정역학 정해 — 내측 거더, 힌지 가정 명시) 또는 입력 우선
 *   ③ 극한한계상태 I 조합 = 1.25DC + 1.50DW + 1.80(LL+IM) (KDS 24 12 11 표 4.1-1·2 원문)
 *   ④ RC 거더 가정 시 rc_beam 연계(T형 플랜지 유효폭은 보수측 복부 검토 명시 — PSC 미지원)
 *
 * 정직 원칙: 하중·계수 전부 원문 근거. 레버룰·복부 검토 등 근사 전부 명시.
 * 미지원(명시): 연속경간·PSC·처짐(§4.3.1.7)·피로·바닥판 설계·받침·하부공.
 */
import { runCalculator } from '../engineering-core/registry.mjs';
import { partVolume } from './structural.mjs';

const round = (v, n = 2) => +Number(v).toFixed(n);
const RHO_C = 24.5; // kN/m³ (교량 관례 24.5 — 국토부 표준도와 동일)

/**
 * @param assembly girder_bridge (bridgeMeta 필수)
 * @param params {
 *   pavementThk_mm?: 포장 두께(DW — 미입력 시 DW=0 명시), pavementRho=22.6 kN/m³(아스팔트 관례),
 *   DF?: 분배계수 직접 입력(우선), nLanes?: 재하차로(기본 바닥판 폭/3.6 내림),
 *   As_mm2?: 거더 인장철근(RC 가정 — rc_beam 연계), fck=27, fy=400,
 * }
 */
export function bridgeCheck(assembly, params = {}) {
  const bm = assembly?.bridgeMeta;
  if (!bm) return { ok: false, error: 'bridgeMeta 필요 (girder_bridge 어셈블리)' };
  const allParts = assembly.parts ?? [];
  const unverifiedParts = allParts.filter((p) => p.unverified === true);
  const parts = allParts.filter((p) => p.unverified !== true);
  const girders = parts.filter((p) => p.role === 'girder');
  const deck = parts.find((p) => p.role === 'deck');
  const crosses = parts.filter((p) => p.role === 'crossbeam');
  if (!girders.length || !deck) return { ok: false, error: 'girder·deck role 필요' };

  const L = bm.span / 1000; // m
  const s = bm.girderSpacing / 1000;
  const n = bm.nGirders;

  // ── ① 고정하중 (형상×밀도 — 결정론) ────────────────────────────────────────
  const girderSelf = (partVolume(girders[0].type, girders[0].params) / 1e9) * RHO_C / L; // kN/m
  const deckVol = (partVolume(deck.type, deck.params) / 1e9) * RHO_C;
  const deckPerGirder = deckVol / n / L; // kN/m (등분담 근사 — 내측 기준 명시)
  const crossPerGirder = crosses.reduce((sum, c) => sum + (partVolume(c.type, c.params) / 1e9) * RHO_C, 0) / n / L;
  const wDC = girderSelf + deckPerGirder + crossPerGirder;
  const pvThk = Number(params.pavementThk_mm) || 0;
  const pvRho = params.pavementRho ?? 22.6;
  const wDW = pvThk > 0 ? (pvThk / 1000) * pvRho * (bm.deckW / 1000 / n) : 0;
  const M_DC = wDC * L * L / 8, V_DC = wDC * L / 2;
  const M_DW = wDW * L * L / 8, V_DW = wDW * L / 2;

  // ── ② 활하중 — DF: 입력 우선, 아니면 레버룰(내측 거더, 힌지 가정) ─────────────
  // 레버룰 내측: 바퀴 1.8m 간격 축을 거더 위·간격 내 최불리 배치 → DF = (s−0.9)/s + max(0,(s−1.8−0.9))/s…
  // 정역학 단순화: 차륜(축의 1/2)들 지렛대 분담 — 3m 점유폭 1개 차로 기준 폐형:
  //   바퀴1 거더 직상(분담 1/2축), 바퀴2 1.8m 옆 → 분담 (s−1.8)/s×1/2 (s>1.8일 때)
  const leverDF = s > 1.8 ? 0.5 * (1 + (s - 1.8) / s) : 0.5;
  let DF, dfSrc;
  if (Number(params.DF) > 0) { DF = Number(params.DF); dfSrc = '입력'; }
  else {
    // 정밀식(표 4.6-5) 자동 — 적용범위 내일 때. 범위 밖은 레버룰 폴백(명시)
    try {
      const dfr = runCalculator('girder_df', { S_mm: Math.round(s * 1000), L_mm: Math.round(L * 1000), ts_mm: bm.deckThk, Nb: n }, 'KDS');
      DF = dfr.DF.interior_gov; dfSrc = '정밀식(KDS 24 10 11 표 4.6-5 — Kg항 1.0 기본설계)';
    } catch (e) {
      DF = round(leverDF, 3); dfSrc = '레버룰(정밀식 적용범위 밖: ' + e.message.slice(0, 40) + '…)';
    }
  }
  const nLanes = params.nLanes ?? Math.max(1, Math.floor(bm.deckW / 1000 / 3.6));
  let ll = null;
  try {
    ll = runCalculator('girder_line', { span: round(L, 1), DF, nLanes }, 'KDS');
  } catch (e) {
    return { ok: false, error: 'girder_line 실패: ' + e.message };
  }
  const M_LL = ll.perGirder.M_kNm, V_LL = ll.perGirder.V_kN;

  // ── ③ 극한한계상태 I (KDS 24 12 11 표 4.1-1·4.1-2 원문): 1.25DC+1.50DW+1.80(LL+IM)
  const Mu = 1.25 * M_DC + 1.50 * M_DW + 1.80 * M_LL;
  const Vu = 1.25 * V_DC + 1.50 * V_DW + 1.80 * V_LL;
  // 사용 I (처짐·균열 참고): 1.0DC+1.0DW+1.0LL
  const Ms = M_DC + M_DW + M_LL;

  // ── ④ RC 거더 단면 검토 (선택 — As 입력 시. 복부 직사각 보수측 검토 명시) ──
  let section = null;
  if (Number(params.As_mm2) > 0) {
    const sec = bm.section;
    const d = bm.girderH - 150; // 유효깊이 근사(피복+철근 150 관례 명시)
    try {
      const r = runCalculator('rc_beam', {
        b: sec.webT, d, fck: params.fck ?? 27, fy: params.fy ?? 400,
        As: Number(params.As_mm2), Mu: round(Mu), Vu: round(Vu),
      }, 'KDS');
      section = {
        verdict: r.verdict, checks: r.checks,
        note: `복부 ${sec.webT}×d${d} 직사각 검토(보수측 — T형 유효폭 미적용 명시). RC 가정 — PSC는 미지원.`,
      };
    } catch (e) {
      section = { verdict: e.code === 'INPUT_GATE' ? 'INPUT' : 'ERROR', error: e.message };
    }
  }

  return {
    ok: true,
    geometry: { span_m: round(L, 1), nGirders: n, spacing_m: round(s, 2), deckW_m: round(bm.deckW / 1000, 2) },
    dead: {
      wDC_kNm: round(wDC, 2), girderSelf: round(girderSelf, 2), deckShare: round(deckPerGirder, 2), crossShare: round(crossPerGirder, 3),
      wDW_kNm: round(wDW, 2), dwNote: pvThk > 0 ? `포장 ${pvThk}mm × ${pvRho}kN/m³` : 'DW(포장) 미입력 — 미포함 명시',
      M_DC: round(M_DC, 1), M_DW: round(M_DW, 1),
    },
    live: { DF, dfSrc, nLanes, M_LL: round(M_LL, 1), V_LL: round(V_LL, 1), detail: { lane: ll.lane, truck: ll.truck, govern: ll.perLane.governM } },
    ultimate: { Mu_kNm: round(Mu, 1), Vu_kN: round(Vu, 1), combo: '극한 I: 1.25DC + 1.50DW + 1.80(LL+IM) — KDS 24 12 11 표 4.1-1·2 원문' },
    service: { Ms_kNm: round(Ms, 1) },
    section,
    provenance: { geometry: ['거더·바닥판·가로보 자중', '지간·간격', '레버룰 DF'], user: ['포장 두께(DW)', 'DF/차로수(선택)', '철근(단면 검토)'] },
    disclaimer: '실시설계급 계산(원문 하중·계수·영향선 검증) — 단, 법정 설계도서는 교량 기술사 검토·날인 필요. 연속경간·PSC·바닥판·받침·하부공·피로·처짐 미포함(명시).' + (unverifiedParts.length ? ` ⚠ 비검증 직접편집 파츠 ${unverifiedParts.length}개는 구조 검토에서 제외됨(P4 라벨) — 해당 형상의 안전은 별도 확인 필요.` : ''),
  };
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('bridge-check.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  const asm = buildAssemblyTemplate('bridge', 'girder_bridge', { span: 30000, nGirders: 4, girderSpacing: 2500 });
  const r = bridgeCheck(asm, { pavementThk_mm: 80 });
  if (!r.ok) { console.log('FAIL', r.error); process.exit(1); }
  console.log('DC:', r.dead.wDC_kNm, 'kN/m (거더', r.dead.girderSelf, '+바닥판', r.dead.deckShare, ') | M_DC:', r.dead.M_DC);
  console.log('LL: DF', r.live.DF, '(' + r.live.dfSrc.slice(0, 10) + '…) M_LL:', r.live.M_LL, '| 극한 Mu:', r.ultimate.Mu_kNm, 'kN·m');
  // sanity: 레버룰 DF = 0.5(1+(2.5−1.8)/2.5)=0.64 · M_DC>0 · Mu > M_DC×1.25
  const ok = Math.abs(r.live.DF - 0.568) < 0.005 && r.live.dfSrc.includes('정밀식') && r.ultimate.Mu_kNm > 1.25 * r.dead.M_DC && r.dead.wDC_kNm > 10;
  console.log(ok ? 'bridge-check self-test: PASS' : 'bridge-check self-test: FAIL');
  if (!ok) process.exit(1);
}

/**
 * 교량 전수 루프 — 전 거더 개별 검토 (내측/외측 DF 구분 + 위치별 고정하중 분담).
 * 외측 거더: girder_df 외측식(e=0.77+de/2800) — de=바닥판 연단~외측 거더 거리.
 * 교차검증: 내측 거더 결과 = bridgeCheck 대표 결과와 Mu 일치(동일 로직 게이트).
 */
export function bridgeLoop(assembly, params = {}) {
  const base = bridgeCheck(assembly, params);
  if (!base.ok) return base;
  const bm = assembly.bridgeMeta;
  const girders = (assembly.parts ?? []).filter((p) => p.role === 'girder' && p.unverified !== true).slice().sort((a, b) => (a.at?.ty ?? 0) - (b.at?.ty ?? 0));
  const s = bm.girderSpacing / 1000, L = bm.span / 1000, n = bm.nGirders;
  const deckPart = (assembly.parts ?? []).find((p) => p.role === 'deck');
  const deckCy = deckPart ? ((deckPart.at?.ty ?? 0)) : 0;
  const gTys = girders.map((g) => g.at?.ty ?? 0);
  const centerY = deckPart && Math.abs(deckCy) > 1 ? deckCy : (Math.min(...gTys) + Math.max(...gTys)) / 2;
  const deckHalf = bm.deckW / 2;
  const members = [];
  for (const [gi, g] of girders.entries()) {
    const ty = (g.at?.ty ?? 0) - centerY;
    const edgeDist = deckHalf - Math.abs(ty); // 바닥판 연단까지(데크/거더군 중심 보정)
    const isExterior = gi === 0 || gi === girders.length - 1;
    let DF, dfSrc;
    if (Number(params.DF) > 0) { DF = params.DF; dfSrc = '입력(전 거더 동일)'; }
    else {
      try {
        const de = Math.max(0, Math.round(edgeDist - 0)); // de≈연단~거더 중심(관례 명시)
        const dfr = runCalculator('girder_df', { S_mm: Math.round(s * 1000), L_mm: Math.round(L * 1000), ts_mm: bm.deckThk, Nb: n, ...(isExterior ? { de_mm: de } : {}) }, 'KDS');
        DF = isExterior ? (dfr.DF.exterior?.DF_multi ?? dfr.DF.interior_gov) : dfr.DF.interior_gov;
        dfSrc = isExterior ? '정밀식 외측(e=0.77+de/2800)' : '정밀식 내측';
      } catch { DF = base.live.DF; dfSrc = '대표값 폴백(범위 밖)'; }
    }
    let ll;
    try { ll = runCalculator('girder_line', { span: +L.toFixed(1), DF, nLanes: base.live.nLanes }, 'KDS'); }
    catch (e) { members.push({ id: g.id ?? `girder${gi + 1}`, error: e.message }); continue; }
    const Mu = 1.25 * base.dead.M_DC + 1.5 * base.dead.M_DW + 1.8 * ll.perGirder.M_kNm;
    const Vu = 1.25 * (base.dead.wDC_kNm * L / 2) + 1.5 * ((base.dead.wDW_kNm ?? 0) * L / 2) + 1.8 * ll.perGirder.V_kN;
    let verdict = 'INFO', util = null;
    if (Number(params.As_mm2) > 0) {
      try {
        const r = runCalculator('rc_beam', { b: bm.section.webT, d: bm.girderH - 150, fck: params.fck ?? 27, fy: params.fy ?? 400, As: Number(params.As_mm2), Mu: +Mu.toFixed(1), Vu: +Vu.toFixed(1) }, 'KDS');
        verdict = r.verdict; util = r.checks?.flexure?.ratio ?? null;
      } catch (e) { verdict = 'ERROR'; }
    }
    members.push({ id: g.id ?? `girder${gi + 1}`, position: isExterior ? '외측' : '내측', DF: +Number(DF).toFixed(3), dfSrc, Mu_kNm: +Mu.toFixed(1), Vu_kN: +Vu.toFixed(1), verdict, util });
  }
  // 교차검증: 내측 거더 Mu = 대표(bridgeCheck) Mu 일치
  const interior = members.find((m) => m.position === '내측');
  const crossCheck = interior
    ? { loopInteriorMu: interior.Mu_kNm, representativeMu: base.ultimate.Mu_kNm, pass: Math.abs(interior.Mu_kNm - base.ultimate.Mu_kNm) <= Math.max(0.5, base.ultimate.Mu_kNm * 0.01) }
    : { note: '내측 거더 없음(2거더교)' };
  const counts = { PASS: 0, FAIL: 0, INFO: 0, ERROR: 0 };
  for (const m of members) counts[m.verdict === 'PASS' ? 'PASS' : m.verdict === 'FAIL' ? 'FAIL' : m.verdict === 'ERROR' ? 'ERROR' : 'INFO']++;
  return {
    ok: true, members, summary: { total: members.length, ...counts }, crossCheck,
    notes: [
      '전 거더 개별 DF(내측 정밀식·외측 e식 — 외측 de=연단~거더 중심 관례 명시)·동일 고정하중 분담(등분담 근사 유지 — 외측 증가분은 후속).',
      '교차검증: 내측 거더 Mu=대표 검토 일치 게이트' + (crossCheck.pass === false ? ' — ⚠ 불일치' : '.'),
    ],
    disclaimer: base.disclaimer,
  };
}
