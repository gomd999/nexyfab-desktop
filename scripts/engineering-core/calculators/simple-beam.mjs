/**
 * P1/P3 공용 — 단순보 검토 (등분포 w + 중앙 집중 P): 휨·전단·처짐.
 * 허용응력 방식(ASD 관행): Fb=0.66Fy, Fv=0.4Fy — 계수는 standards/*.json에서 튜닝.
 * M=wL²/8+PL/4, V=wL/2+P/2, δ=5wL⁴/384EI+PL³/48EI (정역학 폐형식 — 저작권 무관).
 */
export default {
  id: 'simple_beam',
  domain: 'steel/building',
  title: '단순보 검토 (휨·전단·처짐)',
  description: '단순지지 보, 등분포+중앙집중 하중. 콤팩트 단면·충분한 횡지지 가정(LTB 미검토 게이트 명시).',
  refs: [
    'AISC 360-16 §F2 / KDS 14 31 10(대기) — 허용휨 0.66Fy 관행',
    'FHWA SBDH Vol.4 (RAG 코퍼스 수록)',
  ],
  status: '검증 — 손계산 앵커(M·V) N-version 대조 통과. LTB(횡좌굴) 미포함 · 비법정 참고(공표예제 확충중)',
  inputSchema: {
    type: 'object',
    required: ['L', 'Fy', 'Sx', 'Aw', 'Ix'],
    properties: {
      L: { type: 'number', exclusiveMinimum: 0, maximum: 30000, description: '지간 mm' },
      w: { type: 'number', minimum: 0, description: '등분포하중 kN/m (기본 0)' },
      P: { type: 'number', minimum: 0, description: '중앙 집중하중 kN (기본 0)' },
      Fy: { type: 'number', minimum: 200, maximum: 700, description: '항복강도 MPa' },
      E: { type: 'number', minimum: 190000, maximum: 215000, description: '탄성계수 MPa (기본: 표준값)' },
      Sx: { type: 'number', exclusiveMinimum: 0, description: '단면계수 mm³' },
      Aw: { type: 'number', exclusiveMinimum: 0, description: '웨브 전단면적 mm² (d×tw)' },
      Ix: { type: 'number', exclusiveMinimum: 0, description: '단면2차모멘트 mm⁴' },
      deflectionLimit: { type: 'number', minimum: 100, maximum: 1000, description: '처짐한계 분모 n (L/n), 기본: 표준값' },
    },
  },
  run(input, std) {
    const s = std.steel;
    const E = input.E ?? s.E_MPa;
    const w = input.w ?? 0; // kN/m
    const P = input.P ?? 0; // kN
    if (w === 0 && P === 0) throw new Error('load gate: w와 P가 모두 0 — 검토할 하중 없음');
    const n = input.deflectionLimit ?? std.serviceability.deflection_limit_denominator_default;
    const { L, Fy, Sx, Aw, Ix } = input;

    const L_m = L / 1000;
    const M = (w * L_m ** 2) / 8 + (P * L_m) / 4; // kNm
    const V = (w * L_m) / 2 + P / 2; // kN
    // deflection in mm: w [kN/m]=[N/mm], P[kN]→N
    const w_Nmm = w; // kN/m == N/mm
    const delta = (5 * w_Nmm * L ** 4) / (384 * E * Ix) + (P * 1000 * L ** 3) / (48 * E * Ix);

    const sigma = (M * 1e6) / Sx; // MPa
    const tau = (V * 1e3) / Aw; // MPa
    const Fb = s.allowable_bending_ratio_ASD * Fy;
    const Fv = s.allowable_shear_ratio_ASD * Fy;
    const dLimit = L / n;

    const checks = {
      bending: { sigma_MPa: sigma, allow_MPa: Fb, ratio: sigma / Fb, pass: sigma <= Fb },
      shear: { tau_MPa: tau, allow_MPa: Fv, ratio: tau / Fv, pass: tau <= Fv },
      deflection: { delta_mm: delta, limit_mm: dLimit, limitSpec: `L/${n}`, ratio: delta / dLimit, pass: delta <= dLimit },
    };
    return {
      inputsEcho: { ...input, E, w, P, deflectionLimit: n },
      intermediate: { Mmax_kNm: M, Vmax_kN: V },
      checks,
      verdict: Object.values(checks).every((c) => c.pass) ? 'PASS' : 'FAIL',
      notes: ['콤팩트 단면+연속 횡지지 가정 — LTB 지배 구간(Lb 큰 경우)은 본 계산기 적용 불가', '사용하중(비계수) 기준 ASD 검토'],
    };
  },
};
