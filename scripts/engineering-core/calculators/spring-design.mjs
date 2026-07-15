/**
 * P17 기계 — 압축 코일스프링 (Wahl 폐형).
 * τ = Kw·8FD/(πd³), Kw = (4C−1)/(4C−4) + 0.615/C (Wahl — 폐형).
 * 처짐 δ = 8FD³Na/(Gd⁴) · 스프링상수 k = Gd⁴/(8D³Na).
 * 좌굴 게이트: 자유고/평균경 > 2.6(양단 고정 가이드 관례 — 조건별 표는 입력 안내)·
 * 밀착 여유 게이트. 허용응력=재료·선경 의존(입력 원칙 — KS D 3510 등 산정 입력).
 * 앵커: C→∞ 시 Kw→1 · k 폐형 손검증.
 */
export default {
  id: 'spring_design',
  domain: 'mechanical/element',
  title: '압축 코일스프링 (Wahl)',
  description: '전단응력(Wahl 보정)·스프링상수·처짐·좌굴/밀착 게이트.',
  refs: ['Wahl 응력보정·스프링 폐형 (기계설계 표준)', '허용응력·G값 = 재료 산정 입력(KS D 3510 등 — 지어내지 않음)'],
  status: 'verified — 폐형 앵커(Kw 극한·k 손검증). 피로(교번하중)·서징은 후속',
  inputSchema: {
    type: 'object',
    required: ['d_mm', 'D_mm', 'Na', 'G_MPa', 'F_N'],
    properties: {
      d_mm: { type: 'number', exclusiveMinimum: 0, maximum: 50, description: '선경' },
      D_mm: { type: 'number', exclusiveMinimum: 0, maximum: 500, description: '평균 코일경' },
      Na: { type: 'number', minimum: 1, maximum: 50, description: '유효 감김수' },
      G_MPa: { type: 'number', minimum: 60000, maximum: 90000, description: '전단탄성계수 (강 78,500~81,500 — 재료값 입력)' },
      F_N: { type: 'number', exclusiveMinimum: 0, description: '작용 하중' },
      tauAllow_MPa: { type: 'number', exclusiveMinimum: 0, description: '허용전단응력 (재료·선경 의존 — KS 자료 산정 입력. 미입력=INFO)' },
      freeLen_mm: { type: 'number', exclusiveMinimum: 0, description: '자유고 (좌굴·밀착 게이트용)' },
      totalCoils: { type: 'number', minimum: 2, description: '총 감김수 (밀착고 = d×총감김 — 연삭 단부 관례)' },
    },
  },
  run(input) {
    const { d_mm: d, D_mm: D, Na, G_MPa: G, F_N: F } = input;
    const C = D / d;
    if (C < 3 || C > 15) throw new Error(`input gate: 스프링지수 C=${C.toFixed(1)} — 3~15 범위(제조 관례)`);
    const Kw = (4 * C - 1) / (4 * C - 4) + 0.615 / C;
    const tau = (Kw * 8 * F * D) / (Math.PI * d ** 3);
    const k = (G * d ** 4) / (8 * D ** 3 * Na); // N/mm
    const delta = F / k;
    const checks = {
      stress: Number(input.tauAllow_MPa) > 0
        ? { tau_MPa: +tau.toFixed(1), allow_MPa: input.tauAllow_MPa, ratio: +(tau / input.tauAllow_MPa).toFixed(3), pass: tau <= input.tauAllow_MPa }
        : { tau_MPa: +tau.toFixed(1), note: '허용응력 미입력 — INFO(재료 자료 입력 시 판정)' },
    };
    let buckle = null, solid = null;
    if (Number(input.freeLen_mm) > 0) {
      const slend = input.freeLen_mm / D;
      buckle = { L0overD: +slend.toFixed(2), limit: 2.6, pass: slend <= 2.6, note: '양단 평행 가이드 관례 한계 2.6(조건별 상세 도표는 별도) — 초과 시 가이드 필요' };
      checks.buckling = buckle;
      if (Number(input.totalCoils) > 0) {
        const Ls = d * input.totalCoils; // 연삭 단부 관례
        const ok = input.freeLen_mm - delta > Ls;
        solid = { solidLen_mm: +Ls.toFixed(1), atLoad_mm: +(input.freeLen_mm - delta).toFixed(1), pass: ok, note: ok ? '하중 시 밀착 전' : '⚠ 하중 시 밀착 도달 — 자유고/감김수 조정' };
        checks.solidHeight = solid;
      }
    }
    const pass = Object.values(checks).every((c) => c.pass !== false);
    return {
      verdict: Number(input.tauAllow_MPa) > 0 ? (pass ? 'PASS' : 'FAIL') : 'INFO',
      checks,
      intermediate: { C: +C.toFixed(2), Kw: +Kw.toFixed(3), k_Nmm: +k.toFixed(2), delta_mm: +delta.toFixed(1) },
      notes: [
        `τ=Kw(${Kw.toFixed(3)})·8FD/πd³=${tau.toFixed(1)}MPa · k=${k.toFixed(2)}N/mm · δ=${delta.toFixed(1)}mm — 전부 폐형.`,
        '허용응력·G=재료 입력 원칙(선경 의존 — KS D 3510 등). 교번하중 피로·서징(고유진동수)은 후속.',
      ],
    };
  },
};
