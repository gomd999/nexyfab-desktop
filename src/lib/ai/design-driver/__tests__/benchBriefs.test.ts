/**
 * 측정 세트 **동결** 회귀 (260728 §7-2).
 *
 * 이 테스트의 목적은 브리프의 품질을 재는 것이 아니라 **자가 조용히 바뀌는 것을 막는 것**이다.
 * 260727 의 "완주 10/12" 와 260728 의 "1/6" 이 비교 불가였던 이유가 정확히 이것이었다 —
 * 측정 대상은 바뀌어도 되지만 자는 고정돼야 한다.
 *
 * 브리프를 정말 바꿔야 한다면: `BENCH_VERSION` 을 올리고 여기 기대값도 함께 올린 뒤,
 * **새 버전으로 기준선을 다시 잡아라**(옛 수치를 새 세트에 붙이지 말 것).
 */
import { describe, it, expect } from 'vitest';
import { BENCH_BRIEFS, BENCH_VERSION, benchCapabilities } from '../benchBriefs';

const EXPECTED_IDS = [
  'b-01', 'b-02', 'b-03', 'b-04', 'b-05', 'b-06',
  'b-07', 'b-08', 'b-09', 'b-10', 'b-11', 'b-12',
];

describe('benchBriefs — 측정 세트는 동결이다', () => {
  it('버전과 id 목록이 고정돼 있다', () => {
    expect(BENCH_VERSION).toBe('v1-260728');
    expect(BENCH_BRIEFS.map((x) => x.brief.id)).toEqual(EXPECTED_IDS);
  });

  it('id 중복 없음 · 본문이 비어있지 않음 · 라벨 있음', () => {
    expect(new Set(EXPECTED_IDS).size).toBe(EXPECTED_IDS.length);
    for (const x of BENCH_BRIEFS) {
      expect(x.brief.text.length, x.brief.id).toBeGreaterThan(40);
      expect(x.label.length, x.brief.id).toBeGreaterThan(0);
    }
  });

  it('기준선(요구 기능 없음) 브리프가 최소 2개 있다 — 회귀 감지선', () => {
    // 요구 기능이 없는데도 실패한다면 그건 기능 부재가 아니라 회귀다.
    expect(BENCH_BRIEFS.filter((x) => x.requires.length === 0).length).toBeGreaterThanOrEqual(2);
  });

  it('알려진 기능 축을 모두 덮는다 — 축이 늘면 세트도 늘어야 한다', () => {
    expect(benchCapabilities()).toEqual([
      'dim.aligned', 'dim.axis', 'holes.blind', 'holes.rect', 'holes.round', 'volume.nonRect',
    ]);
  });
});
