/**
 * P7 교량 — PSC 거더 응력 검토 (사용한계·2단계) — 고전 폐형(σ = P/A ∓ Pe·y/I ± M·y/I).
 * 단계: ①이송(전달) — Pi(즉시손실 후) + 자중 Mo / ②사용 — Pe(전 손실 후) + 전체 M.
 * 손실: 즉시(탄성수축 등)·장기(크리프·건조수축·릴랙세이션) — **손실률 입력 원칙**
 * (정밀 손실식은 재료·시간 계수 의존 — KDS 24 14 21 산정 후 입력, 지어내지 않음.
 *  관례 안내: 프리텐션 총 18~25% 참고 — 참고일 뿐 입력 필수).
 * 허용응력: 압축 계수(기본 0.6fck 관례)·인장 계수(기본 0.25√fck 관례) — KDS 24 14 21
 * 원문 대조 후 승격 예정(현행은 '관례 명시' 라벨). 앵커: e=0·M=0 → σ=P/A 균등 폐형.
 */
export default {
  id: 'psc_girder',
  domain: 'bridge/psc',
  title: 'PSC 거더 응력 검토 (이송·사용)',
  description: '긴장력·편심·단면성능 → 상·하연 응력 2단계 검토. 손실률·허용계수 입력 원칙.',
  refs: ['PSC 고전 응력식 σ=P/A∓Pe·y/I±M·y/I (폐형)', 'KDS 24 14 21 허용응력·손실 산정은 확인 입력(원문 대조 후 계수 승격 예정 — 명시)'],
  status: 'verified(압축계수) — §4.2.2.1·§1.5.7.2③ 원문 확정(0.6/0.45/0.6fck(t)) + 솟음 탄성폐형(앵커식). 균열폭·긴장재 응력·극한휨은 후속',
  inputSchema: {
    type: 'object',
    required: ['A_mm2', 'I_mm4', 'yt_mm', 'yb_mm', 'Pj_kN', 'e_mm', 'fck'],
    properties: {
      A_mm2: { type: 'number', exclusiveMinimum: 0, description: '단면적' },
      I_mm4: { type: 'number', exclusiveMinimum: 0, description: '단면 2차모멘트' },
      yt_mm: { type: 'number', exclusiveMinimum: 0, description: '도심~상연' },
      yb_mm: { type: 'number', exclusiveMinimum: 0, description: '도심~하연' },
      Pj_kN: { type: 'number', exclusiveMinimum: 0, description: '재킹 긴장력' },
      e_mm: { type: 'number', minimum: 0, description: '긴장재 편심 (도심 아래 +)' },
      lossImmediate_pct: { type: 'number', minimum: 0, maximum: 20, description: '즉시손실 % (탄성수축 등 — KDS 24 14 21 산정 입력, 기본 0=미반영 명시)' },
      lossTotal_pct: { type: 'number', minimum: 0, maximum: 40, description: '총손실 % (장기 포함 — 산정 입력. 참고 관례 18~25%는 안내일 뿐)' },
      Mo_kNm: { type: 'number', minimum: 0, description: '이송 시 모멘트(자중)' },
      Ms_kNm: { type: 'number', minimum: 0, description: '사용 시 전체 모멘트(자중+2차사하중+활하중)' },
      fck: { type: 'number', minimum: 30, maximum: 70, description: '콘크리트 강도 (PSC ≥30 관례)' },
      fci: { type: 'number', minimum: 20, maximum: 60, description: '이송 시 강도 (기본 0.8fck 관례 명시)' },
      compFactor: { type: 'number', minimum: 0.4, maximum: 0.7, description: '압축한계 계수 (기본 0.6 — KDS 24 14 21 §4.2.2.1② 원문: 사용조합-I 0.6fck·전달 §1.5.7.2③ 0.6fck(t))' },
      MsSustained_kNm: { type: 'number', minimum: 0, description: '지속하중 모멘트 (입력 시 조합-V 지속 압축한계 0.45fck 검토 — §4.2.2.1① 원문)' },
      tensFactor: { type: 'number', minimum: 0, maximum: 0.63, description: '인장 참고한계 ×√fck (기본 0.25 참고 관례 — 한계상태설계법의 정식 검토는 균열폭/탈압축(§4.2.3, 후속) 명시)' },
      camber: { description: '솟음 산정(선택 — 탄성 폐형): { L_m(지간), wSw_kNm(자중 등분포), Ec_MPa?(기본 8500∛(fck+4)), Eci_MPa?(전달 시 — 기본 fci 기준), creepMult?(장기배율 — PCI 근사표 등 산정 입력, 기본 미적용 명시) }' },
    },
  },
  run(input) {
    const { A_mm2: A, I_mm4: I, yt_mm: yt, yb_mm: yb, e_mm: e } = input;
    const Pi = input.Pj_kN * 1000 * (1 - (input.lossImmediate_pct ?? 0) / 100);
    const Pe = input.Pj_kN * 1000 * (1 - (input.lossTotal_pct ?? 0) / 100);
    const St = I / yt, Sb = I / yb;
    const sig = (P, M_kNm) => ({
      top: P / A - (P * e) / St + (M_kNm * 1e6) / St,   // 압축 +
      bot: P / A + (P * e) / Sb - (M_kNm * 1e6) / Sb,
    });
    const transfer = sig(Pi, input.Mo_kNm ?? 0);
    const service = sig(Pe, input.Ms_kNm ?? 0);
    const fci = input.fci ?? 0.8 * input.fck;
    const cf = input.compFactor ?? 0.6, tf = input.tensFactor ?? 0.25;
    const lim = {
      transfer: { comp: cf * fci, tens: -tf * Math.sqrt(fci) },
      service: { comp: cf * input.fck, tens: -tf * Math.sqrt(input.fck) },
    };
    const chk = (st, l) => ({
      top_MPa: +st.top.toFixed(2), bot_MPa: +st.bot.toFixed(2),
      compOk: Math.max(st.top, st.bot) <= l.comp, tensOk: Math.min(st.top, st.bot) >= l.tens,
      allowComp: +l.comp.toFixed(2), allowTens: +l.tens.toFixed(2),
    });
    const t = chk(transfer, lim.transfer), sv = chk(service, lim.service);
    // 지속(조합-V) 0.45fck (§4.2.2.1① 원문) — MsSustained 입력 시
    let sus = null;
    if (input.MsSustained_kNm > 0) {
      const st2 = sig(Pe, input.MsSustained_kNm);
      const lim045 = 0.45 * input.fck;
      sus = { top_MPa: +st2.top.toFixed(2), bot_MPa: +st2.bot.toFixed(2), allow_MPa: +lim045.toFixed(2), pass: Math.max(st2.top, st2.bot) <= lim045 };
    }
    // 솟음(camber) — 탄성 폐형: 직선 긴장재(등편심) δp=Pe·e·L²/8EI(↑) − 자중 δw=5wL⁴/384EI(↓)
    let camber = null;
    const cb = input.camber;
    if (cb && Number(cb.L_m) > 0) {
      const Lmm = cb.L_m * 1000;
      const Eci = Number(cb.Eci_MPa) > 0 ? Number(cb.Eci_MPa) : 8500 * Math.cbrt(fci + 4);
      const Ec = Number(cb.Ec_MPa) > 0 ? Number(cb.Ec_MPa) : 8500 * Math.cbrt(input.fck + 4);
      const w_Nmm = (Number(cb.wSw_kNm) || 0); // kN/m = N/mm
      const dP_i = (Pi * e * Lmm * Lmm) / (8 * Eci * I);       // 전달 시 상향 (mm)
      const dW_i = (5 * w_Nmm * Math.pow(Lmm, 4)) / (384 * Eci * I);
      const net_i = dP_i - dW_i;
      const dP_e = (Pe * e * Lmm * Lmm) / (8 * Ec * I);         // 유효(전 손실 후)
      const dW_e = (5 * w_Nmm * Math.pow(Lmm, 4)) / (384 * Ec * I);
      const mult = Number(cb.creepMult) > 0 ? Number(cb.creepMult) : null;
      camber = {
        transfer: { up_mm: +dP_i.toFixed(1), selfWt_mm: +dW_i.toFixed(1), net_mm: +net_i.toFixed(1) },
        effective: { up_mm: +dP_e.toFixed(1), selfWt_mm: +dW_e.toFixed(1), net_mm: +(dP_e - dW_e).toFixed(1) },
        ...(mult ? { longTerm_mm: +((dP_e - dW_e) * mult).toFixed(1), creepMult: mult } : {}),
        note: '탄성 폐형(직선 긴장재 등편심 Pe·e·L²/8EI − 자중 5wL⁴/384EI — 앵커식). 절곡/포물선 배치·크리프 시간이력은 별도(creepMult=산정 입력, 기본 미적용). 시공단계(합성 전후)는 프로젝트 검토.',
      };
    }
    const pass = t.compOk && t.tensOk && sv.compOk && sv.tensOk && (sus ? sus.pass : true);
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: { transfer: t, service: sv, ...(sus ? { sustained: sus } : {}) },
      ...(camber ? { camber } : {}),
      intermediate: { Pi_kN: +(Pi / 1000).toFixed(1), Pe_kN: +(Pe / 1000).toFixed(1), St_mm3: Math.round(St), Sb_mm3: Math.round(Sb) },
      notes: [
        `이송: 상 ${t.top_MPa}/하 ${t.bot_MPa} MPa (허용 압축 ${t.allowComp}·인장 ${t.allowTens}) / 사용: 상 ${sv.top_MPa}/하 ${sv.bot_MPa} (허용 ${sv.allowComp}·${sv.allowTens})`,
        `손실: 즉시 ${input.lossImmediate_pct ?? 0}%·총 ${input.lossTotal_pct ?? 0}% — 입력값(KDS 24 14 21 산정 필요, 0=미반영 명시).`,
        '압축한계=원문 확정(§4.2.2.1: 사용-I 0.6fck·지속-V 0.45fck / §1.5.7.2③ 전달 0.6fck(t)). 인장 0.25√fck=참고 관례 — 정식은 균열폭/탈압축 검토(후속). 긴장재 0.65fpu·철근 0.8fy 한계는 별도. 압축 +, 인장 −.',
      ],
    };
  },
};
