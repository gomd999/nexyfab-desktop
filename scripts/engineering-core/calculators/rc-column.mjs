/**
 * P3 건축 — RC 직사각형 기둥 P-M 상관 검토 (2면 등배근, 강도설계법).
 *
 * 방법: 변형률 적합 — 주어진 하중 편심 e=Mu/Pu의 하중경로를 따라 중립축 c를
 * 이분법으로 정해, 그 편심에서의 (φPn, φMn)와 대조. 결정론(도표 근사 아님).
 * 전 계수 KDS 원문 대조(2026-07-12):
 *  - 응력블록 η·β1·εcu = rc_beam과 동일 (표 4.1-2)
 *  - φPn(max): 띠 0.80φ[0.85fck(Ag−Ast)+fy·Ast] / 나선 0.85φ[…] (식 4.1-17/16)
 *  - 철근비 0.01 ≤ ρ ≤ 0.08 (KDS 14 20 20 §4.3.2(1))
 *  - φ: 압축지배 0.65(띠)/0.70(나선)·변화구간 보간·인장지배 0.85 (14 20 10 §4.2.3)
 * 한계: 2면 등배근·단일 곡률 1축 휨. 장주효과(§4.4 모멘트 증대)는 입력 Mu에
 * 반영돼 있다고 가정 — 세장 기둥은 증대 후 모멘트를 넣을 것.
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
  id: 'rc_column_pm',
  domain: 'concrete/building',
  title: 'RC 기둥 P-M 상관 검토 (1축 휨+축력)',
  description: '직사각형 띠/나선 기둥, 2면 등배근. 하중 편심 경로에서 변형률 적합 이분법으로 (φPn,φMn) 정해 후 대조.',
  refs: [
    'KDS 14 20 20 §4.1.1(표 4.1-2)·§4.1.2(7) 식(4.1-16/17) φPn(max)·§4.3.2(1) 철근비 0.01~0.08',
    'KDS 14 20 10 §4.2.3(2) 강도감소계수 (압축지배 0.65 띠/0.70 나선)',
  ],
  status: 'verified — 원문 계수 대조 + 공표예제 재현(StructurePoint P-M 공칭 Po·εs=0점 ≤0.5%, φ는 KDS 적용)',
  inputSchema: {
    type: 'object',
    required: ['b', 'h', 'fck', 'fy', 'Ast', 'Pu', 'Mu'],
    properties: {
      b: { type: 'number', exclusiveMinimum: 0, maximum: 3000, description: '단면 폭 mm (휨축 직각)' },
      h: { type: 'number', exclusiveMinimum: 0, maximum: 3000, description: '단면 깊이 mm (휨 방향)' },
      dPrime: { type: 'number', minimum: 30, maximum: 200, description: '연단~철근중심 거리 mm (기본 60)' },
      fck: { type: 'number', minimum: 18, maximum: 90, description: '콘크리트 강도 MPa' },
      fy: { type: 'number', minimum: 300, maximum: 600, description: '철근 항복강도 MPa' },
      Ast: { type: 'number', exclusiveMinimum: 0, description: '축방향 주철근 총단면적 mm² (2면 균등 분할 가정)' },
      Pu: { type: 'number', exclusiveMinimum: 0, description: '계수축력 kN (압축)' },
      Mu: { type: 'number', minimum: 0, description: '계수휨모멘트 kN·m (장주효과 반영 후)' },
      transverse: { type: 'string', enum: ['tied', 'spiral'], description: '횡철근 형식 (기본 tied)' },
    },
  },
  run(input, std) {
    const rc = std.rc;
    if (!rc) throw new Error(`standard gate: '${std.id}'에 rc 파라미터 미탑재 — 이 계산기는 KDS만 지원`);
    const { b, h, fck, fy, Ast, Pu, Mu } = input;
    const dP = input.dPrime ?? 60;
    const spiral = (input.transverse ?? 'tied') === 'spiral';
    const Es = rc.Es_MPa;
    const T = rc.stress_block_table;
    const epsCu = interp(T.fck, T.eps_cu, fck);
    const eta = interp(T.fck, T.eta, fck);
    const beta1 = interp(T.fck, T.beta1, fck);
    const epsY = fy / Es;
    const Ag = b * h;
    const rho = Ast / Ag;
    const dt = h - dP; // 최외단 인장측 철근
    const layers = [
      { y: dP, A: Ast / 2 },
      { y: dt, A: Ast / 2 },
    ];

    // 단면력 (중립축 c): 압축 +
    const forces = (c) => {
      const a = Math.min(beta1 * c, h);
      const Cc = eta * 0.85 * fck * b * a;
      let Pn = Cc;
      let Mn = Cc * (h / 2 - a / 2);
      for (const ly of layers) {
        const eps = (epsCu * (c - ly.y)) / c;
        const fs = Math.min(fy, Math.max(-fy, Es * eps));
        // 압축블록 내 철근은 변위 콘크리트 공제
        const F = ly.y <= a ? ly.A * (fs - eta * 0.85 * fck) : ly.A * fs;
        Pn += F;
        Mn += F * (h / 2 - ly.y);
      }
      return { Pn, Mn, a };
    };

    // 하중 편심 e_u = Mu/Pu(mm) 경로에서 c 이분법: g(c)=Mn−e_u·Pn (c↑→g↓)
    const eU = (Mu * 1e6) / (Pu * 1e3); // mm
    let lo = h / 1000, hi = 20 * h;
    // 브래킷 확인: g(lo)>0, g(hi)<0 아니면 게이트
    const g = (c) => { const f = forces(c); return f.Mn - eU * f.Pn; };
    for (let i = 0; i < 60 && g(lo) < 0; i++) lo /= 2; // 극단 대비
    if (g(hi) > 0) throw new Error('load-path gate: 편심이 너무 커 압축 P-M 경로에서 해 없음 — 휨부재(rc_beam)로 검토');
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (g(mid) > 0) lo = mid;
      else hi = mid;
    }
    const c = (lo + hi) / 2;
    const { Pn, Mn } = forces(c);

    // φ: 최외단 인장철근 순인장변형률 (인장 +)
    const epsT = (epsCu * (dt - c)) / c;
    const epsTcl = fy <= 400 ? rc.tension_ctrl_strain_fy_le400 : rc.tension_ctrl_eps_y_mult_fy_gt400 * epsY;
    const phiC = spiral ? rc.phi_compression_spiral : rc.phi_compression_other;
    let phi, section;
    if (epsT >= epsTcl) { phi = rc.phi_tension; section = '인장지배'; }
    else if (epsT <= epsY) { phi = phiC; section = '압축지배'; }
    else { phi = phiC + (rc.phi_tension - phiC) * ((epsT - epsY) / (epsTcl - epsY)); section = '변화구간'; }

    // φPn(max) 상한 (식 4.1-16/17: Po에 0.85fck — 원문 표기 그대로)
    const Po = 0.85 * fck * (Ag - Ast) + fy * Ast; // N
    const capFactor = spiral ? 0.85 : 0.8;
    const phiPnMax = (capFactor * phiC * Po) / 1e3; // kN
    let phiPn = (phi * Pn) / 1e3;
    let capped = false;
    if (phiPn > phiPnMax) { phiPn = phiPnMax; capped = true; }
    const phiMn = phiPn * (eU / 1e3); // 같은 편심 경로 — kN·m

    const checks = {
      rho: { rho, min: 0.01, max: 0.08, pass: rho >= 0.01 && rho <= 0.08 },
      pm: {
        phiPn_kN: phiPn, phiMn_kNm: phiMn, cappedByPnMax: capped, phiPnMax_kN: phiPnMax,
        ratio: Pu / phiPn, pass: Pu <= phiPn,
      },
    };
    return {
      inputsEcho: { ...input, dPrime: dP, transverse: spiral ? 'spiral' : 'tied' },
      intermediate: { c_mm: c, e_mm: eU, Pn_kN: Pn / 1e3, Mn_kNm: Mn / 1e6, eps_t: epsT, phi, section, eta, beta1, eps_cu: epsCu, Po_kN: Po / 1e3 },
      checks,
      verdict: Object.values(checks).every((ch) => ch.pass) ? 'PASS' : 'FAIL',
      notes: [
        '2면 등배근(Ast/2씩)·1축 휨 가정 — 4면 배근·2축 휨은 범위 외',
        '장주효과(KDS 14 20 20 §4.4 모멘트 증대) 미포함 — 증대 후 Mu 입력 전제',
        '겹침이음 시 철근비 ≤0.04 별도 확인(§4.3.2(1))',
      ],
    };
  },
};
