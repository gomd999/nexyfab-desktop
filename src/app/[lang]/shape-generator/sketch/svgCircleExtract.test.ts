// @vitest-environment node
/**
 * F-4(260808g) — HLR 투영 원 추출: 실측 경로 형식(drawingProjectionMapping
 * 실측 — "M 38 10 A 8 8 0 0 1 22 10 A 8 8 0 0 1 38 10 Z")을 기준으로 고정.
 */
import { describe, expect, it } from 'vitest';
import { circleFromPath, extractCircles } from './svgCircleExtract';

const CIRCLE = 'M 38 10 A 8 8 0 0 1 22 10 A 8 8 0 0 1 38 10 Z';

describe('circleFromPath', () => {
  it('parses the measured full-circle form → center (30,10) r=8', () => {
    expect(circleFromPath(CIRCLE)).toMatchObject({ cx: 30, cy: 10, r: 8 });
  });

  it('rejects outlines, open arcs, mixed L+A (fillet corners), ellipses', () => {
    expect(circleFromPath('M 0 0 L 100 0 L 100 60 L 0 60 L 0 0 Z')).toBeNull();
    expect(circleFromPath('M 38 10 A 8 8 0 0 1 22 10')).toBeNull(); // 미폐합 반원
    expect(circleFromPath('M 0 0 L 10 0 A 5 5 0 0 1 15 5 L 15 20 Z')).toBeNull();
    expect(circleFromPath('M 38 10 A 8 4 0 0 1 22 10 A 8 4 0 0 1 38 10 Z')).toBeNull();
  });
});

describe('extractCircles', () => {
  it('dedupes the same circle appearing in visible AND hidden, keeps distinct holes', () => {
    const visible = [['M 0 0 L 100 0 L 100 60 L 0 60 L 0 0 Z'], [CIRCLE]];
    const hidden = [[CIRCLE], ['M 78 40 A 5 5 0 0 0 68 40 A 5 5 0 0 0 78 40 Z']];
    const out = extractCircles([...visible, ...hidden]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ cx: 30, cy: 10, r: 8 });
    expect(out[1]).toMatchObject({ cx: 73, cy: 40, r: 5 });
  });
});
