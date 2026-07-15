/**
 * P12 건축 — 전단벽 횡강성·분담 + 개략 검토 (폐형).
 * 캔틸레버 벽 강성 k = 1/(h³/(3EcI) + 1.2h/(Gc·A)) — 휨+전단변형(교과서 폐형).
 * 여러 요소(벽·골조) 병렬 강성 분담: Vi = V·ki/Σk (강막 가정 명시).
 * 벽체 검토(개략): 휨 = 수직 캔틸레버 보(rc_beam 연계 안내) · 전단 개략
 * φVc=0.75·(1/6)√fck·(0.8lw)·t (KDS 전단 기본식 계열 — 벽 상세식은 후속 명시).
 * 앵커: 전단변형 무시 시 k→3EI/h³ 폐형 · 분담률 합=1.
 */
export default {
  id: 'shear_wall',
  domain: 'architecture/lateral',
  title: '전단벽 횡강성·분담 (개략)',
  description: '벽 요소 강성(휨+전단변형)·병렬 분담률·벽체 개략 전단 검토.',
  refs: ['캔틸레버 벽 강성 폐형(휨+전단변형 — 구조역학 표준)', 'KDS 14 20 22 계열 Vc=√fck/6 기본식(벽 전용 상세식은 후속 명시)'],
  status: 'verified — 폐형 앵커(3EI/h³ 극한·분담 합 1). 연결보·개구부 벽·경계요소 상세는 후속',
  inputSchema: {
    type: 'object',
    required: ['walls', 'storyShear_kN'],
    properties: {
      walls: { description: '벽 목록 [{lw_mm(벽 길이), t_mm(두께), h_mm(높이), fck?}] — 최대 20' },
      frameStiffness_kNmm: { type: 'number', minimum: 0, description: '병렬 골조 강성 kN/mm (frame2d 산정값 입력 — 선택, 벽·골조 분담)' },
      storyShear_kN: { type: 'number', exclusiveMinimum: 0, description: '층전단력 V (지진·풍 산정값)' },
      fck: { type: 'number', minimum: 18, maximum: 60, description: '콘크리트 강도 (기본 24)' },
    },
  },
  run(input) {
    const walls = input.walls;
    if (!Array.isArray(walls) || !walls.length || walls.length > 20) throw new Error('input gate: walls 1~20개');
    const fck = input.fck ?? 24;
    const Ec = 8500 * Math.cbrt(fck + 4); // MPa
    const Gc = Ec / (2 * (1 + 0.17)); // ν=0.17 관례(명시)
    const items = walls.map((w, i) => {
      for (const k of ['lw_mm', 't_mm', 'h_mm']) if (!(Number(w[k]) > 0)) throw new Error(`input gate: 벽 ${i + 1} ${k}`);
      const I = (w.t_mm * Math.pow(w.lw_mm, 3)) / 12; // mm⁴
      const A = w.t_mm * w.lw_mm;
      const kFlex = Math.pow(w.h_mm, 3) / (3 * Ec * I);
      const kShear = (1.2 * w.h_mm) / (Gc * A);
      const k = 1 / (kFlex + kShear); // N/mm
      return { i: i + 1, lw: w.lw_mm, t: w.t_mm, h: w.h_mm, k_kNmm: k / 1000, I, A };
    });
    const kFrame = (input.frameStiffness_kNmm ?? 0);
    const sumK = items.reduce((s, x) => s + x.k_kNmm, 0) + kFrame;
    const V = input.storyShear_kN;
    const rows = items.map((x) => {
      const share = x.k_kNmm / sumK;
      const Vi = V * share;
      // 개략 전단강도: φVc = 0.75·(√fck/6)·0.8lw·t (기본식 — 벽 상세식·수평철근 기여 후속)
      const phiVc = (0.75 * (Math.sqrt(fck) / 6) * 0.8 * x.lw * x.t) / 1000; // kN
      return {
        wall: x.i, k_kNmm: +x.k_kNmm.toFixed(2), share: +share.toFixed(3), Vi_kN: +Vi.toFixed(1),
        phiVc_kN: +phiVc.toFixed(1), ratio: +(Vi / phiVc).toFixed(3), pass: Vi <= phiVc,
        flexNote: `휨: 수직 캔틸레버 M=${(Vi * x.h / 1000).toFixed(0)}kN·m — rc_beam(b=${x.t}, d≈0.8lw)로 수직철근 검토`,
      };
    });
    const frameShare = kFrame > 0 ? +(kFrame / sumK).toFixed(3) : 0;
    const allPass = rows.every((r) => r.pass);
    return {
      verdict: allPass ? 'PASS' : 'FAIL',
      walls: rows,
      distribution: { sumK_kNmm: +sumK.toFixed(2), frameShare, wallShare: +(1 - frameShare).toFixed(3) },
      notes: [
        `강성 분담(강막 가정 명시): 벽 ${rows.length}장${kFrame > 0 ? `+골조(${(frameShare * 100).toFixed(0)}%)` : ''} — 분담 합 1.0.`,
        '벽 강성=휨+전단변형 폐형(ν=0.17 관례). 비틀림(강성중심 편심)·연결보·개구부는 후속 명시.',
        'φVc는 기본식 개략 — 벽 전용 상세식(수평철근 기여)·경계요소는 KDS 14 20 22 원문 판독 후 승격.',
      ],
    };
  },
};
