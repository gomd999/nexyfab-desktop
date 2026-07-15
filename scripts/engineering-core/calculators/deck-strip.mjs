/**
 * P7 교량 — RC 바닥판 활하중 휨모멘트 (간략식) — KDS 24 10 11 §4.6.2.4~4.6.2.5 원문 판독.
 * 내측(주철근 직각, 지간 0.6~6m): M = (L+0.6)·P/9.6 (kN·m/m), P=후륜 96kN(1등교).
 *   연속(3지점 이상): ×0.8 (정·부 모두). 2등교=1등교×0.75, 3등교=2등교×0.75.
 * 주철근 평행: 유효폭 E=1.2+0.06L ≤ 2.1m → 윤하중 재하 설계(v1은 직각 배근 중심).
 * 캔틸레버: E=0.8X+1.14, M=(P/E)·X (X=하중점~지지점 m).
 * 충격: i=15/(40+L) ≤ 0.3 (도로교 2005 식 2.1.2 — 간략식 계열과 동일 세대 명시).
 * 이후 rc_beam(b=1000)으로 단면 검토 연계. 6m 초과 장지간 식(표 4.6-1)은 후속.
 */
export default {
  id: 'deck_strip',
  domain: 'bridge/deck',
  title: '교량 바닥판 휨모멘트 (간략식)',
  description: '내측(직각 배근)·캔틸레버 바닥판 활하중 M — 충격·연속 보정 + 단면 검토 연계.',
  refs: [
    'KDS 24 10 11:2021 §4.6.2.4(M=(L+0.6)P/9.6·연속 0.8배·E=1.2+0.06L)·§4.6.2.5(캔틸레버 E=0.8X+1.14) — 원문 GIF 판독',
    '충격 i=15/(40+L)≤0.3 (도로교설계기준 2005 — CODIL 판독)',
  ],
  status: 'verified — 원문식 판독. 장지간(6m 초과, 표 4.6-1)·평행 배근 상세·경험적 설계법은 후속',
  inputSchema: {
    type: 'object',
    required: ['mode'],
    properties: {
      mode: { type: 'string', enum: ['interior', 'cantilever'], description: '내측(거더 사이) / 캔틸레버(내민)' },
      span_m: { type: 'number', minimum: 0.6, maximum: 6, description: '내측: 바닥판 지간 L m (거더 중심 간 — 0.6~6m 간략식 범위)' },
      continuous: { type: 'boolean', description: '내측: 3지점 이상 연속 (×0.8 — 기본 true 관례)' },
      X_m: { type: 'number', exclusiveMinimum: 0, maximum: 3, description: '캔틸레버: 하중점~지지점 거리 m' },
      grade: { type: 'string', enum: ['1', '2', '3'], description: '교량 등급 (1등교 P=96kN 기준 — 2등 0.75배·3등 0.5625배, 기본 1)' },
      deckThk_mm: { type: 'number', minimum: 160, maximum: 400, description: '바닥판 두께 (자중 모멘트 포함용 — 선택)' },
      pavementThk_mm: { type: 'number', minimum: 0, maximum: 200, description: '포장 두께 (DW — 선택, 22.6kN/m³)' },
    },
  },
  run(input) {
    const gradeF = { '1': 1.0, '2': 0.75, '3': 0.5625 }[input.grade ?? '1'];
    const P = 96 * gradeF; // 후륜 (원문: 1등교 96kN)
    let M_LL, i, detail;
    if (input.mode === 'interior') {
      const L = input.span_m;
      if (!(L >= 0.6 && L <= 6)) throw new Error('input gate: 내측 간략식은 지간 0.6~6m (초과=장지간 식 후속 — 정직 거부)');
      i = Math.min(0.3, 15 / (40 + L));
      const base = ((L + 0.6) * P) / 9.6;
      const cont = input.continuous !== false;
      M_LL = base * (cont ? 0.8 : 1.0) * (1 + i);
      detail = { base_kNm: +base.toFixed(2), continuousFactor: cont ? 0.8 : 1.0, E_parallel_m: Math.min(2.1, 1.2 + 0.06 * L) };
    } else {
      const X = input.X_m;
      if (!(X > 0)) throw new Error('input gate: 캔틸레버는 X_m 필요');
      i = Math.min(0.3, 15 / (40 + X));
      const E = 0.8 * X + 1.14;
      M_LL = (P / E) * X * (1 + i);
      detail = { E_m: +E.toFixed(3) };
    }
    // 자중·포장 (내측: wL²/10 연속 관례 명시 / 캔틸레버: wX²/2)
    let M_D = 0;
    const wSelf = input.deckThk_mm > 0 ? (input.deckThk_mm / 1000) * 24.5 : 0;
    const wPav = input.pavementThk_mm > 0 ? (input.pavementThk_mm / 1000) * 22.6 : 0;
    const wD = wSelf + wPav;
    if (wD > 0) {
      M_D = input.mode === 'interior' ? (wD * input.span_m ** 2) / 10 : (wD * input.X_m ** 2) / 2;
    }
    // 극한 I: 1.25DC+1.50DW+1.80LL (KDS 24 12 11 — DW 분리 근사: 자중=DC·포장=DW)
    const M_DC = input.mode === 'interior' ? (wSelf * (input.span_m ?? 0) ** 2) / 10 : (wSelf * (input.X_m ?? 0) ** 2) / 2;
    const M_DW = input.mode === 'interior' ? (wPav * (input.span_m ?? 0) ** 2) / 10 : (wPav * (input.X_m ?? 0) ** 2) / 2;
    const Mu = 1.25 * M_DC + 1.5 * M_DW + 1.8 * M_LL;
    return {
      verdict: 'INFO',
      moments: { M_LL_kNm_m: +M_LL.toFixed(2), impact: +i.toFixed(3), M_DC: +M_DC.toFixed(2), M_DW: +M_DW.toFixed(2), Mu_kNm_m: +Mu.toFixed(2) },
      intermediate: { P_kN: P, ...detail },
      notes: [
        input.mode === 'interior'
          ? `내측 M=(L+0.6)P/9.6${input.continuous !== false ? '×0.8(연속)' : ''}×(1+i ${i.toFixed(2)}) = ${M_LL.toFixed(2)} kN·m/m (정·부 동일 크기 — 원문)`
          : `캔틸레버 E=0.8X+1.14=${detail.E_m}m → M=(P/E)X×(1+i) = ${M_LL.toFixed(2)} kN·m/m`,
        `극한 I Mu=${Mu.toFixed(1)} — rc_beam(b=1000, d=두께−피복)으로 단면 검토 연계. 고정하중 wL²/10(연속 관례 명시).`,
        `${input.grade ?? '1'}등교 P=${P}kN. 장지간(>6m)·평행 배근·경험적 설계법(KDS 24 14 21)은 후속.`,
      ],
    };
  },
};
