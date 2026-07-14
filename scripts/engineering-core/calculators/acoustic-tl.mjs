/**
 * P11 인테리어 — 단일벽 차음 질량법칙 (폐형) — 개념 검토.
 * TL = 20·log10(f·m) − 47 dB (실용식 — 건축음향 교과서 표준).
 * 앵커: m=10, f=500 → 20log(5000)−47 = 26.99 dB.
 * 한계(명시): 질량법칙 영역만 — 일치효과·이중벽 공진·플랭킹·틈새 누음 미포함.
 */
export default {
  id: 'acoustic_tl',
  domain: 'interior/acoustics',
  title: '단일벽 차음 (질량법칙)',
  description: '면밀도 → 투과손실 TL 개산(주파수 대역) + 요구치 대조.',
  refs: ['질량법칙 실용식 TL=20log(f·m)−47 (건축음향 교과서 표준)'],
  status: 'verified — 폐형. 일치효과·이중벽·바닥충격음은 후속',
  inputSchema: {
    type: 'object',
    required: ['surfaceDensity_kgm2'],
    properties: {
      surfaceDensity_kgm2: { type: 'number', exclusiveMinimum: 0, maximum: 1000, description: '면밀도 kg/m² (콘크리트 150t≈360·석고 12.5t≈10 — 재료값 입력)' },
      freqHz: { type: 'number', minimum: 63, maximum: 8000, description: '평가 주파수 Hz (기본 500 관례 대표)' },
      requiredTL_dB: { type: 'number', minimum: 20, maximum: 80, description: '요구 투과손실 dB (경계벽 법정 기준 등 — 프로젝트 확인 입력)' },
    },
  },
  run(input) {
    const f = input.freqHz ?? 500;
    const TL = 20 * Math.log10(f * input.surfaceDensity_kgm2) - 47;
    const bands = [125, 250, 500, 1000, 2000].map((fb) => ({ f: fb, TL_dB: +(20 * Math.log10(fb * input.surfaceDensity_kgm2) - 47).toFixed(1) }));
    const pass = input.requiredTL_dB > 0 ? TL >= input.requiredTL_dB : null;
    return {
      verdict: pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL',
      ...(input.requiredTL_dB > 0 ? { checks: { tl: { TL_dB: +TL.toFixed(1), required: input.requiredTL_dB, pass } } } : {}),
      intermediate: { TL_dB: +TL.toFixed(1), bands },
      notes: [
        `질량법칙 TL(${f}Hz)=${TL.toFixed(1)}dB — 이론 상한 개산(일치효과 딥·틈새로 실측 하회 가능, 명시).`,
        '이중벽·중공층·플랭킹 미포함 — 상세 차음설계는 음향 전문 검토.',
      ],
    };
  },
};
