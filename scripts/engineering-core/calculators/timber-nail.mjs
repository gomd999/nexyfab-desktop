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
  status: 'draft — 표 원문 파싱(스팟체크 정확). 항복모드식 교차검증·끝거리 게이트 후속',
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
    return {
      verdict: ratio <= 1 ? 'PASS' : 'FAIL',
      checks: { shear: { demand_N: input.demandN, capacity_N: +capacity.toFixed(0), perNail_N: +Zprime.toFixed(0), ratio: +ratio.toFixed(3), pass: ratio <= 1 } },
      intermediate: { Z_table_N: row[gi], CD, count: n, metalSide: !!input.metalSide },
      notes: [
        `표 4.4-4 기준값 ${row[gi]}N (${input.group}군) × CD ${CD}${input.metalSide ? ' × 1.10(금속측면판)' : ''} × ${n}본`,
        '끝거리·간격·연단거리(§4.4.4) 준수 전제 — 배치 게이트 후속. 습윤 접합부는 별도 감소 필요(원문 표 확인 예정).',
      ],
    };
  },
};
