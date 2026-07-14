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
      Se: { type: 'number', minimum: 0, description: 'Se MPa — 직접 입력(우선). 0/미입력+아래 보정 입력 시 Shigley 표준 추정' },
      surface: { type: 'string', enum: ['ground', 'machined', 'hotRolled', 'asForged'], description: 'Se 추정: 표면 (Shigley ka=a·Su^b 공표 계수 — 출처 명시)' },
      dia_mm: { type: 'number', minimum: 0, maximum: 254, description: 'Se 추정: 회전굽힘 지름 kb (2.79~51: (d/7.62)^−0.107 · 51~254: 1.51d^−0.157)' },
      loadType: { type: 'string', enum: ['bending', 'axial', 'torsion'], description: 'Se 추정: 하중 kc (1.0/0.85/0.59 — Shigley)' },
      reliability: { type: 'string', enum: ['50', '90', '95', '99', '99.9'], description: 'Se 추정: 신뢰도 ke (1.0/0.897/0.868/0.814/0.753 — Shigley)' },
      lifeMode: { type: 'boolean', description: '유한수명 S-N (Basquin, f=0.9 관례 명시) — 등가 완전교번 응력으로 N 산출' },
      minerBlocks: { description: 'Miner 누적: [{sigmaA, sigmaM, cycles}] 배열 (lifeMode와 함께)' },
      Su: { type: 'number', exclusiveMinimum: 0, description: '인장강도 Su MPa' },
      Sy: { type: 'number', exclusiveMinimum: 0, description: '항복강도 Sy MPa (Soderberg·1차 항복 검토용 — 선택)' },
      nRequired: { type: 'number', minimum: 1.0, maximum: 10, description: '요구 안전율 (기본 1.5 관례 명시)' },
    },
  },
  run(input) {
    const { sigmaA: sa, Su } = input;
    // Se: 직접 입력 우선 — 없으면 Shigley 표준 추정(공표 교과서 계수, 출처 명시)
    let Se = input.Se > 0 ? input.Se : null;
    let seNote = null;
    if (!Se) {
      const KA = { ground: [1.58, -0.085], machined: [4.51, -0.265], hotRolled: [57.7, -0.718], asForged: [272, -0.995] };
      if (!input.surface) throw new Error('input gate: Se 직접 입력 또는 surface(+dia_mm·loadType·reliability) 필요 — 지어내지 않음');
      const [a, b] = KA[input.surface];
      const ka = a * Math.pow(Su, b);
      const d = input.dia_mm ?? 0;
      const kb = d <= 0 ? 1.0 : d <= 2.79 ? 1.0 : d <= 51 ? Math.pow(d / 7.62, -0.107) : 1.51 * Math.pow(d, -0.157);
      const kc = { bending: 1.0, axial: 0.85, torsion: 0.59 }[input.loadType ?? 'bending'];
      const ke = { '50': 1.0, '90': 0.897, '95': 0.868, '99': 0.814, '99.9': 0.753 }[input.reliability ?? '50'];
      const SeP = 0.5 * Math.min(Su, 1400) + (Su > 1400 ? 0 : 0); // Se' = 0.5Su (Su≤1400 — 초과 시 700 고정)
      const SePrime = Su <= 1400 ? 0.5 * Su : 700;
      Se = ka * kb * kc * ke * SePrime;
      seNote = 'Se 추정(Shigley 공표 계수): ka ' + ka.toFixed(3) + ' × kb ' + kb.toFixed(3) + ' × kc ' + kc + ' × ke ' + ke + " × Se' " + SePrime.toFixed(0) + ' = ' + Se.toFixed(1) + 'MPa — 온도 kd·노치 Kf 미포함(입력 반영 별도), 시험값 대체 권장';
    }
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
    // 유한수명 (Basquin — f=0.9 관례 명시): 등가 완전교번 σrev = σa/(1−σm/Su) [Goodman 환산]
    let life = null;
    if (input.lifeMode === true) {
      const fB = 0.9;
      const aB = Math.pow(fB * Su, 2) / Se;
      const bB = -Math.log10((fB * Su) / Se) / 3;
      const sigRev = sm > 0 ? sa / (1 - sm / Su) : sa;
      const N = sigRev >= Se ? Math.pow(sigRev / aB, 1 / bB) : Infinity;
      life = { sigmaRev_MPa: +sigRev.toFixed(1), N_cycles: N === Infinity ? 'infinite(>Se)' : Math.round(N), basquin: { a: +aB.toFixed(1), b: +bB.toFixed(4), f: fB } };
      if (Array.isArray(input.minerBlocks) && input.minerBlocks.length) {
        let Dsum = 0;
        const rows = [];
        for (const blk of input.minerBlocks.slice(0, 20)) {
          const sR = blk.sigmaM > 0 ? blk.sigmaA / (1 - blk.sigmaM / Su) : blk.sigmaA;
          const Ni = sR >= Se ? Math.pow(sR / aB, 1 / bB) : Infinity;
          const di = Ni === Infinity ? 0 : blk.cycles / Ni;
          Dsum += di;
          rows.push({ sigmaA: blk.sigmaA, sigmaM: blk.sigmaM ?? 0, n: blk.cycles, Ni: Ni === Infinity ? 'inf' : Math.round(Ni), d: +di.toFixed(4) });
        }
        life.miner = { D: +Dsum.toFixed(4), pass: Dsum < 1, blocks: rows, note: 'Miner Σn/N<1 — 순서효과 무시(선형 누적 관례 명시)' };
      }
    }
    const req = input.nRequired ?? 1.5;
    const nGov = Math.min(nGoodman, yield1 ?? Infinity);
    return {
      verdict: nGov >= req ? 'PASS' : 'FAIL',
      checks: {
        goodman: { n: +nGoodman.toFixed(3), required: req, pass: nGoodman >= req },
        ...(yield1 ? { firstCycleYield: { n: +yield1.toFixed(3), required: req, pass: yield1 >= req } } : {}),
      },
      ...(life ? { life } : {}),
      intermediate: { Se_used_MPa: +Se.toFixed(1), nGerber: nGerber ? +nGerber.toFixed(3) : null, nSoderberg: nSoder ? +nSoder.toFixed(3) : null, sigmaM_used: sm, compressiveMeanZeroed: smRaw < 0 },
      notes: [
        `Goodman n=${nGoodman.toFixed(2)} (지배: min(Goodman, 1차항복)) · Gerber ${nGerber?.toFixed(2)} · Soderberg ${nSoder ? nSoder.toFixed(2) : 'Sy 미입력'}`,
        seNote ?? 'Se=직접 입력값 — 보정 포함 여부 입력자 확인.',
        ...(life ? ['유한수명 Basquin(f=0.9 관례)·Miner 선형 누적 — 노치 Kf·표면 잔류응력 미포함 명시.'] : []),
        ...(smRaw < 0 ? ['압축 평균응력 → σm=0 보수 처리(관례 명시).'] : []),
      ],
    };
  },
};
