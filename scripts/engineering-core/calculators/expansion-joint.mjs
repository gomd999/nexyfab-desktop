/**
 * P17 교량 — 신축이음 이동량 (폐형 합산).
 * ΔL = ΔL온도 + ΔL크리프 + ΔL건조수축 (+ 여유율).
 * 온도: α·L·ΔT (α=콘크리트 1.0e-5/℃ 관례·강 1.2e-5 — 재료 선택. 설계온도범위=
 *   발주 기준 입력 원칙 — KDS 24 12 21 온도 조항 확인 안내).
 * 크리프·건조수축(PSC): 변형률 입력 원칙(εcr·εsh — KDS 24 14 21 산정 or 시험.
 *   관례 안내 200~400με 참고 — 입력 필수, 지어내지 않음). RC 상부는 통상 무시 선택.
 * 앵커: 단순 α·L·ΔT 폐형 손검증.
 */
export default {
  id: 'expansion_joint',
  domain: 'bridge/detail',
  title: '신축이음 이동량',
  description: '온도+크리프+건조수축 합산 → 소요 이동량·유간 — 계수 입력 원칙.',
  refs: ['열팽창·수축 폐형 합산 (교량 상세 표준)', 'ΔT=발주/KDS 24 온도 조항 입력 · εcr·εsh=산정 입력(지어내지 않음)'],
  status: 'verified — 폐형 손검증. 지점 배치(가동/고정)별 분배·사교 보정은 후속',
  inputSchema: {
    type: 'object',
    required: ['L_m', 'dTplus_C', 'dTminus_C'],
    properties: {
      L_m: { type: 'number', exclusiveMinimum: 0, maximum: 1000, description: '신축 길이 (고정점~이음부 — 지점 배치에서 산정 입력)' },
      material: { enum: ['concrete', 'steel'], description: '상부 재료 (α 1.0e-5 / 1.2e-5 관례 — 기본 concrete)' },
      dTplus_C: { type: 'number', minimum: 0, maximum: 60, description: '상승 온도차 (가설온도→최고 — 발주 기준 입력)' },
      dTminus_C: { type: 'number', minimum: 0, maximum: 60, description: '하강 온도차 (가설온도→최저)' },
      creepStrain_ue: { type: 'number', minimum: 0, maximum: 1000, description: '잔여 크리프 변형률 με (PSC — KDS 24 14 21 산정 입력. 0=미반영 명시)' },
      shrinkStrain_ue: { type: 'number', minimum: 0, maximum: 1000, description: '잔여 건조수축 με (산정 입력)' },
      marginFactor: { type: 'number', minimum: 1.0, maximum: 1.5, description: '여유율 (기본 1.15 관례 — 발주 기준 확인)' },
      jointCapacity_mm: { type: 'number', exclusiveMinimum: 0, description: '이음 제품 이동량 용량 (판정용)' },
    },
  },
  run(input) {
    const L = input.L_m * 1000; // mm
    const alpha = (input.material ?? 'concrete') === 'steel' ? 1.2e-5 : 1.0e-5;
    const expand = alpha * L * input.dTplus_C;
    const contractT = alpha * L * input.dTminus_C;
    const creep = ((Number(input.creepStrain_ue) || 0) / 1e6) * L;
    const shrink = ((Number(input.shrinkStrain_ue) || 0) / 1e6) * L;
    const mf = input.marginFactor ?? 1.15;
    const open = (contractT + creep + shrink) * mf;  // 벌어짐(수축측)
    const close = expand * mf;                        // 닫힘(팽창측)
    const total = open + close;
    const pass = Number(input.jointCapacity_mm) > 0 ? total <= input.jointCapacity_mm : null;
    const r1 = (v) => +v.toFixed(1);
    return {
      verdict: pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL',
      checks: {
        movement: {
          expand_mm: r1(close), contract_mm: r1(open), total_mm: r1(total),
          ...(pass !== null ? { capacity_mm: input.jointCapacity_mm, ratio: +(total / input.jointCapacity_mm).toFixed(3), pass } : {}),
        },
      },
      intermediate: { alpha, temp_mm: r1(expand + contractT), creep_mm: r1(creep), shrink_mm: r1(shrink), margin: mf },
      notes: [
        `총 이동량 ${total.toFixed(1)}mm = [수축측 ${open.toFixed(1)} + 팽창측 ${close.toFixed(1)}] (여유율 ${mf}).`,
        `ΔT=발주/KDS 24 온도 조항 입력 원칙. 크리프·건조수축 ${creep + shrink > 0 ? '반영' : '미반영(0 입력 — PSC는 산정 입력 필요 명시)'}.`,
        '고정/가동 지점 배치에 따른 L 산정·사교(경사) 이동 방향 보정·유간 설치온도 보정은 별도 명시.',
      ],
    };
  },
};
