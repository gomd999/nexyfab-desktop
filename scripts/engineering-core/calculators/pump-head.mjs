/**
 * P17 조경/설비 — 펌프 전양정 (폐형: 정수두+마찰+부차손실).
 * H = Hz(정수두) + hf(Hazen-Williams — pipe_sizing과 동일식) + Σ hm(부차 K·v²/2g)
 *   + 잔류수두(분수 노즐 등 — 사양 입력).
 * 축동력 P = ρgQH/η (효율=펌프 사양 입력 원칙 — 기본 미입력 시 수동력만).
 * 앵커: 마찰·부차 0 → H=Hz 폐형 · 수동력 ρgQH 손검증.
 */
export default {
  id: 'pump_head',
  domain: 'landscape/water',
  title: '펌프 전양정·동력',
  description: '정수두+마찰(H-W)+부차손실+잔류수두 → 전양정·수동력/축동력.',
  refs: ['전양정 합산·Hazen-Williams (수리 표준 폐형)', '부차손실 K·노즐 잔류수두·펌프효율=사양 입력 원칙'],
  status: 'verified — 폐형 앵커(무손실 극한·수동력). NPSH·병렬운전·시스템곡선 교점은 후속',
  inputSchema: {
    type: 'object',
    required: ['Q_Lmin', 'staticHead_m', 'pipeDia_mm', 'pipeLen_m'],
    properties: {
      Q_Lmin: { type: 'number', exclusiveMinimum: 0, description: '유량 L/min' },
      staticHead_m: { type: 'number', minimum: 0, description: '정수두 (흡입저면~토출 최고점)' },
      pipeDia_mm: { type: 'number', exclusiveMinimum: 0, description: '관 내경' },
      pipeLen_m: { type: 'number', exclusiveMinimum: 0, description: '관 연장' },
      hwC: { type: 'number', minimum: 80, maximum: 160, description: 'Hazen-Williams C (기본 130 PVC 관례 — 재질 확인)' },
      sumK: { type: 'number', minimum: 0, maximum: 100, description: '부차손실계수 합 ΣK (엘보·밸브 — 자료 입력, 기본 0=미반영 명시)' },
      residualHead_m: { type: 'number', minimum: 0, description: '잔류수두 (분수 노즐 사양 등 — 입력)' },
      efficiency: { type: 'number', minimum: 0.2, maximum: 0.9, description: '펌프 효율 (사양 입력 — 미입력 시 수동력만)' },
    },
  },
  run(input) {
    const Q = input.Q_Lmin / 60000; // m³/s
    const D = input.pipeDia_mm / 1000;
    const C = input.hwC ?? 130;
    const v = Q / (Math.PI * D * D / 4);
    // Hazen-Williams (SI): hf = 10.67·L·Q^1.852 / (C^1.852 · D^4.87)
    const hf = (10.67 * input.pipeLen_m * Math.pow(Q, 1.852)) / (Math.pow(C, 1.852) * Math.pow(D, 4.87));
    const hm = ((Number(input.sumK) || 0) * v * v) / (2 * 9.81);
    const H = input.staticHead_m + hf + hm + (Number(input.residualHead_m) || 0);
    const Pw = (1000 * 9.81 * Q * H) / 1000; // kW 수동력
    const eff = Number(input.efficiency) > 0 ? Number(input.efficiency) : null;
    const Ps = eff ? Pw / eff : null;
    return {
      verdict: 'INFO',
      checks: {
        head: { static_m: input.staticHead_m, friction_m: +hf.toFixed(2), minor_m: +hm.toFixed(2), residual_m: Number(input.residualHead_m) || 0, total_m: +H.toFixed(2) },
        power: { waterPower_kW: +Pw.toFixed(3), ...(Ps ? { shaftPower_kW: +Ps.toFixed(3), efficiency: eff } : { note: '효율 미입력 — 수동력만(사양 입력 시 축동력)' }) },
      },
      intermediate: { velocity_ms: +v.toFixed(2), hwC: C },
      notes: [
        `전양정 ${H.toFixed(2)}m = 정수두 ${input.staticHead_m} + 마찰 ${hf.toFixed(2)}(H-W C=${C}) + 부차 ${hm.toFixed(2)}${Number(input.sumK) > 0 ? `(ΣK=${input.sumK})` : '(미반영 명시)'} + 잔류 ${Number(input.residualHead_m) || 0}.`,
        `유속 ${v.toFixed(2)}m/s (0.6~2.0 관례 범위 확인). NPSH·펌프 선정(H-Q 곡선 교점)은 제품 자료 별도.`,
      ],
    };
  },
};
