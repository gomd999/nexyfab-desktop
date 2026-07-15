/**
 * P13 기계/강구조 — 필릿용접 접합 (KDS 14 31 25 원문 판독).
 * 유효면적: Ae = 0.7s × Le (§4.1.2.2.1 — 유효목 0.7s(원문 "0.7배", AISC 0.707과 구분),
 *   유효길이 Le = L − 2s). 장대용접 감소(§4.1.2.2.2(5)): L>100s → β=1.2−0.002(L/s)≤1.0
 *   (식 4.1-1), L>300s → Le=180s.
 * 설계강도(건축, 표 4.1-8): φRn = 0.75 × 0.60FEXX × Ae — 용접재 파단. 모재 전단·인장
 *   파단(§4.1.4)은 별도 검토 명시. 방향성 증가(AISC 1+0.5sin^1.5θ)는 KDS 표에 없어
 *   미적용(보수 — 명시).
 * 게이트: 최소치수 표 4.1-6(a) [t<6:3, 6≤t<13:5, 13≤t<20:6, 20≤t:8] · 겹침 최대
 *   (§(2): t<6 → s≤t, t≥6 → s≤t−2) · 최소길이 4s(§(3)).
 * 앵커: 폐형 손계산 — 단순 곱이라 자체검증 가능. 토목(표 4.1-7 φ0.8 계열)은 후속.
 */
export default {
  id: 'weld_connection',
  domain: 'mechanical/connection',
  title: '필릿용접 접합 (KDS 14 31 25)',
  description: '필릿용접 설계강도(0.75·0.6FEXX·Ae)+치수·길이 게이트 — 건축구조물 기준.',
  refs: ['KDS 14 31 25:2024 §4.1.2.2(유효면적·제한사항·식4.1-1)·표 4.1-6(a)·표 4.1-8(φ0.75·0.60FEXX) — 원문 판독'],
  status: 'verified — 원문 계수·표 전사 + 폐형 손검증. 토목(표 4.1-7)·용접군 편심(순간중심법)·모재 파단 자동검토는 후속',
  inputSchema: {
    type: 'object',
    required: ['weldSize_mm', 'length_mm', 'FEXX_MPa', 'demandP_kN'],
    properties: {
      weldSize_mm: { type: 'number', exclusiveMinimum: 0, maximum: 30, description: '용접치수 s (다리길이)' },
      length_mm: { type: 'number', exclusiveMinimum: 0, description: '용접 총길이 L (양면이면 합계 입력)' },
      nSegments: { type: 'integer', minimum: 1, maximum: 20, description: '세그먼트 수 (기본 1 — 유효길이 공제 2s×n)' },
      FEXX_MPa: { type: 'number', minimum: 400, maximum: 830, description: '용접재 인장강도 (KS 등급 — 매칭용접재 원칙, 표 4.1-8 주2)' },
      demandP_kN: { type: 'number', minimum: 0, description: '소요강도 (용접군 도심 통과 합력 — 편심은 후속, 별도 해석 입력)' },
      tThin_mm: { type: 'number', exclusiveMinimum: 0, description: '접합부 얇은 쪽 판두께 (최소치수 게이트 — 표 4.1-6(a))' },
      lapJoint: { type: 'boolean', description: '겹침이음 여부 (최대치수 게이트 §4.1.2.2.2(2))' },
      tEdge_mm: { type: 'number', exclusiveMinimum: 0, description: '겹침이음 시 연단 용접되는 판두께 (최대치수 판정용)' },
      endLoaded: { type: 'boolean', description: '부재 단부 길이방향 재하 여부 (장대 감소 식4.1-1 적용 — 기본 true 보수)' },
    },
  },
  run(input) {
    const s = input.weldSize_mm, L = input.length_mm, n = input.nSegments ?? 1;
    const gates = [];
    // 최소치수 (표 4.1-6(a) 원문: t<6→3, 6≤t<13→5, 13≤t<20→6, 20≤t→8)
    if (Number(input.tThin_mm) > 0) {
      const t = input.tThin_mm;
      const sMin = t < 6 ? 3 : t < 13 ? 5 : t < 20 ? 6 : 8;
      gates.push({ gate: '최소치수(표 4.1-6a)', value: s, limit: sMin, pass: s >= sMin });
    }
    // 겹침 최대치수 (§(2): t<6 → s≤t / t≥6 → s≤t−2)
    if (input.lapJoint && Number(input.tEdge_mm) > 0) {
      const te = input.tEdge_mm;
      const sMax = te < 6 ? te : te - 2;
      gates.push({ gate: '겹침 최대치수(§4.1.2.2.2(2))', value: s, limit: sMax, pass: s <= sMax });
    }
    // 최소길이 4s (§(3)) — 세그먼트당
    const segL = L / n;
    gates.push({ gate: '최소길이 4s(§(3))', value: +segL.toFixed(0), limit: 4 * s, pass: segL >= 4 * s });
    // 유효길이: 세그먼트당 −2s + 장대 감소 (식 4.1-1 — 단부 길이방향 용접)
    let Le = 0, beta = 1.0, longNote = '';
    const applyBeta = input.endLoaded !== false;
    for (let i = 0; i < n; i++) {
      let li = segL - 2 * s;
      if (li <= 0) throw new Error('input gate: 세그먼트 길이가 2s 이하 — 유효길이 0');
      if (applyBeta) {
        const ratio = li / s;
        if (ratio > 300) { li = 180 * s; longNote = 'L>300s → Le=180s (§(5))'; }
        else if (ratio > 100) { beta = Math.min(1.0, 1.2 - 0.002 * ratio); li *= beta; longNote = `β=${beta.toFixed(3)} (식 4.1-1)`; }
      }
      Le += li;
    }
    const Ae = 0.7 * s * Le; // §4.1.2.2.1(3) 원문 "0.7배"
    const phiRn = (0.75 * 0.60 * input.FEXX_MPa * Ae) / 1000; // kN — 표 4.1-8
    const ratio = input.demandP_kN > 0 ? input.demandP_kN / phiRn : null;
    const gatesPass = gates.every((g) => g.pass);
    const strengthPass = ratio === null || ratio <= 1;
    const r1 = (v) => +v.toFixed(1);
    return {
      verdict: gatesPass && strengthPass ? 'PASS' : 'FAIL',
      checks: {
        strength: { phiRn_kN: r1(phiRn), demand_kN: input.demandP_kN, ratio: ratio !== null ? +ratio.toFixed(3) : null, pass: strengthPass },
        gates,
      },
      intermediate: { Le_mm: r1(Le), Ae_mm2: r1(Ae), throat_mm: r1(0.7 * s), ...(longNote ? { longWeld: longNote } : {}) },
      notes: [
        `φRn = 0.75×0.60×${input.FEXX_MPa}×${Ae.toFixed(0)} = ${phiRn.toFixed(1)}kN (표 4.1-8 건축 — 용접재 파단).`,
        '유효목 0.7s(KDS 원문 — AISC 0.707 아님)·유효길이 L−2s/세그먼트. 방향성 증가 미적용(KDS 표 미포함 — 보수 명시).',
        '모재 인장·전단 파단(§4.1.4)·용접군 편심(순간중심법)·토목 기준(표 4.1-7)·비파괴시험 면제 시 50% 저감(§4.1.2.4(4))은 별도/후속.',
      ],
    };
  },
};
