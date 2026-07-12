/**
 * P1 가설·랙·경량철골 — 압축재 좌굴 검토 (AISC 360 §E3 / KDS 14 31 10 동형식, 파라미터 분기).
 * Fe=π²E/(KL/r)²; KL/r ≤ 4.71√(E/Fy) → Fcr=0.658^(Fy/Fe)·Fy, 아니면 Fcr=0.877Fe.
 * 근거 코퍼스(수집완료): FHWA SBDH Vol.4 (부재 거동), Vol.13 (브레이싱·유효좌굴).
 */
export default {
  id: 'column_buckling',
  domain: 'temporary-structures/steel',
  title: '압축재 좌굴 검토 (기둥·랙 포스트·동바리)',
  description: '휨좌굴 한계상태의 압축강도 산정 및 소요축력 판정. LRFD(φPn)·ASD 병기. 세장비 게이트 KL/r ≤ 200.',
  refs: [
    'AISC 360-16 §E3 (파라미터: standards/aisc360.json)',
    'KDS 14 31 10 (원문 확보 대기 — standards/kds.json draft)',
    'FHWA SBDH Vol.4/13 (RAG 코퍼스 수록)',
  ],
  status: '검증 — 손계산 앵커(KL/r·Fe) N-version 대조 통과. 휨좌굴만(비틀림·국부 미포함) · 비법정 참고(공표예제 확충중)',
  inputSchema: {
    type: 'object',
    required: ['Fy', 'Ag', 'L', 'r', 'Pu'],
    properties: {
      Fy: { type: 'number', minimum: 200, maximum: 700, description: '항복강도 MPa' },
      E: { type: 'number', minimum: 190000, maximum: 215000, description: '탄성계수 MPa (기본: 표준값)' },
      Ag: { type: 'number', exclusiveMinimum: 0, description: '총단면적 mm²' },
      L: { type: 'number', exclusiveMinimum: 0, description: '비지지 길이 mm' },
      K: { type: 'number', minimum: 0.5, maximum: 2.4, description: '유효좌굴계수 (기본 1.0)' },
      r: { type: 'number', exclusiveMinimum: 0, description: '단면회전반경 mm (약축)' },
      Pu: { type: 'number', minimum: 0, description: '소요축력 kN (LRFD 계수하중)' },
    },
  },
  run(input, std) {
    const s = std.steel;
    const E = input.E ?? s.E_MPa;
    const K = input.K ?? 1.0;
    const { Fy, Ag, L, r, Pu } = input;
    const slenderness = (K * L) / r;
    if (slenderness > 200) throw new Error(`slenderness gate: KL/r=${slenderness.toFixed(1)} > 200 (압축재 권장한계 초과 — 단면/지지 재검토)`);

    const Fe = (Math.PI ** 2 * E) / slenderness ** 2;
    const limit = s.slenderness_inelastic_limit_coef * Math.sqrt(E / Fy);
    const inelastic = slenderness <= limit;
    const Fcr = inelastic ? Math.pow(s.inelastic_exponent_base, Fy / Fe) * Fy : s.elastic_buckling_coef * Fe;
    const Pn_kN = (Fcr * Ag) / 1000;
    const phiPn = s.phi_compression * Pn_kN;
    const PnOverOmega = Pn_kN / 1.67;
    const ratio = Pu > 0 ? Pu / phiPn : 0;

    return {
      inputsEcho: { ...input, E, K },
      intermediate: {
        slenderness_KLr: slenderness,
        limit_471_sqrtEFy: limit,
        branch: inelastic ? 'inelastic (KL/r ≤ 4.71√(E/Fy))' : 'elastic',
        Fe_MPa: Fe,
        Fcr_MPa: Fcr,
      },
      checks: {
        capacity_LRFD: { phiPn_kN: phiPn, Pu_kN: Pu, ratio, pass: Pu <= phiPn },
        capacity_ASD_ref: { PnOverOmega_kN: PnOverOmega },
      },
      verdict: Pu <= phiPn ? 'PASS' : 'FAIL',
      notes: ['휨좌굴만 검토 — 비틀림좌굴(§E4)·국부좌굴(세장판요소)은 미포함, 해당 단면은 별도 확인'],
    };
  },
};
