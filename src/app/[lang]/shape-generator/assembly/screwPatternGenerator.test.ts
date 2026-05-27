import { describe, it, expect } from 'vitest';
import {
  linearPattern,
  rectangularPattern,
  circularPattern,
  edgeFollowingPattern,
  validateHoles,
  summarize,
  CLEARANCE_HOLES,
  type Vec2,
} from './screwPatternGenerator';

describe('CLEARANCE_HOLES', () => {
  it('M6 close fit 6.4 mm', () => {
    expect(CLEARANCE_HOLES.M6.closeMm).toBe(6.4);
  });

  it('close < medium < free', () => {
    const m = CLEARANCE_HOLES.M8;
    expect(m.closeMm).toBeLessThan(m.mediumMm);
    expect(m.mediumMm).toBeLessThan(m.freeMm);
  });
});

describe('linearPattern', () => {
  it('count 0 → empty', () => {
    expect(linearPattern({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toEqual([]);
  });

  it('count 1 → midpoint', () => {
    const r = linearPattern({ x: 0, y: 0 }, { x: 100, y: 0 }, 1);
    expect(r[0]!.position.x).toBe(50);
  });

  it('count 5 evenly spaced', () => {
    const r = linearPattern({ x: 0, y: 0 }, { x: 100, y: 0 }, 5);
    expect(r).toHaveLength(5);
    expect(r[0]!.position.x).toBe(0);
    expect(r[4]!.position.x).toBe(100);
  });

  it('diameter matches fit + size', () => {
    const r = linearPattern({ x: 0, y: 0 }, { x: 100, y: 0 }, 2, { size: 'M6', fit: 'close', minEdgeDistanceMm: 5 });
    expect(r[0]!.diameterMm).toBe(6.4);
  });
});

describe('rectangularPattern', () => {
  it('rows×cols holes', () => {
    const r = rectangularPattern({ x: 0, y: 0 }, { x: 100, y: 50 }, 3, 4);
    expect(r).toHaveLength(12);
  });

  it('corner positions correct', () => {
    const r = rectangularPattern({ x: 0, y: 0 }, { x: 10, y: 5 }, 2, 2);
    expect(r[0]!.position).toEqual({ x: 0, y: 0 });
    expect(r[3]!.position).toEqual({ x: 10, y: 5 });
  });
});

describe('circularPattern', () => {
  it('count 0 → empty', () => {
    expect(circularPattern({ x: 0, y: 0 }, 50, 0)).toEqual([]);
  });

  it('4 holes on PCD 100', () => {
    const r = circularPattern({ x: 0, y: 0 }, 100, 4, 0);
    expect(r).toHaveLength(4);
    expect(r[0]!.position.x).toBeCloseTo(50, 3);
    expect(r[1]!.position.y).toBeCloseTo(50, 3);
  });

  it('startAngleDeg shifts pattern', () => {
    const r = circularPattern({ x: 0, y: 0 }, 100, 4, 90);
    expect(r[0]!.position.y).toBeCloseTo(50, 3);
  });
});

describe('edgeFollowingPattern', () => {
  it('square 100×100 with pitch 50 → 8 holes', () => {
    const square: Vec2[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const r = edgeFollowingPattern(square, 50);
    expect(r.length).toBe(8);
  });

  it('zero pitch → empty', () => {
    expect(edgeFollowingPattern([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0)).toEqual([]);
  });

  it('degenerate polygon → empty', () => {
    expect(edgeFollowingPattern([{ x: 0, y: 0 }], 10)).toEqual([]);
  });
});

describe('validateHoles', () => {
  it('flags holes too close to edge', () => {
    const outline: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const holes = linearPattern({ x: 1, y: 5 }, { x: 9, y: 5 }, 3);
    const issues = validateHoles(holes, outline, 3);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('no issues when far from edge', () => {
    const outline: Vec2[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const holes = linearPattern({ x: 30, y: 50 }, { x: 70, y: 50 }, 2);
    expect(validateHoles(holes, outline, 5)).toEqual([]);
  });
});

describe('summarize', () => {
  it('reports first hole properties', () => {
    const r = circularPattern({ x: 0, y: 0 }, 100, 4, 0, { size: 'M6', fit: 'medium', minEdgeDistanceMm: 5 });
    const s = summarize(r);
    expect(s.holeCount).toBe(4);
    expect(s.size).toBe('M6');
  });

  it('empty input → zero', () => {
    const s = summarize([]);
    expect(s.holeCount).toBe(0);
    expect(s.diameterMm).toBe(0);
  });
});
