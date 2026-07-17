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
import { partVolume, DENSITY } from './structural.mjs';

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

/**
 * 타이드 아치교 간이 검토 (260718 — 고전 폐형·비법정).
 *
 * 전부 형상 파생 + 명시된 간이화:
 *   ① 사하중 = 주경간 부품(데크·타이·아치·행어·브레이싱·페데스탈) 자중 합 ÷ L (등분포 근사 명시)
 *   ② 활하중 = KL-510 표준차로하중 12.7 kN/m × 재하차로 + 트럭 등가 UDL(510kN/L — 전역 H 보수측 명시)
 *   ③ 수평력 H = w·L²/(8f) (포물선 아치 등분포 폐형 — 타이드 아치라 지점 수평반력=타이 인장, 하부공 무추력)
 *   ④ 타이 인장 = H/2(2본 분담) · 리브 축력 = (H/2)/cosθ0(스프링잉) · 행어 장력 = w/2×s(수직)
 *      닐센 = ÷2cosφ̄(쌍 분담·φ̄=평균 경사 근사 명시)
 *   ⑤ 응력비 = 힘/단면적 ÷ 0.6Fy — 단면적 기본=모델 중실 근사(실 박스거더는 A 입력 권장 — 명시)
 *
 * 미지원(명시): 아치 면내·면외 좌굴, 시공단계, 피로, 비대칭 재하(리브 휨), 풍하중·지진.
 */
export function archBridgeCheck(assembly, params = {}) {
  const am = assembly?.archMeta;
  if (!am) return { ok: false, error: 'archMeta 필요 (arch_bridge 어셈블리)' };
  const allParts = assembly.parts ?? [];
  const unverifiedParts = allParts.filter((p) => p.unverified === true);
  const parts = allParts.filter((p) => p.unverified !== true);
  const L = am.mainSpan / 1000, f = am.rise / 1000; // m
  if (!(L > 0) || !(f > 0)) return { ok: false, error: 'mainSpan·rise 필요' };

  // ── ① 주경간 사하중(형상×밀도 — 결정론. 접속교·교각 제외) ──
  const mains = parts.filter((p) => !/^ap[LR]_/.test(p.id ?? '') && !/^main_pier/.test(p.id ?? ''));
  let W_kN = 0;
  for (const p of mains) {
    const rho = (DENSITY[p.material ?? 'steel'] ?? DENSITY.steel);
    const qty = Math.max(1, Math.round(Number(p.qty) || 1));
    W_kN += (partVolume(p.type, p.params) / 1e9) * rho * qty * 9.80665 / 1000;
  }
  const wDC = W_kN / L; // kN/m (등분포 근사 명시)
  const pvThk = Number(params.pavementThk_mm) || 0;
  const pvRho = params.pavementRho ?? 22.6;
  const wDW = pvThk > 0 ? (pvThk / 1000) * pvRho * (am.deckW / 1000) : 0;

  // ── ② 활하중(간이 등가 UDL — 명시) ──
  const nLanes = params.nLanes ?? Math.max(1, Math.floor(am.deckW / 1000 / 3.6));
  const wLL = 12.7 * nLanes + 510 / L; // kN/m (차로하중 KL-510 12.7 + 트럭 총중량 등가 UDL)

  // ── ③ 극한 I 근사 조합 + 수평력 폐형 ──
  const wu = 1.25 * wDC + 1.5 * wDW + 1.8 * wLL; // kN/m
  const H = (wu * L * L) / (8 * f); // kN (총·양리브 합)

  // ── ④ 부재력 ──
  const th0 = Math.atan((4 * f) / L);
  const T_tie = H / 2; // kN/본
  const N_rib = (H / 2) / Math.cos(th0); // kN/본(스프링잉 축압축)
  const s_m = am.hangerSpacing / 1000;
  const T_hv = ((wu / 2) * s_m); // kN/본(수직 — 한쪽 리브 분담)
  const nielsen = am.hangerStyle === 'nielsen';
  // 닐센 φ̄: 평균 행어 길이 ≈ 0.67f(포물선 평균 명시) 기준 경사각
  const phiBar = nielsen ? Math.atan2(s_m / 2, Math.max(0.1, 0.67 * f)) : 0;
  const T_h = nielsen ? T_hv / (2 * Math.cos(phiBar)) : T_hv;

  // ── ⑤ 응력비(0.6Fy 허용 — 비법정 간이) ──
  const Fy = params.Fy ?? 355; // MPa (SM355 관례)
  const sigA = 0.6 * Fy;
  const A_tie = Number(params.A_tie_mm2) > 0 ? Number(params.A_tie_mm2) : am.tieW * am.tieH;
  const A_rib = Number(params.A_rib_mm2) > 0 ? Number(params.A_rib_mm2) : am.ribW * am.ribH;
  const A_h = Number(params.A_hanger_mm2) > 0 ? Number(params.A_hanger_mm2) : am.hangerDia * am.hangerDia;
  const mk = (name, force_kN, A_mm2, kind) => {
    const sig = (force_kN * 1000) / A_mm2;
    return { name, kind, force_kN: round(force_kN, 1), A_mm2: Math.round(A_mm2), sigma_MPa: round(sig, 1), allow_MPa: round(sigA, 1), ratio: round(sig / sigA, 3), ok: sig <= sigA };
  };
  const checks = [
    mk('타이 인장(본당)', T_tie, A_tie, 'tension'),
    mk('아치 리브 축압축(스프링잉·본당)', N_rib, A_rib, 'compression(좌굴 미검토 명시)'),
    mk(nielsen ? `닐센 행어 장력(φ̄=${round((phiBar * 180) / Math.PI, 1)}°)` : '행어 장력(본당)', T_h, A_h, 'tension'),
  ];
  return {
    ok: true,
    geometry: { span_m: round(L, 1), rise_m: round(f, 1), riseRatio: round(f / L, 3), hangerStyle: am.hangerStyle, nLanes },
    loads: { wDC_kNm: round(wDC, 1), wDW_kNm: round(wDW, 2), wLL_kNm: round(wLL, 1), wu_kNm: round(wu, 1), combo: '극한 I 근사: 1.25DC+1.50DW+1.80LL(등가 UDL — 간이 명시)' },
    forces: { H_kN: round(H, 0), theta0_deg: round((th0 * 180) / Math.PI, 1) },
    checks,
    verdict: checks.every((c) => c.ok) ? 'PASS' : 'FAIL',
    assumptions: [
      '사하중=주경간 부품 자중 합/L 등분포 근사(접속교·교각 제외 — 타이드 아치 자기평형계만)',
      '활하중=차로하중 12.7kN/m×차로 + 트럭 510kN/L 등가 UDL(영향선 미적용 — 전역 H 보수측)',
      'H=wL²/8f 포물선 등분포 폐형 · 부재력=축력만(비대칭 재하 리브 휨 미포함)',
      '단면적 기본=모델 중실 근사(실 박스/강관 단면은 A_tie_mm2·A_rib_mm2·A_hanger_mm2 입력 권장)',
      '모델 중실 강부재(타이·리브) 자중=실교 박스거더 대비 과대측 → 사하중·부재력 보수측(명시)',
      nielsen ? '닐센 φ̄=atan(s/2 ÷ 0.67f) 평균 경사 근사' : null,
    ].filter(Boolean),
    disclaimer: '간이 폐형 검토(비법정) — 아치 좌굴·시공단계·피로·비대칭 재하·풍/지진 미포함. 법정 설계도서는 기술사 검토·날인 필요.' + (unverifiedParts.length ? ` ⚠ 비검증 파츠 ${unverifiedParts.length}개 제외.` : ''),
  };
}

// ── 공통 헬퍼(간이 검토군 — 260718b) ──────────────────────────────────────
/** 부품 자중 합(kN) — id 필터(접속교·교각 제외 등)·qty 반영. */
function selfWeightKN(parts, excludeRe = null) {
  let w = 0;
  for (const p of parts) {
    if (excludeRe && excludeRe.test(p.id ?? '')) continue;
    const rho = DENSITY[p.material ?? 'steel'] ?? DENSITY.steel;
    const qty = Math.max(1, Math.round(Number(p.qty) || 1));
    w += (partVolume(p.type, p.params) / 1e9) * rho * qty * 9.80665 / 1000;
  }
  return w;
}
/** 응력비 부재 검토행(축력/단면적 ÷ 0.6Fy). */
function memberCheck(name, force_kN, A_mm2, kind, Fy = 355) {
  const sig = (Math.abs(force_kN) * 1000) / A_mm2;
  const allow = 0.6 * Fy;
  return { name, kind, force_kN: round(force_kN, 1), A_mm2: Math.round(A_mm2), sigma_MPa: round(sig, 1), allow_MPa: round(allow, 1), ratio: round(sig / allow, 3), ok: sig <= allow };
}
const LIVE_LANE_KNM = 12.7, LIVE_TRUCK_KN = 510; // KL-510 차로하중·트럭 총중량(간이 등가 UDL용)

/** 트러스교 간이 검토(단면법 폐형 — 260718b, 비법정).
 *  현재력=M/h(상현 압축·하현 인장, M=wL²/8)·대각재=V/sinθ(지점 최대 전단)·수직재=패널 전단. */
export function trussBridgeCheck(assembly, params = {}) {
  const tm = assembly?.trussMeta;
  if (!tm) return { ok: false, error: 'trussMeta 필요 (truss_bridge 어셈블리)' };
  const parts = (assembly.parts ?? []).filter((p) => p.unverified !== true);
  const L = tm.span / 1000, h = tm.trussH / 1000, nP = tm.panels;
  const W_kN = selfWeightKN(parts, /^abut_/);
  const wDC = W_kN / L;
  const pvThk = Number(params.pavementThk_mm) || 0, pvRho = params.pavementRho ?? 22.6;
  const wDW = pvThk > 0 ? (pvThk / 1000) * pvRho * (tm.deckW / 1000) : 0;
  const nLanes = params.nLanes ?? Math.max(1, Math.floor(tm.deckW / 1000 / 3.6));
  const wLL = LIVE_LANE_KNM * nLanes + LIVE_TRUCK_KN / L;
  const wu = 1.25 * wDC + 1.5 * wDW + 1.8 * wLL;
  const M = (wu * L * L) / 8, V = (wu * L) / 2;
  const panelL = (tm.panelL ?? tm.span / nP) / 1000;
  const thD = Math.atan2(h, panelL);
  // 부재력(트러스 1면 분담 — 2면이므로 절반)
  const chordForce = M / h / 2;         // kN/면(상현 압축·하현 인장 동일 크기)
  const diagForce = V / Math.sin(thD) / 2;
  const Fy = params.Fy ?? 355;
  const A_ch = Number(params.A_chord_mm2) > 0 ? Number(params.A_chord_mm2) : tm.chordS * tm.chordS;
  const A_dg = Number(params.A_diag_mm2) > 0 ? Number(params.A_diag_mm2) : tm.diagS * tm.diagS;
  const checks = [
    memberCheck('하현재 인장(면당)', chordForce, A_ch, 'tension', Fy),
    memberCheck('상현재 압축(면당·좌굴 미검토 명시)', -chordForce, A_ch, 'compression', Fy),
    memberCheck('단부 대각재(면당)', diagForce, A_dg, 'axial', Fy),
  ];
  return {
    ok: true, type: assembly.trussMeta.trussType ?? 'warren',
    geometry: { span_m: round(L, 1), trussH_m: round(h, 2), panels: nP, panelL_m: round(panelL, 2), nLanes },
    loads: { wDC_kNm: round(wDC, 1), wDW_kNm: round(wDW, 2), wLL_kNm: round(wLL, 1), wu_kNm: round(wu, 1), combo: '극한 I 근사: 1.25DC+1.50DW+1.80LL(등가 UDL — 간이)' },
    forces: { M_kNm: round(M, 0), V_kN: round(V, 0), theta_deg: round((thD * 180) / Math.PI, 1) },
    checks, verdict: checks.every((c) => c.ok) ? 'PASS' : 'FAIL',
    assumptions: [
      '단순보 근사 M=wL²/8·V=wL/2 → 현재력=M/h·대각재=V/sinθ(단면법, 2면 분담)',
      '활하중=차로하중 12.7kN/m×차로 + 트럭 510kN/L 등가 UDL(영향선 미적용 — 보수측)',
      '단면적 기본=모델 중실 근사(실 형강은 A_chord_mm2·A_diag_mm2 입력 권장)·상현 좌굴 미검토',
    ],
    disclaimer: '간이 폐형 검토(비법정) — 좌굴·2차 응력·시공단계·피로·풍/지진 미포함. 법정 설계도서는 기술사 검토·날인 필요.',
  };
}

/** 사장교 간이 검토(260718b, 비법정): 스테이 장력=편측 데크 분담/sinα·마스트 축력=데크 총하중. */
export function cableStayedCheck(assembly, params = {}) {
  const cm = assembly?.cableStayedMeta;
  if (!cm) return { ok: false, error: 'cableStayedMeta 필요 (cable_stayed_bridge 어셈블리)' };
  const parts = (assembly.parts ?? []).filter((p) => p.unverified !== true);
  const L = cm.mainSpan / 1000, pylonH = cm.pylonH / 1000, nStays = cm.nStays;
  // 데크 하중(주경간)만 — 마스트/스테이 제외
  const wDeck = selfWeightKN(parts.filter((p) => /deck|girder/.test(p.role ?? '')), null) / (L + 2 * cm.sideSpan / 1000);
  const pvThk = Number(params.pavementThk_mm) || 0, pvRho = params.pavementRho ?? 22.6;
  const wDW = pvThk > 0 ? (pvThk / 1000) * pvRho * (cm.deckW / 1000) : 0;
  const nLanes = params.nLanes ?? Math.max(1, Math.floor(cm.deckW / 1000 / 3.6));
  const wLL = LIVE_LANE_KNM * nLanes + LIVE_TRUCK_KN / L;
  const wu = 1.25 * wDeck + 1.5 * wDW + 1.8 * wLL;
  // 스테이 1가닥 분담 = 주경간 절반을 스테이 수로 나눔(편측·2면)
  const tribLen = (L / 2) / nStays;
  const alphaBar = Math.atan2(pylonH * 0.6, (L / 4)); // 평균 스테이각 근사
  const V_stay = (wu * tribLen) / 2;                   // 편측 2면 → /2
  const T_stay = V_stay / Math.sin(alphaBar);
  const N_mast = (wu * L) / 2;                          // 마스트 2기 각 절반 데크하중(수직 성분 합 근사)
  const Fy = params.Fy ?? 355;
  const A_stay = Number(params.A_stay_mm2) > 0 ? Number(params.A_stay_mm2) : cm.stayS ? cm.stayS * cm.stayS : 250 * 250;
  const A_mast = Number(params.A_mast_mm2) > 0 ? Number(params.A_mast_mm2) : (cm.mastW ? cm.mastW * cm.mastW : 2500 * 2500);
  const checks = [
    memberCheck(`스테이 장력(ᾱ=${round((alphaBar * 180) / Math.PI, 1)}°·가닥)`, T_stay, A_stay, 'tension', Fy),
    memberCheck('마스트 축압축(기당·좌굴 미검토 명시)', -N_mast, A_mast, 'compression', Fy),
  ];
  return {
    ok: true, arrangement: cm.arrangement ?? 'fan',
    geometry: { mainSpan_m: round(L, 1), pylonH_m: round(pylonH, 1), nStays, nLanes },
    loads: { wDeck_kNm: round(wDeck, 1), wDW_kNm: round(wDW, 2), wLL_kNm: round(wLL, 1), wu_kNm: round(wu, 1) },
    forces: { V_stay_kN: round(V_stay, 1), N_mast_kN: round(N_mast, 0) },
    checks, verdict: checks.every((c) => c.ok) ? 'PASS' : 'FAIL',
    assumptions: [
      '스테이 1가닥=주경간 절반÷스테이 수 분담(편측·2면)·장력=수직분담/sinᾱ',
      'ᾱ=평균 스테이각 근사·마스트 축력=데크 총하중/2(수직성분 합 근사)',
      '활하중=차로+트럭 등가 UDL·단면적 기본=중실 근사(A_stay_mm2·A_mast_mm2 입력 권장)·좌굴/케이블 새그 미검토',
    ],
    disclaimer: '간이 폐형 검토(비법정) — 케이블 새그·마스트 좌굴·비대칭 재하·시공단계·피로·풍/지진 미포함. 법정 설계도서는 기술사 검토·날인 필요.',
  };
}

/** 현수교 간이 검토(260718b, 비법정): 주케이블 수평력 H=wL²/8f·최대장력 T=H/cosθ·행어=w·간격. */
export function suspensionCheck(assembly, params = {}) {
  const sm = assembly?.suspensionMeta;
  if (!sm) return { ok: false, error: 'suspensionMeta 필요 (suspension_bridge 어셈블리)' };
  const parts = (assembly.parts ?? []).filter((p) => p.unverified !== true);
  const L = sm.mainSpan / 1000, f = sm.sag / 1000;
  const wDeck = selfWeightKN(parts.filter((p) => /deck|crossbeam/.test(p.role ?? '')), null) / (L + 2 * sm.sideSpan / 1000);
  const pvThk = Number(params.pavementThk_mm) || 0, pvRho = params.pavementRho ?? 22.6;
  const wDW = pvThk > 0 ? (pvThk / 1000) * pvRho * (sm.deckW / 1000) : 0;
  const nLanes = params.nLanes ?? Math.max(1, Math.floor(sm.deckW / 1000 / 3.6));
  const wLL = LIVE_LANE_KNM * nLanes + LIVE_TRUCK_KN / L;
  const wu = 1.25 * wDeck + 1.5 * wDW + 1.8 * wLL;
  const H = (wu * L * L) / (8 * f);           // 케이블 수평력(양 케이블 합)
  const thMax = Math.atan((4 * f) / L);
  const T_cable = (H / 2) / Math.cos(thMax);  // 타워부 최대 장력(케이블 1가닥)
  const s_m = sm.hangerSpacing / 1000;
  const T_hanger = (wu / 2) * s_m;            // 행어 1가닥(1면 분담)
  const N_tower = (H / 2) * Math.tan(thMax) * 2 + (wu * L) / 4; // 타워 축력 근사(케이블 수직성분+반력)
  const Fy = params.Fy ?? 500;               // 케이블 고강도(간이 — 실제는 1500+급 별도)
  const A_cable = Number(params.A_cable_mm2) > 0 ? Number(params.A_cable_mm2) : (sm.cableS ? sm.cableS * sm.cableS : 600 * 600);
  const A_hanger = Number(params.A_hanger_mm2) > 0 ? Number(params.A_hanger_mm2) : (sm.hangerS ? sm.hangerS * sm.hangerS : 150 * 150);
  const A_tower = Number(params.A_tower_mm2) > 0 ? Number(params.A_tower_mm2) : 3000 * 1800;
  const checks = [
    memberCheck('주케이블 최대장력(가닥·타워부)', T_cable, A_cable, 'tension', Fy),
    memberCheck('행어 장력(가닥)', T_hanger, A_hanger, 'tension', 355),
    memberCheck('주탑 축압축(기당·좌굴 미검토 명시)', -N_tower, A_tower, 'compression', 30),
  ];
  return {
    ok: true,
    geometry: { mainSpan_m: round(L, 1), sag_m: round(f, 1), sagRatio: round(f / L, 3), nLanes },
    loads: { wDeck_kNm: round(wDeck, 1), wDW_kNm: round(wDW, 2), wLL_kNm: round(wLL, 1), wu_kNm: round(wu, 1) },
    forces: { H_kN: round(H, 0), theta_deg: round((thMax * 180) / Math.PI, 1) },
    checks, verdict: checks.every((c) => c.ok) ? 'PASS' : 'FAIL',
    assumptions: [
      'H=wL²/8f 포물선 등분포 폐형·최대장력 T=H/cosθ(타워부)·행어=w·간격(1면)',
      '주탑 축력=케이블 수직성분+반력 근사·타워 σ 허용=콘크리트 0.6·30MPa 간이(강주탑은 Fy 입력)',
      '활하중=차로+트럭 등가 UDL·케이블 단면=등가 중실 근사(A_cable_mm2 등 입력 권장)·좌굴/공탄성 미검토',
    ],
    disclaimer: '간이 폐형 검토(비법정) — 케이블 공탄성·주탑 좌굴·비대칭 재하·시공단계·피로·풍(플러터)/지진 미포함. 법정 설계도서는 기술사 검토·날인 필요.',
  };
}

/** 산업 계단 간이 검토(260718b, 비법정): 트레드=양단 스트링거 지지 단순보 휨·스트링거=경사보 휨. */
export function stairCheck(assembly, params = {}) {
  const sm = assembly?.stairMeta;
  if (!sm) return { ok: false, error: 'stairMeta 필요 (industrial_stair 어셈블리)' };
  const w = sm.width / 1000, tread = sm.tread / 1000, nStep = sm.steps, rise = sm.totalRise / 1000;
  const liveKPa = params.liveKPa ?? 5.0; // 산업 계단 활하중 5kPa 관례(집회 이상)
  const Fy = params.Fy ?? 235;           // SS275/일반강 간이
  // 트레드: 단순보 span=w, 등분포 하중 = 활하중×트레드폭 + 자중 무시(보수: 활하중만은 아님, 집중 4.5kN 대안)
  const wt = liveKPa * tread;            // kN/m (트레드 1장 폭당)
  const Mt = (wt * w * w) / 8;           // kN·m
  // 트레드 단면(체커플레이트 근사 t=6, 폭 tread) → 소성계수 Z≈b·t²/4 는 과소 → 실무는 절곡보강.
  const tThk = params.treadThk_mm ?? 6;
  const Zt = (tread * 1000 * tThk * tThk) / 4; // mm³ (평판 소성 — 절곡/립 보강 미반영, 보수측)
  const sigT = (Mt * 1e6) / Zt;          // MPa
  // 스트링거: 경사 단순보, 스팬=경사장, 하중 = 계단 전체(활+trace) / 2본
  const runLen = Math.hypot(nStep * tread, rise);
  const totalLive = liveKPa * (nStep * tread) * w; // kN
  const wStr = (totalLive / 2) / runLen;           // kN/m per stringer(경사장 기준)
  const Ms = (wStr * runLen * runLen) / 8;
  const strH = params.stringerH_mm ?? 300, strT = 60;
  const Zs = (strT * strH * strH) / 4;             // mm³ 직사각 소성(간이)
  const sigS = (Ms * 1e6) / Zs;
  const allow = 0.6 * Fy;
  const checks = [
    { name: '트레드 휨(단순보·평판 보수측)', kind: 'flexure', M_kNm: round(Mt, 2), sigma_MPa: round(sigT, 1), allow_MPa: round(allow, 1), ratio: round(sigT / allow, 3), ok: sigT <= allow },
    { name: '스트링거 휨(경사 단순보)', kind: 'flexure', M_kNm: round(Ms, 2), sigma_MPa: round(sigS, 1), allow_MPa: round(allow, 1), ratio: round(sigS / allow, 3), ok: sigS <= allow },
  ];
  return {
    ok: true,
    geometry: { totalRise_m: round(rise, 2), steps: nStep, width_m: round(w, 2), tread_m: round(tread, 3), flights: sm.flights ?? 1 },
    loads: { liveKPa, note: '산업 계단 활하중 5kPa 관례(집회·대피 이상)' },
    checks, verdict: checks.every((c) => c.ok) ? 'PASS' : 'FAIL',
    assumptions: [
      '트레드=양단 스트링거 지지 단순보·등분포 활하중(자중 무시)·단면=평판 소성 Z=bt²/4(절곡/립 보강 미반영 — 보수측 과대응력)',
      '스트링거=경사 단순보·하중=계단 전체 활하중÷2본·직사각 소성 Z(간이)',
      '동적/집중하중(4.5kN 점하중)·연결부·처짐·좌굴 미검토 — 실 단면(체커플레이트 절곡·형강 스트링거)은 입력 권장',
    ],
    disclaimer: '간이 폐형 검토(비법정) — 처짐·진동·연결부·좌굴·동적하중 미포함. 법정 설계는 건축구조기술사 검토 필요.',
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
  // 아치 간이 검토(260718): H=wL²/8f 수기 재계산 폐형 + 닐센 φ̄ 반영 확인
  const arch = buildAssemblyTemplate('bridge', 'arch_bridge', {});
  const ar = archBridgeCheck(arch, {});
  if (!ar.ok) { console.log('FAIL arch', ar.error); process.exit(1); }
  const Hman = (ar.loads.wu_kNm * ar.geometry.span_m ** 2) / (8 * ar.geometry.rise_m);
  const okH = Math.abs(Hman - ar.forces.H_kN) < Math.max(1, ar.forces.H_kN * 0.01);
  const nz = buildAssemblyTemplate('bridge', 'arch_bridge', { hangerStyle: 'nielsen' });
  const nr = archBridgeCheck(nz, {});
  // 닐센=쌍 분담(÷2cosφ̄): 본당 힘은 수직의 절반 초과·수직 미만이라야 폐형
  const okN = nr.ok && nr.checks[2].name.includes('닐센') && nr.checks[2].force_kN < ar.checks[2].force_kN && nr.checks[2].force_kN > ar.checks[2].force_kN / 2;
  console.log('arch H:', ar.forces.H_kN, 'kN (수기', Math.round(Hman), ') · 타이', ar.checks[0].ratio, '· 리브', ar.checks[1].ratio, '· 행어', ar.checks[2].ratio, '| 닐센 행어', nr.ok ? nr.checks[2].force_kN : 'ERR');
  console.log(okH && okN ? 'arch-check self-test: PASS' : 'arch-check self-test: FAIL');
  if (!okH || !okN) process.exit(1);
  // 확장 간이 검토 4종(260718b): 트러스 단면법 M=wL²/8 폐형·사장/현수/계단 방출 sanity
  const tr = trussBridgeCheck(buildAssemblyTemplate('bridge', 'truss_bridge', {}), {});
  const trM = (tr.loads.wu_kNm * tr.geometry.span_m ** 2) / 8;
  const okT = tr.ok && Math.abs(trM - tr.forces.M_kNm) < Math.max(1, tr.forces.M_kNm * 0.01) && tr.checks.length === 3;
  const cs = cableStayedCheck(buildAssemblyTemplate('bridge', 'cable_stayed_bridge', {}), {});
  const okC = cs.ok && cs.checks.length === 2 && cs.forces.N_mast_kN > 0;
  const su = suspensionCheck(buildAssemblyTemplate('bridge', 'suspension_bridge', {}), {});
  const suH = (su.loads.wu_kNm * su.geometry.mainSpan_m ** 2) / (8 * su.geometry.sag_m);
  const okS = su.ok && Math.abs(suH - su.forces.H_kN) < Math.max(1, su.forces.H_kN * 0.01) && su.checks.length === 3;
  const st = stairCheck(buildAssemblyTemplate('building', 'industrial_stair', {}), {});
  const okStair = st.ok && st.checks.length === 2 && st.checks.every((c) => c.M_kNm > 0);
  console.log('truss M:', tr.forces.M_kNm, '(수기', Math.round(trM), ') 하현', tr.checks[0].ratio, '| 사장 마스트', cs.forces.N_mast_kN, '| 현수 H', su.forces.H_kN, '(수기', Math.round(suH), ') | 계단 트레드σ', st.checks[0].sigma_MPa);
  console.log(okT && okC && okS && okStair ? 'ext-check self-test: PASS' : 'ext-check self-test: FAIL');
  if (!(okT && okC && okS && okStair)) process.exit(1);
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
