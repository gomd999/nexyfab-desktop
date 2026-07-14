/**
 * P4 조경/목구조 — 못접합부 1면전단 (목재-목재) — KDS 41 50 30 표 4.4-4.
 * Z' = Z(표) × CD(하중기간) × n(개수). 원문이 표 수록값을 항복모드식과 동등 인정(§4.4.3.1).
 * v1 한계(명시): 끝거리·간격·연단거리 상세(§4.4.4) 미검토 — 배치 규정 준수 전제.
 * 습윤 접합부 감소계수는 원문 표 확인 후 적용 예정 — 습윤 환경은 보수적 별도 검토 요.
 */
export default {
  id: 'timber_nail',
  domain: 'timber/connection',
  title: '못접합부 1면전단 (목재-목재)',
  description: 'KDS 41 50 30 표 4.4-4 보통못 기준허용전단내력 × CD × 개수.',
  refs: ['KDS 41 50 30:2022 §4.4.3.1·표 4.4-4 (원문 파싱)', 'KDS 41 50 10:2022 표 3.1-7 (CD)'],
  status: 'verified — 표 원문 파싱 + 항복모드식 교차검증(D≤6.0 재현 98/100 ±4%) + 배치·관입 게이트',
  inputSchema: {
    type: 'object',
    required: ['sideThk', 'nailLen', 'nailDia', 'group', 'demandN'],
    properties: {
      sideThk: { type: 'number', enum: [12, 19, 25, 38], description: '측면부재 두께 mm (표 절점)' },
      nailLen: { type: 'number', minimum: 50, maximum: 152, description: '못 길이 mm (표 절점)' },
      nailDia: { type: 'number', minimum: 2.5, maximum: 7, description: '못 지름 mm (표 절점)' },
      group: { type: 'string', enum: ['A', 'B', 'C', 'D'], description: '수종군 (낙엽송류A~삼나무류D)' },
      count: { type: 'number', minimum: 1, maximum: 50, description: '못 개수 (기본 1)' },
      duration: { type: 'string', enum: ['permanent', 'tenYears', 'twoMonths', 'sevenDays', 'tenMinutes', 'impact'], description: '하중기간 (기본 tenYears)' },
      metalSide: { type: 'boolean', description: '금속측면판 (+10%, §4.4.3.2)' },
      demandN: { type: 'number', minimum: 0, description: '소요 전단력 N (접합부 전체)' },
      predrilled: { type: 'boolean', description: '미리 구멍 뚫음 (표 4.4-5 완화 기준 적용)' },
      endDist: { type: 'number', minimum: 0, description: '끝면거리 mm (입력 시 표 4.4-5 게이트 검사)' },
      edgeDist: { type: 'number', minimum: 0, description: '연단거리 mm' },
      spacingPar: { type: 'number', minimum: 0, description: '섬유 평행 간격 mm' },
      spacingPerp: { type: 'number', minimum: 0, description: '섬유 수직 간격 mm' },
    },
  },
  run(input, std) {
    const tb = std.timber?.nailShear_N;
    if (!tb) throw new Error('standard gate: nailShear 미탑재');
    const row = tb.table[input.sideThk]?.[input.nailLen + '/' + input.nailDia];
    if (!row) throw new Error(`표 절점 없음: 측재 ${input.sideThk} · 못 ${input.nailLen}/${input.nailDia} — 표 4.4-4 조합 확인 (인접 절점 사용은 보수측 하향만 허용)`);
    const gi = { A: 0, B: 1, C: 2, D: 3 }[input.group];
    const CD = std.timber.loadDurationCD[input.duration ?? 'tenYears'] ?? 1.0;
    const n = input.count ?? 1;
    const Z = row[gi] * (input.metalSide ? 1.10 : 1.0);
    const Zprime = Z * CD;
    const capacity = Zprime * n;
    const ratio = input.demandN / capacity;

    // 관입깊이 게이트 (§4.4.3.3): 표 기준값 = 관입 p≥12D 전제. p<12D는 식(4.4-6) 보정
    // 필요(원문 수식 판독 후속) — v1은 12D 미만이면 FAIL(정직 게이트). 최소 6D.
    const D = input.nailDia;
    const p = input.nailLen - input.sideThk; // 주부재 관입
    const penOk = p >= 12 * D;
    const penMsg = p < 6 * D ? `관입 ${p.toFixed(0)}mm < 6D(${(6 * D).toFixed(0)}) — 불가` : !penOk ? `관입 ${p.toFixed(0)}mm < 12D(${(12 * D).toFixed(0)}) — 식(4.4-6) 보정 필요(v1 게이트 FAIL)` : null;

    // 배치 게이트 (표 4.4-5, 입력 시만): 끝면 20D/10D·연단 5D·평행 20D/10D·수직 10D/3D
    const pd = input.predrilled === true;
    const lim = { endDist: (pd ? 10 : 20) * D, edgeDist: 5 * D, spacingPar: (pd ? 10 : 20) * D, spacingPerp: (pd ? 3 : 10) * D };
    const placeFails = [];
    for (const kk of ['endDist', 'edgeDist', 'spacingPar', 'spacingPerp']) {
      if (input[kk] !== undefined && input[kk] < lim[kk]) placeFails.push(`${kk} ${input[kk]} < ${lim[kk]}mm (표 4.4-5${pd ? ' 천공' : ''})`);
    }

    // 항복모드식 교차검증 (§4.4.3 식 4.4-1~5, D≤6.0만 — kds.json nailYield.validation 참조).
    // Fyb는 표 재현 역산으로 확정한 경험 앵커(원문 수치 명기 없음). 표값이 항상 지배.
    let yieldEq = null;
    const ny = std.timber.nailYield;
    if (ny && D <= 6.0) {
      const g = ny.G[input.group];
      const Fyb = ny.Fyb_MPa.find((f) => D <= f.maxD)?.v;
      if (Fyb) {
        const KDv = D <= 4.5 ? 2.2 : D <= 5.0 ? 2.4 : D <= 5.5 ? 2.6 : 2.8;
        const Fe = 117 * Math.pow(g, 1.84), Re = 1, ts = input.sideThk, pe = Math.min(p, 12 * D);
        const Is = D * ts * Fe / KDv;
        const k1 = -1 + Math.sqrt(2 * (1 + Re) + (2 * Fyb * (1 + 2 * Re) * D * D) / (3 * Fe * pe * pe));
        const IIIm = k1 * D * pe * Fe / (KDv * (1 + 2 * Re));
        const k2 = -1 + Math.sqrt((2 * (1 + Re)) / Re + (2 * Fyb * (2 + Re) * D * D) / (3 * Fe * ts * ts));
        const IIIs = k2 * D * ts * Fe / (KDv * (2 + Re));
        const IV = (D * D / KDv) * Math.sqrt((2 * Fe * Fyb) / (3 * (1 + Re)));
        const Zeq = Math.min(Is, IIIm, IIIs, IV);
        const modes = { Is, IIIm, IIIs, IV };
        yieldEq = {
          Z_eq_N: +Zeq.toFixed(0),
          governingMode: Object.keys(modes).find((m) => modes[m] === Zeq),
          Fyb_MPa: Fyb,
          deviation_pct: +((Zeq - row[gi]) / row[gi] * 100).toFixed(1),
        };
      }
    }

    const pass = ratio <= 1 && penOk && placeFails.length === 0;
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: {
        shear: { demand_N: input.demandN, capacity_N: +capacity.toFixed(0), perNail_N: +Zprime.toFixed(0), ratio: +ratio.toFixed(3), pass: ratio <= 1 },
        penetration: { p_mm: +p.toFixed(0), min12D_mm: +(12 * D).toFixed(0), pass: penOk },
        ...(placeFails.length || input.endDist !== undefined ? { placement: { fails: placeFails, pass: placeFails.length === 0 } } : {}),
      },
      intermediate: { Z_table_N: row[gi], CD, count: n, metalSide: !!input.metalSide, ...(yieldEq ? { yieldEq } : {}) },
      notes: [
        `표 4.4-4 기준값 ${row[gi]}N (${input.group}군) × CD ${CD}${input.metalSide ? ' × 1.10(금속측면판)' : ''} × ${n}본`,
        ...(yieldEq ? [`항복모드식 교차검증: Z_eq ${yieldEq.Z_eq_N}N (${yieldEq.governingMode} 지배, Fyb ${yieldEq.Fyb_MPa}, 편차 ${yieldEq.deviation_pct}%) — 표값 지배`] : []),
        ...(penMsg ? [penMsg] : []),
        '배치 최소치=표 4.4-5(미입력 항목은 준수 전제 명시). 습윤 접합부 감소 원문 확인 예정.',
      ],
    };
  },
};
