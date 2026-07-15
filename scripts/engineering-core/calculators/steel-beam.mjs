/**
 * P18 건축/교량 — 강재 보 (2축대칭 H 콤팩트·강축 — KDS 14 31 10 원문 판독).
 * 휨(§4.3.2.1.1.2): Mp=Fy·Zx(4.3-2) · Lb≤Lp 소성 · Lp<Lb≤Lr:
 *   Mn=Cb[Mp−(Mp−0.7FySx)(Lb−Lp)/(Lr−Lp)]≤Mp (4.3-3) · Lb>Lr: Mn=Fcr·Sx≤Mp,
 *   Fcr=Cbπ²E/(Lb/rts)²·√(1+0.078·Jc/(Sx·h0)·(Lb/rts)²) (4.3-5).
 *   Lp=1.76ry√(E/Fy)(4.3-6) · Lr=1.95rts·E/(0.7Fy)·√(Jc/(Sx·h0))·√(1+√(1+6.76(0.7Fy/E·Sx·h0/Jc)²)) (4.3-7).
 *   φb=0.90(원문) · Cb 기본 1.0(안전측 — 원문 §(2) 명시).
 * 전단(§4.3.2.1.2.2): Vn=0.6Fy·Aw·Cv(4.3-85) — h/tw≤2.24√(E/Fy) 압연 H → φv=1.0·Cv=1.0(원문 가.).
 *   초과 시 Cv 산정(후속) — 정직 게이트.
 * 콤팩트 판폭두께비: λp 0.38√(E/Fy)(플랜지)·3.76√(E/Fy)(웨브) — AISC 동형 표준
 *   (KDS 표 4.3-1 대조 후속 명시). 비콤팩트는 정직 거부.
 * 앵커: Lb=0 → φMn=0.9FyZx 폐형 · Lb=Lp 연속성 · 압연 H 전단 φVn=0.6FyAw.
 */
export default {
  id: 'steel_beam',
  domain: 'architecture/steel',
  title: '강재 보 (H형강 콤팩트·강축)',
  description: '소성휨·횡비틀림좌굴(Lp/Lr/탄성) 3구간 + 전단 — KDS 14 31 10 원문식.',
  refs: ['KDS 14 31 10:2024 §4.3.2.1.1.2(식4.3-2~8)·§4.3.2.1.2.2(식4.3-85·h/tw 2.24√(E/Fy)·φv1.0)·φb0.90 — 원문 GIF 판독'],
  status: 'verified — 원문 계수 + 폐형 앵커(Lb=0·구간 연속성). 비콤팩트·약축·처짐(사용성)·λp 표 대조는 후속',
  inputSchema: {
    type: 'object',
    required: ['Zx_mm3', 'Sx_mm3', 'ry_mm', 'Fy_MPa', 'Lb_mm', 'Mu_kNm'],
    properties: {
      Zx_mm3: { type: 'number', exclusiveMinimum: 0, description: '소성단면계수 (KS 형강표 입력)' },
      Sx_mm3: { type: 'number', exclusiveMinimum: 0, description: '탄성단면계수' },
      ry_mm: { type: 'number', exclusiveMinimum: 0, description: '약축 회전반경' },
      rts_mm: { type: 'number', exclusiveMinimum: 0, description: '유효 회전반경 (Lb>Lp 시 필요 — 형강표)' },
      J_mm4: { type: 'number', exclusiveMinimum: 0, description: '비틀림상수 (Lb>Lp 시 필요)' },
      h0_mm: { type: 'number', exclusiveMinimum: 0, description: '플랜지 도심간 거리 (Lb>Lp 시 필요)' },
      Fy_MPa: { type: 'number', minimum: 235, maximum: 460, description: '항복강도 (SS275→275 등 — 강종 확인)' },
      E_MPa: { type: 'number', minimum: 190000, maximum: 215000, description: '탄성계수 (기본 205,000 — KDS 강재 표준값)' },
      Lb_mm: { type: 'number', minimum: 0, description: '비지지길이' },
      Cb: { type: 'number', minimum: 1.0, maximum: 3.0, description: '횡좌굴 보정계수 (기본 1.0 안전측 — 원문 명시)' },
      Mu_kNm: { type: 'number', exclusiveMinimum: 0, description: '계수휨모멘트' },
      Vu_kN: { type: 'number', minimum: 0, description: '계수전단력 (선택)' },
      Aw_mm2: { type: 'number', exclusiveMinimum: 0, description: '웨브 단면적 d×tw (전단 검토 시)' },
      h_tw: { type: 'number', exclusiveMinimum: 0, description: '웨브 h/tw (전단 φv·Cv 판정 — 형강표)' },
      bf_2tf: { type: 'number', exclusiveMinimum: 0, description: '플랜지 b/2tf (콤팩트 게이트 — 미입력 시 콤팩트 가정 명시)' },
    },
  },
  run(input) {
    const E = input.E_MPa ?? 205000;
    const { Zx_mm3: Zx, Sx_mm3: Sx, ry_mm: ry, Fy_MPa: Fy, Lb_mm: Lb } = input;
    const Cb = input.Cb ?? 1.0;
    // 콤팩트 게이트 (λp — AISC 동형 표준·KDS 표 대조 후속 명시)
    const gates = [];
    if (Number(input.bf_2tf) > 0) {
      const lim = 0.38 * Math.sqrt(E / Fy);
      gates.push({ gate: '플랜지 콤팩트 b/2tf≤0.38√(E/Fy)', value: input.bf_2tf, limit: +lim.toFixed(2), pass: input.bf_2tf <= lim });
      if (input.bf_2tf > lim) throw new Error('input gate: 비콤팩트 플랜지 — 본 계산기는 콤팩트 한정(§4.3.2.1.1.3 비콤팩트는 후속)');
    }
    const Mp = (Fy * Zx) / 1e6; // kN·m
    const Lp = 1.76 * ry * Math.sqrt(E / Fy);
    let Mn, regime;
    if (Lb <= Lp) { Mn = Mp; regime = `Lb≤Lp(${Lp.toFixed(0)}mm) — 소성 Mp`; }
    else {
      for (const k of ['rts_mm', 'J_mm4', 'h0_mm']) if (!(Number(input[k]) > 0)) throw new Error('input gate: Lb>Lp — ' + k + ' 필요(형강표. 지어내지 않음)');
      const rts = input.rts_mm, J = input.J_mm4, h0 = input.h0_mm, c = 1.0; // 2축대칭 c=1
      const JcSh = (J * c) / (Sx * h0);
      const Lr = 1.95 * rts * (E / (0.7 * Fy)) * Math.sqrt(JcSh) * Math.sqrt(1 + Math.sqrt(1 + 6.76 * Math.pow(((0.7 * Fy) / E) / JcSh, 2)));
      if (Lb <= Lr) {
        Mn = Math.min(Mp, Cb * (Mp - (Mp - (0.7 * Fy * Sx) / 1e6) * ((Lb - Lp) / (Lr - Lp))));
        regime = `Lp<Lb≤Lr(${Lr.toFixed(0)}mm) — 비탄성 LTB(식4.3-3)`;
      } else {
        const lam = Lb / rts;
        const Fcr = ((Cb * Math.PI * Math.PI * E) / (lam * lam)) * Math.sqrt(1 + 0.078 * JcSh * lam * lam);
        Mn = Math.min(Mp, (Fcr * Sx) / 1e6);
        regime = `Lb>Lr — 탄성 LTB(식4.3-4/5, Fcr ${Fcr.toFixed(1)}MPa)`;
      }
    }
    const phiMn = 0.9 * Mn;
    const checks = { flexure: { Mp_kNm: +Mp.toFixed(1), Mn_kNm: +Mn.toFixed(1), phiMn_kNm: +phiMn.toFixed(1), Mu_kNm: input.Mu_kNm, ratio: +(input.Mu_kNm / phiMn).toFixed(3), pass: input.Mu_kNm <= phiMn, regime } };
    // 전단 (식 4.3-85)
    if (Number(input.Vu_kN) > 0) {
      if (!(Number(input.Aw_mm2) > 0) || !(Number(input.h_tw) > 0)) throw new Error('input gate: 전단 검토는 Aw_mm2·h_tw 필요');
      const lim = 2.24 * Math.sqrt(E / Fy);
      if (input.h_tw > lim) throw new Error(`input gate: h/tw ${input.h_tw} > 2.24√(E/Fy)=${lim.toFixed(1)} — Cv 산정(§(1)②나)은 후속. 압연 H 범위 한정`);
      const phiVn = (1.0 * 0.6 * Fy * input.Aw_mm2) / 1000; // φv=1.0 (원문 가.)
      checks.shear = { phiVn_kN: +phiVn.toFixed(1), Vu_kN: input.Vu_kN, ratio: +(input.Vu_kN / phiVn).toFixed(3), pass: input.Vu_kN <= phiVn, note: 'h/tw≤2.24√(E/Fy) → φv=1.0·Cv=1.0(원문 §(1)②가)' };
    }
    const pass = Object.values(checks).every((c2) => c2.pass !== false) && gates.every((g) => g.pass);
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks, ...(gates.length ? { gates } : {}),
      intermediate: { Lp_mm: +Lp.toFixed(0), Cb, phiB: 0.9, E },
      notes: [
        `${regime} — φMn=${phiMn.toFixed(1)}kN·m (φb 0.90 원문).`,
        'Cb 기본 1.0=안전측(원문 명시 — 모멘트 분포별 산정 입력 가능). 단면성능=KS 형강표 입력 원칙.',
        '콤팩트 한정(비콤팩트·세장 §4.3.2.1.1.3+ 후속)·처짐(사용성)·약축·조합력(H형 보-기둥)은 별도.',
      ],
    };
  },
};
