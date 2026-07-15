/**
 * P14 토목 — 말뚝 축방향 지지력 (정역학 공식) — KDS 11 50 15 §4.1.1 연계.
 * 극한: Qu = Qp + Qs. 층별 주면: 점토 α법 fs=α·Su (α=시험/도표 입력 원칙) ·
 *   사질 β법 fs=β·σv′ (β=K·tanδ — 산정 입력). 선단: 점토 qp=Nc·Su(Nc 기본 9 —
 *   깊은기초 고전값 명시) · 사질 qp=Nq·σv′(Nq=도표(Meyerhof/Berezantzev) 산정 입력,
 *   지어내지 않음).
 * 허용: Qa = Qu/FS — FS 입력(기본 3.0 정역학 관례 명시. KDS 11 50 15 §4.1.1.4(3):
 *   재하시험으로도 극한 대비 2 미만 불가 — 원문).
 * 앵커: 폐형 손계산(균질 점토 α법 고전 예제 구조) — 산식 자체가 곱·합 폐형.
 * 무리말뚝 효율·부주면마찰·인발·횡방향은 후속 명시.
 */
export default {
  id: 'pile_capacity',
  domain: 'civil/foundation',
  title: '말뚝 축방향 지지력 (정역학)',
  description: '층별 α/β법 주면마찰+선단지지 → 극한·허용 지지력. 계수는 산정 입력 원칙.',
  refs: ['정역학 지지력 공식(α법·β법·Nc=9 — 기초공학 표준 폐형)', 'KDS 11 50 15:2021 §4.1.1.3~4(허용=극한/FS·재하시험 FS≥2 원문)'],
  status: 'verified — 폐형(곱·합) + 게이트. Nq·α·β는 도표/시험 입력 원칙. 무리효율·부주면마찰·인발·횡방향·침하는 후속',
  inputSchema: {
    type: 'object',
    required: ['dia_m', 'length_m', 'layers'],
    properties: {
      dia_m: { type: 'number', exclusiveMinimum: 0, maximum: 3, description: '말뚝 직경 (원형 환산)' },
      length_m: { type: 'number', exclusiveMinimum: 0, maximum: 80, description: '근입 길이' },
      layers: { description: '지층 배열 [{thick_m, type: clay|sand, Su_kPa?(점토), alpha?(점토 α — 시험/도표 입력), sigmaVmid_kPa?(사질 층중앙 유효응력 — 지하수 반영 산정 입력), beta?(사질 β=K·tanδ)}] — 합계두께 ≥ 근입장' },
      tip: { description: '선단 지반: { type: clay|sand, Su_kPa?(점토), Nc?(기본 9 고전값), sigmaVtip_kPa?(사질 선단 유효응력), Nq?(도표 산정 입력 — 필수, 지어내지 않음) }' },
      FS: { type: 'number', minimum: 2, maximum: 6, description: '안전율 (기본 3.0 정역학 관례 — §4.1.1.4(3) 재하시험도 ≥2)' },
      demandP_kN: { type: 'number', minimum: 0, description: '작용하중 (판정용)' },
    },
  },
  run(input) {
    const D = input.dia_m, Lp = input.length_m;
    const perim = Math.PI * D, Atip = (Math.PI * D * D) / 4;
    const layers = input.layers;
    if (!Array.isArray(layers) || !layers.length || layers.length > 20) throw new Error('input gate: layers 1~20개');
    let z = 0, Qs = 0;
    const rows = [];
    for (const [i, ly] of layers.entries()) {
      if (!(Number(ly.thick_m) > 0)) throw new Error(`input gate: 층 ${i + 1} thick_m`);
      const emb = Math.max(0, Math.min(z + ly.thick_m, Lp) - z); // 근입 구간만
      if (emb <= 0) { z += ly.thick_m; continue; }
      let fs;
      if (ly.type === 'clay') {
        if (!(Number(ly.Su_kPa) > 0) || !(Number(ly.alpha) > 0)) throw new Error(`input gate: 점토층 ${i + 1}은 Su_kPa·alpha 필수(α=시험/도표 산정 입력 — 기본값 없음)`);
        fs = ly.alpha * ly.Su_kPa;
      } else if (ly.type === 'sand') {
        if (!(Number(ly.sigmaVmid_kPa) > 0) || !(Number(ly.beta) > 0)) throw new Error(`input gate: 사질층 ${i + 1}은 sigmaVmid_kPa·beta 필수(β=K·tanδ 산정 입력)`);
        fs = ly.beta * ly.sigmaVmid_kPa;
      } else throw new Error(`input gate: 층 ${i + 1} type=clay|sand`);
      const Qsi = fs * perim * emb;
      Qs += Qsi;
      rows.push({ layer: i + 1, type: ly.type, emb_m: +emb.toFixed(2), fs_kPa: +fs.toFixed(1), Qs_kN: +Qsi.toFixed(1) });
      z += ly.thick_m;
    }
    if (z < Lp) throw new Error('input gate: 지층 합계두께가 근입장 미만');
    // 선단
    const tp = input.tip;
    if (!tp) throw new Error('input gate: tip 필수');
    let qp;
    if (tp.type === 'clay') {
      if (!(Number(tp.Su_kPa) > 0)) throw new Error('input gate: tip.Su_kPa');
      qp = (Number(tp.Nc) > 0 ? tp.Nc : 9) * tp.Su_kPa; // Nc=9 깊은기초 고전값(명시)
    } else if (tp.type === 'sand') {
      if (!(Number(tp.sigmaVtip_kPa) > 0) || !(Number(tp.Nq) > 0)) throw new Error('input gate: 사질 선단은 sigmaVtip_kPa·Nq 필수(Nq=Meyerhof/Berezantzev 도표 산정 입력 — 기본값 없음)');
      qp = tp.Nq * tp.sigmaVtip_kPa;
    } else throw new Error('input gate: tip.type=clay|sand');
    const Qp = qp * Atip;
    const Qu = Qp + Qs;
    const FS = input.FS ?? 3.0;
    const Qa = Qu / FS;
    const pass = Number(input.demandP_kN) > 0 ? input.demandP_kN <= Qa : null;
    const r1 = (v) => +v.toFixed(1);
    return {
      verdict: pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL',
      checks: { capacity: { Qu_kN: r1(Qu), Qa_kN: r1(Qa), FS, ...(pass !== null ? { demand_kN: input.demandP_kN, ratio: +(input.demandP_kN / Qa).toFixed(3), pass } : {}) } },
      breakdown: { Qp_kN: r1(Qp), qp_kPa: r1(qp), Qs_kN: r1(Qs), shaft: rows },
      notes: [
        `Qu=${Qu.toFixed(0)}kN (선단 ${Qp.toFixed(0)}+주면 ${Qs.toFixed(0)}) / FS ${FS} → Qa=${Qa.toFixed(0)}kN.`,
        'α·β·Nq=도표/시험 산정 입력 원칙(기본값 없음 — 지어내지 않음). Nc=9는 깊은기초 고전값(명시). 허용=극한/FS 구조는 KDS 11 50 15 §4.1.1.3 원문.',
        '말뚝 재질(구조체) 강도·무리효율·부주면마찰·침하·횡방향·재하시험 보정은 별도/후속 명시.',
      ],
    };
  },
};
