/**
 * dimensionLegibility.test.ts — 실측 임계가 **코드에서 그대로 지켜지는가** (260731).
 *
 * 여기서 잡는 것은 「동작하나」가 아니라 **근거 없는 주장을 하게 되는 것**이다:
 *   · 재지 않은 구간을 「읽힌다」로 바꿔 버리는 것
 *   · 계산 실패(NaN)를 「도면이 나쁘다」로 바꿔 버리는 것
 */
import { describe, expect, it } from 'vitest';
import {
  DIM_SPAN_ILLEGIBLE_PX,
  DIM_SPAN_LEGIBLE_PX,
  assessDimensionLegibility,
  findIllegibleDimensions,
} from './dimensionLegibility';

describe('실측 두 점은 그대로 재현된다', () => {
  it('9.6px(실측 0/6) → illegible', () => {
    const r = assessDimensionLegibility(9.6);
    expect(r.status).toBe('illegible');
    expect(r.recommendLeaderNote).toBe(true);
  });

  it('14.4px(실측 4/4) → legible, 지시선 불필요', () => {
    const r = assessDimensionLegibility(14.4);
    expect(r.status).toBe('legible');
    expect(r.recommendLeaderNote).toBe(false);
  });

  it('실측값이 상수와 어긋나지 않는다', () => {
    expect(DIM_SPAN_ILLEGIBLE_PX).toBe(9.6);
    expect(DIM_SPAN_LEGIBLE_PX).toBe(14.4);
    expect(DIM_SPAN_ILLEGIBLE_PX).toBeLessThan(DIM_SPAN_LEGIBLE_PX);
  });
});

describe('★재지 않은 구간을 안다고 하지 않는다', () => {
  it('9.6~14.4 사이는 unverified — legible 로 넘기지 않는다', () => {
    for (const px of [9.7, 11, 12.5, 14.3]) {
      const r = assessDimensionLegibility(px);
      expect(r.status, `${px}px 를 단정했다`).toBe('unverified');
      // 모르는 것은 **안전한 쪽**으로 — 지시선을 권한다.
      expect(r.recommendLeaderNote).toBe(true);
      expect(r.reason).toContain('측정한 적이 없다');
    }
  });

  it('★계산 실패(NaN·음수)를 「짧다」로 바꾸지 않는다', () => {
    for (const bad of [NaN, Infinity, -1]) {
      const r = assessDimensionLegibility(bad);
      expect(r.status, `${bad} 를 illegible 로 단정했다`).not.toBe('illegible');
      expect(r.status).toBe('unverified');
    }
  });
});

describe('도면 단위 집계', () => {
  it('판독 불가와 미검증을 **합치지 않는다** — 대응이 다르다', () => {
    const { flagged, summary } = findIllegibleDimensions([9.0, 12, 20, 30]);
    expect(flagged).toHaveLength(2);
    expect(summary).toContain('판독 불가 1');
    expect(summary).toContain('미검증 1');
  });

  it('전부 안전하면 빈 목록', () => {
    const { flagged, summary } = findIllegibleDimensions([15, 40, 100]);
    expect(flagged).toHaveLength(0);
    expect(summary).toContain('전부');
  });

  it('빈 도면은 실패가 아니다', () => {
    expect(findIllegibleDimensions([]).flagged).toHaveLength(0);
  });
});
