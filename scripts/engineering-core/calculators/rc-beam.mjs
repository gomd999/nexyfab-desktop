/**
 * P3 건축 — RC 직사각형 단철근 보 검토 (휨 + 전단, 강도설계법).
 *
 * 전 계수 KDS 원문 대조 완료(2026-07-12, standards/kds.json rc._verified_note):
 *  - 휨: 변형률 적합 + 힘 평형을 중립축 c에 대한 이분법으로 정해 — 등가응력블록
 *    η(0.85fck)·β1(표 4.1-2, β1=0.80 — ACI와 다름), εcu=0.0033(fck≤40)
 *  - φ: 인장지배 0.85 / 압축지배 0.65 / 변화구간 선형보간 (KDS 14 20 10 §4.2.3)
 *  - 연성 게이트: 휨부재 최소허용변형률 0.004(fy≤400)/2εy (§4.1.2(5))
 *  - 전단: Vc=(1/6)λ√fck·bw·d, Vs=Av·fyt·d/s ≤ 0.2(1−fck/250)fck·bw·d,
 *    Av,min·간격(d/2·600·절반규정) — KDS 14 20 22
 * 재료계수 방식(부록)이 아닌 본문 강도감소계수 방식. AISC/AASHTO 미지원(rc 파라미터 없음).
 */
const interp = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1];
};

export default {
  id: 'rc_beam',
  domain: 'concrete/building',
  title: 'RC 보 검토 (휨·전단, 강도설계법)',
  description: '직사각형 단철근 보. 변형률 적합 이분법 정해 + KDS 등가응력블록(η·β1 표 4.1-2). 압축철근·T형 플랜지·비틀림 미포함.',
  refs: [
    'KDS 14 20 20 §4.1.1(표 4.1-2 η·β1·εcu)·§4.1.2(지배단면·최소허용변형률)',
    'KDS 14 20 10 §4.2.3(2) 강도감소계수·식(4.3-5) Es=200,000',
    'KDS 14 20 22 식(4.2-1) Vc·식(4.3-3) Vs·§4.3.2 간격·§4.3.3 Av,min·§4.3.4(9) Vs 상한',
  ],
  status: 'draft — 골든벤치 수계산 대조, 공인 공표예제 재현 대기(§7.0 게이트). 단철근·직사각형 한정',
  inputSchema: {
    type: 'object',
    required: ['b', 'd', 'fck', 'fy', 'As', 'Mu'],
    properties: {
      b: { type: 'number', exclusiveMinimum: 0, maximum: 3000, description: '단면 폭 bw, mm' },
      d: { type: 'number', exclusiveMinimum: 0, maximum: 3000, description: '유효깊이, mm' },
      fck: { type: 'number', minimum: 18, maximum: 90, description: '콘크리트 설계기준압축강도 MPa' },
      fy: { type: 'number', minimum: 300, maximum: 600, description: '철근 설계기준항복강도 MPa' },
      As: { type: 'number', exclusiveMinimum: 0, description: '인장철근 단면적 mm²' },
      Mu: { type: 'number', exclusiveMinimum: 0, description: '계수휨모멘트 kN·m' },
      Vu: { type: 'number', minimum: 0, description: '계수전단력 kN (0/생략=전단 검토 생략)' },
      Av: { type: 'number', minimum: 0, description: '전단철근 단면적(간격 s 내 전 가닥) mm²' },
      s: { type: 'number', exclusiveMinimum: 0, description: '전단철근 간격 mm' },
      fyt: { type: 'number', minimum: 300, maximum: 600, description: '전단철근 항복강도 MPa (기본 fy)' },
      lambda: { type: 'number', minimum: 0.75, maximum: 1.0, description: '경량콘크리트계수 λ (기본 1.0)' },
    },
  },
  run(input, std) {
    const rc = std.rc;
    if (!rc) throw new Error(`standard gate: '${std.id}'에 rc 파라미터 미탑재 — 이 계산기는 KDS만 지원`);
    const { b, d, fck, fy, As, Mu } = input;
    const Vu = input.Vu ?? 0;
    const lam = input.lambda ?? 1.0;
    const fyt = input.fyt ?? fy;
    const Es = rc.Es_MPa;

    // ── 응력블록 변수 (표 4.1-2, fck≤40 상수 / 40~90 표 보간) ──
    const T = rc.stress_block_table;
    const epsCu = interp(T.fck, T.eps_cu, fck);
    const eta = interp(T.fck, T.eta, fck);
    const beta1 = interp(T.fck, T.beta1, fck);
    const epsY = fy / Es;

    // ── 휨: 변형률 적합 + 힘 평형, 중립축 c 이분법 (철근 항복/미항복 모두 정해) ──
    const tension = (c) => As * Math.min(fy, Math.max(-fy, Es * epsCu * ((d - c) / c)));
    const compression = (c) => eta * 0.85 * fck * b * beta1 * c;
    let lo = 1e-6, hi = 10 * d;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (compression(mid) - tension(mid) > 0) hi = mid;
      else lo = mid;
    }
    const c = (lo + hi) / 2;
    const a = beta1 * c;
    const epsT = epsCu * ((d - c) / c); // 최외단 인장철근(=d 가정) 순인장변형률
    const fs = Math.min(fy, Math.max(-fy, Es * epsT));
    const Mn = (As * fs * (d - a / 2)) / 1e6; // kN·m

    // φ: 인장지배/압축지배/변화구간 (KDS 14 20 10 §4.2.3(2))
    const epsTcl = fy <= 400 ? rc.tension_ctrl_strain_fy_le400 : rc.tension_ctrl_eps_y_mult_fy_gt400 * epsY;
    const phiC = rc.phi_compression_other; // 나선철근 보는 비현실 — 기타 0.65
    let phi, section;
    if (epsT >= epsTcl) { phi = rc.phi_tension; section = '인장지배'; }
    else if (epsT <= epsY) { phi = phiC; section = '압축지배'; }
    else { phi = phiC + (rc.phi_tension - phiC) * ((epsT - epsY) / (epsTcl - epsY)); section = '변화구간'; }
    const phiMn = phi * Mn;

    // 연성 게이트: 휨부재 최소허용변형률 (§4.1.2(5))
    const epsMin = fy <= 400 ? rc.min_flex_strain_fy_le400 : rc.min_flex_eps_y_mult_fy_gt400 * epsY;

    const checks = {
      ductility: {
        eps_t: epsT, min_allowed: epsMin, section,
        pass: epsT >= epsMin,
      },
      flexure: {
        Mn_kNm: Mn, phi, phiMn_kNm: phiMn, ratio: Mu / phiMn, pass: Mu <= phiMn && epsT >= epsMin,
      },
    };
    const intermediate = { c_mm: c, a_mm: a, eps_cu: epsCu, eta, beta1, eps_t: epsT, fs_MPa: fs, eps_y: epsY, eps_tcl: epsTcl };
    const notes = [
      '단철근 직사각형 단면 — 압축철근·T형 플랜지 기여 미포함(보수측)',
      '최외단 인장철근 위치 dt=d 가정 (1단 배근)',
      '최소철근(φMn≥1.2Mcr, KDS 14 20 30 필요)·처짐·균열 검토는 본 계산기 범위 외',
    ];

    // ── 전단 (Vu>0일 때) ──
    if (Vu > 0) {
      const sqrtFck = Math.sqrt(fck);
      const Vc = (lam * sqrtFck * b * d) / rc.Vc_coef_inv / 1e3; // kN
      let Vs = 0;
      const hasStirrup = (input.Av ?? 0) > 0 && (input.s ?? 0) > 0;
      const shear = { Vc_kN: Vc };
      if (hasStirrup) {
        const { Av, s } = input;
        Vs = (Av * fyt * d) / s / 1e3;
        const VsMax = (rc.Vs_max_coef * (1 - fck / rc.Vs_max_fck_denom) * fck * b * d) / 1e3;
        const AvMin = Math.max(rc.Av_min_sqrt_coef * sqrtFck, rc.Av_min_floor_coef) * ((b * s) / fyt);
        let sMax = Math.min(rc.stirrup_spacing_d_ratio * d, rc.stirrup_spacing_max_mm);
        const VsHalveLimit = (lam * sqrtFck * b * d) / rc.spacing_halve_Vs_sqrt_coef_inv / 1e3;
        if (Vs > VsHalveLimit) sMax /= 2;
        Object.assign(shear, {
          Vs_kN: Vs, Vs_max_kN: VsMax, VsWithinMax: Vs <= VsMax,
          Av_mm2: Av, Av_min_mm2: AvMin, AvOk: Av >= AvMin,
          s_mm: s, s_max_mm: sMax, spacingOk: s <= sMax,
        });
        if (Vs > VsMax) Vs = VsMax; // 상한 초과분 불인정 (§4.3.4(9))
      }
      const phiVn = rc.phi_shear * (Vc + Vs);
      const minStirrupNeeded = Vu > 0.5 * rc.phi_shear * Vc && !hasStirrup;
      Object.assign(shear, {
        phiVn_kN: phiVn, ratio: Vu / phiVn,
        pass: Vu <= phiVn && !minStirrupNeeded
          && (shear.VsWithinMax ?? true) && (shear.AvOk ?? true) && (shear.spacingOk ?? true),
      });
      if (minStirrupNeeded) notes.push('Vu > ½φVc — 최소 전단철근 배치 필요(KDS 14 20 22 §4.3.3), 스터럽 입력 없음 → FAIL');
      checks.shear = shear;
    }

    return {
      inputsEcho: { ...input, Vu, lambda: lam, fyt },
      intermediate,
      checks,
      verdict: Object.values(checks).every((ch) => ch.pass) ? 'PASS' : 'FAIL',
      notes,
    };
  },
};
