/**
 * P4 목구조 — 볼트접합부 1면전단 (목재-목재) — KDS 41 50 30 표 4.5-2.
 * Z' = Z(표, ∥/⊥) × CD × CM(표 4.9-2) × CΔ(§4.5.5 위치계수) × Cg(§4.9.2.6 무리작용) × n.
 * CΔ = 실제/총내력최소 보간(식 4.5-14·16 판독), 감소최소 미달 = FAIL.
 * Cg = 식(4.9-1) 원문 판독 전식 — nRow≥2일 때 부재 단면·간격으로 산정(γ=250/375·D^1.5).
 * 한계(명시): 두께쌍 절점(주38·89·140 × 측38) 외는 보수측 하향 절점만 허용.
 */
export default {
  id: 'timber_bolt',
  domain: 'timber/connection',
  title: '볼트접합부 1면전단 (목재-목재)',
  description: 'KDS 41 50 30 표 4.5-2 기준허용전단내력(∥/⊥) × CD × CM × CΔ × Cg.',
  refs: [
    'KDS 41 50 30:2022 §4.5.2.1·표 4.5-2 (원문 파싱)',
    'KDS 41 50 30:2022 §4.5.5 표 4.5-5~8·식 4.5-14·16 (위치계수 CΔ)',
    'KDS 41 50 30:2022 §4.9.2.6 식(4.9-1) (무리작용계수 Cg)',
    'KDS 41 50 30:2022 표 4.9-2 (접합부 습윤계수)',
    'KDS 41 50 10:2022 표 3.1-7 (CD)',
  ],
  status: 'verified — 표 원문 파싱 + CΔ·Cg·CM 원문식 (Cg γ값 NDS 계보 단위환산 교차일치)',
  inputSchema: {
    type: 'object',
    required: ['mainThk', 'sideThk', 'boltDia', 'group', 'demandN'],
    properties: {
      mainThk: { type: 'number', enum: [38, 89, 140], description: '주부재 두께 mm (표 절점)' },
      sideThk: { type: 'number', enum: [38], description: '측면부재 두께 mm (표 절점 — v1: 38)' },
      boltDia: { type: 'number', enum: [12, 16, 19, 22, 25], description: '볼트 지름 mm' },
      group: { type: 'string', enum: ['A', 'B', 'C', 'D'], description: '수종군' },
      grade: { type: 'string', enum: ['1', '2', '3'], description: '등급 (Cg의 E 산정용, 기본 2)' },
      loadDir: { type: 'string', enum: ['parallel', 'perp'], description: '하중 방향 (기본 parallel=섬유평행)' },
      count: { type: 'number', minimum: 1, maximum: 20, description: '볼트 총 개수 (기본 1)' },
      nRow: { type: 'number', minimum: 1, maximum: 12, description: '하중방향 1열 내 볼트 수 (기본 count와 동일 — Cg 산정)' },
      rowSpacing_mm: { type: 'number', minimum: 0, description: '1열 내 볼트 중심간격 s mm (nRow≥2 시 Cg 필수)' },
      mainWidth: { type: 'number', minimum: 10, maximum: 1000, description: '주부재 폭 mm (Cg의 Am=주두께×폭, nRow≥2 시 필수)' },
      sideWidth: { type: 'number', minimum: 10, maximum: 1000, description: '측면부재 폭 mm (Cg의 As, nRow≥2 시 필수)' },
      duration: { type: 'string', enum: ['permanent', 'tenYears', 'twoMonths', 'sevenDays', 'tenMinutes', 'impact'], description: '하중기간 (기본 tenYears)' },
      serviceWet: { type: 'boolean', description: '사용 중 함수율>19% (표 4.9-2: CM 0.7)' },
      loadType: { type: 'string', enum: ['tension', 'compression'], description: '평행하중 성격 (끝면거리 기준: 인장 침엽수 7D/압축 4D, 기본 tension)' },
      hardwood: { type: 'boolean', description: '활엽수 (인장 끝면 5D — 기본 침엽수 7D)' },
      endDist: { type: 'number', minimum: 0, description: '끝면거리 mm (입력 시 CΔ 산정, 감소최소 미달 FAIL)' },
      edgeDist: { type: 'number', minimum: 0, description: '연단거리 mm (게이트 — 미달 FAIL, 보간 없음: 표 4.5-5)' },
      spacing: { type: 'number', minimum: 0, description: '1열 내 간격 mm (입력 시 CΔ 산정 — rowSpacing_mm과 동일 물리량, 게이트 검사용)' },
      rowGap: { type: 'number', minimum: 0, description: '볼트 열 사이 간격 mm (입력 시 표 4.5-8 게이트: ∥ 1.5D · ⊥ l/D 구간별 2.5D~5D)' },
      demandN: { type: 'number', minimum: 0, description: '소요 전단력 N' },
    },
  },
  run(input, std) {
    const tb = std.timber?.boltShear_N;
    if (!tb) throw new Error('standard gate: boltShear 미탑재');
    const row = tb.table[input.mainThk + '/' + input.sideThk]?.[input.boltDia];
    if (!row) throw new Error(`표 절점 없음: ${input.mainThk}/${input.sideThk} D${input.boltDia}`);
    const gi = { A: 0, B: 1, C: 2, D: 3 }[input.group];
    const perp = input.loadDir === 'perp';
    const Z = row[gi * 2 + (perp ? 1 : 0)];
    const CD = std.timber.loadDurationCD[input.duration ?? 'tenYears'] ?? 1.0;
    const n = input.count ?? 1;
    const D = input.boltDia;
    const notes = [];

    // 습윤계수 CM (표 4.9-2, 측방하중 볼트: 사용중>19% → 0.7)
    const CM = input.serviceWet === true ? std.timber.connectionWetCM.bolt_lateral.serviceWet : 1.0;
    if (input.serviceWet) notes.push(`습윤 CM ${CM} (표 4.9-2 — 사용중 함수율>19%)`);

    // 위치계수 CΔ (§4.5.5): l/D = min(주부재 내 길이, 측면부재 내 길이 합)/D — 1면전단: min(주두께, 측두께)
    const lD = Math.min(input.mainThk, input.sideThk) / D;
    let cDelta = 1.0;
    const placeFails = [];
    if (input.endDist !== undefined) {
      const key = perp ? 'perp' : (input.loadType ?? 'tension') === 'compression' ? 'compression' : input.hardwood ? 'tensionHard' : 'tensionSoft';
      const [red, full] = std.timber.boltPlacement.end_D[key];
      if (input.endDist < red * D) placeFails.push(`끝면거리 ${input.endDist} < 감소최소 ${red}D=${(red * D).toFixed(0)}mm — 사용불가(표 4.5-6)`);
      else cDelta = Math.min(cDelta, Math.min(1, input.endDist / (full * D)));
    }
    if (input.spacing !== undefined) {
      const [red, full] = std.timber.boltPlacement.spacing_D;
      if (input.spacing < red * D) placeFails.push(`볼트간격 ${input.spacing} < 감소최소 ${red}D=${(red * D).toFixed(0)}mm — 사용불가(표 4.5-7)`);
      else cDelta = Math.min(cDelta, Math.min(1, input.spacing / (full * D)));
    }
    if (input.rowGap !== undefined) {
      // 표 4.5-8 볼트 열의 최소간격: ∥하중 1.5D · ⊥하중 l/D≤2→2.5D, 2<l/D<6→(5l+10D)/8, ≥6→5D
      const minRow = !perp ? 1.5 * D : lD <= 2 ? 2.5 * D : lD >= 6 ? 5 * D : (5 * (lD * D) + 10 * D) / 8;
      if (input.rowGap < minRow) placeFails.push(`열간격 ${input.rowGap} < ${minRow.toFixed(0)}mm (표 4.5-8${perp ? ` — l/D=${lD.toFixed(1)}` : ' ∥ 1.5D'})`);
    }
    if (input.edgeDist !== undefined) {
      const min = perp ? 4 * D : lD <= 6 ? 1.5 * D : Math.max(1.5 * D, input.rowSpacing_mm ?? 1.5 * D);
      if (input.edgeDist < min) placeFails.push(`연단거리 ${input.edgeDist} < ${(min).toFixed(0)}mm (표 4.5-5${perp ? ' 부하측면 4D' : ''})`);
    }
    if (cDelta < 1) notes.push(`위치계수 CΔ ${cDelta.toFixed(3)} (식 4.5-14·16 — 실제/총내력최소 보간)`);

    // 무리작용계수 Cg (§4.9.2.6 식 4.9-1) — 1열 내 2개 이상일 때
    const nRow = input.nRow ?? n;
    let Cg = 1.0;
    let cgDetail = null;
    if (nRow >= 2) {
      if (!input.rowSpacing_mm || !input.mainWidth || !input.sideWidth) {
        throw new Error('input gate: nRow≥2는 rowSpacing_mm·mainWidth·sideWidth 필수 (Cg 산정 — 지어내지 않음)');
      }
      const grade = input.grade ?? '2';
      const spMap = { A: 'larch', B: 'pine', C: 'koreanpine', D: 'cedar' };
      const E = std.timber.allowable_MPa[spMap[input.group]].grades[grade].E; // MPa
      const Am = input.mainThk * input.mainWidth, As = input.sideThk * input.sideWidth;
      const EmAm = E * Am, EsAs = E * As;
      const REA = Math.min(EsAs / EmAm, EmAm / EsAs);
      const gamma = 250 * Math.pow(D, 1.5); // 목재-목재 (금속측면판 375 — v1 목재-목재만)
      const s = input.rowSpacing_mm;
      const u = 1 + gamma * (s / 2) * (1 / EmAm + 1 / EsAs);
      const m = u - Math.sqrt(u * u - 1);
      const nr = nRow;
      Cg = (m * (1 - Math.pow(m, 2 * nr))) / (nr * ((1 + REA * Math.pow(m, nr)) * (1 + m) - 1 + Math.pow(m, 2 * nr))) * ((1 + REA) / (1 - m));
      cgDetail = { gamma_Npermm: +gamma.toFixed(0), u: +u.toFixed(4), m: +m.toFixed(4), REA: +REA.toFixed(3), nRow: nr };
      notes.push(`무리작용계수 Cg ${Cg.toFixed(3)} (식 4.9-1 — 1열 ${nr}본, s=${s}mm, γ=250·D^1.5)`);
    }

    const capacity = Z * CD * CM * cDelta * Cg * n;
    const ratio = input.demandN / capacity;
    const pass = ratio <= 1 && placeFails.length === 0;
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: {
        shear: { demand_N: input.demandN, capacity_N: +capacity.toFixed(0), perBolt_N: +(Z * CD * CM * cDelta * Cg).toFixed(0), ratio: +ratio.toFixed(3), pass: ratio <= 1 },
        ...(placeFails.length || input.endDist !== undefined || input.edgeDist !== undefined || input.spacing !== undefined
          ? { placement: { fails: placeFails, cDelta: +cDelta.toFixed(3), pass: placeFails.length === 0 } } : {}),
      },
      intermediate: { Z_table_N: Z, dir: perp ? 'Zs⊥' : 'Z∥', CD, CM, cDelta: +cDelta.toFixed(3), Cg: +Cg.toFixed(3), count: n, ...(cgDetail ? { cg: cgDetail } : {}) },
      notes: [
        `표 4.5-2 ${input.group}군 ${perp ? '측재 섬유수직' : '섬유평행'} ${Z}N × CD ${CD} × CM ${CM} × CΔ ${cDelta.toFixed(2)} × Cg ${Cg.toFixed(2)} × ${n}본`,
        ...notes,
        '배치 미입력 항목은 표 4.5-5~7 총내력 최소치 준수 전제(명시). 열간격(표 4.5-8)·경사하중은 후속.',
      ],
    };
  },
};
