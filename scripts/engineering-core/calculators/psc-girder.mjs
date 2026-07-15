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
  status: 'draft — 응력식 폐형 앵커. 허용계수·손실 KDS 원문 대조·긴장재 응력·처짐(솟음)은 후속',
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
      compFactor: { type: 'number', minimum: 0.4, maximum: 0.7, description: '허용압축 계수 (기본 0.6 관례 — KDS 24 14 21 확인)' },
      tensFactor: { type: 'number', minimum: 0, maximum: 0.63, description: '허용인장 계수 ×√fck (기본 0.25 관례 — 완전 프리스트레스는 0)' },
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
    const pass = t.compOk && t.tensOk && sv.compOk && sv.tensOk;
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: { transfer: t, service: sv },
      intermediate: { Pi_kN: +(Pi / 1000).toFixed(1), Pe_kN: +(Pe / 1000).toFixed(1), St_mm3: Math.round(St), Sb_mm3: Math.round(Sb) },
      notes: [
        `이송: 상 ${t.top_MPa}/하 ${t.bot_MPa} MPa (허용 압축 ${t.allowComp}·인장 ${t.allowTens}) / 사용: 상 ${sv.top_MPa}/하 ${sv.bot_MPa} (허용 ${sv.allowComp}·${sv.allowTens})`,
        `손실: 즉시 ${input.lossImmediate_pct ?? 0}%·총 ${input.lossTotal_pct ?? 0}% — 입력값(KDS 24 14 21 산정 필요, 0=미반영 명시).`,
        '허용계수 0.6/0.25√fck=관례(원문 대조 후 승격 예정 명시). 긴장재 응력·솟음·극한 휨은 후속. 압축 +, 인장 −.',
      ],
    };
  },
};
