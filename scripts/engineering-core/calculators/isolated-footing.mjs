/**
 * P3 건축/토목 — 독립기초 검토 (지지력·뚫림전단·1방향 전단).
 *
 * 뚫림전단 = KDS 14 20 22 §4.11 **2021 신형 성능식** (구 ACI 3식-min 아님!):
 *   vc = λ·ks·kbo·fte·cotψ·(cu/d)                    (식 4.11-1, 이미지 판독)
 *   ks = (300/d)^0.25 ≤ 1.1 (하한 0.75)               (식 4.11-3)
 *   kbo = 4/√(αs·b0/d) ≤ 1.25  (αs 내부1.0/외부1.33/모서리2.0)
 *   fte = 0.2√fck (4.11-5) · fcc = (2/3)fck (4.11-6)
 *   cotψ = √(fte(fte+fcc))/fte
 *   cu = d[25√(ρ/fck) − 300(ρ/fck)], ρ∈[0.005,0.03]  (식 4.11-7)
 *   Vn ≤ 0.58·fck·b0·cu                               (§4.11.2(5))
 * 기초판 특례: 기둥면 0.75d 내 지반반력 무시 가능 (§4.11.2(6)) — 하중 공제에 적용.
 * 1방향 전단 = 보 Vc=(1/6)λ√fck·b·d (§4.11.1(2)→4.1~4.3). 중심 축하중 가정.
 */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default {
  id: 'isolated_footing',
  domain: 'concrete/building/civil',
  title: '독립기초 검토 (지지력·뚫림전단·1방향 전단)',
  description: '직사각형 독립기초 + 중심 축하중. 뚫림전단은 KDS 2021 신형 성능식(압축대 모델). 편심·모멘트 재하는 범위 외.',
  refs: [
    'KDS 14 20 22 §4.11.2 식(4.11-1~7) 뚫림전단 성능식·(5) Vn≤0.58fck·b0·cu·(6) 기초판 0.75d 공제',
    'KDS 14 20 22 식(4.2-1) 1방향 Vc · KDS 14 20 10 §4.2.3(2) φ=0.75',
  ],
  status: 'draft — 골든벤치 수계산 대조. 중심하중·직사각형 한정, 휨철근 설계는 rc_beam 연계',
  inputSchema: {
    type: 'object',
    required: ['B', 'L', 't', 'd', 'cb', 'cl', 'Pu', 'Pservice', 'qAllow', 'fck'],
    properties: {
      B: { type: 'number', exclusiveMinimum: 0, maximum: 10000, description: '기초 폭 mm' },
      L: { type: 'number', exclusiveMinimum: 0, maximum: 10000, description: '기초 길이 mm' },
      t: { type: 'number', exclusiveMinimum: 0, maximum: 2000, description: '기초 두께 mm' },
      d: { type: 'number', exclusiveMinimum: 0, maximum: 2000, description: '유효깊이 mm (t−피복−철근)' },
      cb: { type: 'number', exclusiveMinimum: 0, description: '기둥 폭 mm (B 방향)' },
      cl: { type: 'number', exclusiveMinimum: 0, description: '기둥 깊이 mm (L 방향)' },
      Pu: { type: 'number', exclusiveMinimum: 0, description: '계수축하중 kN (전단 검토)' },
      Pservice: { type: 'number', exclusiveMinimum: 0, description: '사용축하중 kN (지지력 검토)' },
      qAllow: { type: 'number', exclusiveMinimum: 0, description: '허용지지력 kPa' },
      fck: { type: 'number', minimum: 18, maximum: 90, description: '콘크리트 강도 MPa' },
      rho: { type: 'number', minimum: 0.001, maximum: 0.05, description: '기초판 평균 주인장철근비 (기본 0.005 — 식 4.11-7 하한)' },
      columnPosition: { type: 'string', enum: ['interior', 'edge', 'corner'], description: '기둥 위치 (αs: 1.0/1.33/2.0, 기본 interior)' },
      lambda: { type: 'number', minimum: 0.75, maximum: 1.0, description: '경량콘크리트계수 (기본 1.0)' },
      soilDepth: { type: 'number', minimum: 0, description: '기초 상부 흙 두께 mm (기본 0)' },
      gammaSoil: { type: 'number', minimum: 10, maximum: 24, description: '흙 단위중량 kN/m³ (기본 18)' },
    },
  },
  run(input, std) {
    const rc = std.rc;
    if (!rc) throw new Error(`standard gate: '${std.id}'에 rc 파라미터 미탑재 — 이 계산기는 KDS만 지원`);
    const { B, L, t, d, cb, cl, Pu, Pservice, qAllow, fck } = input;
    if (d >= t) throw new Error('geometry gate: 유효깊이 d는 두께 t보다 작아야 함');
    if (cb >= B || cl >= L) throw new Error('geometry gate: 기둥이 기초보다 큼');
    const lam = input.lambda ?? 1.0;
    const rho = clamp(input.rho ?? 0.005, 0.005, 0.03); // 식 4.11-7 적용 범위
    const alphaS = { interior: 1.0, edge: 1.33, corner: 2.0 }[input.columnPosition ?? 'interior'];
    const phiV = rc.phi_shear;

    // ── 1. 지지력 (사용하중 + 자중 + 상재토) ──
    const A_m2 = (B * L) / 1e6;
    const Wself = A_m2 * (t / 1000) * 24; // kN (γc=24)
    const Wsoil = A_m2 * ((input.soilDepth ?? 0) / 1000) * (input.gammaSoil ?? 18);
    const q = (Pservice + Wself + Wsoil) / A_m2; // kPa
    const bearing = { q_kPa: q, allow_kPa: qAllow, Wself_kN: Wself, Wsoil_kN: Wsoil, ratio: q / qAllow, pass: q <= qAllow };

    // ── 2. 뚫림전단 (신형 성능식) ──
    const qu = (Pu * 1e3) / (B * L); // N/mm² (순반력 — 자중은 지반반력과 상쇄)
    const b0 = 2 * (cb + d) + 2 * (cl + d);
    const ks = clamp((300 / d) ** 0.25, 0.75, 1.1);
    const kbo = Math.min(4 / Math.sqrt((alphaS * b0) / d), 1.25);
    const fte = 0.2 * Math.sqrt(fck);
    const fcc = (2 / 3) * fck;
    const cotPsi = Math.sqrt(fte * (fte + fcc)) / fte;
    const cu = d * (25 * Math.sqrt(rho / fck) - 300 * (rho / fck));
    const vc = lam * ks * kbo * fte * cotPsi * (cu / d); // N/mm²
    const Vc = (vc * b0 * d) / 1e3; // kN
    const VnMax = (0.58 * fck * b0 * cu) / 1e3; // kN (§4.11.2(5))
    const VcGoverned = Math.min(Vc, VnMax);
    // 하중: 기둥면 0.75d 내 지반반력 무시 가능 (§4.11.2(6)) → 공제폭 cb+1.5d
    const dedW = Math.min(cb + 1.5 * d, B);
    const dedL = Math.min(cl + 1.5 * d, L);
    const VuP = (qu * (B * L - dedW * dedL)) / 1e3; // kN
    const phiVnP = phiV * VcGoverned;
    const punching = {
      b0_mm: b0, ks, kbo, fte_MPa: fte, cotPsi, cu_mm: cu, vc_MPa: vc,
      Vc_kN: Vc, VnMax_kN: VnMax, cappedByVnMax: Vc > VnMax,
      Vu_kN: VuP, phiVn_kN: phiVnP, ratio: VuP / phiVnP, pass: VuP <= phiVnP,
    };

    // ── 3. 1방향 전단 (양방향 중 지배, 위험단면 = 기둥면에서 d) ──
    const Vc1coef = (lam * Math.sqrt(fck)) / rc.Vc_coef_inv; // N/mm²
    const armL = (L - cl) / 2 - d; // L방향 캔틸레버 잔여
    const armB = (B - cb) / 2 - d;
    const dirs = [];
    if (armL > 0) dirs.push({ dir: 'L', Vu: (qu * B * armL) / 1e3, phiVc: (phiV * Vc1coef * B * d) / 1e3 });
    if (armB > 0) dirs.push({ dir: 'B', Vu: (qu * L * armB) / 1e3, phiVc: (phiV * Vc1coef * L * d) / 1e3 });
    let oneWay;
    if (dirs.length === 0) {
      oneWay = { note: '위험단면(기둥면+d)이 기초 밖 — 1방향 전단 비지배', pass: true };
    } else {
      const gov = dirs.reduce((a, b) => (a.Vu / a.phiVc > b.Vu / b.phiVc ? a : b));
      oneWay = { governingDir: gov.dir, Vu_kN: gov.Vu, phiVc_kN: gov.phiVc, ratio: gov.Vu / gov.phiVc, pass: gov.Vu <= gov.phiVc };
    }

    const checks = { bearing, punching, oneWayShear: oneWay };
    return {
      inputsEcho: { ...input, rho, columnPosition: input.columnPosition ?? 'interior', lambda: lam },
      intermediate: { qu_net_MPa: qu, alphaS },
      checks,
      verdict: Object.values(checks).every((c) => c.pass) ? 'PASS' : 'FAIL',
      notes: [
        '중심 축하중 가정 — 편심·모멘트 재하(사다리꼴 반력)는 범위 외',
        '뚫림전단은 KDS 2021 신형 성능식 — ρ(주인장철근비)가 강도에 직접 기여, 배근 확정 후 재검토 권장',
        '휨철근 산정·정착은 rc_beam 및 KDS 14 20 52 연계 별도 검토',
        '지지력은 총응력(자중+상재 포함) 검토 / 전단은 순반력(qu=Pu/A) 기준',
      ],
    };
  },
};
