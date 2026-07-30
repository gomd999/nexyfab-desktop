/**
 * ISO 286 끼워맞춤 — **표가 유효한 크기 구간을 벗어나면 거부한다** (260801d).
 *
 * ## 왜
 * `FIT_TABLE` 주석에 「illustrative … for size range 18-30 mm」라고 적혀 있었는데
 * `evaluateFit` 은 **어떤 지름에도 그 표를 그대로 적용**했다. 실측: ⌀6 과 ⌀400 이
 * 같은 틈새(7~41µm)를 냈다. ISO 286 의 편차는 **치수 구간마다 다르므로** 구간 밖 결과는
 * 틀린다 — 그런데 이 기능은 `assembly.fit-class` 로 사용자에게 노출돼 있고 설명은
 * 「Computes min/max clearance」였다.
 *
 * ⚠ 표 값을 기억으로 채워 넣지 않는다(그게 지어내기다). 전 구간 표를 넣는 것은 별 작업이고,
 *   넣기 전까지는 **범위를 지킨다**.
 */
import { describe, it, expect } from 'vitest';
import { evaluateFit, FIT_TABLE, FIT_TABLE_RANGE_MM, type FitName } from './fitClassLookup';

describe('표 구간 안에서는 종전대로 계산한다', () => {
  it.each(Object.keys(FIT_TABLE) as FitName[])('%s — ⌀25mm 는 계산된다', (fit) => {
    const r = evaluateFit(25, fit);
    expect(r.fitName).toBe(fit);
    expect(r.maxClearance).toBeGreaterThan(r.minClearance);
  });

  it('경계값(18·30mm)은 포함한다', () => {
    expect(() => evaluateFit(FIT_TABLE_RANGE_MM.min, 'H7/g6')).not.toThrow();
    expect(() => evaluateFit(FIT_TABLE_RANGE_MM.max, 'H7/g6')).not.toThrow();
  });

  it('H7/g6 ⌀25 — 틈새 부호가 맞다(clearance)', () => {
    const r = evaluateFit(25, 'H7/g6');
    expect(r.category).toBe('clearance');
    expect(r.minClearance).toBeGreaterThan(0);
  });

  it('H7/u6 은 조임이다 — 최대 틈새가 음수(간섭)', () => {
    const r = evaluateFit(25, 'H7/u6');
    expect(r.category).toBe('interference');
    expect(r.maxClearance).toBeLessThan(0);
  });
});

describe('★ 구간 밖은 거부한다 — 틀린 값을 표준 이름으로 내보내지 않는다', () => {
  it.each([1, 6, 17.9, 30.1, 100, 400])('⌀%dmm 는 거부한다', (d) => {
    expect(() => evaluateFit(d, 'H7/g6')).toThrow(/outside the tabulated range/);
  });

  it('거부 사유가 **왜**인지 말한다 — 범위만 넓히지 말라고 적는다', () => {
    let msg = '';
    try { evaluateFit(100, 'H7/p6'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('vary by');
    expect(msg).toContain('Extend FIT_TABLE');
  });

  it('0·음수·비유한 지름도 거부한다', () => {
    for (const d of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => evaluateFit(d, 'H7/g6')).toThrow();
    }
  });
});

describe('범위 상수는 표와 함께 움직여야 한다', () => {
  it('범위가 넓어졌으면 이 테스트가 먼저 깨진다 — 표를 늘렸는지 확인하라는 신호', () => {
    // 표를 확장하면 이 기대값을 함께 고쳐야 한다(그때 위 거부 케이스도 다시 골라야 한다).
    expect(FIT_TABLE_RANGE_MM).toEqual({ min: 18, max: 30 });
  });
});
