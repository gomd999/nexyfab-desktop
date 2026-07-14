/**
 * P6 조경/토목 — 우수 배수 네트워크 (합리식 누적 + Manning) — 부지 스케일 확장.
 * 선형 간선(상류→하류 순) 구간별: 누적 CA(유출계수×면적) · 도달시간 tc = max(자체 tc,
 * 상류 tc + 관내 유하시간) · I(tc) = Talbot형 a/(tc+b) (지역 IDF 계수 — 필수 입력,
 * 지어내지 않음) 또는 고정 강우강도 · Q = ΣCA·I/360 (ha·mm/hr → m³/s) ·
 * Manning 만관 통수능 대조 + 표준관경 자동 제안.
 * 검증: 단일 구간 = landscape_drainage와 동치(회귀) · 2구간 손검증.
 */
const STD_DIA = [300, 400, 450, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1350, 1500, 1650, 1800];

export default {
  id: 'drainage_network',
  domain: 'landscape/civil',
  title: '우수 배수 네트워크 (합리식 누적)',
  description: '다구역 집수 → 간선 순차 누적(CA·tc) → 구간별 관경 검토/제안. 부지·공원 스케일.',
  refs: [
    'KDS 34 20 10(조경 배수) §4.3.1(6) 합리식 — landscape_drainage 동일 근거',
    'Manning 만관 통수능 (조도계수 입력·기본 0.013 콘크리트관)',
  ],
  status: 'verified — 단일구간 landscape_drainage 동치 회귀 + 2구간 손검증. IDF 계수=지역값 필수 입력',
  inputSchema: {
    type: 'object',
    required: ['segments'],
    properties: {
      segments: { description: '상류→하류 순 구간 배열: [{name?, areaHa, C, tcMin, len_m, slope, dia_mm?, n?}] — areaHa=구간 신규 집수면적, tcMin=해당 구역 자체 유입시간(분)' },
      iFixed_mmhr: { type: 'number', exclusiveMinimum: 0, maximum: 300, description: '고정 설계 강우강도 mm/hr (입력 시 IDF 무시 — 소규모 개산)' },
      idfA: { type: 'number', exclusiveMinimum: 0, maximum: 20000, description: 'Talbot IDF 계수 a — I=a/(tc+b) (지역 확률강우 분석값, 예: 서울 30년 등 — 출처는 프로젝트 자료)' },
      idfB: { type: 'number', minimum: 0, maximum: 120, description: 'Talbot IDF 계수 b (분)' },
      fillRatio: { type: 'number', minimum: 0.5, maximum: 1.0, description: '허용 충만도 (만관 대비, 기본 1.0 — 실무 0.75 권장 시 입력)' },
    },
  },
  run(input) {
    const segs = input.segments;
    if (!Array.isArray(segs) || !segs.length) throw new Error('input gate: segments 배열 필요');
    if (segs.length > 30) throw new Error('input gate: 구간 30개 이하 (v1 선형 간선)');
    const useFixed = input.iFixed_mmhr > 0;
    if (!useFixed && !(input.idfA > 0 && input.idfB >= 0)) {
      const e = new Error('input gate: iFixed_mmhr 또는 IDF 계수(idfA·idfB — 지역 확률강우 분석값) 필요 — 강우를 지어내지 않음');
      e.code = 'INPUT_GATE';
      throw e;
    }
    const fill = input.fillRatio ?? 1.0;
    const I_of = (tcMin) => useFixed ? input.iFixed_mmhr : input.idfA / (tcMin + input.idfB);

    let cumCA = 0, tc = 0;
    const rows = [];
    let allPass = true;
    for (const [idx, s] of segs.entries()) {
      for (const k of ['areaHa', 'C', 'tcMin', 'len_m', 'slope']) {
        if (!(Number(s[k]) >= 0)) throw new Error(`input gate: 구간 ${idx + 1} '${k}' 필요`);
      }
      cumCA += s.C * s.areaHa;
      tc = Math.max(s.tcMin, tc); // 상류 tc(유하시간 누적 반영된 값)와 자체 유입시간 중 큰 값
      const I = I_of(tc);
      const Q = (cumCA * I) / 360; // m³/s
      const n = s.n ?? 0.013;
      // 관경: 지정 시 검토, 미지정 시 표준관경 중 최소 적합 제안
      const capOf = (dia) => {
        const D = dia / 1000, A = Math.PI * D * D / 4, R = D / 4;
        const v = (1 / n) * Math.pow(R, 2 / 3) * Math.sqrt(s.slope);
        return { cap: A * v * fill, v };
      };
      let dia = s.dia_mm ?? null, suggested = false;
      if (!dia) {
        dia = STD_DIA.find((d) => capOf(d).cap >= Q) ?? STD_DIA[STD_DIA.length - 1];
        suggested = true;
      }
      const { cap, v } = capOf(dia);
      const pass = cap >= Q;
      if (!pass) allPass = false;
      // 관내 유하시간(만관 유속 기준, 분) → 하류 tc 누적
      const travelMin = v > 0 ? (s.len_m / v) / 60 : 0;
      tc += travelMin;
      rows.push({
        seg: s.name ?? `S${idx + 1}`, cumCA_ha: +cumCA.toFixed(3), tc_min: +(tc - travelMin).toFixed(1),
        I_mmhr: +I.toFixed(1), Q_m3s: +Q.toFixed(4), dia_mm: dia, suggested,
        v_ms: +v.toFixed(2), cap_m3s: +cap.toFixed(4), ratio: +(Q / cap).toFixed(3), pass,
        travel_min: +travelMin.toFixed(1),
      });
    }
    return {
      verdict: allPass ? 'PASS' : 'FAIL',
      segments: rows,
      outfall: { Q_m3s: rows[rows.length - 1].Q_m3s, tc_min: +tc.toFixed(1), cumCA_ha: +cumCA.toFixed(3) },
      notes: [
        `합리식 Q=ΣCA·I/360 (CA ha·I mm/hr) — ${useFixed ? `고정 I=${input.iFixed_mmhr}` : `Talbot I=${input.idfA}/(tc+${input.idfB})`}.`,
        '도달시간: 구간 자체 유입시간과 상류 누적(유하시간=만관 유속 기준) 중 지배값 — 부분관 유속 미고려(개산 명시).',
        `충만도 ${fill} 기준 통수능. 관경 제안은 표준관경(D300~1800) 중 최소 적합.`,
        'v1 선형 간선 — 분기 합류(트리)는 후속. 우수 유출 저감시설(침투·저류)은 미반영.',
      ],
    };
  },
};
