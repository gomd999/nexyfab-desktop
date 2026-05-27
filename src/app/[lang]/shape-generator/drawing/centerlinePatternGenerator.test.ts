import { describe, it, expect } from 'vitest';
import {
  detectPattern,
  summarize,
  type CircleFeature,
} from './centerlinePatternGenerator';

function circle(id: string, x: number, y: number, r: number = 5): CircleFeature {
  return { id, center: { x, y }, radius: r };
}

describe('detectPattern', () => {
  it('empty input → single kind with empty', () => {
    const r = detectPattern([]);
    expect(r.marks).toEqual([]);
    expect(r.lines).toEqual([]);
  });

  it('single circle → center mark', () => {
    const r = detectPattern([circle('a', 0, 0)]);
    expect(r.kind).toBe('single');
    expect(r.marks).toHaveLength(1);
    expect(r.lines).toHaveLength(0);
  });

  it('bolt circle: 4 holes equidistant from center', () => {
    const circles = [
      circle('a', 10, 0),
      circle('b', 0, 10),
      circle('c', -10, 0),
      circle('d', 0, -10),
    ];
    const r = detectPattern(circles);
    expect(r.kind).toBe('bolt-circle');
    expect(r.boltCircle).toBeDefined();
    expect(r.boltCircle!.radius).toBeCloseTo(10, 1);
  });

  it('bolt circle has spokes to each hole', () => {
    const circles = [
      circle('a', 10, 0),
      circle('b', 0, 10),
      circle('c', -10, 0),
      circle('d', 0, -10),
    ];
    const r = detectPattern(circles);
    expect(r.lines.length).toBeGreaterThanOrEqual(4);
    expect(r.lines.every(l => l.kind === 'spoke')).toBe(true);
  });

  it('linear pattern: collinear holes', () => {
    const circles = [circle('a', 0, 0), circle('b', 10, 0), circle('c', 20, 0)];
    const r = detectPattern(circles);
    expect(r.kind).toBe('linear');
    expect(r.linearDirection).toBeDefined();
  });

  it('linear pattern has primary centerline', () => {
    const circles = [circle('a', 0, 0), circle('b', 10, 0), circle('c', 20, 0)];
    const r = detectPattern(circles);
    const primary = r.lines.filter(l => l.kind === 'primary');
    expect(primary).toHaveLength(1);
  });

  it('mixed pattern: non-collinear non-concentric', () => {
    const circles = [
      circle('a', 0, 0),
      circle('b', 50, 50),
      circle('c', 100, 0),
    ];
    const r = detectPattern(circles);
    expect(['mixed', 'bolt-circle']).toContain(r.kind);
  });

  it('mark count = circle count for non-bolt patterns', () => {
    const circles = [circle('a', 0, 0), circle('b', 10, 0), circle('c', 20, 0)];
    const r = detectPattern(circles);
    expect(r.marks.length).toBe(3);
  });

  it('bolt circle adds center mark', () => {
    const circles = [
      circle('a', 10, 0),
      circle('b', 0, 10),
      circle('c', -10, 0),
      circle('d', 0, -10),
    ];
    const r = detectPattern(circles);
    // 4 holes + 1 pattern center.
    expect(r.marks.length).toBe(5);
  });

  it('cross arm length scales with radius', () => {
    const r = detectPattern([circle('a', 0, 0, 10)], { crossArmFactor: 2 });
    expect(r.marks[0]!.armLength).toBe(20);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize(detectPattern([]));
    expect(s.markCount).toBe(0);
  });

  it('reports kind', () => {
    const s = summarize(detectPattern([circle('a', 0, 0)]));
    expect(s.kind).toBe('single');
  });

  it('hasBoltCircle when bolt circle detected', () => {
    const circles = [circle('a', 10, 0), circle('b', 0, 10), circle('c', -10, 0), circle('d', 0, -10)];
    const s = summarize(detectPattern(circles));
    expect(s.hasBoltCircle).toBe(true);
  });
});
