/**
 * P7 교량 — 단순지지 주거더 활하중 단면력 (KL-510) — KDS 24 12 21 §4.3·4.4.
 * 영향선 스위프 엔진(moving-load.mjs)으로 표준트럭 최대 M·V → 지배조합
 * max(트럭×(1+IM), 0.75트럭×(1+IM)+차로) (§4.3.1.5 — 충격은 트럭만, §4.4.1(3))
 * × 다차로계수(표 4.3-1) × 거더 분배계수 DF(입력 — KDS 24 10 11 산정, 지어내지 않음).
 * 고정하중 입력 시 1.25DC+1.5DW? — 아님: 계수조합은 후속(활하중 산출 전용 v1 명시).
 * 검증: 엔진 폐형해 3/3 + 차로 wL²/8 + (HL-93 공표표 재현은 published-bench).
 */
import { sweepSimpleSpan, sweepTwoSpan, sweepThreeSpan, threeSpanUdlEnvelope, sweepNSpan, nSpanUdlEnvelope, midspanDeflection } from '../moving-load.mjs';

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
      span: { type: 'number', minimum: 5, maximum: 200, description: '지간 m (등경간)' },
      spans: { type: 'integer', minimum: 1, maximum: 6, description: '경간 수 (기본 1 단순지지 · 2~6=등경간 연속 — 3연모멘트 삼중대각 일반해·차로 패턴재하 포락)' },
      EI_kNm2: { type: 'number', exclusiveMinimum: 0, description: '휨강성 EI kN·m² (입력 시 처짐 검토 §4.3.1.7 — 트럭 vs 25%트럭+차로 중 큰 값)' },
      deflLimitRatio: { type: 'number', minimum: 100, maximum: 2000, description: '처짐 한계 L/n (기본 800 관례 — 발주자 기준 확인 명시)' },
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
    const nsp = input.spans ?? 1;
    const scaled = axles.map((a) => ({ P: a.P * truckScale, x: a.x }));
    const sw = nsp >= 4
      ? (() => { const t = sweepNSpan(L, nsp, scaled); return { Mmax_kNm: t.MspanMax_kNm, at_m: 0, Vmax_kN: sweepSimpleSpan(L, scaled).Vmax_kN, MsupMax_kNm: t.MsupMax_kNm }; })()
      : nsp === 3
      ? (() => { const t = sweepThreeSpan(L, scaled); return { Mmax_kNm: t.MspanMax_kNm, at_m: 0, Vmax_kN: sweepSimpleSpan(L, scaled).Vmax_kN, MsupMax_kNm: t.MsupMax_kNm }; })()
      : nsp === 2
        ? (() => { const t = sweepTwoSpan(L, scaled); return { Mmax_kNm: t.MspanMax_kNm, at_m: t.at_m, Vmax_kN: sweepSimpleSpan(L, scaled).Vmax_kN, MsupMax_kNm: t.MsupMax_kNm }; })()
        : sweepSimpleSpan(L, scaled);
    // 차로하중 (표 4.3-2): 12.7 (L≤60) · 12.7(60/L)^0.1 (L>60) — 충격 미적용
    // 연속경간 차로하중 = 패턴재하 포락(§ 불리 구간만 재하): 2경간 +M=49wL²/512(1경간 재하 지배,
    // 만재 9/128보다 큼 — 손계산 폐형) · 3경간=threeSpanUdlEnvelope(7조합 전수, 앵커 재현)
    const w = L <= 60 ? 12.7 : 12.7 * Math.pow(60 / L, 0.10);
    const nsp2 = input.spans ?? 1;
    const udl3 = nsp2 >= 4 ? nSpanUdlEnvelope(L, nsp2, w) : nsp2 === 3 ? threeSpanUdlEnvelope(L, w) : null;
    const Mlane = nsp2 >= 3 ? udl3.MspanMax_kNm : nsp2 === 2 ? (49 * w * L * L) / 512 : (w * L * L) / 8;
    const MlaneSup = nsp2 >= 3 ? udl3.MsupMax_kNm : nsp2 === 2 ? (w * L * L) / 8 : 0;
    const Vlane = (w * L) / 2;
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
    // 연속 지점부 −M (spans=2): 트럭 지점모멘트×(1+IM) 조합 + 차로 지점 −M
    let MgirderNeg = null;
    if ((input.spans ?? 1) >= 2 && sw.MsupMax_kNm !== undefined) {
      const Mt_sup = sw.MsupMax_kNm * (1 + IM);
      MgirderNeg = Math.max(Mt_sup, 0.75 * Mt_sup + MlaneSup) * mf * DF;
    }
    // 처짐 검토 (§4.3.1.7 원문: max(트럭, 25%트럭+차로) — 단순경간만, EI 입력 시)
    let defl = null;
    if (input.EI_kNm2 > 0 && (input.spans ?? 1) === 1) {
      const dTruck = midspanDeflection(L, scaled, input.EI_kNm2) * (1 + IM);
      const dLane = (5 * w * Math.pow(L, 4)) / (384 * input.EI_kNm2);
      const d = Math.max(dTruck, 0.25 * dTruck + dLane) * DF * mf;
      const nRatio = input.deflLimitRatio ?? 800;
      const limit = L / nRatio;
      defl = { delta_mm: +(d * 1000).toFixed(1), limit_mm: +(limit * 1000).toFixed(1), ratio: 'L/' + nRatio, pass: d <= limit,
        note: '§4.3.1.7 max(트럭, 25%트럭+차로)·충격 포함. 한계 L/' + nRatio + '=관례 기본 — 발주자 기준 확인. EI는 입력(균열 강성 여부 명시 필요).' };
    }
    const checks = {};
    if (input.demandM_kNm > 0) checks.moment = { demand: input.demandM_kNm, capacityRef: +Mgirder.toFixed(1), note: '활하중 효과 비교(내하력 판정 아님)' };
    return {
      verdict: 'INFO',
      lane: { w_kNm: +w.toFixed(2), M_kNm: +Mlane.toFixed(1), V_kN: +Vlane.toFixed(1) },
      truck: { M_kNm: +sw.Mmax_kNm.toFixed(1), at_m: +sw.at_m.toFixed(2), V_kN: +sw.Vmax_kN.toFixed(1), IM },
      perLane: { M_kNm: +Math.max(M1, M2).toFixed(1), governM: mGov, V_kN: +Math.max(V1, V2).toFixed(1), governV: vGov },
      perGirder: { M_kNm: +Mgirder.toFixed(1), V_kN: +Vgirder.toFixed(1), multiLaneFactor: mf, DF, ...(MgirderNeg !== null ? { Mneg_kNm: +MgirderNeg.toFixed(1) } : {}) },
      ...(defl ? { deflection: defl } : {}),
      ...(Object.keys(checks).length ? { checks } : {}),
      notes: [
        `KL-510${input.fatigue ? ' 피로(트럭 80%·IM 15%)' : ''}: 트럭 M ${sw.Mmax_kNm.toFixed(0)}×(1+${IM}) vs 0.75트럭+차로 → ${mGov} 지배`,
        `다차로계수 ${mf}(${nl}차로) × DF ${DF}(입력 — KDS 24 10 11 산정) 적용.`,
        (input.spans ?? 1) >= 2 ? `${input.spans}등경간 연속(3연모멘트 삼중대각 일반해·등경간 한정) — 지점부 −M 별도 보고·차로하중 패턴재하 포락(2^n 조합 전수, 불리 구간만 재하). 부등경간은 frame2d 매트릭스 후속.` : '단순지지 기준.',
        '고정하중·계수조합은 bridge-check 체인에서. 내하력 판정 아님.',
      ],
    };
  },
};
