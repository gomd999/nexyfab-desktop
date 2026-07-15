/**
 * P20 교량 — 교각 내진 심부구속 철근 (KDS 24 17 11 §4.6.3.4~5 원문 판독).
 * 원형(나선/후프): ρs = max( 0.45(Ag/Ac−1)·fck/fyh [식4.6-5], 0.12·fck/fyh [식4.6-6] ).
 * 사각형: Ash = max( 0.30·a·hc·(fck/fyh)(Ag/Ac−1) [4.6-7], 0.12·a·hc·fck/fyh [4.6-8] ).
 * 상세 게이트(§4.6.3.5 원문): 소성힌지구간 나선 겹침이음 금지(기계/용접) · 보강띠 갈고리
 *   135°/90°+연장 max(6db, 80mm) · 수평간격 ≤350mm · 첫 배근 = 경계면에서 s/2.
 * 연성도 내진설계(4.6.6 소요연성도 기반)·최대소성힌지력·전단은 후속 명시 —
 *   본 계산기는 완전연성(개념) 심부구속량 검토.
 */
export default {
  id: 'pier_seismic',
  domain: 'bridge/seismic',
  title: '교각 심부구속 철근 (§4.6.3.4)',
  description: '원형 ρs·사각 Ash 심부구속량 + 상세 게이트 — KDS 24 17 11 원문식.',
  refs: ['KDS 24 17 11 §4.6.3.4(식4.6-5~8: 0.45/0.12·0.30/0.12)·§4.6.3.5(겹침금지·6db/80·350mm·s/2) — 원문 GIF 판독'],
  status: 'verified — 원문 계수 + 폐형 손검증. 연성도 설계(4.6.6)·소성힌지력·전단(4.6.2.6)·중공단면(4.6.5)은 후속',
  inputSchema: {
    type: 'object',
    required: ['shape', 'fck', 'fyh'],
    properties: {
      shape: { enum: ['circular', 'rectangular'], description: '단면 형상' },
      fck: { type: 'number', minimum: 21, maximum: 60 },
      fyh: { type: 'number', minimum: 300, maximum: 500, description: '횡방향철근 항복강도' },
      D_mm: { type: 'number', exclusiveMinimum: 0, description: '원형: 기둥 지름' },
      Dc_mm: { type: 'number', exclusiveMinimum: 0, description: '원형: 심부 지름(나선 외경)' },
      b_mm: { type: 'number', exclusiveMinimum: 0, description: '사각: 폭' },
      h_mm: { type: 'number', exclusiveMinimum: 0, description: '사각: 깊이' },
      bc_mm: { type: 'number', exclusiveMinimum: 0, description: '사각: 심부 폭(후프 외측간)' },
      hc_mm: { type: 'number', exclusiveMinimum: 0, description: '사각: 검토 방향 심부 치수 hc' },
      a_mm: { type: 'number', exclusiveMinimum: 0, description: '사각: 횡방향철근 수직간격 a' },
      provided: { description: '제공 철근(검토): { rhoS?(원형 체적비), Ash_mm2?(사각 간격 a당), spacing_mm?(상세 게이트), dbTie_mm?(띠철근 지름) }' },
    },
  },
  run(input) {
    const { fck, fyh } = input;
    const gates = [];
    let req = null, prov = null, kind;
    if (input.shape === 'circular') {
      for (const k of ['D_mm', 'Dc_mm']) if (!(Number(input[k]) > 0)) throw new Error('input gate: ' + k);
      const Ag = (Math.PI * input.D_mm ** 2) / 4;
      const Ac = (Math.PI * input.Dc_mm ** 2) / 4;
      const r1 = 0.45 * (Ag / Ac - 1) * (fck / fyh); // 식4.6-5
      const r2 = 0.12 * (fck / fyh);                  // 식4.6-6
      req = Math.max(r1, r2);
      kind = `ρs,req = max(0.45(Ag/Ac−1), 0.12)·fck/fyh = max(${r1.toFixed(4)}, ${r2.toFixed(4)})`;
      prov = Number(input.provided?.rhoS) > 0 ? input.provided.rhoS : null;
    } else {
      for (const k of ['b_mm', 'h_mm', 'bc_mm', 'hc_mm', 'a_mm']) if (!(Number(input[k]) > 0)) throw new Error('input gate: ' + k);
      const Ag = input.b_mm * input.h_mm;
      const Ac = input.bc_mm * input.hc_mm;
      const a1 = 0.30 * input.a_mm * input.hc_mm * (fck / fyh) * (Ag / Ac - 1); // 식4.6-7
      const a2 = 0.12 * input.a_mm * input.hc_mm * (fck / fyh);                  // 식4.6-8
      req = Math.max(a1, a2);
      kind = `Ash,req = max(0.30·a·hc·(fck/fyh)(Ag/Ac−1), 0.12·a·hc·fck/fyh) = max(${a1.toFixed(0)}, ${a2.toFixed(0)})mm²`;
      prov = Number(input.provided?.Ash_mm2) > 0 ? input.provided.Ash_mm2 : null;
      gates.push({ gate: '보강띠 수평간격 ≤350mm(§4.6.3.5(6))', value: input.provided?.spacing_mm ?? null, limit: 350, pass: Number(input.provided?.spacing_mm) > 0 ? input.provided.spacing_mm <= 350 : null });
    }
    if (Number(input.provided?.dbTie_mm) > 0) {
      const ext = Math.max(6 * input.provided.dbTie_mm, 80);
      gates.push({ gate: '갈고리 연장 ≥max(6db, 80)(§4.6.3.5(3)(4))', value: null, limit: +ext.toFixed(0), pass: null, note: '상세도 반영 확인 항목(치수 게이트 아님)' });
    }
    const pass = prov !== null ? prov >= req : null;
    return {
      verdict: pass === null ? 'INFO' : pass && gates.every((g) => g.pass !== false) ? 'PASS' : 'FAIL',
      checks: {
        confinement: { required: +req.toFixed(input.shape === 'circular' ? 5 : 0), provided: prov, formula: kind, ...(pass !== null ? { pass } : { note: 'provided 입력 시 판정' }) },
        ...(gates.length ? { detailGates: gates } : {}),
      },
      notes: [
        kind + ' — 식4.6-5~8 원문. 소성힌지구역 전 구간 적용(구역 길이=§4.6.3.2 별도).',
        '상세(§4.6.3.5 원문): 소성힌지구간 나선 겹침이음 금지(기계/용접)·첫 배근 경계면 s/2·135°/90° 갈고리 연장 max(6db,80).',
        '연성도 기반 설계(§4.6.6 소요연성도)·최대 소성힌지력·전단강도(§4.6.2.6)·중공원형(§4.6.5)은 후속 — 본 검토는 심부구속량.',
      ],
    };
  },
};
