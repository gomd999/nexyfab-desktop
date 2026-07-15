/**
 * P16 건축 — 특수전단벽 연결보 (KDS 14 20 80 §4.7.7 원문 판독).
 * 분류(원문 GIF 확정): ① ln/h ≥ 4 → §4.4 특수모멘트골조 보 규정 적용
 *   ② ln/h < 4 → 대각선 다발철근 보강으로 설계 가능
 *   ③ ln/h < 2 이고 Vu ≥ (√fck/3)·Acp → 대각선 다발철근 필수(수직하중 전달 등 입증 시 예외 — 원문)
 * 대각보강 강도(식 4.7-3): Vn = 2·Avd·fy·sinα ≤ (5√fck/6)·Acp.
 * 상세(§(4)): 다발 최소 4가닥·정착 1.25ld·횡철근 간격 ≤6db(③안) 또는 ≤min(150, 6db)+
 *   연결철근 200mm(④안) — 게이트로 검사.
 * φ는 프로젝트 확인 입력(기본 0.75 관례 명시 — 대각보강 연결보 φ는 발주 기준 확인).
 */
export default {
  id: 'coupling_beam',
  domain: 'architecture/lateral',
  title: '연결보 (특수전단벽 — §4.7.7)',
  description: '세장비 분류·대각보강 필요 판정·식4.7-3 전단강도·상세 게이트.',
  refs: ['KDS 14 20 80:2022 §4.7.7 — ln/h 분류(≥4·<4·<2)·(√fck/3)Acp 문턱·식 4.7-3 Vn=2Avd·fy·sinα≤(5√fck/6)Acp — 원문 GIF 판독'],
  status: 'verified — 원문 계수·식 판독 + 폐형 손검증. 대체공법(성능검증)·비선형 모델링 파라미터는 별도',
  inputSchema: {
    type: 'object',
    required: ['ln_mm', 'h_mm', 'b_mm', 'fck', 'Vu_kN'],
    properties: {
      ln_mm: { type: 'number', exclusiveMinimum: 0, description: '연결보 순경간' },
      h_mm: { type: 'number', exclusiveMinimum: 0, description: '보 깊이' },
      b_mm: { type: 'number', exclusiveMinimum: 0, description: '보 폭 (Acp=b·h)' },
      fck: { type: 'number', minimum: 21, maximum: 70, description: '콘크리트 강도' },
      Vu_kN: { type: 'number', minimum: 0, description: '계수전단력' },
      diagonal: { description: '대각보강 검토(선택): { Avd_mm2(한 다발 대각철근 총단면적), fy?, nBars?(다발 가닥수 — ≥4 게이트), alphaDeg?(대각 경사각 — 직접) 또는 zDiag_mm?(상·하 다발 도심 수직거리 — tanα=z/ln 산정), sTrans_mm?(횡철근 간격), db_mm?(대각철근 지름), option?(3|4 — §(4)③ 6db / ④ min(150,6db)) }' },
      phiV: { type: 'number', minimum: 0.5, maximum: 0.9, description: '전단 강도감수계수 (기본 0.75 관례 — 대각보강 연결보 φ는 발주기준·KDS 14 20 10 확인 입력 명시)' },
    },
  },
  run(input) {
    const { ln_mm: ln, h_mm: h, b_mm: b, fck } = input;
    const ratio = ln / h;
    const Acp = b * h; // mm²
    const Vu = input.Vu_kN * 1000;
    const threshold = (Math.sqrt(fck) / 3) * Acp; // N — (√fck/3)Acp 원문
    const mustDiagonal = ratio < 2 && Vu >= threshold;
    const cls = ratio >= 4
      ? '① ln/h≥4 — §4.4 특수모멘트골조 보 규정 적용(휨지배)'
      : mustDiagonal
        ? '③ ln/h<2·Vu≥(√fck/3)Acp — 대각선 다발철근 필수(§4.7.7(3), 입증 예외 원문)'
        : '② ln/h<4 — 대각선 다발철근 보강 설계 가능(§4.7.7(2))';
    // 대각보강 강도 (식 4.7-3)
    let diag = null;
    const dg = input.diagonal;
    if (dg && Number(dg.Avd_mm2) > 0) {
      const fy = Number(dg.fy) > 0 ? dg.fy : 400;
      let sinA;
      if (Number(dg.alphaDeg) > 0) sinA = Math.sin((dg.alphaDeg * Math.PI) / 180);
      else if (Number(dg.zDiag_mm) > 0) { const t = dg.zDiag_mm / ln; sinA = t / Math.hypot(1, t); }
      else throw new Error('input gate: diagonal은 alphaDeg 또는 zDiag_mm 필요(기하 산정 — 지어내지 않음)');
      const VnRaw = 2 * dg.Avd_mm2 * fy * sinA; // N
      const VnCap = ((5 * Math.sqrt(fck)) / 6) * Acp;
      const Vn = Math.min(VnRaw, VnCap);
      const capped = VnRaw > VnCap;
      const phi = input.phiV ?? 0.75;
      const phiVn = phi * Vn;
      const gates = [];
      if (Number(dg.nBars) > 0) gates.push({ gate: '다발 최소 4가닥(§(4)①)', value: dg.nBars, limit: 4, pass: dg.nBars >= 4 });
      if (Number(dg.sTrans_mm) > 0 && Number(dg.db_mm) > 0) {
        const opt = dg.option === 4 ? 4 : 3;
        const sLim = opt === 3 ? 6 * dg.db_mm : Math.min(150, 6 * dg.db_mm);
        gates.push({ gate: `횡철근 간격(§(4)${opt === 3 ? '③ 6db' : '④ min(150,6db)'})`, value: dg.sTrans_mm, limit: +sLim.toFixed(0), pass: dg.sTrans_mm <= sLim });
        if (opt === 4) gates.push({ gate: '연결철근 간격 200mm(§(4)④)', value: dg.sTrans_mm, limit: 200, pass: dg.sTrans_mm <= 200 });
      }
      diag = {
        sinAlpha: +sinA.toFixed(4), Vn_kN: +(Vn / 1000).toFixed(1), capped, phiVn_kN: +(phiVn / 1000).toFixed(1), phi,
        ratio: Vu > 0 ? +(Vu / phiVn).toFixed(3) : null, pass: Vu > 0 ? Vu <= phiVn : null, gates,
        note: `식 4.7-3: Vn=2·${dg.Avd_mm2}·${fy}·sinα(${sinA.toFixed(3)})${capped ? ' — ⚠ 상한 (5√fck/6)Acp 지배' : ''}. 정착 1.25ld(§(4)①)·φ=${phi}(확인 입력 — 기본 관례 명시).`,
      };
    }
    const pass = diag ? (diag.pass !== false && diag.gates.every((g) => g.pass)) : !mustDiagonal;
    return {
      verdict: diag ? (pass ? 'PASS' : 'FAIL') : mustDiagonal ? 'FAIL' : 'INFO',
      checks: {
        classification: { lnOverH: +ratio.toFixed(2), class: cls, VuVsThreshold: { Vu_kN: input.Vu_kN, threshold_kN: +(threshold / 1000).toFixed(1), over: Vu >= threshold } },
        ...(diag ? { diagonal: diag } : {}),
      },
      notes: [
        cls,
        diag ? `대각보강: φVn=${diag.phiVn_kN}kN vs Vu=${input.Vu_kN}kN` : mustDiagonal ? '⚠ 대각선 다발철근 설계 필요 — diagonal 입력으로 검토' : 'ln/h≥4 구간은 rc_beam(§4.4 보 규정)으로 검토.',
        '전 계수 §4.7.7 원문. 대체공법은 공인시험 성능검증 필요(원문 §(2)). 벽체 정착·경계요소 연계는 shear_wall boundary 검토.',
      ],
    };
  },
};
