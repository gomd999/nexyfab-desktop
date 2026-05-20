import { describe, it, expect } from 'vitest';
import {
  routeLeaders,
  segmentCrossesBox,
  summarize,
  type AnnotationRequest,
  type BBox,
} from './leaderLineRouter';

function box(x0: number, y0: number, x1: number, y1: number): BBox {
  return { min: { x: x0, y: y0 }, max: { x: x1, y: y1 } };
}

describe('routeLeaders', () => {
  it('empty input → empty paths', () => {
    const r = routeLeaders([], []);
    expect(r.paths).toEqual([]);
    expect(r.totalScore).toBe(0);
  });

  it('routes a single annotation directly', () => {
    const ann: AnnotationRequest = {
      id: 'a',
      textBox: box(0, 0, 2, 1),
      target: { x: 10, y: 5 },
    };
    const r = routeLeaders([ann], []);
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0]!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('zero score crossings when no obstacles', () => {
    const ann: AnnotationRequest = {
      id: 'a',
      textBox: box(0, 0, 2, 1),
      target: { x: 10, y: 5 },
    };
    const r = routeLeaders([ann], []);
    expect(r.paths[0]!.crossings).toBe(0);
  });

  it('penalty rises when obstacle in the way', () => {
    const ann: AnnotationRequest = {
      id: 'a',
      textBox: box(0, 0, 2, 1),
      target: { x: 10, y: 0.5 },
    };
    const obstacle = box(4, 0, 6, 1);
    const r = routeLeaders([ann], [obstacle]);
    // Either still crosses (penalty applied) or routed around (longer).
    expect(r.paths[0]!.score).toBeGreaterThan(8);
  });

  it('routes around a preferred side', () => {
    const annTop: AnnotationRequest = {
      id: 'a',
      textBox: box(0, 0, 2, 1),
      target: { x: 5, y: 10 },
      preferredSide: 'top',
    };
    const r = routeLeaders([annTop], []);
    // Exit should be near (1, 1) — top edge of the text box.
    const exit = r.paths[0]!.points[0]!;
    expect(exit.y).toBeGreaterThan(0.9);
  });

  it('routes multiple annotations', () => {
    const anns: AnnotationRequest[] = [
      { id: 'a', textBox: box(0, 0, 2, 1), target: { x: 10, y: 5 } },
      { id: 'b', textBox: box(0, 5, 2, 6), target: { x: 10, y: 1 } },
    ];
    const r = routeLeaders(anns, []);
    expect(r.paths).toHaveLength(2);
  });

  it('respects padding option', () => {
    const ann: AnnotationRequest = {
      id: 'a',
      textBox: box(0, 0, 2, 1),
      target: { x: 10, y: 0.5 },
    };
    const obstacle = box(4, -0.1, 6, 1.1);
    const noPad = routeLeaders([ann], [obstacle], { paddingMm: 0 });
    const withPad = routeLeaders([ann], [obstacle], { paddingMm: 5 });
    expect(withPad.paths[0]!.score).toBeGreaterThanOrEqual(noPad.paths[0]!.score);
  });
});

describe('segmentCrossesBox', () => {
  it('horizontal segment crossing centered box returns true', () => {
    expect(segmentCrossesBox({ x: 0, y: 5 }, { x: 10, y: 5 }, box(3, 3, 7, 7))).toBe(true);
  });

  it('segment outside box returns false', () => {
    expect(segmentCrossesBox({ x: 0, y: 0 }, { x: 1, y: 1 }, box(10, 10, 20, 20))).toBe(false);
  });

  it('segment with endpoint inside box returns true', () => {
    expect(segmentCrossesBox({ x: 5, y: 5 }, { x: 100, y: 100 }, box(3, 3, 7, 7))).toBe(true);
  });

  it('parallel segment outside box returns false', () => {
    expect(segmentCrossesBox({ x: 0, y: 10 }, { x: 100, y: 10 }, box(3, 3, 7, 7))).toBe(false);
  });
});

describe('summarize', () => {
  it('empty paths', () => {
    const s = summarize({ paths: [], totalScore: 0, crossingCount: 0 });
    expect(s.annotationCount).toBe(0);
    expect(s.cleanFraction).toBe(1);
  });

  it('reports counts and average length', () => {
    const ann: AnnotationRequest = {
      id: 'a',
      textBox: box(0, 0, 2, 1),
      target: { x: 10, y: 5 },
    };
    const r = routeLeaders([ann], []);
    const s = summarize(r);
    expect(s.annotationCount).toBe(1);
    expect(s.averageLengthMm).toBeGreaterThan(0);
  });

  it('clean fraction = 1 when no crossings', () => {
    const ann: AnnotationRequest = {
      id: 'a',
      textBox: box(0, 0, 2, 1),
      target: { x: 10, y: 5 },
    };
    const s = summarize(routeLeaders([ann], []));
    expect(s.cleanFraction).toBe(1);
  });
});
