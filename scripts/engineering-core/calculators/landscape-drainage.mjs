/**
 * P4 조경 — 우수 배수 검토 (합리식 + Manning 관거 용량).
 * 합리식 Q=C·i·A/360, Manning Q=(1/n)·A·R^(2/3)·√S — 보편 공학 공식(저작권 무관).
 * KDS 34 20 10 §4.3.1(6)이 조경 지형설계에 집수유역·유하량 검토와 배수시설
 * 설계를 요구 — 본 계산기는 그 검토의 결정론 구현.
 * 조경 스코프 경계: 공학(배수)만 — 미학·식재 디자인은 검증 대상 아님(plan §7.7).
 */
export default {
  id: 'landscape_drainage',
  domain: 'landscape/civil',
  title: '조경 우수 배수 검토 (합리식 + Manning)',
  description: '소유역 첨두유출량(합리식)과 원형 관거 만관 용량(Manning) 대조. 강우강도 i는 지역 IDF에서 입력.',
  refs: [
    'KDS 34 20 10 §4.3.1(6) 집수유역·유하량 검토 및 배수시설 설계 · §4.3.2(3) 표면배수 연계',
    '합리식 Q=CiA/360 · Manning 조도식 — 보편 공학 공식',
  ],
  status: 'draft — 골든벤치 수계산 대조. 합리식 적용한계(소유역) 준수 전제',
  inputSchema: {
    type: 'object',
    required: ['areaHa', 'C', 'i_mmhr'],
    properties: {
      areaHa: { type: 'number', exclusiveMinimum: 0, maximum: 500, description: '배수(집수)면적 ha — 합리식은 소유역용' },
      C: { type: 'number', minimum: 0.05, maximum: 0.95, description: '유출계수 (녹지 0.05~0.3, 포장 0.7~0.95)' },
      i_mmhr: { type: 'number', exclusiveMinimum: 0, maximum: 300, description: '설계 강우강도 mm/hr (지역 IDF·재현빈도에서)' },
      pipeDia_mm: { type: 'number', minimum: 100, maximum: 3000, description: '관거 내경 mm (생략=유출량만 산정)' },
      slope: { type: 'number', exclusiveMinimum: 0, maximum: 0.5, description: '관거 경사 m/m' },
      n: { type: 'number', minimum: 0.009, maximum: 0.05, description: 'Manning 조도계수 (기본 0.013 콘크리트관)' },
    },
  },
  run(input) {
    const { areaHa, C, i_mmhr } = input;
    // 합리식: Q[m³/s] = C·i[mm/hr]·A[ha] / 360
    const Q = (C * i_mmhr * areaHa) / 360;
    const intermediate = { Q_design_m3s: Q };
    const checks = {};
    const notes = [
      '합리식 적용한계: 소유역(도달시간 내 균일 강우 가정) — 대유역·저류 효과는 별도 해석',
      '강우강도 i는 지역 IDF 곡선·설계 재현빈도에서 결정해 입력 (본 계산기는 i를 산정하지 않음)',
    ];

    if (input.pipeDia_mm) {
      if (typeof input.slope !== 'number' || input.slope <= 0) {
        throw new Error('pipe gate: pipeDia_mm 입력 시 slope 필수');
      }
      const n = input.n ?? 0.013;
      const D = input.pipeDia_mm / 1000; // m
      const Af = (Math.PI * D * D) / 4;
      const R = D / 4; // 만관 동수반경
      const Qcap = (1 / n) * Af * R ** (2 / 3) * Math.sqrt(input.slope);
      const v = Qcap / Af;
      Object.assign(intermediate, { Q_capacity_m3s: Qcap, v_full_ms: v, A_pipe_m2: Af, R_m: R, n });
      checks.capacity = { Q_m3s: Q, Qcap_m3s: Qcap, ratio: Q / Qcap, pass: Q <= Qcap };
      // 유속 점검 — 관행 범위(퇴적 방지 하한·마모 방지 상한), 정보성
      checks.velocity = { v_ms: v, range: '0.8~3.0 (관행)', pass: v >= 0.8 && v <= 3.0 };
      notes.push('만관(full-flow) 기준 용량 — 부분수심 흐름·손실수두·접합부는 상세설계 영역', '유속 범위 0.8~3.0m/s는 퇴적·마모 방지 관행값(정보성)');
    } else {
      checks.runoff = { Q_m3s: Q, pass: true, note: '관거 미입력 — 첨두유출량 산정만 수행' };
    }

    return {
      inputsEcho: { ...input, n: input.n ?? 0.013 },
      intermediate,
      checks,
      verdict: Object.values(checks).every((c) => c.pass) ? 'PASS' : 'FAIL',
      notes,
    };
  },
};
