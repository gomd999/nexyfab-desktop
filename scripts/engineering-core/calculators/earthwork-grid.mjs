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
  status: 'verified — 폐형 앵커(균일 고차·상쇄) + TIN 삼각기둥법(혼재 삼각형 교선 정확분할 — 폐형 앵커). 유토곡선(운반거리)은 후속',
  inputSchema: {
    type: 'object',
    required: [],
    properties: {
      existing: { description: '기존 지반고 2D 배열 [row][col] (m) — 격자 교점 (격자 모드)' },
      proposed: { description: '계획 지반고 2D 배열 (동일 크기)' },
      cellSize_m: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: '격자 간격 m (격자 모드 필수)' },
      tin: { description: 'TIN 모드(선택 — 격자 대신): { points: [[x,y,zExist,zPlan],...], triangles: [[i,j,k],...] } — 불규칙 삼각망. 삼각기둥법 V=A·(dz1+dz2+dz3)/3, 절성 혼재 삼각형은 평면 교선 정확 분할' },
      swellFactor: { type: 'number', minimum: 1.0, maximum: 1.6, description: '토량변화율 L(흐트러짐 — 운반토량용, 기본 1.0=미반영 명시)' },
      shrinkFactor: { type: 'number', minimum: 0.7, maximum: 1.0, description: '다짐 C(성토 필요 원지반토량 환산, 기본 1.0=미반영)' },
    },
  },
  run(input) {
    // ── TIN 모드: 삼각기둥법 — dz는 각 정점 선형(평면) 가정, 혼재 삼각형은 dz=0 교선으로 분할 적분(폐형) ──
    if (input.tin && !input.existing) {
      const { points, triangles } = input.tin;
      if (!Array.isArray(points) || points.length < 3 || !Array.isArray(triangles) || !triangles.length) throw new Error('input gate: tin.points(≥3)·tin.triangles 필요');
      if (triangles.length > 20000) throw new Error('input gate: 삼각형 20,000개 이하');
      let cut = 0, fill = 0, area = 0;
      // 선형 dz 평면 위 삼각형에서 양/음 부분 부피 폐형: 부호별 분할(작은 삼각형 재귀 아님 — 교선 정확 절단)
      const triVol = (p) => {
        // p: [{x,y,dz}×3] → {pos, neg, A}
        const A2 = (a, b, c) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
        const A = A2(p[0], p[1], p[2]);
        const sgn = p.map((v) => Math.sign(v.dz));
        if (A === 0) return { pos: 0, neg: 0, A: 0 };
        if (sgn.every((s) => s >= 0)) return { pos: (A * (p[0].dz + p[1].dz + p[2].dz)) / 3, neg: 0, A };
        if (sgn.every((s) => s <= 0)) return { pos: 0, neg: (-A * (p[0].dz + p[1].dz + p[2].dz)) / 3, A };
        // 혼재: dz=0 교선으로 절단 — 단독 부호 정점(o)과 반대 부호 두 정점(u,v)
        const solo = sgn[0] !== sgn[1] && sgn[0] !== sgn[2] ? 0 : sgn[1] !== sgn[0] && sgn[1] !== sgn[2] ? 1 : 2;
        const o = p[solo], u = p[(solo + 1) % 3], v = p[(solo + 2) % 3];
        const cutPt = (a, b) => { const t = a.dz / (a.dz - b.dz); return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), dz: 0 }; };
        const m1 = cutPt(o, u), m2 = cutPt(o, v);
        const rSolo = triVol([o, m1, m2]);
        const rQuad1 = triVol([m1, u, v]);
        const rQuad2 = triVol([m1, v, m2]);
        return { pos: rSolo.pos + rQuad1.pos + rQuad2.pos, neg: rSolo.neg + rQuad1.neg + rQuad2.neg, A };
      };
      for (const t of triangles) {
        const p = t.map((i) => { const q = points[i]; if (!q) throw new Error('input gate: 삼각형 인덱스 범위'); return { x: q[0], y: q[1], dz: q[2] - q[3] }; });
        const r = triVol(p);
        cut += r.pos; fill += r.neg; area += r.A;
      }
      const L = input.swellFactor ?? 1.0, Cc = input.shrinkFactor ?? 1.0;
      const fillBank = fill / Cc, net = cut - fillBank;
      const r2 = (v) => +v.toFixed(2);
      return {
        verdict: 'INFO',
        volumes: { cut_m3: r2(cut), fill_m3: r2(fill), haul_loose_m3: r2(cut * L), fillBank_m3: r2(fillBank), net_m3: r2(net), balance: net >= 0 ? '잉여(반출)' : '부족(반입)' },
        intermediate: { mode: 'TIN', triangles: triangles.length, area_m2: r2(area), L, C: Cc },
        notes: [
          `TIN 삼각기둥법: ${triangles.length}개 삼각형·면적 ${area.toFixed(1)}m² — 절토 ${cut.toFixed(1)}·성토 ${fill.toFixed(1)}m³.`,
          '정점 선형(dz 평면) 가정 — 혼재 삼각형은 dz=0 교선 절단 정확 적분(근사 아님). 삼각망 자체(측점 배치·분할)는 입력 책임 명시.',
          `토량환산: L=${L}·C=${Cc} — 1.0=미반영 명시.`,
        ],
      };
    }
    const ex = input.existing, pr = input.proposed;
    if (!ex || !pr || !(Number(input.cellSize_m) > 0)) throw new Error('input gate: 격자 모드는 existing·proposed·cellSize_m 필수 (또는 tin 입력)');
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
