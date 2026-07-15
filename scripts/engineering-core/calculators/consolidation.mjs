/**
 * P14 토목 — 1차원 압밀침하 (Terzaghi 폐형) — 침하량 + 시간(압밀도).
 * 침하량: 정규압밀 Sc = Cc·H/(1+e0)·log((σ0′+Δσ)/σ0′) · 과압밀 분기
 *   (σ0′+Δσ ≤ σp′ → Cr만 / σ0′ < σp′ < σ0′+Δσ → Cr·log(σp′/σ0′)+Cc·log((σ0′+Δσ)/σp′)).
 * 시간: Terzaghi 급수 U(Tv) = 1 − Σ 2/M²·exp(−M²Tv), M=π(2m+1)/2 (정확해) —
 *   t = Tv·Hdr²/cv. 앵커: 고전 공표값 U50%→Tv 0.197 · U90%→Tv 0.848 재현.
 * 전 물성(Cc·Cr·e0·cv·σp′)은 압밀시험 입력 원칙 — 경험식 추정 안 함(지어내지 않음).
 * 즉시침하·2차압밀(Cα)은 후속 명시.
 */
export default {
  id: 'consolidation',
  domain: 'civil/settlement',
  title: '압밀침하 (Terzaghi 1D)',
  description: '정규/과압밀 침하량 + 압밀도-시간 곡선(급수 정확해) — 시험물성 입력 원칙.',
  refs: ['Terzaghi 1차원 압밀이론 (폐형 — 토질역학 표준)', 'KDS 11 30 05 지반설계 일반 연계 — 물성은 압밀시험 입력'],
  status: 'verified — 폐형 + 고전 공표 앵커(U50 Tv0.197·U90 Tv0.848). 즉시침하·2차압밀·다층 분할은 후속',
  inputSchema: {
    type: 'object',
    required: ['H_m', 'e0', 'Cc', 'sigma0_kPa', 'dSigma_kPa'],
    properties: {
      H_m: { type: 'number', exclusiveMinimum: 0, maximum: 50, description: '압밀층 두께' },
      e0: { type: 'number', exclusiveMinimum: 0, maximum: 5, description: '초기 간극비 (시험)' },
      Cc: { type: 'number', exclusiveMinimum: 0, maximum: 2, description: '압축지수 (압밀시험 — 경험식 추정 안 함)' },
      Cr: { type: 'number', minimum: 0, maximum: 0.5, description: '재압축지수 (과압밀 검토 시 필수)' },
      sigma0_kPa: { type: 'number', exclusiveMinimum: 0, description: '층 중앙 유효상재응력 σ0′' },
      dSigma_kPa: { type: 'number', exclusiveMinimum: 0, description: '층 중앙 응력증가 Δσ (2:1법·Boussinesq 등 별도 산정 입력)' },
      sigmaP_kPa: { type: 'number', exclusiveMinimum: 0, description: '선행압밀압력 σp′ (미입력=정규압밀 가정 명시)' },
      cv_m2yr: { type: 'number', exclusiveMinimum: 0, description: '압밀계수 m²/yr (시간침하 산정 시)' },
      drainage: { enum: ['double', 'single'], description: '배수조건 (기본 double — Hdr=H/2)' },
      targetU_pct: { type: 'number', minimum: 10, maximum: 99, description: '목표 압밀도 % (기본 90)' },
      allowSettle_mm: { type: 'number', exclusiveMinimum: 0, description: '허용 침하량 (판정용 — 발주 기준 입력)' },
      immediate: { description: '즉시침하(탄성 — 선택): { q_kPa(순하중), B_m(기초폭), Es_kPa(지반 탄성계수 — 시험 입력), nu?(0.3 기본), If?(영향계수 — 형상·강성 도표 입력, 기본 강성 원형 0.79π/4≈0.79 아님 — 유연 중앙 1.0 관례 명시) } — Se=q·B·(1−ν²)/Es·If 폐형' },
      secondary: { description: '2차압밀(선택): { Calpha(2차압밀계수 — 시험 입력), t1_yr(1차완료 시점), t2_yr(설계수명) } — Ss=Cα·H/(1+e0)·log(t2/t1)' },
    },
  },
  run(input) {
    const { H_m: H, e0, Cc, sigma0_kPa: s0, dSigma_kPa: ds } = input;
    const sf = s0 + ds;
    let Sc_m, regime;
    if (Number(input.sigmaP_kPa) > 0) {
      const sp = input.sigmaP_kPa;
      if (sp < s0) throw new Error('input gate: σp′ < σ0′ — 선행압밀압력이 현 응력보다 작을 수 없음(시험치 확인)');
      const Cr = Number(input.Cr) > 0 ? input.Cr : null;
      if (Cr === null) throw new Error('input gate: 과압밀 검토는 Cr 필수');
      if (sf <= sp) {
        Sc_m = (Cr * H / (1 + e0)) * Math.log10(sf / s0);
        regime = `과압밀(재압축만): σf ${sf.toFixed(0)} ≤ σp′ ${sp.toFixed(0)}`;
      } else {
        Sc_m = (Cr * H / (1 + e0)) * Math.log10(sp / s0) + (Cc * H / (1 + e0)) * Math.log10(sf / sp);
        regime = `과압밀→정규 전이: Cr(σ0′→σp′)+Cc(σp′→σf)`;
      }
    } else {
      Sc_m = (Cc * H / (1 + e0)) * Math.log10(sf / s0);
      regime = '정규압밀 가정(σp′ 미입력 — 명시)';
    }
    // 시간-압밀도: Terzaghi 급수 정확해 (U→Tv 이분법)
    const Uof = (Tv) => {
      let sum = 0;
      for (let m = 0; m < 60; m++) {
        const M = (Math.PI * (2 * m + 1)) / 2;
        sum += (2 / (M * M)) * Math.exp(-M * M * Tv);
      }
      return 1 - sum;
    };
    const TvOf = (U) => {
      let lo = 1e-6, hi = 10;
      for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (Uof(mid) < U) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    };
    let time = null;
    if (Number(input.cv_m2yr) > 0) {
      const Hdr = (input.drainage ?? 'double') === 'double' ? H / 2 : H;
      const targetU = (input.targetU_pct ?? 90) / 100;
      const Tv = TvOf(targetU);
      const t_yr = (Tv * Hdr * Hdr) / input.cv_m2yr;
      const curve = [30, 50, 70, 90, 95].map((u) => {
        const tv = TvOf(u / 100);
        return { U_pct: u, Tv: +tv.toFixed(3), t_yr: +((tv * Hdr * Hdr) / input.cv_m2yr).toFixed(2), settle_mm: +(Sc_m * 1000 * u / 100).toFixed(1) };
      });
      time = { targetU_pct: input.targetU_pct ?? 90, Tv: +Tv.toFixed(3), t_yr: +t_yr.toFixed(2), Hdr_m: Hdr, curve };
    }
    // 즉시침하 (탄성 폐형 — Se = q·B·(1−ν²)/Es·If)
    let imm = null;
    const im = input.immediate;
    if (im && Number(im.q_kPa) > 0) {
      for (const k of ['B_m', 'Es_kPa']) if (!(Number(im[k]) > 0)) throw new Error('input gate: immediate.' + k);
      const nu = Number(im.nu) > 0 ? Number(im.nu) : 0.3;
      const If = Number(im.If) > 0 ? Number(im.If) : 1.0; // 유연기초 중앙 관례(명시)
      const Se = (im.q_kPa * im.B_m * (1 - nu * nu)) / im.Es_kPa * If * 1000; // mm
      imm = { Se_mm: +Se.toFixed(1), If, nu, note: 'Se=qB(1−ν²)/Es·If — Es=시험 입력·If=형상/강성 도표 입력(기본 1.0 유연 중앙 관례 명시)' };
    }
    // 2차압밀 (Ss = Cα·H/(1+e0)·log(t2/t1))
    let sec = null;
    const sc2 = input.secondary;
    if (sc2 && Number(sc2.Calpha) > 0) {
      const t1 = Number(sc2.t1_yr), t2 = Number(sc2.t2_yr);
      if (!(t1 > 0) || !(t2 > t1)) throw new Error('input gate: secondary.t2_yr > t1_yr > 0');
      const Ss = (sc2.Calpha * H / (1 + e0)) * Math.log10(t2 / t1) * 1000; // mm
      sec = { Ss_mm: +Ss.toFixed(1), t1_yr: t1, t2_yr: t2, note: 'Cα=시험 입력(Cα/Cc 0.04±0.01 점토 관례는 안내일 뿐)' };
    }
    const Sc_mm = Sc_m * 1000;
    const totalSettle = Sc_mm + (imm?.Se_mm ?? 0) + (sec?.Ss_mm ?? 0);
    const pass = Number(input.allowSettle_mm) > 0 ? totalSettle <= input.allowSettle_mm : null;
    return {
      verdict: pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL',
      checks: { settlement: { Sc_mm: +Sc_mm.toFixed(1), regime, ...(imm ? { immediate: imm } : {}), ...(sec ? { secondary: sec } : {}), total_mm: +totalSettle.toFixed(1), ...(pass !== null ? { allow_mm: input.allowSettle_mm, pass } : {}) } },
      ...(time ? { time } : {}),
      notes: [
        `침하량 ${Sc_mm.toFixed(1)}mm — ${regime}. Δσ는 층 중앙 기준 별도 산정 입력(2:1법·Boussinesq).`,
        '압밀도-시간=Terzaghi 급수 정확해(근사식 아님). 물성(Cc·Cr·e0·cv·σp′)=압밀시험 입력 원칙 — 경험식 추정 안 함.',
        '즉시침하(탄성)·2차압밀(Cα)·다층 분할합산·연직배수재 보정은 후속/별도 명시.',
      ],
    };
  },
};
