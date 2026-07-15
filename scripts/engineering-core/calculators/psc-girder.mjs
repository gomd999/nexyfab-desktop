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
  status: 'verified(압축·긴장 계수) — §4.2.2.1(0.6/0.45fck)·§1.5.7.2③(0.6fck(t))·긴장 min(0.8fpu,0.9fpy)·전달 min(0.75fpu,0.85fpy) 원문 확정 + 솟음 탄성폐형. 균열폭·극한휨은 후속',
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
      tendon: { description: '긴장재 응력 한계 검토(선택 — §1.5.7.2·§1.5.7.3 원문): { Ap_mm2, fpu_MPa, fpy_MPa(항복 — 뚜렷하지 않으면 fp0.2k 입력·명시) }' },
      crackControl: { description: '간접 균열 제어(선택 — §4.2.3.3 표 4.2-4·4.2-5 원문): { steelStress_MPa(균열단면 기준 철근응력 — 산정 입력), barDia_mm?, barSpacing_mm?, section: rc_flexure|rc_tension|psc } — 지름 또는 간격 중 하나 만족 시 한계균열폭(PSC 0.2·RC 0.3mm) 충족 간주(§4.2.3.1(6)). 최소철근량(§4.2.3.2 식4.2-1)은 별도 확인' },
      crackWidth: { description: '직접 균열폭 계산(선택 — §4.2.3.4 식4.2-4~7 원문): { fso_MPa(균열단면 철근응력), fcte_MPa(유효 인장강도 fctm(t) — 산정 입력), h_mm, d_mm, x_mm(중립축 — 균열환산단면 산정 입력), b_mm(유효폭), cc_mm(최소피복), db_mm, As_mm2, Ap_mm2?, xi1?(부착비 ξ1 — 표 4.2-3, 기본 0=긴장재 무시 보수), barSpacing_mm?, kt?(0.6 단기/0.4 장기 — 기본 0.4), k1?(0.8 이형/1.6 원형·긴장재), k2?(0.5 휨/1.0 인장), Es_MPa?, n?(탄성계수비 — 기본 Es/(8500∛(fck+4)) 관례 명시), limit_mm?(표 4.2-2: PSC 0.2·RC 0.3 기본 0.2) }' },
      ultimate: { description: '극한휨 Mn(선택 — 변형률적합 이분법·이선형 긴장재 모델 명시): { b_mm(압축면 유효폭 — 플랜지), dp_mm(긴장재 유효깊이), Ap_mm2, fpu_MPa, fpy_MPa, Ep_MPa?(기본 200000 강연선 관례 — 195~200GPa 제품치 입력 권장), As_mm2?(인장철근), d_mm?(철근 깊이), fy_MPa?, Mu_kNm?(판정용 — 계수휨모멘트), phiF?(휨 강도감수계수 — 기본 0.85 인장지배 관례, 한계상태법 재료계수 방식과 구분 명시) }. 직사각 압축블록 한정(플랜지 내 중립축 검증 게이트)' },
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
    // 긴장재 응력 한계 (§1.5.7.2(1)·§1.5.7.3(1) 원문 GIF 판독 확정):
    // 재킹 f0,max=min(0.8fpu, 0.9fpy) · 전달 직후 fpm0=min(0.75fpu, 0.85fpy) · 초과긴장(±5% 계측) 0.95fpy
    let tendon = null;
    const td = input.tendon;
    if (td && Number(td.Ap_mm2) > 0 && Number(td.fpu_MPa) > 0 && Number(td.fpy_MPa) > 0) {
      const fJack = (input.Pj_kN * 1000) / td.Ap_mm2;
      const fTransfer = Pi / td.Ap_mm2;
      const limJack = Math.min(0.8 * td.fpu_MPa, 0.9 * td.fpy_MPa);
      const limTransfer = Math.min(0.75 * td.fpu_MPa, 0.85 * td.fpy_MPa);
      tendon = {
        jacking: { f_MPa: +fJack.toFixed(1), limit_MPa: +limJack.toFixed(1), pass: fJack <= limJack },
        transfer: { f_MPa: +fTransfer.toFixed(1), limit_MPa: +limTransfer.toFixed(1), pass: fTransfer <= limTransfer },
        note: '§1.5.7.2(1)① f0,max=min(0.8fpu, 0.9fpy)·§1.5.7.3(1) fpm0=min(0.75fpu, 0.85fpy) — 원문 확정. 초과긴장은 ±5% 계측 시 0.95fpy까지(§1.5.7.2(1)② — 별도 판단). 항복점 불명확 시 fpy=fp0.2k(§3.3.1(6)).',
      };
    }
    // 간접 균열 제어 (§4.2.3.3 표 4.2-4·4.2-5 원문 전사 — 보간 없음, 보수적으로 상위 응력행 적용)
    let crack = null;
    const cc = input.crackControl;
    if (cc && Number(cc.steelStress_MPa) > 0) {
      const STRESS = [160, 200, 240, 280, 320, 360];
      const DIA = { rc: [32, 25, 16, 14, 10, 8], psc: [25, 16, 13, 8, 6, 5] };           // 표 4.2-4
      const SPC = { rc_flexure: [300, 250, 200, 150, 100, 50], rc_tension: [200, 150, 125, 75, null, null], psc: [200, 150, 100, 50, null, null] }; // 표 4.2-5
      const sec = ['rc_flexure', 'rc_tension', 'psc'].includes(cc.section) ? cc.section : 'psc';
      const ss = Number(cc.steelStress_MPa);
      const row = STRESS.findIndex((s) => ss <= s);
      if (row === -1) {
        crack = { pass: false, note: `철근응력 ${ss}MPa > 360 — 표 범위 밖, 간접 제어 불가. §4.2.3.4 직접 균열폭 계산 필요(후속) 또는 철근량 증가로 응력 저감.` };
      } else {
        const maxDia = (sec === 'psc' ? DIA.psc : DIA.rc)[row];
        const maxSpc = SPC[sec][row];
        const diaOk = Number(cc.barDia_mm) > 0 ? cc.barDia_mm <= maxDia : null;
        const spcOk = Number(cc.barSpacing_mm) > 0 ? (maxSpc !== null ? cc.barSpacing_mm <= maxSpc : false) : null;
        const ok = diaOk === true || spcOk === true; // §4.2.3.3(1): 둘 중 하나 만족
        crack = {
          steelStress_MPa: ss, appliedRow_MPa: STRESS[row], maxDia_mm: maxDia, maxSpacing_mm: maxSpc,
          diaOk, spacingOk: spcOk, pass: ok,
          note: `표 4.2-4/4.2-5(${sec}) — 지름 또는 간격 중 하나 만족 시 한계균열폭(PSC 0.2·RC 0.3mm — 표 4.2-2 B~E등급) 충족 간주. 응력 ${ss}→${STRESS[row]}행 보수 적용(표 보간 규정 없음). 간접하중(구속) 지배 부재는 지름 조건 필수(§4.2.3.3(2)). 최소철근량 식4.2-1 별도.`,
        };
      }
    }
    // 직접 균열폭 (§4.2.3.4 원문 GIF 판독 확정):
    // wk = lr,max(εsm−εcm) [4.2-4] · Δε = fso/Es − kt·fcte/(Es·ρe)·(1+n·ρe) ≥ 0.6fso/Es [4.2-5]
    // ρe = (As+ξ1²Ap)/Acte [4.2-6] · lr,max = 3.4cc+0.425k1k2db/ρe (간격≤5(cc+db/2)) | 1.3(h−x) [4.2-7a/b]
    // hc,eff = min(2.5(h−d), (h−x)/3, h/2)
    let crackW = null;
    const cw = input.crackWidth;
    if (cw && Number(cw.fso_MPa) > 0) {
      for (const k of ['fcte_MPa', 'h_mm', 'd_mm', 'x_mm', 'b_mm', 'cc_mm', 'db_mm', 'As_mm2']) if (!(Number(cw[k]) > 0)) throw new Error('input gate: crackWidth.' + k);
      const Es = Number(cw.Es_MPa) > 0 ? Number(cw.Es_MPa) : 200000;
      const n = Number(cw.n) > 0 ? Number(cw.n) : Es / (8500 * Math.cbrt(input.fck + 4));
      const kt2 = Number(cw.kt) > 0 ? Number(cw.kt) : 0.4;
      const k1 = Number(cw.k1) > 0 ? Number(cw.k1) : 0.8, k2 = Number(cw.k2) > 0 ? Number(cw.k2) : 0.5;
      const xi1 = Number(cw.xi1) >= 0 ? Number(cw.xi1) : 0;
      const hceff = Math.min(2.5 * (cw.h_mm - cw.d_mm), (cw.h_mm - cw.x_mm) / 3, cw.h_mm / 2);
      const Acte = cw.b_mm * hceff;
      const rhoE = (cw.As_mm2 + xi1 * xi1 * (Number(cw.Ap_mm2) || 0)) / Acte;
      const dEps = Math.max(cw.fso_MPa / Es - (kt2 * cw.fcte_MPa * (1 + n * rhoE)) / (Es * rhoE), (0.6 * cw.fso_MPa) / Es);
      const spcThresh = 5 * (cw.cc_mm + cw.db_mm / 2);
      const useA = !(Number(cw.barSpacing_mm) > 0) || cw.barSpacing_mm <= spcThresh;
      const lrmax = useA ? 3.4 * cw.cc_mm + (0.425 * k1 * k2 * cw.db_mm) / rhoE : 1.3 * (cw.h_mm - cw.x_mm);
      const wk = lrmax * dEps;
      const lim = Number(cw.limit_mm) > 0 ? Number(cw.limit_mm) : 0.2;
      crackW = {
        hceff_mm: +hceff.toFixed(1), rhoE: +rhoE.toFixed(5), dEps: +dEps.toExponential(3),
        lrmax_mm: +lrmax.toFixed(1), formula: useA ? '4.2-7a (간격≤5(cc+db/2))' : '4.2-7b 1.3(h−x)',
        wk_mm: +wk.toFixed(3), limit_mm: lim, pass: wk <= lim,
        note: `§4.2.3.4 원문식. kt=${kt2}(0.6 단기/0.4 장기)·k1=${k1}·k2=${k2}·n=${n.toFixed(2)}${Number(cw.n) > 0 ? '(입력)' : '(Ec=8500∛(fck+4) 관례 — 교량기준 Ec식 확인 입력 권장)'}·ξ1=${xi1}${xi1 === 0 && Number(cw.Ap_mm2) > 0 ? '(긴장재 기여 무시 — 보수, 표 4.2-3 산정 입력 가능)' : ''}. x(중립축)·fso는 균열환산단면 산정 입력. 한계 ${lim}mm=표 4.2-2(설계등급별).`,
      };
    }
    // 극한휨 Mn — 변형률적합 이분법 (정해). 긴장재 = 이선형(Ep 탄성 → fpy 이후 완만 경화
    // (fpu−fpy)/(εpu−εpy) 선형, εpu=0.035 관례 명시 — 실제 파워식(Ramberg-Osgood)은 제품별).
    // εcu=0.0033(KDS)·등가블록 β1=0.80(fck≤40 — rc_beam과 동일 KDS 원문 계수).
    let ult = null;
    const ul = input.ultimate;
    if (ul && Number(ul.Ap_mm2) > 0) {
      for (const k of ['b_mm', 'dp_mm', 'fpu_MPa', 'fpy_MPa']) if (!(Number(ul[k]) > 0)) throw new Error('input gate: ultimate.' + k);
      const Ep = Number(ul.Ep_MPa) > 0 ? Number(ul.Ep_MPa) : 200000;
      const fck2 = input.fck;
      const beta1 = fck2 <= 40 ? 0.80 : Math.max(0.64, 0.80 - 0.0016 * (fck2 - 40)); // KDS β1(rc_beam 검증 계수 재사용)
      const ecu = 0.0033;
      // 유효 프리스트레인 (전 손실 후): εpe = Pe/(Ap·Ep) — Pe는 위에서 산정
      const epe = Pe / (ul.Ap_mm2 * Ep);
      const epy = ul.fpy_MPa / Ep, epu2 = 0.035; // εpu=0.035 관례 명시
      const fpOf = (eps) => eps <= epy ? eps * Ep : Math.min(ul.fpu_MPa, ul.fpy_MPa + ((ul.fpu_MPa - ul.fpy_MPa) * (eps - epy)) / (epu2 - epy));
      const As2 = Number(ul.As_mm2) > 0 ? ul.As_mm2 : 0;
      const fy2 = Number(ul.fy_MPa) > 0 ? ul.fy_MPa : 400;
      const d2 = Number(ul.d_mm) > 0 ? ul.d_mm : ul.dp_mm;
      // 힘평형: 0.85fck·b·β1·c = Ap·fp(εpe+εcu(dp−c)/c) + As·fs — c 이분법
      const forceGap = (c) => {
        const epsP = epe + (ecu * (ul.dp_mm - c)) / c;
        const epsS = (ecu * (d2 - c)) / c;
        const fsS = Math.max(-fy2, Math.min(fy2, epsS * 200000));
        return 0.85 * fck2 * ul.b_mm * beta1 * c - ul.Ap_mm2 * fpOf(epsP) - As2 * fsS;
      };
      let lo = 1, hi = ul.dp_mm;
      for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (forceGap(mid) < 0) lo = mid; else hi = mid; }
      const c = (lo + hi) / 2, a = beta1 * c;
      const epsP = epe + (ecu * (ul.dp_mm - c)) / c;
      const fps = fpOf(epsP);
      const epsS = (ecu * (d2 - c)) / c;
      const fsS = Math.max(-fy2, Math.min(fy2, epsS * 200000));
      const Mn = (ul.Ap_mm2 * fps * (ul.dp_mm - a / 2) + As2 * fsS * (d2 - a / 2)) / 1e6; // kN·m
      const phiF = Number(ul.phiF) > 0 ? Number(ul.phiF) : 0.85;
      const phiMn = phiF * Mn;
      const flangeOk = true; // 직사각 블록 — 플랜지 두께 입력 시 게이트(후속): 현재 b=압축면 유효폭 전제
      const passU = Number(ul.Mu_kNm) > 0 ? ul.Mu_kNm <= phiMn : null;
      ult = {
        c_mm: +c.toFixed(1), a_mm: +a.toFixed(1), beta1, epsP: +epsP.toFixed(5), fps_MPa: +fps.toFixed(1),
        Mn_kNm: +Mn.toFixed(1), phiMn_kNm: +phiMn.toFixed(1), phiF,
        ...(passU !== null ? { Mu_kNm: ul.Mu_kNm, ratio: +(ul.Mu_kNm / phiMn).toFixed(3), pass: passU } : {}),
        note: `변형률적합 이분법(정해): εpe=${epe.toFixed(5)}(Pe 기준)+휨 변형률, 긴장재=이선형(fpy→fpu, εpu 0.035 관례 명시 — 제품 곡선 입력은 후속). εcu 0.0033·β1 ${beta1}(KDS). 직사각 압축블록 전제 — 중립축 a=${a.toFixed(0)}mm가 플랜지 내인지 확인(플랜지 두께 게이트 후속). φ=${phiF}(인장지배 관례 — 한계상태 재료계수 방식 병행 시 별도).`,
      };
      if (!flangeOk) ult.note += ' ⚠ 플랜지 초과';
    }
    const pass = t.compOk && t.tensOk && sv.compOk && sv.tensOk && (sus ? sus.pass : true) && (tendon ? tendon.jacking.pass && tendon.transfer.pass : true) && (crack ? crack.pass : true) && (crackW ? crackW.pass : true) && (ult && ult.pass !== undefined ? ult.pass : true);
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: { transfer: t, service: sv, ...(sus ? { sustained: sus } : {}), ...(tendon ? { tendon } : {}), ...(crack ? { crackIndirect: crack } : {}), ...(crackW ? { crackWidth: crackW } : {}), ...(ult ? { ultimate: ult } : {}) },
      ...(camber ? { camber } : {}),
      intermediate: { Pi_kN: +(Pi / 1000).toFixed(1), Pe_kN: +(Pe / 1000).toFixed(1), St_mm3: Math.round(St), Sb_mm3: Math.round(Sb) },
      notes: [
        `이송: 상 ${t.top_MPa}/하 ${t.bot_MPa} MPa (허용 압축 ${t.allowComp}·인장 ${t.allowTens}) / 사용: 상 ${sv.top_MPa}/하 ${sv.bot_MPa} (허용 ${sv.allowComp}·${sv.allowTens})`,
        `손실: 즉시 ${input.lossImmediate_pct ?? 0}%·총 ${input.lossTotal_pct ?? 0}% — 입력값(KDS 24 14 21 산정 필요, 0=미반영 명시).`,
        '압축한계=원문 확정(§4.2.2.1: 사용-I 0.6fck·지속-V 0.45fck / §1.5.7.2③ 전달 0.6fck(t)). 인장 0.25√fck=참고 관례 — 정식은 균열폭/탈압축 검토(후속). 긴장재 한계=tendon 입력 시 원문식 검토(재킹 min(0.8fpu,0.9fpy)·전달 min(0.75fpu,0.85fpy)). 압축 +, 인장 −.',
      ],
    };
  },
};
