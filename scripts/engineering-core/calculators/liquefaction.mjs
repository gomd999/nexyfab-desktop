/**
 * P19 토목 — 액상화 평가 (KDS 17 10 00 §4.7 원문 판독).
 * 예비평가(§4.7(4) — 생략 조건 게이트, 층별): ①연중 최고지하수위 상부 ②심도>20m
 *   ③SPT N>25(에너지 미보정·측점별) ④고소성 점토 영역C(그림 4.7-1 — 판정 입력).
 * 본평가(§4.7(6)): FS = CRR/CSR ≤ 1.0 → 액상화 발생 판정(원문).
 *   CSR = 0.65·(amax/g)·(σv/σ′v)·rd (§(6)① — 지표 최대지반가속도+응력감소계수 방식 원문 허용.
 *   rd=응력감소계수 입력 원칙 — 관례식(Youd&Idriss 등)은 산정 근거 명시 입력).
 *   CRR = 현장시험(SPT/CPT/Vs) 기반 산정 입력(§(6)② — 도표/보정 의존, 지어내지 않음).
 * 지반응답해석 방식(τmax 직접)은 τmax 입력 시 CSR=0.65τmax/σ′v (식4.7-2 계열).
 */
export default {
  id: 'liquefaction',
  domain: 'civil/seismic',
  title: '액상화 평가 (§4.7 — 예비+본평가)',
  description: '층별 예비평가 생략 게이트 + FS=CRR/CSR 본평가 — CRR·rd 산정 입력 원칙.',
  refs: ['KDS 17 10 00:2024 §4.7 — 예비평가 4조건(지하수위·20m·N25·영역C)·본평가 FS=CRR/CSR·1.0 판정 원문', 'CRR=현장시험 산정 입력·rd=산정 입력(지어내지 않음)'],
  status: 'verified — 원문 절차·판정 기준 전사(결정론). CRR 자동 산정(SPT 보정 체인)·지반응답해석은 후속/전문 해석',
  inputSchema: {
    type: 'object',
    required: ['layers'],
    properties: {
      layers: { description: '층 배열(두께 1.5m 이하 단위 — 원문) [{z_m(중심 심도), aboveGWT?(최고지하수위 상부), N_SPT?(미보정), zoneC?(그림4.7-1 영역C 판정 입력), sigmaV_kPa?, sigmaVe_kPa?, CRR?(시험 산정), tauMax_kPa?(지반응답해석 시)}]' },
      amax_g: { type: 'number', minimum: 0, maximum: 1, description: '지표면 최대지반가속도 (g — 지반응답해석/성능목표 재현주기 산정 입력)' },
      rd: { type: 'number', minimum: 0.3, maximum: 1.0, description: '응력감소계수 (산정 입력 — 관례식 사용 시 근거 명시. 층별 다르면 layers에 개별 CSR 위해 tauMax 사용 권장)' },
    },
  },
  run(input) {
    const layers = input.layers;
    if (!Array.isArray(layers) || !layers.length || layers.length > 50) throw new Error('input gate: layers 1~50');
    const rows = layers.map((ly, i) => {
      const z = Number(ly.z_m);
      if (!(z > 0)) throw new Error(`input gate: layers[${i}].z_m`);
      // 예비평가 — 생략 조건(§4.7(4) 원문)
      const skip = [];
      if (ly.aboveGWT === true) skip.push('①지하수위 상부');
      if (z > 20) skip.push('②심도>20m');
      if (Number(ly.N_SPT) > 25) skip.push('③N>25');
      if (ly.zoneC === true) skip.push('④고소성 영역C(반복연화 별도 주의 — 원문)');
      if (skip.length) return { layer: i + 1, z_m: z, result: '평가 생략', basis: skip.join('·') };
      // 본평가
      const sv = Number(ly.sigmaV_kPa), sve = Number(ly.sigmaVe_kPa);
      if (!(sve > 0)) return { layer: i + 1, z_m: z, result: 'INPUT', basis: '본평가 대상 — σ′v(·CRR) 입력 필요' };
      let CSR;
      if (Number(ly.tauMax_kPa) > 0) CSR = (0.65 * ly.tauMax_kPa) / sve; // 식4.7-2 계열(지반응답해석)
      else {
        if (!(Number(input.amax_g) > 0) || !(sv > 0) || !(Number(input.rd) > 0)) return { layer: i + 1, z_m: z, result: 'INPUT', basis: 'amax_g·σv·rd(또는 τmax) 필요 — 산정 입력 원칙' };
        CSR = 0.65 * input.amax_g * (sv / sve) * input.rd;
      }
      if (!(Number(ly.CRR) > 0)) return { layer: i + 1, z_m: z, CSR: +CSR.toFixed(3), result: 'INPUT', basis: 'CRR 필요(현장시험 산정 — §(6)②. 지어내지 않음)' };
      const FS = ly.CRR / CSR;
      return { layer: i + 1, z_m: z, CSR: +CSR.toFixed(3), CRR: ly.CRR, FS: +FS.toFixed(2), result: FS <= 1.0 ? '액상화 발생 판정(FS≤1.0 원문)' : '비액상화', pass: FS > 1.0 };
    });
    const evaluated = rows.filter((r) => r.FS !== undefined);
    const anyLiq = evaluated.some((r) => r.pass === false);
    const anyInput = rows.some((r) => r.result === 'INPUT');
    return {
      verdict: evaluated.length ? (anyLiq ? 'FAIL' : 'PASS') : anyInput ? 'INFO' : 'PASS',
      checks: { layers: rows, summary: { total: rows.length, skipped: rows.filter((r) => r.result === '평가 생략').length, evaluated: evaluated.length, liquefiable: evaluated.filter((r) => r.pass === false).length } },
      notes: [
        '예비평가 생략 4조건·본평가 FS=CRR/CSR·1.0 판정 — §4.7 원문. 층두께 1.5m 이하 단위 평가(원문).',
        'CRR=SPT/CPT/Vs 시험 산정 입력·rd=산정 입력(관례식 근거 명시) — 자동 보정 체인(N값 에너지·상재압)은 후속.',
        'FS≤1.0 층 존재 시 지반분야 책임기술자 대책 검토(§4.7(1)) — 특등급 반복연화 실내시험 별도(§(5)).',
      ],
    };
  },
};
