/**
 * P18 건축 — 특수모멘트골조 상세 게이트 (KDS 14 20 80 §4.4~4.5 원문 판독).
 * 보(§4.4): 적용(Pu≤Agfck/10·ln≥4d·b/h≥0.3·b≥250) · As,min≥1.4bwd/fy·ρ≤0.025 ·
 *   정모멘트≥부모멘트/2(접합면) · 후프구간 2h·첫 50mm·간격 min(d/4, 8db, 24dh, 300) ·
 *   비후프 구간 스터럽 ≤d/2.
 * 기둥(§4.5): 적용(Pu>Agfck/10·최소치수≥300·비≥0.4) · 강기둥-약보 ΣMc≥(6/5)ΣMg(식4.5-1)
 *   · ρ 0.01~0.06 · 후프량 Ash≥max(0.3·s·hc·(fck/fyh)(Ag/Ach−1), 0.09·s·hc·fck/fyh)
 *   (식4.5-3/4) · 나선 ρs≥0.12fck/fyh(4.5-2) · 간격 min(최소치수/4, 6db, sx),
 *   sx=100+(350−hx)/3 (식4.5-5).
 * 전부 게이트(판정) — 강도 산정은 rc_beam·rc_column_pm과 연계.
 */
export default {
  id: 'smf_detail',
  domain: 'architecture/seismic',
  title: '특수모멘트골조 상세 게이트 (§4.4~4.5)',
  description: 'SMF 보·기둥 내진 상세(치수·철근비·후프량·간격·강기둥-약보) 전 게이트.',
  refs: ['KDS 14 20 80:2022 §4.4(보)·§4.5(기둥) — Agfck/10·1.4bwd/fy·0.025·d/4·8db·24dh·300·d/2·6/5·0.01~0.06·식4.5-2/3/4/5 전부 원문 GIF 판독'],
  status: 'verified — 원문 수치 게이트(결정론). 접합부 전단(§4.7)·정착(§4.6)·중간모멘트골조(§4.10)는 후속',
  inputSchema: {
    type: 'object',
    required: ['member'],
    properties: {
      member: { enum: ['beam', 'column'], description: '부재 구분' },
      b_mm: { type: 'number', exclusiveMinimum: 0, description: '폭(보)/최소 단면치수(기둥)' },
      h_mm: { type: 'number', exclusiveMinimum: 0, description: '깊이(보)/직각방향 치수(기둥)' },
      d_mm: { type: 'number', exclusiveMinimum: 0, description: '유효깊이(보)' },
      ln_mm: { type: 'number', exclusiveMinimum: 0, description: '순경간(보 — ln≥4d 게이트)' },
      Pu_kN: { type: 'number', minimum: 0, description: '계수축력 (적용 구분 Agfck/10)' },
      fck: { type: 'number', minimum: 21, maximum: 70 },
      fy: { type: 'number', minimum: 300, maximum: 600, description: '축방향 철근 fy' },
      fyh: { type: 'number', minimum: 300, maximum: 600, description: '횡방향 철근 fyh (기둥 후프량)' },
      As_mm2: { type: 'number', exclusiveMinimum: 0, description: '주철근량 (보 ρ·기둥 ρg)' },
      db_mm: { type: 'number', exclusiveMinimum: 0, description: '축방향 철근 지름 (간격 게이트)' },
      dbh_mm: { type: 'number', exclusiveMinimum: 0, description: '후프 지름 (보 24dh)' },
      s_mm: { type: 'number', exclusiveMinimum: 0, description: '후프/횡철근 간격 (계획)' },
      hc_mm: { type: 'number', exclusiveMinimum: 0, description: '심부 치수 hc (기둥 Ash — 후프 중심간)' },
      Ach_mm2: { type: 'number', exclusiveMinimum: 0, description: '심부 면적 (기둥 4.5-3)' },
      Ash_mm2: { type: 'number', exclusiveMinimum: 0, description: '제공 후프 단면적 (간격 s당)' },
      hx_mm: { type: 'number', exclusiveMinimum: 0, description: '연결철근/후프다리 수평간격 (식4.5-5)' },
      sumMc_kNm: { type: 'number', exclusiveMinimum: 0, description: '기둥 설계휨강도 합 (강기둥-약보)' },
      sumMg_kNm: { type: 'number', exclusiveMinimum: 0, description: '보 설계휨강도 합' },
      MposFace_kNm: { type: 'number', exclusiveMinimum: 0, description: '접합면 정모멘트 강도 (보 §4.4.2(2))' },
      MnegFace_kNm: { type: 'number', exclusiveMinimum: 0, description: '접합면 부모멘트 강도' },
    },
  },
  run(input) {
    const g = [];
    const add = (gate, value, limit, pass, ref) => g.push({ gate, value: +Number(value).toFixed(2), limit: +Number(limit).toFixed(2), pass, ref });
    const Ag = (input.b_mm ?? 0) * (input.h_mm ?? 0);
    const threshold = (Ag * input.fck) / 10 / 1000; // kN
    if (input.member === 'beam') {
      for (const k of ['b_mm', 'h_mm', 'd_mm', 'fck', 'fy']) if (!(Number(input[k]) > 0)) throw new Error('input gate: ' + k);
      if (Number(input.Pu_kN) >= 0) add('축력 Pu ≤ Agfck/10 (§4.4.1(2)①)', input.Pu_kN ?? 0, threshold, (input.Pu_kN ?? 0) <= threshold, '초과 시 §4.5 기둥 규정');
      if (Number(input.ln_mm) > 0) add('순경간 ln ≥ 4d (§(2)②)', input.ln_mm, 4 * input.d_mm, input.ln_mm >= 4 * input.d_mm);
      add('폭비 b/h ≥ 0.3 (§(2)③)', input.b_mm / input.h_mm, 0.3, input.b_mm / input.h_mm >= 0.3);
      add('폭 b ≥ 250 (§(2)④)', input.b_mm, 250, input.b_mm >= 250);
      if (Number(input.As_mm2) > 0) {
        const AsMin = (1.4 * input.b_mm * input.d_mm) / input.fy;
        const rho = input.As_mm2 / (input.b_mm * input.d_mm);
        add('As ≥ 1.4bwd/fy (§4.4.2(1))', input.As_mm2, AsMin, input.As_mm2 >= AsMin, '식4.2-1(√fck/4) 병행 확인');
        add('ρ ≤ 0.025 (§4.4.2(1))', rho, 0.025, rho <= 0.025);
      }
      if (Number(input.MposFace_kNm) > 0 && Number(input.MnegFace_kNm) > 0) {
        add('접합면 M+ ≥ M−/2 (§4.4.2(2))', input.MposFace_kNm, input.MnegFace_kNm / 2, input.MposFace_kNm >= input.MnegFace_kNm / 2);
      }
      if (Number(input.s_mm) > 0 && Number(input.db_mm) > 0 && Number(input.dbh_mm) > 0) {
        const sLim = Math.min(input.d_mm / 4, 8 * input.db_mm, 24 * input.dbh_mm, 300);
        add('후프 간격 ≤ min(d/4, 8db, 24dh, 300) (§4.4.3(2))', input.s_mm, sLim, input.s_mm <= sLim, '후프구간=단부 2h·첫 후프 50mm 이내');
        add('비후프 구간 스터럽 ≤ d/2 (§4.4.3(4))', input.s_mm, input.d_mm / 2, input.s_mm <= input.d_mm / 2, '전길이 내진갈고리 스터럽');
      }
    } else {
      for (const k of ['b_mm', 'h_mm', 'fck', 'fyh']) if (!(Number(input[k]) > 0)) throw new Error('input gate: ' + k);
      add('최소치수 ≥ 300 (§4.5.1(2)①)', Math.min(input.b_mm, input.h_mm), 300, Math.min(input.b_mm, input.h_mm) >= 300);
      const ratio = Math.min(input.b_mm, input.h_mm) / Math.max(input.b_mm, input.h_mm);
      add('치수비 ≥ 0.4 (§(2)②)', ratio, 0.4, ratio >= 0.4);
      if (Number(input.sumMc_kNm) > 0 && Number(input.sumMg_kNm) > 0) {
        add('강기둥-약보 ΣMc ≥ (6/5)ΣMg (식4.5-1)', input.sumMc_kNm, (6 / 5) * input.sumMg_kNm, input.sumMc_kNm >= (6 / 5) * input.sumMg_kNm);
      }
      if (Number(input.As_mm2) > 0) {
        const rho = input.As_mm2 / Ag;
        add('ρg 0.01~0.06 (§4.5.3(1))', rho, 0.06, rho >= 0.01 && rho <= 0.06, rho < 0.01 ? '하한 미달' : undefined);
      }
      if (Number(input.s_mm) > 0 && Number(input.hc_mm) > 0 && Number(input.Ach_mm2) > 0 && Number(input.Ash_mm2) > 0) {
        const a1 = 0.3 * input.s_mm * input.hc_mm * (input.fck / input.fyh) * (Ag / input.Ach_mm2 - 1); // 식4.5-3
        const a2 = 0.09 * input.s_mm * input.hc_mm * (input.fck / input.fyh);                            // 식4.5-4
        const AshReq = Math.max(a1, a2);
        add('후프량 Ash ≥ max(식4.5-3, 4.5-4)', input.Ash_mm2, AshReq, input.Ash_mm2 >= AshReq, `4.5-3=${a1.toFixed(0)}·4.5-4=${a2.toFixed(0)}`);
      }
      if (Number(input.s_mm) > 0 && Number(input.db_mm) > 0) {
        const sx = Number(input.hx_mm) > 0 ? Math.min(150, Math.max(100, 100 + (350 - input.hx_mm) / 3)) : null; // 식4.5-5 (100~150 범위 관례)
        const sLim = Math.min(Math.min(input.b_mm, input.h_mm) / 4, 6 * input.db_mm, sx ?? Infinity);
        add('횡철근 간격 ≤ min(최소치수/4, 6db' + (sx ? `, sx=${sx.toFixed(0)}` : '') + ') (§4.5.4(2)·식4.5-5)', input.s_mm, sLim, input.s_mm <= sLim);
      }
    }
    const pass = g.every((x) => x.pass);
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: { gates: g, threshold_AgFck10_kN: +threshold.toFixed(1) },
      notes: [
        `SMF ${input.member === 'beam' ? '보(§4.4)' : '기둥(§4.5)'} 상세 게이트 ${g.length}건 — 전부 원문 수치.`,
        '겹침이음 위치·기계/용접이음(§4.1.6~7)·정착(§4.6)·접합부 전단(§4.7)·전단 요구(Mpr 기반 §4.4.4/4.5.5)는 별도/후속 명시.',
        '강도 자체는 rc_beam·rc_column_pm으로 검토 — 본 계산기는 내진 상세 적합성.',
      ],
    };
  },
};
