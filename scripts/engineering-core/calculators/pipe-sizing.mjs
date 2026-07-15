/**
 * P11 인테리어 — 급수 배관 사이징 (속도법 + Hazen-Williams 마찰) — 폐형.
 * A=Q/v → 표준 호칭경 → hf = 10.67·L·Q^1.852/(C^1.852·D^4.87) (SI, HW 표준식).
 * 기구단위(FU) 표는 KDS 31 30에 미수록 확인 — 동시사용유량은 프로젝트 산정
 * 입력(설비 편람 표 — 지어내지 않음 명시). 앵커: HW 폐형 손검증.
 */
const STD_DN = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200];

export default {
  id: 'pipe_sizing',
  domain: 'interior/plumbing',
  title: '급수 배관 사이징 (속도법+HW)',
  description: '설계유량·허용유속 → 호칭경 + Hazen-Williams 마찰손실.',
  refs: ['Hazen-Williams SI 표준식 hf=10.67LQ^1.852/(C^1.852 D^4.87) (폐형)', 'KDS 31 30 15 급수설비(원칙 — 기구단위 표 미수록 확인, 동시유량=입력)'],
  status: 'verified — HW 폐형 앵커. 기구단위→동시유량 자동 환산은 공인 표 확보 후(정직 보류)',
  inputSchema: {
    type: 'object',
    required: ['flowLpm', 'velocityLimit'],
    properties: {
      flowLpm: { type: 'number', exclusiveMinimum: 0, maximum: 10000, description: '설계 유량 L/min (동시사용유량 — 프로젝트 산정 입력)' },
      velocityLimit: { type: 'number', minimum: 0.5, maximum: 4, description: '허용 유속 m/s (급수 1.5~2.5 관례 — 소음·수격 고려 확인 입력)' },
      lengthM: { type: 'number', minimum: 0, description: '배관 길이 m (마찰손실 — 선택)' },
      hwC: { type: 'number', minimum: 80, maximum: 160, description: 'HW 조도계수 C (동관 130·PVC 150·강관 100 — 재질값 입력, 기본 130)' },
      staticHead_m: { type: 'number', minimum: 0, description: '정수두 m (필요 급수압 검토용 — 선택)' },
    },
  },
  run(input) {
    const Q = input.flowLpm / 60000; // m³/s
    const v = input.velocityLimit;
    const D = Math.sqrt((4 * Q) / (Math.PI * v)); // m
    const DN = STD_DN.find((d) => d >= D * 1000) ?? 200;
    const Di = DN / 1000;
    const vAct = Q / ((Math.PI * Di * Di) / 4);
    let hf = null;
    if (input.lengthM > 0) {
      const C = input.hwC ?? 130;
      hf = (10.67 * input.lengthM * Math.pow(Q, 1.852)) / (Math.pow(C, 1.852) * Math.pow(Di, 4.87));
    }
    const totalHead = hf !== null ? hf + (input.staticHead_m ?? 0) : null;
    return {
      verdict: 'INFO',
      intermediate: {
        required_D_mm: +(D * 1000).toFixed(1), DN, v_actual_ms: +vAct.toFixed(2),
        hf_m: hf !== null ? +hf.toFixed(2) : null,
        totalHead_m: totalHead !== null ? +totalHead.toFixed(2) : null,
        pressure_kPa: totalHead !== null ? +(totalHead * 9.81).toFixed(1) : null,
      },
      notes: [
        `속도법 D=${(D * 1000).toFixed(1)}mm → DN${DN} (실유속 ${vAct.toFixed(2)}m/s)`,
        ...(hf !== null ? [`HW 마찰 hf=${hf.toFixed(2)}m (C=${input.hwC ?? 130}) — 직관만, 밸브·엘보 상당길이 별도.`] : []),
        '동시사용유량은 기구단위법 등 프로젝트 산정 입력 — 공인 FU 표 확보 시 자동 환산 승격(정직 보류). 기구별 최저 급수압 확인 필요.',
      ],
    };
  },
};
