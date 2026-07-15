/**
 * P6 조경/토목 — 격자 토공량 (점고법·사각기둥법 폐형) — 부지 정지 절·성토.
 * 격자 교점의 기존/계획 지반고 → 셀별 V = 평균고차 × 셀면적, 절토(+)/성토(−) 분리.
 * 검증 앵커: 균일 고차 h → V = h·A 정확 · 대칭 절성 상쇄 = 0.
 * 한계(명시): 직사각 균일 격자 v1 — 불규칙 삼각망(TIN)·토량환산계수(L·C)는 입력.
 */
export default {
  id: 'earthwork_grid',
  domain: 'landscape/earthwork',
  title: '격자 토공량 (점고법)',
  description: '기존·계획 지반고 격자 → 절토·성토량, 토량환산(입력 계수) 반영.',
  refs: ['점고법(사각기둥법) 폐형 — 측량·토공 교과서 표준'],
  status: 'verified — 폐형 앵커(균일 고차·상쇄). TIN·비균일 격자·운반거리 최적화는 후속',
  inputSchema: {
    type: 'object',
    required: ['existing', 'proposed', 'cellSize_m'],
    properties: {
      existing: { description: '기존 지반고 2D 배열 [row][col] (m) — 격자 교점' },
      proposed: { description: '계획 지반고 2D 배열 (동일 크기)' },
      cellSize_m: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: '격자 간격 m' },
      swellFactor: { type: 'number', minimum: 1.0, maximum: 1.6, description: '토량변화율 L(흐트러짐 — 운반토량용, 기본 1.0=미반영 명시)' },
      shrinkFactor: { type: 'number', minimum: 0.7, maximum: 1.0, description: '다짐 C(성토 필요 원지반토량 환산, 기본 1.0=미반영)' },
    },
  },
  run(input) {
    const ex = input.existing, pr = input.proposed;
    if (!Array.isArray(ex) || !Array.isArray(pr) || ex.length < 2 || ex.length !== pr.length || ex[0].length !== pr[0].length || ex[0].length < 2) {
      throw new Error('input gate: existing·proposed 동일 크기 2D 배열(≥2×2 교점) 필요');
    }
    const R = ex.length, C = ex[0].length;
    if (R * C > 10000) throw new Error('input gate: 교점 10,000개 이하');
    const A = input.cellSize_m * input.cellSize_m;
    let cut = 0, fill = 0;
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
      const dh = ((ex[r][c] - pr[r][c]) + (ex[r][c + 1] - pr[r][c + 1]) + (ex[r + 1][c] - pr[r + 1][c]) + (ex[r + 1][c + 1] - pr[r + 1][c + 1])) / 4;
      const V = dh * A;
      if (V > 0) cut += V; else fill += -V;
    }
    const L = input.swellFactor ?? 1.0, Cc = input.shrinkFactor ?? 1.0;
    const haul = cut * L;               // 운반토량(흐트러진 상태)
    const fillBank = fill / Cc;          // 성토에 필요한 원지반토량
    const net = cut - fillBank;          // +잉여(반출)/−부족(반입)
    const r2 = (v) => +v.toFixed(2);
    return {
      verdict: 'INFO',
      volumes: { cut_m3: r2(cut), fill_m3: r2(fill), haul_loose_m3: r2(haul), fillBank_m3: r2(fillBank), net_m3: r2(net), balance: net >= 0 ? '잉여(반출)' : '부족(반입)' },
      intermediate: { grid: `${R}×${C} 교점 · 셀 ${input.cellSize_m}m`, L, C: Cc },
      notes: [
        `점고법: 셀 평균고차×면적 합산 — 절토 ${cut.toFixed(1)}·성토 ${fill.toFixed(1)} m³ (자연상태).`,
        `토량환산: L=${L}(운반)·C=${Cc}(다짐) — 1.0=미반영 명시(토질시험값 입력 권장).`,
        '균일 직사각 격자 v1 — 경계 불규칙·TIN·유토곡선(운반거리)은 후속.',
      ],
    };
  },
};
