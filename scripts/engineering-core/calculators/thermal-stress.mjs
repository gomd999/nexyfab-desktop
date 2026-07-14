/**
 * P10 기계 — 구속 열응력·열팽창 (폐형). σ = k·E·α·ΔT.
 * 앵커: 강 E=200GPa·α=1.2e-5·ΔT=100·k=1 → 240MPa.
 * 크리프는 Larson-Miller 재료상수 입력식으로 후속(지어내지 않음).
 */
export default {
  id: 'thermal_stress',
  domain: 'mech/thermal',
  title: '구속 열응력·열팽창',
  description: '온도변화 구속 응력(σ=kEαΔT)·자유 팽창량 + 허용응력 대조.',
  refs: ['열탄성 폐형 σ=EαΔT (교과서 표준)'],
  status: 'verified — 폐형. 온도구배·2축 구속·크리프(LM 입력식)는 후속',
  inputSchema: {
    type: 'object',
    required: ['E_MPa', 'alpha_1perC', 'deltaT'],
    properties: {
      E_MPa: { type: 'number', exclusiveMinimum: 0, description: '탄성계수 MPa' },
      alpha_1perC: { type: 'number', exclusiveMinimum: 0, maximum: 5e-5, description: '선팽창계수 1/°C (강 ~1.2e-5 — 재료값 입력)' },
      deltaT: { type: 'number', minimum: -300, maximum: 600, description: '온도변화 °C (+가열)' },
      restraint: { type: 'number', minimum: 0, maximum: 1, description: '구속도 k (1=완전구속 보수측, 기본 1)' },
      L_mm: { type: 'number', exclusiveMinimum: 0, description: '자유 팽창량 계산 길이 mm (선택)' },
      allowMPa: { type: 'number', exclusiveMinimum: 0, description: '허용응력 MPa (입력 시 판정)' },
    },
  },
  run(input) {
    const k = input.restraint ?? 1;
    const sigma = k * input.E_MPa * input.alpha_1perC * Math.abs(input.deltaT);
    const free = input.L_mm > 0 ? input.alpha_1perC * input.L_mm * input.deltaT : null;
    const pass = input.allowMPa > 0 ? sigma <= input.allowMPa : null;
    return {
      verdict: pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL',
      ...(input.allowMPa > 0 ? { checks: { thermal: { sigma_MPa: +sigma.toFixed(1), allow_MPa: input.allowMPa, pass } } } : {}),
      intermediate: {
        sigma_MPa: +sigma.toFixed(1),
        freeExpansion_mm: free !== null ? +free.toFixed(3) : null,
        sign: input.deltaT >= 0 ? '가열=압축(구속 시)' : '냉각=인장(구속 시)',
      },
      notes: [
        `σ = k·E·α·ΔT = ${k}×${input.E_MPa}×${input.alpha_1perC}×${Math.abs(input.deltaT)} = ${sigma.toFixed(1)} MPa`,
        '균일 온도·1축 구속 가정 — 온도구배·2축은 후속. 크리프는 LM 상수 입력식 예정.',
      ],
    };
  },
};
