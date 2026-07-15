/**
 * P7 교량 — 거더 활하중 분배계수 DF (정밀식) — KDS 24 10 11 표 4.6-5·4.6-6 원문 판독.
 * 내측(a,e,k — 강거더·T형 콘크리트): 1차로 0.83[0.06+(S/4300)^0.4(S/L)^0.3(Kg/Lts³)^0.1]
 *                                     2+차로 0.9[0.075+(S/2900)^0.6(S/L)^0.2(Kg/Lts³)^0.1]
 * 외측: 1차로=지렛대 법칙(별도) · 2+차로 = e·DF내측, e = 0.77 + de/2800 (−300≤de≤1700).
 * Kg/Lts³은 기본설계 시 1.0 허용(§4.6.3.2 ② 원문). 적용범위 게이트(원문 표).
 */
export default {
  id: 'girder_df',
  domain: 'bridge',
  title: '거더 분배계수 DF (정밀식)',
  description: 'KDS 24 10 11 표 4.6-5·6 — 내측·외측 휨 분배계수, 적용범위 게이트.',
  refs: ['KDS 24 10 11:2021 표 4.6-5(내측)·표 4.6-6(외측 e=0.77+de/2800)·§4.6.3.2②(Kg항 기본 1.0) — 원문 GIF 판독'],
  status: 'verified — 원문식 판독+손검증. 단면유형 a·e·k(강거더·T형) 한정 — 박스·다중보는 후속',
  inputSchema: {
    type: 'object',
    required: ['S_mm', 'L_mm', 'ts_mm'],
    properties: {
      S_mm: { type: 'number', minimum: 1100, maximum: 4900, description: '거더 간격 S (적용범위 1100~4900)' },
      L_mm: { type: 'number', minimum: 6000, maximum: 73000, description: '지간 L (6000~73000)' },
      ts_mm: { type: 'number', minimum: 110, maximum: 300, description: '바닥판 두께 ts (110~300)' },
      KgOverLts3: { type: 'number', minimum: 0.5, maximum: 5, description: 'Kg/(L·ts³) 항 (기본 1.0 — §4.6.3.2② 기본설계 허용. 정밀=n(I+A·eg²)/Lts³ 산정 입력)' },
      Nb: { type: 'integer', minimum: 3, maximum: 20, description: '거더 수 (적용범위 ≥4 — 3이면 지렛대 법칙 비교 필요 명시)' },
      de_mm: { type: 'number', minimum: -300, maximum: 1700, description: '외측: 외측거더 복부~방호책 내면 거리 de (입력 시 외측 DF 산출)' },
    },
  },
  run(input) {
    const { S_mm: S, L_mm: L, ts_mm: ts } = input;
    const kg = input.KgOverLts3 ?? 1.0;
    const one = 0.83 * (0.06 + Math.pow(S / 4300, 0.4) * Math.pow(S / L, 0.3) * Math.pow(kg, 0.1));
    const multi = 0.9 * (0.075 + Math.pow(S / 2900, 0.6) * Math.pow(S / L, 0.2) * Math.pow(kg, 0.1));
    const interior = Math.max(one, multi);
    let exterior = null;
    if (input.de_mm !== undefined) {
      const e = 0.77 + input.de_mm / 2800;
      exterior = { e: +e.toFixed(3), DF_multi: +(e * multi).toFixed(3), note: '외측 2+차로 = e×내측. 1차로는 지렛대 법칙 별도(§표 4.6-6) — 강체 회전식(4.16-14) 비교 후속.' };
    }
    const notes = [
      `내측: 1차로 ${one.toFixed(3)} · 2+차로 ${multi.toFixed(3)} → 지배 ${interior.toFixed(3)} (Kg항 ${kg}${kg === 1 ? ' — 기본설계 허용값(§4.6.3.2②)' : ''})`,
      '적용: 단면유형 a·e·k(콘크리트 바닥판+강거더/T형) — 표 4.6-3 유형 확인. 다이아프램 있는 외측은 강체식 비교 필요.',
    ];
    if ((input.Nb ?? 4) < 4) notes.push('⚠ Nb=3 — Nb=3 식/지렛대 법칙 중 작은 값 규정(원문) — 지렛대 별도 확인.');
    return {
      verdict: 'INFO',
      DF: { interior_one: +one.toFixed(3), interior_multi: +multi.toFixed(3), interior_gov: +interior.toFixed(3), exterior },
      notes,
    };
  },
};
