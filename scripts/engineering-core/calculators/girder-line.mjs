/**
 * P7 교량 — 단순지지 주거더 활하중 단면력 (KL-510) — KDS 24 12 21 §4.3·4.4.
 * 영향선 스위프 엔진(moving-load.mjs)으로 표준트럭 최대 M·V → 지배조합
 * max(트럭×(1+IM), 0.75트럭×(1+IM)+차로) (§4.3.1.5 — 충격은 트럭만, §4.4.1(3))
 * × 다차로계수(표 4.3-1) × 거더 분배계수 DF(입력 — KDS 24 10 11 산정, 지어내지 않음).
 * 고정하중 입력 시 1.25DC+1.5DW? — 아님: 계수조합은 후속(활하중 산출 전용 v1 명시).
 * 검증: 엔진 폐형해 3/3 + 차로 wL²/8 + (HL-93 공표표 재현은 published-bench).
 */
import { sweepSimpleSpan } from '../moving-load.mjs';

export default {
  id: 'girder_line',
  domain: 'bridge',
  title: '주거더 활하중 단면력 (KL-510 · 단순지지)',
  description: 'KL-510 표준트럭+차로하중 영향선 최대 M·V — 충격·다차로·분배계수 반영.',
  refs: [
    'KDS 24 12 21:2021 그림 4.3-1(트럭 48/135/135/192kN @3.6/1.2/7.2m)·표 4.3-2(차로 12.7)·§4.3.1.5(조합)·표 4.4-1(IM 25%)·표 4.3-1(다차로) — 전부 원문 판독',
  ],
  status: 'verified — 엔진 폐형해 앵커 + 원문 하중 데이터. 연속경간·횡분배 자동산정(KDS 24 10 11)·계수조합은 후속',
  inputSchema: {
    type: 'object',
    required: ['span', 'DF'],
    properties: {
      span: { type: 'number', minimum: 5, maximum: 200, description: '지간 m (단순지지)' },
      nLanes: { type: 'integer', minimum: 1, maximum: 8, description: '재하차로 수 (기본 1 — 다차로계수 표 4.3-1 적용)' },
      DF: { type: 'number', exclusiveMinimum: 0, maximum: 1.5, description: '거더 분배계수 (KDS 24 10 11 산정값 입력 — 지어내지 않음. 레버룰·강성법 등 프로젝트 산정)' },
      fatigue: { type: 'boolean', description: '피로 검토 모드 (트럭 80%·IM 15% — §4.3.2·표 4.4-1)' },
      demandM_kNm: { type: 'number', minimum: 0, description: '비교용 소요 모멘트 (선택 — 판정용)' },
      demandV_kN: { type: 'number', minimum: 0, description: '비교용 소요 전단 (선택)' },
    },
  },
  run(input, std) {
    const bl = std.bridgeLive?.KL510;
    if (!bl) throw new Error('standard gate: bridgeLive 미탑재');
    const L = input.span;
    // 트럭 하중열 (원문 그림 4.3-1)
    let xs = 0;
    const axles = bl.truckAxles_kN.map((P, i) => {
      if (i > 0) xs += bl.spacing_m[i - 1];
      return { P, x: xs };
    });
    const truckScale = input.fatigue ? 0.8 : 1.0;
    const IM = (input.fatigue ? bl.IM_pct.fatigue : bl.IM_pct.general) / 100;
    const sw = sweepSimpleSpan(L, axles.map((a) => ({ P: a.P * truckScale, x: a.x })));
    // 차로하중 (표 4.3-2): 12.7 (L≤60) · 12.7(60/L)^0.1 (L>60) — 충격 미적용
    const w = L <= 60 ? 12.7 : 12.7 * Math.pow(60 / L, 0.10);
    const Mlane = (w * L * L) / 8, Vlane = (w * L) / 2;
    // 지배조합 (§4.3.1.5): max(트럭×(1+IM), 0.75트럭×(1+IM) + 차로)
    const Mt = sw.Mmax_kNm * (1 + IM), Vt = sw.Vmax_kN * (1 + IM);
    const M1 = Mt, M2 = 0.75 * Mt + Mlane;
    const V1 = Vt, V2 = 0.75 * Vt + Vlane;
    const mGov = M2 > M1 ? '0.75트럭+차로' : '트럭 단독';
    const vGov = V2 > V1 ? '0.75트럭+차로' : '트럭 단독';
    // 다차로계수 × 분배계수
    const nl = input.nLanes ?? 1;
    const mf = bl.multiLane[Math.min(nl, 5) === 5 ? '5+' : String(nl)] ?? 1.0;
    const DF = input.DF;
    const Mgirder = Math.max(M1, M2) * mf * DF;
    const Vgirder = Math.max(V1, V2) * mf * DF;
    const checks = {};
    if (input.demandM_kNm > 0) checks.moment = { demand: input.demandM_kNm, capacityRef: +Mgirder.toFixed(1), note: '활하중 효과 비교(내하력 판정 아님)' };
    return {
      verdict: 'INFO',
      lane: { w_kNm: +w.toFixed(2), M_kNm: +Mlane.toFixed(1), V_kN: +Vlane.toFixed(1) },
      truck: { M_kNm: +sw.Mmax_kNm.toFixed(1), at_m: +sw.at_m.toFixed(2), V_kN: +sw.Vmax_kN.toFixed(1), IM },
      perLane: { M_kNm: +Math.max(M1, M2).toFixed(1), governM: mGov, V_kN: +Math.max(V1, V2).toFixed(1), governV: vGov },
      perGirder: { M_kNm: +Mgirder.toFixed(1), V_kN: +Vgirder.toFixed(1), multiLaneFactor: mf, DF },
      ...(Object.keys(checks).length ? { checks } : {}),
      notes: [
        `KL-510${input.fatigue ? ' 피로(트럭 80%·IM 15%)' : ''}: 트럭 M ${sw.Mmax_kNm.toFixed(0)}×(1+${IM}) vs 0.75트럭+차로 → ${mGov} 지배`,
        `다차로계수 ${mf}(${nl}차로) × DF ${DF}(입력 — KDS 24 10 11 산정) 적용.`,
        '단순지지·활하중 전용 v1 — 고정하중·계수조합(한계상태)·연속경간·처짐(§4.3.1.7)은 후속. 내하력 판정 아님.',
      ],
    };
  },
};
