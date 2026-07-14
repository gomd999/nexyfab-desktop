/**
 * P4 목구조 — 볼트접합부 1면전단 (목재-목재) — KDS 41 50 30 표 4.5-2.
 * Z' = Z(표, ∥/⊥) × CD × 개수. 원문이 표 수록값을 항복모드 6식과 동등 인정(§4.5.2.1).
 * v1 한계(명시): 끝면·연단·간격 규정(§4.5.5) 게이트 후속 · 그룹작용계수(다열) 미적용 ·
 * 두께쌍 절점(주38·89·140 × 측38) 외는 보수측 하향 절점만 허용.
 */
export default {
  id: 'timber_bolt',
  domain: 'timber/connection',
  title: '볼트접합부 1면전단 (목재-목재)',
  description: 'KDS 41 50 30 표 4.5-2 기준허용전단내력(∥/⊥) × CD × 개수.',
  refs: ['KDS 41 50 30:2022 §4.5.2.1·표 4.5-2 (원문 파싱)', 'KDS 41 50 10:2022 표 3.1-7 (CD)'],
  status: 'draft — 표 원문 파싱(스팟 정확). 항복모드 6식 교차검증·배치 게이트·그룹계수 후속',
  inputSchema: {
    type: 'object',
    required: ['mainThk', 'sideThk', 'boltDia', 'group', 'demandN'],
    properties: {
      mainThk: { type: 'number', enum: [38, 89, 140], description: '주부재 두께 mm (표 절점)' },
      sideThk: { type: 'number', enum: [38], description: '측면부재 두께 mm (표 절점 — v1: 38)' },
      boltDia: { type: 'number', enum: [12, 16, 19, 22, 25], description: '볼트 지름 mm' },
      group: { type: 'string', enum: ['A', 'B', 'C', 'D'], description: '수종군' },
      loadDir: { type: 'string', enum: ['parallel', 'perp'], description: '하중 방향 (기본 parallel=섬유평행)' },
      count: { type: 'number', minimum: 1, maximum: 20, description: '볼트 개수 (기본 1 — 다열 그룹계수 미적용 명시)' },
      duration: { type: 'string', enum: ['permanent', 'tenYears', 'twoMonths', 'sevenDays', 'tenMinutes', 'impact'], description: '하중기간 (기본 tenYears)' },
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
    const capacity = Z * CD * n;
    const ratio = input.demandN / capacity;
    return {
      verdict: ratio <= 1 ? 'PASS' : 'FAIL',
      checks: { shear: { demand_N: input.demandN, capacity_N: +capacity.toFixed(0), perBolt_N: +(Z * CD).toFixed(0), ratio: +ratio.toFixed(3), pass: ratio <= 1 } },
      intermediate: { Z_table_N: Z, dir: perp ? 'Zs⊥' : 'Z∥', CD, count: n },
      notes: [
        `표 4.5-2 ${input.group}군 ${perp ? '측재 섬유수직' : '섬유평행'} ${Z}N × CD ${CD} × ${n}본`,
        '끝면·연단·간격(§4.5.5)·다열 그룹작용계수 미적용 — 배치 규정 준수 전제(후속 게이트). 습윤 접합부 감소 원문 확인 예정.',
      ],
    };
  },
};
