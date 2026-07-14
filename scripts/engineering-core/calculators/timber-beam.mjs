/**
 * P4 조경/건축 — 목재 휨부재(장선·보) 허용응력설계 검토 (Wave A 조경 L1).
 *
 * 방법: KDS 41 50 10 육안등급구조재 기준허용응력(표 3.1-4) × 하중기간계수 CD(표 3.1-7)
 *   휨   fb = M/S ≤ Fb·CD        (직사각 단면 S = b·h²/6)
 *   전단 fv = 1.5V/(b·h) ≤ Fv·CD (직사각 단면 최대전단응력)
 *   처짐 δ = 5wL⁴/384EI + PL³/48EI ≤ L/limit (한계는 입력 — KDS 41 50 15는 정성 규정)
 *
 * v1 한계(정직 명시): 보정계수 중 CD만 적용 — 습윤 CM·온도 Ct·치수 CF·좌굴안정 CL 미적용
 * (건조사용·상시온도·횡지지 가정). 옥외 상시습윤 데크는 CM 적용 시 더 불리 — 후속.
 */
export default {
  id: 'timber_beam',
  domain: 'timber/landscape/building',
  title: '목재 휨부재 검토 (허용응력설계)',
  description: '침엽수 육안등급구조재 장선·보의 휨·전단·처짐. 기준허용응력×하중기간계수(KDS 41 50 10).',
  refs: [
    'KDS 41 50 10:2022 표 3.1-3(수종군)·표 3.1-4(육안등급구조재 기준허용응력 — 열순서 Fb·Ft·Fc·Fc⊥·Fv·E 원문 수식 판독)',
    'KDS 41 50 10:2022 §3.1.4.2 표 3.1-7(하중기간계수 CD — E·Fc⊥ 미적용)',
    'KDS 41 50 20:2022 목구조 부재설계 (RAG 코퍼스 kds-415020)',
  ],
  status: 'draft — KDS 원문 대조(허용응력·CD). v1: CD만 적용, CM·Ct·CF·CL 미적용(건조·상시온도·횡지지 가정). 공표예제 재현 대기(§7.0)',
  inputSchema: {
    type: 'object',
    required: ['species', 'grade', 'b', 'h', 'L'],
    properties: {
      species: { type: 'string', enum: ['larch', 'pine', 'koreanpine', 'cedar'], description: '수종군(표 3.1-3): larch 낙엽송류/pine 소나무류/koreanpine 잣나무류/cedar 삼나무류' },
      grade: { type: 'number', enum: [1, 2, 3], description: '육안등급 (1·2·3등급)' },
      b: { type: 'number', exclusiveMinimum: 0, maximum: 600, description: '단면 폭 mm' },
      h: { type: 'number', exclusiveMinimum: 0, maximum: 1200, description: '단면 춤 mm' },
      L: { type: 'number', exclusiveMinimum: 0, maximum: 12000, description: '스팬 mm (단순지지)' },
      w: { type: 'number', minimum: 0, description: '등분포하중 kN/m (기본 0)' },
      P: { type: 'number', minimum: 0, description: '중앙 집중하중 kN (기본 0)' },
      duration: { type: 'string', enum: ['permanent', 'tenYears', 'twoMonths', 'sevenDays', 'tenMinutes', 'impact'], description: '지배 하중기간(표 3.1-7 — 조합 중 최단 기간, 기본 tenYears)' },
      deflLimit: { type: 'number', minimum: 100, maximum: 500, description: '처짐 한계 분모 L/n (기본 240 — KDS 41 50 15 정성 규정, 관례값 명시)' },
      wetService: { type: 'boolean', description: '습윤 사용조건(옥외 데크·파고라 등) — 표 3.1-8 습윤계수 CM 적용 (기본 false=건조)' },
    },
  },
  run(input, std) {
    const tb = std.timber;
    if (!tb) throw new Error(`standard gate: '${std.id}'에 timber 파라미터 미탑재 — 이 계산기는 KDS만 지원`);
    const { species, grade, b, h, L } = input;
    const w = input.w ?? 0, P = input.P ?? 0;
    if (w <= 0 && P <= 0) {
      const err = new Error('하중(w 또는 P)이 필요합니다 — 하중을 지어내지 않습니다');
      err.code = 'INPUT_GATE';
      throw err;
    }
    const sp = tb.allowable_MPa[species];
    const g = sp?.grades?.[grade];
    if (!g) throw new Error(`unknown species/grade: ${species}/${grade}`);
    const CD = tb.loadDurationCD[input.duration ?? 'tenYears'] ?? 1.0;
    const limitN = input.deflLimit ?? 240;
    // 습윤계수 CM (표 3.1-8) — E에는 CD 미적용이지만 CM은 적용
    const wet = input.wetService === true;
    const CM = wet && tb.wetServiceCM ? tb.wetServiceCM : { Fb: 1, Ft: 1, Fc: 1, Fcp: 1, Fv: 1, E: 1 };

    // 단면 성능 (직사각)
    const S = (b * h * h) / 6;          // mm³
    const I = (b * h * h * h) / 12;     // mm⁴
    const A = b * h;                    // mm²
    const Lm = L / 1000;

    // 하중효과 (단순지지)
    const M = (w * Lm * Lm) / 8 + (P * Lm) / 4;   // kN·m
    const V = (w * Lm) / 2 + P / 2;               // kN
    const fb = (M * 1e6) / S;                     // MPa
    const fv = (1.5 * V * 1e3) / A;               // MPa
    const FbP = g.Fb * CD * CM.Fb;
    const FvP = g.Fv * CD * CM.Fv;

    // 처짐 (E는 CD 미적용(표 3.1-7 주1) — 습윤 CM.E는 적용)
    const Eeff = g.E * CM.E;
    const wNmm = w; // kN/m = N/mm
    const delta = (5 * wNmm * Math.pow(L, 4)) / (384 * Eeff * I) + (P * 1e3 * Math.pow(L, 3)) / (48 * Eeff * I); // mm
    const deltaLimit = L / limitN;

    const checks = {
      flexure: { fb_MPa: +fb.toFixed(2), allow_MPa: +FbP.toFixed(2), ratio: +(fb / FbP).toFixed(3), pass: fb <= FbP },
      shear: { fv_MPa: +fv.toFixed(3), allow_MPa: +FvP.toFixed(3), ratio: +(fv / FvP).toFixed(3), pass: fv <= FvP },
      deflection: { delta_mm: +delta.toFixed(2), limit_mm: +deltaLimit.toFixed(1), limitSpec: `L/${limitN}`, ratio: +(delta / deltaLimit).toFixed(3), pass: delta <= deltaLimit },
    };
    const verdict = Object.values(checks).every((c) => c.pass) ? 'PASS' : 'FAIL';
    return {
      verdict,
      checks,
      intermediate: {
        speciesLabel: sp.label, grade, CD, CM: wet ? { Fb: CM.Fb, Fv: CM.Fv, E: CM.E } : null, base: { Fb: g.Fb, Fv: g.Fv, E: g.E },
        S_mm3: Math.round(S), I_mm4: Math.round(I), M_kNm: +M.toFixed(2), V_kN: +V.toFixed(2),
      },
      notes: [
        `기준허용응력 ${sp.label} ${grade}등급 (표 3.1-4) × CD ${CD} (표 3.1-7, ${input.duration ?? 'tenYears'})${wet ? ` × 습윤 CM(표 3.1-8: Fb ${CM.Fb}·Fv ${CM.Fv}·E ${CM.E})` : ''}`,
        wet
          ? '습윤 사용조건 적용 — Fv·Fc CM은 원문 열배속 애매성으로 보수측 0.8 채택(원문 PDF 대조 후 정밀화 예정).'
          : '건조사용 가정 — 옥외 상시습윤(데크·파고라)은 wetService=true 필요(미적용 시 비안전측).',
        '보정 미적용 항목: 온도 Ct·치수 CF·좌굴안정 CL(횡지지 가정) — v1 한계.',
        `처짐 한계 L/${limitN} = 입력값(KDS 41 50 15는 수치 미규정 — 관례값)`,
      ],
    };
  },
};
