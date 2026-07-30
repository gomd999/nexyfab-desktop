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

  // ── ④ RC 거더 단면 검토 (As 입력 시. 복부 직사각 보수측 검토 명시) ──
  //
  // ⚠ 260729b: As 가 없으면 `section = null` 로 **조용히 사라졌다.** 그 결과 Mu·Vu 를
  //   다 산출해 놓고 부재 강도 판정을 하나도 안 한 채, 남는 것은 "바닥판 폭 자기정합"
  //   하나뿐이었다 — 그게 evidenceSufficient 를 충족시켜 **「이상 없음」으로 나갔다.**
  //   설계압력·배근처럼 지어낼 수 없는 값은 **이름으로 요구**해야 한다(도메인 공통 원칙).
  let section = null;
  if (!(Number(params.As_mm2) > 0)) {
    section = {
      // ⚠ 260731b: 소비부가 컨테이너 키 `section` 을 라벨로 쓰고 있었다 — 근본에서 이름을 준다.
      labelKo: '거더 단면 강도 검토 (RC 복부 직사각 보수측)',
      verdict: 'INPUT',
      needInputs: [{
        field: 'As_mm2',
        reason: '거더 인장철근 단면적(mm²) — 배근은 형상에서 알 수 없다. 없으면 Mu·Vu 를 '
          + '산출해도 **부재가 견디는지 판정할 수 없다**(단면력 산출 ≠ 안전 판정).',
      }],
      note: `단면력은 산출됐다(Mu ${round(Mu, 1)}kN·m · Vu ${round(Vu, 1)}kN). 배근을 주면 rc_beam 으로 검토한다.`,
    };
  } else {
    const sec = bm.section ?? {};
    // 복부폭·거더 높이 — 정식 필드 우선, 없으면 흔한 별칭(section.b / section.h) 수용
    const webT = Number(sec.webT) > 0 ? Number(sec.webT) : (Number(sec.b) > 0 ? Number(sec.b) : null);
    const girderH = Number(bm.girderH) > 0 ? Number(bm.girderH) : (Number(sec.h) > 0 ? Number(sec.h) : null);
    const needInputs = [];
    if (webT === null) needInputs.push({ field: 'bridgeMeta.section.webT', reason: '거더 복부 폭(mm) — 직사각 보수 단면 검토용. section.b로도 대체 가능.' });
    if (girderH === null) needInputs.push({ field: 'bridgeMeta.girderH', reason: '거더 전체 높이(mm) — 유효깊이 d=H−150 산정용. section.h로도 대체 가능.' });
    if (needInputs.length) {
      section = { verdict: 'INPUT', needInputs };
    } else {
      const d = girderH - 150; // 유효깊이 근사(피복+철근 150 관례 명시)
      try {
        const r = runCalculator('rc_beam', {
          b: webT, d, fck: params.fck ?? 27, fy: params.fy ?? 400,
          As: Number(params.As_mm2), Mu: round(Mu), Vu: round(Vu),
        }, 'KDS');
        section = {
          labelKo: '거더 단면 강도 검토 (RC 복부 직사각 보수측)',
          verdict: r.verdict, checks: r.checks,
          note: `복부 ${webT}×d${d} 직사각 검토(보수측 — T형 유효폭 미적용 명시). RC 가정 — PSC는 미지원.`,
        };
      } catch (e) {
        // 게이트 실패 원문("input gate failed: …")을 사용자 응답에 노출 금지 → 구조화
        section = e.code === 'INPUT_GATE'
          ? { verdict: 'INPUT', needInputs: [{ field: 'bridgeMeta.section', reason: e.message.replace(/^input gate failed:\s*/, '') }] }
          : { verdict: 'ERROR', error: e.message };
      }
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
    // 260729: 이 검사는 철근 미입력 시 section=null 이라 **판정 항목이 0개**였다 —
    // 전수 감사에서 "이상 없음"으로 인쇄되던 8건 중 하나다. 제원끼리의 자기정합은
    // 철근과 무관하게 언제나 판정 가능하다.
    checks: [
      ...(Number(bm.nGirders) > 1 && Number(bm.girderSpacing) > 0 && Number(bm.overhang) >= 0 && Number(bm.deckW) > 0
        ? [selfEq('바닥판 폭 자기정합', bm.deckW,
          (Number(bm.nGirders) - 1) * Number(bm.girderSpacing) + 2 * Number(bm.overhang),
          '바닥판 폭 = (거더수−1)×간격 + 2×내밈')]
        : []),
    ],
    provenance: { geometry: ['거더·바닥판·가로보 자중', '지간·간격', '레버룰 DF'], user: ['포장 두께(DW)', 'DF/차로수(선택)', '철근(단면 검토)'] },
    disclaimer: '실시설계급 계산(원문 하중·계수·영향선 검증) — 단, 법정 설계도서는 교량 기술사 검토·날인 필요. 연속경간·PSC·바닥판·받침·하부공·피로·처짐 미포함(명시).' + (unverifiedParts.length ? ` ⚠ 비검증 직접편집 파츠 ${unverifiedParts.length}개는 구조 검토에서 제외됨(P4 라벨) — 해당 형상의 안전은 별도 확인 필요.` : ''),
  };
}


/**
 * 선언 제원끼리의 자기정합 한 줄 (260729).
 * 어긋나면 형상과 제원표 중 하나가 반드시 틀렸다 — 정의식이라 가정이 없다.
 */
function selfEq(name, declared, computed, formulaKo) {
  const ok = Number.isFinite(Number(declared)) && Number.isFinite(Number(computed))
    && Math.abs(Number(declared) - Number(computed)) <= 1e-6;
  return { name, kind: 'self-consistency', declared: Number(declared), computed: +Number(computed).toFixed(3), ok, note: formulaKo };
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
  // 260729: 단면적 입력(A_tie/A_rib/A_hanger)은 종전에 **응력에만** 쓰였다. 그런데 같은
  // 부재의 **사하중**은 여전히 중실 박스 형상에서 나왔다 — 실측(120m 타이드 아치):
  //   타이 2본 222 · 아치 리브 215 · 데크 127 kN/m → wDC 577.1
  // 타이 800×1800·리브 900×1400 을 **중실 강재**로 본 값이다. 실 타이드 아치는 제작
  // 박스(중공)라 자중이 훨씬 작다. 사하중은 모든 부재력을 지배하므로 이 근사가
  // 행어 장력까지 부풀리고, 그것이 곧 "행어 초과" 판정이 된다.
  //
  // 사용자가 실단면을 선언했다면 **자중도 그 단면에서 나온다** — 같은 선언을 한쪽에만
  // 쓰는 것이 일관성 없다. 선언이 없으면 종전대로 중실 형상을 쓰되 그 사실을 보고한다
  // (여기서 중공률을 가정하지는 않는다 — 그러면 그게 날조다).
  const areaOverride = (id) => {
    if (/^tie_/.test(id) && Number(params.A_tie_mm2) > 0) return Number(params.A_tie_mm2);
    if (/^arch/.test(id) && Number(params.A_rib_mm2) > 0) return Number(params.A_rib_mm2);
    if (/^hanger/.test(id) && Number(params.A_hanger_mm2) > 0) return Number(params.A_hanger_mm2);
    return null;
  };
  let W_kN = 0;
  const solidModeled = new Set();
  const deadShare = {};
  for (const p of mains) {
    const rho = (DENSITY[p.material ?? 'steel'] ?? DENSITY.steel);
    const qty = Math.max(1, Math.round(Number(p.qty) || 1));
    const id = String(p.id ?? p.type);
    const A = areaOverride(id);
    let vol;
    if (A != null && p.params) {
      // 부재 길이 = 박스 최대 변(형상에서 파생). 자중 = A × 길이 × ρ.
      const len = Math.max(Number(p.params.width) || 0, Number(p.params.depth) || 0, Number(p.params.height) || 0);
      vol = A * len;
    } else {
      vol = partVolume(p.type, p.params);
      if (/^(tie_|arch|hanger)/.test(id)) solidModeled.add(id.replace(/[_-]?\d+.*$/, ''));
    }
    const w = (vol / 1e9) * rho * qty * 9.80665 / 1000;
    W_kN += w;
    const key = id.replace(/[_-]?\d+.*$/, '');
    deadShare[key] = +((deadShare[key] ?? 0) + w).toFixed(1);
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
  // ⚠ 260729: `hangerDia` 는 **이름이 지름인데 형상은 각봉**이다(실측: hanger 부품이
  // type:'box' width=depth=90). 그래서 면적은 d² 가 맞고 계산은 형상과 일치한다.
  // 그러나 이름만 보고 Ø90 원형봉으로 읽으면 면적이 πd²/4 = 6,362mm² 로 **27% 작아**
  // 발주가 어긋난다. 어느 쪽을 썼는지 검사 결과에 명시한다(감추면 오독이 남는다).
  const hangerSquare = !(Number(params.A_hanger_mm2) > 0);
  const A_h = Number(params.A_hanger_mm2) > 0 ? Number(params.A_hanger_mm2) : am.hangerDia * am.hangerDia;
  const sectionNote = hangerSquare
    ? `단면 근거: 각봉 ${am.hangerDia}×${am.hangerDia} = ${am.hangerDia * am.hangerDia}mm²(모델 형상 기준). `
      + `⚠ 메타명은 hangerDia 지만 형상은 각봉이다 — Ø${am.hangerDia} 원형봉이면 `
      + `${Math.round((Math.PI * am.hangerDia * am.hangerDia) / 4)}mm²(27% 작음)이니 발주 전 확인.`
    : `단면 근거: A_hanger_mm2 입력값 ${Number(params.A_hanger_mm2)}mm².`;
  const mk = (name, force_kN, A_mm2, kind) => {
    const sig = (force_kN * 1000) / A_mm2;
    return { name, kind, force_kN: round(force_kN, 1), A_mm2: Math.round(A_mm2), sigma_MPa: round(sig, 1), allow_MPa: round(sigA, 1), ratio: round(sig / sigA, 3), ok: sig <= sigA };
  };
  const checks = [
    mk('타이 인장(본당)', T_tie, A_tie, 'tension'),
    mk('아치 리브 축압축(스프링잉·본당)', N_rib, A_rib, 'compression(재료 항복)'),
    // ⚠ 아치 리브의 좌굴장은 형상만으로 정할 수 없다 — 면내는 아치 곡선 형상과 행어
    //   구속에, 면외는 횡브레이싱에 달렸다. 곡선장을 그냥 Lb 로 쓰면 **지어내는 것**이라
    //   이름으로 요구한다.
    bucklingCheck('아치 리브 좌굴', N_rib, A_rib, {
      r_mm: Number(params.r_rib_mm), Lb_mm: Number(params.Lb_rib_mm),
      K: Number(params.K_rib) > 0 ? Number(params.K_rib) : 1.0, Fy: Number(params.Fy) || 355,
      fields: { r: 'r_rib_mm', Lb: 'Lb_rib_mm' },
    }),
    { ...mk(nielsen ? `닐센 행어 장력(φ̄=${round((phiBar * 180) / Math.PI, 1)}°)` : '행어 장력(본당)', T_h, A_h, 'tension'), note: sectionNote },
    // 260729 자기정합: 선언 행어 수 ↔ 실제 행어 부품 수. 행어 장력은 "본당"이므로
    // 개수가 어긋나면 총 전달 하중이 달라진다 — 부재력의 전제를 먼저 확인한다.
    ...(Number(am.hangers) > 0
      ? [selfEq('행어 수 자기정합', am.hangers,
        parts.filter((p) => /^hanger/i.test(String(p.id ?? '')) || String(p.role ?? '') === 'hanger').length,
        '선언 행어 수 = 실제 행어 부품 수')]
      : []),
  ];
  return {
    ok: true,
    geometry: { span_m: round(L, 1), rise_m: round(f, 1), riseRatio: round(f / L, 3), hangerStyle: am.hangerStyle, nLanes },
    loads: {
      wDC_kNm: round(wDC, 1), wDW_kNm: round(wDW, 2), wLL_kNm: round(wLL, 1), wu_kNm: round(wu, 1),
      combo: '극한 I 근사: 1.25DC+1.50DW+1.80LL(등가 UDL — 간이 명시)',
      // 사하중이 모든 부재력을 지배한다 — 어디서 왔는지 감추지 않는다.
      deadShare_kN: deadShare,
      basis: solidModeled.size
        ? `⚠ ${[...solidModeled].join('·')} 은(는) **중실 단면**으로 자중을 계산했다(형상 그대로). `
          + '실 타이드 아치의 타이·리브는 제작 박스(중공)라 자중이 훨씬 작고, 사하중은 모든 부재력을 '
          + '지배하므로 이 값은 **보수측으로 크게 치우칠 수 있다**. A_tie_mm2·A_rib_mm2·A_hanger_mm2 를 '
          + '주면 자중과 응력을 **같은 단면**으로 계산한다(여기서 중공률을 가정하지는 않는다).'
        : '자중 단면 = 선언 A 입력 기준(중실 근사 아님).',
    },
    forces: { H_kN: round(H, 0), theta0_deg: round((th0 * 180) / Math.PI, 1) },
    checks,
    verdict: bridgeVerdict(checks),
    ...(unjudgedNote(checks) ? { unjudged: unjudgedNote(checks) } : {}),
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
/**
 * 압축재 좌굴 검토 (KDS 14 31 25 §4.3 — 260729b).
 *
 * ## 왜 필요한가
 * 종전 압축재 검사는 `σ ≤ 0.6Fy`(재료 항복)만 봤고 이름에 "좌굴 미검토 명시"를
 * 달았다. 명시는 정직하지만 **압축재는 항복보다 좌굴로 먼저 파괴된다** — 교량 파괴모드의
 * 핵심을 검토 밖에 두고 있었던 것이다. 명시가 검토를 대신하지 못한다.
 *
 * ## 지어내지 않는 것
 *  · 회전반경 r — 단면 형상이 정한다. 모델이 정사각 중실 근사면 r = s/√12 로 파생하고
 *    **그 사실을 적는다**(실 형강이면 `r_mm` 입력 우선). 근사 단면의 r 은 실제보다 작아
 *    좌굴에 **불리(보수)** 하다.
 *  · 비지지길이 Lb — 형상에서 나오면 쓰고(트러스 격점 간격 등), 아니면 요구한다.
 *  · 유효좌굴길이계수 K — 지점조건이 정한다. **K=1.0(양단 핀)을 기본으로 쓰되 명시**한다.
 *    실제 구속이 있으면 K<1 이라 이 값은 보수측이다.
 *
 * 반환 ok=null 은 「판정 불가」다 — 통과가 아니다.
 */
function bucklingCheck(name, N_kN, A_mm2, { r_mm, Lb_mm, K = 1.0, Fy = 355, E = 205000, basis, fields = {} }) {
  if (!(r_mm > 0) || !(Lb_mm > 0)) {
    // ⚠ 필드명은 **부재별**이어야 한다. 전부 `Lb_mm` 이라고 하면 여러 압축재가 같은
    //   이름을 요구해 사용자는 **어느 부재의 값인지 알 수 없다**(실측에서 걸렸다).
    return {
      name, kind: 'buckling', ok: null,
      needInputs: [
        ...(!(r_mm > 0) ? [{ field: fields.r ?? 'r_mm', reason: `${name} 의 단면 회전반경(mm) — 단면 형상이 정한다. I·A 를 주면 √(I/A) 로도 된다.` }] : []),
        ...(!(Lb_mm > 0) ? [{ field: fields.Lb ?? 'Lb_mm', reason: `${name} 의 비지지 길이(mm) — 브레이싱·격점 간격이 정한다. 형상만으로는 알 수 없다.` }] : []),
      ],
      note: '좌굴 판정 불가 — **미검토이지 안전이 아니다.**',
    };
  }
  const slender = (K * Lb_mm) / r_mm;
  const Fe = (Math.PI ** 2 * E) / slender ** 2;            // 오일러 탄성좌굴응력
  const lim = 4.71 * Math.sqrt(E / Fy);                     // 비탄성/탄성 경계
  const Fcr = slender <= lim ? Math.pow(0.658, Fy / Fe) * Fy : 0.877 * Fe;
  const phiPn_kN = (0.90 * Fcr * A_mm2) / 1000;             // φc=0.90
  const Pu = Math.abs(N_kN);
  return {
    name, kind: 'buckling', K, Lb_mm: Math.round(Lb_mm), r_mm: round(r_mm, 1),
    slenderness: round(slender, 1), Fe_MPa: round(Fe, 1), Fcr_MPa: round(Fcr, 1),
    Pu_kN: round(Pu, 1), phiPn_kN: round(phiPn_kN, 1), ratio: round(Pu / phiPn_kN, 3),
    ok: Pu <= phiPn_kN,
    note: `KDS 14 31 25 §4.3 · K=${K}(${K === 1.0 ? '양단 핀 가정 — 실 구속이 있으면 보수측' : '입력'})`
      + (basis ? ` · ${basis}` : '') + ' · φc=0.90 · 국부좌굴(판폭두께비)·횡비틀림 미검토',
  };
}

/** 정사각 중실 근사 단면의 회전반경 — r = s/√12. 실 형강이면 입력 r 이 우선한다. */
const rSquare = (s_mm) => (s_mm > 0 ? s_mm / Math.sqrt(12) : 0);

/**
 * 부재 부품에서 **실제 평면 단면**(b×d, mm)을 읽는다. 없으면 null.
 *
 * ⚠ 260729b: 마스트·주탑 단면을 `mastW²`·`3000*1800` 같은 **가정·하드코딩**으로 쓰고
 * 있었다. 실측: cable_stayed 마스트 부품은 2500×800 인데 코드는 2500²(=3.1배 과대)을
 * 썼다 — 축응력이 1/3 로 나오고 좌굴 회전반경도 강축으로 잡혀 **양방향으로 위험측**이다.
 * 형상에 있는 값을 가정으로 덮는 것은 지어내는 것과 같다.
 */
function memberSection(parts, re) {
  const p = (parts ?? []).find((x) => re.test(String(x.id ?? '')) || re.test(String(x.role ?? '')));
  const w = Number(p?.params?.width), d = Number(p?.params?.depth);
  if (!(w > 0) || !(d > 0)) return null;
  return { b: w, d, A: w * d, rMin: Math.min(w, d) / Math.sqrt(12), src: p.id ?? p.type };
}

/**
 * 검사 목록 → 종합 판정. **ok:null(판정 불가)을 FAIL 로 세지 않는다.**
 *
 * ⚠ 260729b: 좌굴 검토를 추가하자 종전의 every(c => c.ok) 가 판정 불가(null)를 falsy 로
 * 읽어 **입력이 없다는 이유로 교량이 FAIL** 이 됐다(실측: arch_bridge 는 실단면을
 * 선언해도 FAIL). 「확인 못 함 ≠ 기준 미달」은 이 세션 내내 강제한 구별인데 verdict
 * 계산에서 무너진 것이다 — 판정을 뒤집는 §6-G ② 형태다.
 *
 * 미판정은 verdict 에 영향을 주지 않는다. 대신 호출측이 unjudgedNote() 로 **건수를
 * 고지**한다 — 영향을 안 주는 것과 없는 셈 치는 것은 다르다.
 */
function bridgeVerdict(checks) {
  const judged = (checks ?? []).filter((c) => c && typeof c.ok === 'boolean');
  if (!judged.length) return 'INPUT';   // 판정한 항목이 하나도 없다 = 통과가 아니다
  return judged.every((c) => c.ok) ? 'PASS' : 'FAIL';
}

/** 판정 불가 항목을 이름과 함께 고지한다(없으면 null — 과고지 금지). */
function unjudgedNote(checks) {
  const un = (checks ?? []).filter((c) => c && c.ok === null);
  if (!un.length) return null;
  return {
    count: un.length,
    items: un.map((c) => c.name),
    fields: [...new Set(un.flatMap((c) => (c.needInputs ?? []).map((n) => n.field)))],
    messageKo: `판정하지 못한 항목 ${un.length}건(${un.map((c) => c.name).join(' · ')}) — `
      + '입력이 없어 검토하지 못한 것이며 **"이상 없음"이 아니다.** 종합 판정에는 반영되지 않았다.',
  };
}

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
    memberCheck('상현재 압축(면당·재료 항복)', -chordForce, A_ch, 'compression', Fy),
    // 좌굴은 항복보다 먼저 온다 — 트러스 상현재의 면내 비지지길이는 **격점 간격**이라
    // 형상에서 그대로 나온다(면외는 횡브레이싱 선언이 없어 요구한다).
    bucklingCheck('상현재 좌굴(면내·격점 간격)', -chordForce, A_ch, {
      r_mm: Number(params.r_chord_mm) > 0 ? Number(params.r_chord_mm) : rSquare(tm.chordS),
      Lb_mm: Number(params.Lb_chord_mm) > 0 ? Number(params.Lb_chord_mm) : panelL * 1000,
      K: Number(params.K_chord) > 0 ? Number(params.K_chord) : 1.0, Fy,
      basis: Number(params.Lb_chord_mm) > 0 ? 'Lb=입력' : 'Lb=격점 간격(형상)',
    }),
    /**
     * 면외 좌굴장을 **형상에서 파생**한다 (260729d, 계획 P2-④).
     *
     * 종전엔 `Lb_chord_out_mm` 를 무조건 요구했다. 그런데 상부 횡브레이싱이 **부품으로
     * 존재하면**(role='bracing') 그 간격이 곧 상현재의 면외 비지지길이다 — 지어내는 것이
     * 아니라 형상에 있는 값을 읽는 것이다. 실측: truss_bridge 는 tbrace 3개가
     * x=14800·29800·44800 에 있고 상현재는 x=7500~52500 이라 최대 구간이 나온다.
     *
     * ⚠ 브레이싱이 없으면 종전대로 **요구**한다 — 없는 것을 「간격 = 전장」으로 대신하면
     *   좌굴장을 과대(불리)로 잡는 것이 아니라 **브레이싱이 있다고 착각**하게 만든다.
     */
    ...(() => {
      const braces = parts.filter((p) => String(p.role ?? '') === 'bracing')
        .map((p) => Number(p.at?.tx ?? 0)).sort((x, y) => x - y);
      const tc = parts.find((p) => /^tchord/i.test(String(p.id ?? '')));
      let LbOut = Number(params.Lb_chord_out_mm) > 0 ? Number(params.Lb_chord_out_mm) : 0;
      let basisOut = LbOut ? 'Lb=입력' : null;
      if (!LbOut && braces.length && tc) {
        // 상현재 구간 [x0, x1] 안의 브레이싱으로 나눈 **최대 구간**이 지배한다.
        const x0 = Number(tc.at?.tx ?? 0), x1 = x0 + Number(tc.params?.width ?? 0);
        const pts = [x0, ...braces.filter((b) => b > x0 && b < x1), x1];
        LbOut = Math.max(...pts.slice(1).map((v, i) => v - pts[i]));
        basisOut = `Lb=횡브레이싱 최대 구간(브레이싱 ${braces.length}개소 — 형상 파생)`;
      }
      return [bucklingCheck('상현재 좌굴(면외·횡브레이싱 간격)', -chordForce, A_ch, {
        r_mm: Number(params.r_chord_out_mm) > 0 ? Number(params.r_chord_out_mm) : rSquare(tm.chordS),
        Lb_mm: LbOut, K: Number(params.K_chord) > 0 ? Number(params.K_chord) : 1.0, Fy,
        ...(basisOut ? { basis: basisOut } : {}),
        fields: { r: 'r_chord_out_mm', Lb: 'Lb_chord_out_mm' },
      })];
    })(),
    memberCheck('단부 대각재(면당)', diagForce, A_dg, 'axial', Fy),
    // 260729 자기정합: 지간 = 패널 수 × 패널 길이(정의식). 어긋나면 형상과 제원표 중
    // 하나가 틀렸다 — 부재력 계산이 이 값들 위에 서 있으므로 먼저 걸러야 한다.
    ...(Number(tm.panelL) > 0 && Number(tm.panels) > 0 && Number(tm.span) > 0
      ? [selfEq('지간 자기정합', tm.span, Number(tm.panels) * Number(tm.panelL), '지간 = 패널 수 × 패널 길이')]
      : []),
  ];
  return {
    ok: true, type: assembly.trussMeta.trussType ?? 'warren',
    geometry: { span_m: round(L, 1), trussH_m: round(h, 2), panels: nP, panelL_m: round(panelL, 2), nLanes },
    loads: { wDC_kNm: round(wDC, 1), wDW_kNm: round(wDW, 2), wLL_kNm: round(wLL, 1), wu_kNm: round(wu, 1), combo: '극한 I 근사: 1.25DC+1.50DW+1.80LL(등가 UDL — 간이)' },
    forces: { M_kNm: round(M, 0), V_kN: round(V, 0), theta_deg: round((thD * 180) / Math.PI, 1) },
    checks, verdict: bridgeVerdict(checks),
    ...(unjudgedNote(checks) ? { unjudged: unjudgedNote(checks) } : {}),
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
  // 형상 우선 — 가정 단면(mastW²)은 실측에서 3.1배 과대였다(memberSection 주석).
  const mastSec = memberSection(parts, /mast|pylon/i);
  const A_mast = Number(params.A_mast_mm2) > 0 ? Number(params.A_mast_mm2)
    : (mastSec ? mastSec.A : (cm.mastW ? cm.mastW * cm.mastW : 2500 * 2500));
  const checks = [
    memberCheck(`스테이 장력(ᾱ=${round((alphaBar * 180) / Math.PI, 1)}°·가닥)`, T_stay, A_stay, 'tension', Fy),
    memberCheck('마스트 축압축(기당·재료 항복)', -N_mast, A_mast, 'compression', Fy),
    // 마스트는 스테이가 중간을 잡아 주지만 **그 구속을 세지 않는다** — 전 높이를
    // 비지지로 보므로 보수측이다(실 구속을 반영하려면 Lb_mast_mm 입력).
    bucklingCheck('마스트 좌굴(전 높이 비지지 — 보수측)', -N_mast, A_mast, {
      // 좌굴은 **약축**이 지배한다 — 실단면의 min(b,d) 로 낸다.
      r_mm: Number(params.r_mast_mm) > 0 ? Number(params.r_mast_mm) : (mastSec ? mastSec.rMin : rSquare(cm.mastW)),
      Lb_mm: Number(params.Lb_mast_mm) > 0 ? Number(params.Lb_mast_mm) : pylonH * 1000,
      K: Number(params.K_mast) > 0 ? Number(params.K_mast) : 1.0, Fy,
      basis: Number(params.Lb_mast_mm) > 0 ? 'Lb=입력' : 'Lb=파일런 전 높이(스테이 구속 미반영)',
      fields: { r: 'r_mast_mm', Lb: 'Lb_mast_mm' },
    }),
  ];
  return {
    ok: true, arrangement: cm.arrangement ?? 'fan',
    geometry: { mainSpan_m: round(L, 1), pylonH_m: round(pylonH, 1), nStays, nLanes },
    loads: { wDeck_kNm: round(wDeck, 1), wDW_kNm: round(wDW, 2), wLL_kNm: round(wLL, 1), wu_kNm: round(wu, 1) },
    forces: { V_stay_kN: round(V_stay, 1), N_mast_kN: round(N_mast, 0) },
    checks, verdict: bridgeVerdict(checks),
    ...(unjudgedNote(checks) ? { unjudged: unjudgedNote(checks) } : {}),
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
  // 형상 우선 — 종전 3000×1800 은 어디에도 근거가 없는 하드코딩이었다.
  const towerSec = memberSection(parts, /tower|pylon|주탑/i);
  const A_tower = Number(params.A_tower_mm2) > 0 ? Number(params.A_tower_mm2)
    : (towerSec ? towerSec.A : 3000 * 1800);
  const checks = [
    memberCheck('주케이블 최대장력(가닥·타워부)', T_cable, A_cable, 'tension', Fy),
    memberCheck('행어 장력(가닥)', T_hanger, A_hanger, 'tension', 355),
    memberCheck('주탑 축압축(기당·재료 항복)', -N_tower, A_tower, 'compression', 30),
    // ⚠ 주탑은 **콘크리트**(허용 30MPa 자리)라 강재 압축식(KDS 14 31 25)을 그대로 쓸 수
    //   없다. 세장 콘크리트 기둥은 모멘트 확대(P-δ) 문제라 다른 조항이다 — 지어내지 않고
    //   요구한다. 강재 주탑이면 towerSteel:true 로 선언하면 강재식으로 검토한다.
    ...(params.towerSteel === true
      ? [bucklingCheck('주탑 좌굴(강재·전 높이 비지지 — 보수측)', -N_tower, A_tower, {
        r_mm: Number(params.r_tower_mm) > 0 ? Number(params.r_tower_mm) : (towerSec ? towerSec.rMin : 0),
        Lb_mm: Number(params.Lb_tower_mm) > 0 ? Number(params.Lb_tower_mm) : H * 1000,
        K: Number(params.K_tower) > 0 ? Number(params.K_tower) : 1.0, Fy: Number(params.Fy_tower) || 355,
        basis: 'Lb=주탑 전 높이(케이블 구속 미반영)', fields: { r: 'r_tower_mm', Lb: 'Lb_tower_mm' },
      })]
      : [{
        name: '주탑 좌굴(세장효과)', kind: 'buckling', ok: null,
        needInputs: [{ field: 'towerSteel 또는 콘크리트 기둥 제원', reason: 'RC 주탑의 세장효과는 강재 압축식이 아니라 모멘트 확대(P-δ) 조항이다 — 배근·비지지길이·단부 모멘트가 필요하다.' }],
        note: '좌굴 판정 불가 — **미검토이지 안전이 아니다.**',
      }]),
    // 260729 하드 기하: 주탑이 상판 위로 솟은 높이는 케이블 새그 이상이어야 한다.
    // 미달이면 케이블이 상판 아래로 처지는 형상이 된다 — 가정 없는 불가능성 검사.
    ...(Number(sm.towerAbove) > 0 && Number(sm.sag) > 0
      ? [{
        name: '주탑 상부 높이 ≥ 케이블 새그', kind: 'geometry',
        towerAbove_mm: Number(sm.towerAbove), sag_mm: Number(sm.sag),
        ok: Number(sm.towerAbove) >= Number(sm.sag),
        note: '미달이면 케이블이 상판 아래로 처진다 — 형상이 성립하지 않는다',
      }]
      : []),
  ];
  return {
    ok: true,
    geometry: { mainSpan_m: round(L, 1), sag_m: round(f, 1), sagRatio: round(f / L, 3), nLanes },
    loads: { wDeck_kNm: round(wDeck, 1), wDW_kNm: round(wDW, 2), wLL_kNm: round(wLL, 1), wu_kNm: round(wu, 1) },
    forces: { H_kN: round(H, 0), theta_deg: round((thMax * 180) / Math.PI, 1) },
    checks, verdict: bridgeVerdict(checks),
    ...(unjudgedNote(checks) ? { unjudged: unjudgedNote(checks) } : {}),
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
    checks, verdict: bridgeVerdict(checks),
    ...(unjudgedNote(checks) ? { unjudged: unjudgedNote(checks) } : {}),
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
