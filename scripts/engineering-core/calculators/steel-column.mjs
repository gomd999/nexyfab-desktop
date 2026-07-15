/**
 * P18 건축/교량 — 강재 기둥 (휨좌굴 — KDS 14 31 10 §4.2.3 원문 판독).
 * Pn = Fcr·Ag (4.2-1) · KL/r ≤ 4.71√(E/Fy) → Fcr = 0.658^(Fy/Fe)·Fy (4.2-2)
 * · 초과 → Fcr = 0.877·Fe (4.2-3) · Fe = π²E/(KL/r)² (4.2-4) · φc = 0.90(원문).
 * 세장비 제한: 건축 200 관례 권고·교량 주부재/가새(§4.2.2(2) — 한계값 GIF, 120/140
 *   관례로 알려짐 — 원문 수치 미판독 시 입력 원칙) → 기본 200 경고 게이트만.
 * 앵커: KL/r=0 → Fcr=Fy · 경계 4.71√(E/Fy)에서 두 식 연속(0.390Fy) — 폐형 자체검증.
 * column_buckling(오일러·AISC구식)과 별도 — 본 계산기가 KDS 원문 확정판.
 */
export default {
  id: 'steel_column',
  domain: 'architecture/steel',
  title: '강재 기둥 (휨좌굴 — KDS 원문)',
  description: 'Fcr 2구간(0.658^λ·0.877Fe)·φc0.90 — 비세장판 단면 한정.',
  refs: ['KDS 14 31 10:2024 §4.2.3 식4.2-1~4·φc0.90·경계 4.71√(E/Fy) — 원문 GIF 판독'],
  status: 'verified — 원문 계수 + 경계 연속성 앵커(0.390Fy). 비틀림좌굴·세장판(§4.2.7)·조합력은 후속',
  inputSchema: {
    type: 'object',
    required: ['Ag_mm2', 'r_mm', 'K', 'L_mm', 'Fy_MPa', 'Pu_kN'],
    properties: {
      Ag_mm2: { type: 'number', exclusiveMinimum: 0, description: '총단면적' },
      r_mm: { type: 'number', exclusiveMinimum: 0, description: '지배축 회전반경 (min(rx,ry) 통상)' },
      K: { type: 'number', minimum: 0.5, maximum: 2.4, description: '유효길이계수 (표 4.2-3 — 지지조건 판단 입력)' },
      L_mm: { type: 'number', exclusiveMinimum: 0, description: '비지지길이' },
      Fy_MPa: { type: 'number', minimum: 235, maximum: 460, description: '항복강도' },
      E_MPa: { type: 'number', minimum: 190000, maximum: 215000, description: '탄성계수 (기본 205,000)' },
      Pu_kN: { type: 'number', exclusiveMinimum: 0, description: '계수축력' },
      slenderLimit: { type: 'number', minimum: 100, maximum: 250, description: '세장비 한계 (기본 200 건축 관례 — 교량 주부재/가새는 발주·원문 확인 입력)' },
    },
  },
  run(input) {
    const E = input.E_MPa ?? 205000;
    const { Ag_mm2: Ag, r_mm: r, K, L_mm: L, Fy_MPa: Fy } = input;
    const KLr = (K * L) / r;
    const limS = input.slenderLimit ?? 200;
    if (KLr > limS) throw new Error(`input gate: KL/r=${KLr.toFixed(0)} > ${limS} — 세장비 한계 초과(관례 게이트 — 발주 기준 확인)`);
    const Fe = (Math.PI * Math.PI * E) / (KLr * KLr);
    const bound = 4.71 * Math.sqrt(E / Fy);
    const inelastic = KLr <= bound;
    const Fcr = inelastic ? Math.pow(0.658, Fy / Fe) * Fy : 0.877 * Fe;
    const phiPn = (0.9 * Fcr * Ag) / 1000; // kN
    const ratio = input.Pu_kN / phiPn;
    return {
      verdict: ratio <= 1 ? 'PASS' : 'FAIL',
      checks: { compression: { KLr: +KLr.toFixed(1), Fe_MPa: +Fe.toFixed(1), Fcr_MPa: +Fcr.toFixed(1), phiPn_kN: +phiPn.toFixed(1), Pu_kN: input.Pu_kN, ratio: +ratio.toFixed(3), pass: ratio <= 1, regime: inelastic ? `비탄성(KL/r≤4.71√(E/Fy)=${bound.toFixed(1)}) — 0.658^(Fy/Fe)·Fy` : '탄성 — 0.877Fe' } },
      intermediate: { phiC: 0.9, E, bound: +bound.toFixed(1) },
      notes: [
        `Fcr=${Fcr.toFixed(1)}MPa (식4.2-${inelastic ? 2 : 3}) → φPn=${phiPn.toFixed(0)}kN (φc 0.90 원문).`,
        'K=표 4.2-3 판단 입력. 비세장판 단면 한정(세장판 §4.2.7·비틀림좌굴 §4.2.4·보-기둥 조합력 후속).',
      ],
    };
  },
};
