/**
 * P9 기계 — 피로 안전율 (Goodman/Gerber/Soderberg) — 교과서 폐형(수정 없음).
 * n = 1/(σa/Se + σm/Su) [Goodman] · Gerber: σa/Se + (σm/Su)² = 1/n(근사 보수 처리:
 * n_G = 정해 이차식 해) · Soderberg: Su→Sy.
 * 원칙: Se(수정 내구한도)는 지어내지 않음 — 시험값·설계자 산정값 입력(ka~kf 보정은
 * 재료·표면·크기 의존 — 후속 보정계수 모듈 명시). σa=0 정하중은 정적 판정 안내.
 */
export default {
  id: 'fatigue_goodman',
  domain: 'mech/fatigue',
  title: '피로 안전율 (Goodman 계열)',
  description: '평균·교번응력 → Goodman/Gerber/Soderberg 안전율. Se는 입력(날조 금지).',
  refs: ['Shigley 계열 교과서 표준식 (폐형 — 검증 앵커: σm=0 → n=Se/σa)'],
  status: 'verified — 폐형 앵커. 내구한도 보정계수(ka~kf)·다축·누적손상(Miner)은 후속',
  inputSchema: {
    type: 'object',
    required: ['sigmaA', 'sigmaM', 'Se', 'Su'],
    properties: {
      sigmaA: { type: 'number', minimum: 0, description: '교번응력 진폭 σa MPa' },
      sigmaM: { type: 'number', minimum: -500, description: '평균응력 σm MPa (압축 평균은 Goodman에서 σm=0 보수 처리 명시)' },
      Se: { type: 'number', exclusiveMinimum: 0, description: '수정 내구한도 Se MPa — 시험/설계 산정값 입력(표면·크기·신뢰도 보정 포함 여부 명시)' },
      Su: { type: 'number', exclusiveMinimum: 0, description: '인장강도 Su MPa' },
      Sy: { type: 'number', exclusiveMinimum: 0, description: '항복강도 Sy MPa (Soderberg·1차 항복 검토용 — 선택)' },
      nRequired: { type: 'number', minimum: 1.0, maximum: 10, description: '요구 안전율 (기본 1.5 관례 명시)' },
    },
  },
  run(input) {
    const { sigmaA: sa, Se, Su } = input;
    const smRaw = input.sigmaM;
    const sm = Math.max(0, smRaw); // 압축 평균 → 0 (Goodman 보수 관례, 명시)
    if (sa <= 0) {
      return { verdict: 'INFO', notes: ['σa=0 — 피로 아님, 정적 강도 검토(σm vs Sy/Su)로.'] };
    }
    const nGoodman = 1 / (sa / Se + sm / Su);
    // Gerber: (n·sa/Se) + (n·sm/Su)² = 1 → 이차식 정해
    let nGerber = null;
    if (sm > 0) {
      const A = (sm / Su) ** 2, B = sa / Se;
      nGerber = (-B + Math.sqrt(B * B + 4 * A)) / (2 * A);
    } else nGerber = Se / sa;
    const nSoder = input.Sy > 0 ? 1 / (sa / Se + sm / input.Sy) : null;
    const yield1 = input.Sy > 0 ? input.Sy / (sa + sm) : null; // 1차 항복(Langer)
    const req = input.nRequired ?? 1.5;
    const nGov = Math.min(nGoodman, yield1 ?? Infinity);
    return {
      verdict: nGov >= req ? 'PASS' : 'FAIL',
      checks: {
        goodman: { n: +nGoodman.toFixed(3), required: req, pass: nGoodman >= req },
        ...(yield1 ? { firstCycleYield: { n: +yield1.toFixed(3), required: req, pass: yield1 >= req } } : {}),
      },
      intermediate: { nGerber: nGerber ? +nGerber.toFixed(3) : null, nSoderberg: nSoder ? +nSoder.toFixed(3) : null, sigmaM_used: sm, compressiveMeanZeroed: smRaw < 0 },
      notes: [
        `Goodman n=${nGoodman.toFixed(2)} (지배: min(Goodman, 1차항복)) · Gerber ${nGerber?.toFixed(2)} · Soderberg ${nSoder ? nSoder.toFixed(2) : 'Sy 미입력'}`,
        'Se는 입력값 — 보정계수(표면·크기·신뢰도) 반영 여부는 입력자 책임 명시. 무한수명 기준(유한수명 S-N·Miner는 후속).',
        ...(smRaw < 0 ? ['압축 평균응력 → σm=0 보수 처리(관례 명시).'] : []),
      ],
    };
  },
};
