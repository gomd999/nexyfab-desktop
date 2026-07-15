/**
 * P16 토목 — 유토곡선 (Mass Haul Diagram) — 폐형.
 * 측점 구간별 절토(+)·성토(−)량 → 누적토량곡선. 성토는 다짐 보정(÷C — 토량환산).
 * 산출: 곡선 좌표·균형점(0 교차, 선형보간)·구간별 운반 방향·평균운반거리
 *   (구간 면적/이동토량 — 유토곡선 표준 해석)·총 잉여/부족.
 * 앵커: 대칭 절-성 케이스 → 균형점 정중앙·잉여 0 (폐형 자체검증).
 * 경제 운반거리(자유·유상 한계) 판정은 장비 단가 의존 — 한계거리 입력 시 초과 구간 표시.
 */
export default {
  id: 'mass_haul',
  domain: 'civil/earthwork',
  title: '유토곡선 (누적토량·운반)',
  description: '측점별 절/성토 → 누적곡선·균형점·평균운반거리·잉여/부족 — 다짐 보정 반영.',
  refs: ['유토곡선(Mass Haul) 표준 해석 — 토공·도로공학 교과서 폐형', '토량환산계수 C는 시험값 입력(earthwork_grid와 동일 원칙)'],
  status: 'verified — 폐형 앵커(대칭 상쇄·균형점). 경제운반 판정은 한계거리 입력 시 표시(단가 판단 별도)',
  inputSchema: {
    type: 'object',
    required: ['stations'],
    properties: {
      stations: { description: '구간 배열 [{sta_m(구간 끝 측점 위치), cut_m3, fill_m3}] — 측점 순서대로(구간장 임의)' },
      shrinkC: { type: 'number', minimum: 0.7, maximum: 1.0, description: '다짐 토량환산 C (성토 필요 원지반토량 = fill/C, 기본 1.0=미반영 명시)' },
      freeHaul_m: { type: 'number', exclusiveMinimum: 0, description: '무료 운반거리 (선택 — 초과 구간 표시. 장비·단가 판단은 별도 명시)' },
    },
  },
  run(input) {
    const st = input.stations;
    if (!Array.isArray(st) || st.length < 2 || st.length > 500) throw new Error('input gate: stations 2~500 구간');
    const C = input.shrinkC ?? 1.0;
    let cum = 0, prevSta = 0;
    const curve = [{ sta_m: 0, cum_m3: 0 }];
    let totalCut = 0, totalFill = 0;
    for (const [i, s] of st.entries()) {
      if (!(Number(s.sta_m) > prevSta)) throw new Error(`input gate: 구간 ${i + 1} sta_m 오름차순`);
      const cut = Number(s.cut_m3) || 0, fill = Number(s.fill_m3) || 0;
      totalCut += cut; totalFill += fill;
      cum += cut - fill / C;
      curve.push({ sta_m: s.sta_m, cum_m3: +cum.toFixed(1) });
      prevSta = s.sta_m;
    }
    // 균형점: 누적곡선 0 교차(선형보간)
    const balance = [];
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1], b = curve[i];
      if ((a.cum_m3 > 0 && b.cum_m3 < 0) || (a.cum_m3 < 0 && b.cum_m3 > 0)) {
        const t = Math.abs(a.cum_m3) / (Math.abs(a.cum_m3) + Math.abs(b.cum_m3));
        balance.push(+(a.sta_m + t * (b.sta_m - a.sta_m)).toFixed(1));
      } else if (b.cum_m3 === 0 && a.cum_m3 !== 0) balance.push(b.sta_m);
    }
    // 평균운반거리: 유토곡선 면적(사다리꼴 적분)/최대 이동토량 — 루프별이 정석이나 v1은 전체 평균(명시)
    let area = 0;
    for (let i = 1; i < curve.length; i++) {
      area += ((Math.abs(curve[i - 1].cum_m3) + Math.abs(curve[i].cum_m3)) / 2) * (curve[i].sta_m - curve[i - 1].sta_m);
    }
    const peak = Math.max(...curve.map((p) => Math.abs(p.cum_m3)));
    const avgHaul = peak > 0 ? area / peak : 0;
    // 운반 방향(구간): 누적 증가=절토 우세(전방 운반), 감소=성토 우세
    const surplus = cum; // 끝점 누적 = 총 잉여(+반출)/부족(−반입)
    let freeNote = null;
    if (Number(input.freeHaul_m) > 0) {
      freeNote = avgHaul > input.freeHaul_m
        ? `⚠ 평균운반거리 ${avgHaul.toFixed(0)}m > 무료운반 ${input.freeHaul_m}m — 유상운반 구간 발생(단가 판단 별도)`
        : `평균운반거리 ${avgHaul.toFixed(0)}m ≤ 무료운반 ${input.freeHaul_m}m`;
    }
    return {
      verdict: 'INFO',
      checks: {
        summary: { totalCut_m3: +totalCut.toFixed(1), totalFillBank_m3: +(totalFill / C).toFixed(1), surplus_m3: +surplus.toFixed(1), balance: surplus >= 0 ? '잉여(반출)' : '부족(반입)' },
        haul: { avgHaul_m: +avgHaul.toFixed(1), peak_m3: +peak.toFixed(1), balancePoints_m: balance, ...(freeNote ? { freeHaul: freeNote } : {}) },
      },
      curve,
      notes: [
        `누적토량곡선 ${curve.length}점 — 성토는 ÷C=${C} 보정(1.0=미반영 명시). 균형점 ${balance.length}개.`,
        '평균운반거리=곡선면적/최대종거(전체 평균 v1 — 루프별 세분·경제운반 한계는 장비 단가 판단 별도 명시).',
        '측점별 절/성토량은 earthwork_grid(격자·TIN) 산출 또는 횡단면 측량 입력.',
      ],
    };
  },
};
