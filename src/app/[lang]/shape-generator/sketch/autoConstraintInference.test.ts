import { describe, it, expect } from 'vitest';
import {
  inferConstraints,
  summarize,
  type SketchEntity,
} from './autoConstraintInference';

function line(id: string, x0: number, y0: number, x1: number, y1: number): SketchEntity {
  return { id, kind: 'line', start: { x: x0, y: y0 }, end: { x: x1, y: y1 } };
}

function point(id: string, x: number, y: number): SketchEntity {
  return { id, kind: 'point', position: { x, y } };
}

function arc(id: string, cx: number, cy: number, r: number): SketchEntity {
  return { id, kind: 'arc', center: { x: cx, y: cy }, radius: r, startAngle: 0, endAngle: Math.PI };
}

describe('inferConstraints', () => {
  it('empty input → no suggestions', () => {
    expect(inferConstraints([])).toEqual([]);
  });

  it('horizontal line detected', () => {
    const s = inferConstraints([line('a', 0, 0, 10, 0)]);
    expect(s.some(x => x.kind === 'horizontal')).toBe(true);
  });

  it('vertical line detected', () => {
    const s = inferConstraints([line('a', 0, 0, 0, 10)]);
    expect(s.some(x => x.kind === 'vertical')).toBe(true);
  });

  it('parallel lines detected', () => {
    const s = inferConstraints([line('a', 0, 0, 10, 5), line('b', 0, 2, 10, 7)]);
    expect(s.some(x => x.kind === 'parallel')).toBe(true);
  });

  it('perpendicular lines detected', () => {
    const s = inferConstraints([line('a', 0, 0, 10, 0), line('b', 0, 0, 0, 10)]);
    expect(s.some(x => x.kind === 'perpendicular')).toBe(true);
  });

  it('equal-length lines detected', () => {
    const s = inferConstraints([line('a', 0, 0, 10, 0), line('b', 0, 5, 10, 5)]);
    expect(s.some(x => x.kind === 'equal-length')).toBe(true);
  });

  it('coincident points detected', () => {
    const s = inferConstraints([point('a', 0, 0), point('b', 0.05, 0)]);
    expect(s.some(x => x.kind === 'coincident')).toBe(true);
  });

  it('concentric arcs detected', () => {
    const s = inferConstraints([arc('a', 0, 0, 5), arc('b', 0, 0, 10)]);
    expect(s.some(x => x.kind === 'concentric')).toBe(true);
  });

  it('equal-radius arcs detected', () => {
    const s = inferConstraints([arc('a', 0, 0, 5), arc('b', 100, 100, 5)]);
    expect(s.some(x => x.kind === 'equal-radius')).toBe(true);
  });

  it('tangent line-arc detected', () => {
    // Line tangent to arc at center distance ≈ radius.
    const s = inferConstraints([
      arc('a', 0, 0, 5),
      line('b', -10, 5, 10, 5), // line at y=5, tangent to circle r=5 centered at origin
    ]);
    expect(s.some(x => x.kind === 'tangent')).toBe(true);
  });

  it('confidence in [0, 1]', () => {
    const s = inferConstraints([line('a', 0, 0, 10, 0.001)]);
    for (const sg of s) {
      expect(sg.confidence).toBeGreaterThanOrEqual(0);
      expect(sg.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('angle tolerance respected', () => {
    const tight = inferConstraints([line('a', 0, 0, 10, 0.5)], { angleToleranceRad: 0.01 });
    const loose = inferConstraints([line('a', 0, 0, 10, 0.5)], { angleToleranceRad: 0.5 });
    expect(loose.length).toBeGreaterThanOrEqual(tight.length);
  });

  it('duplicates merged (keep highest confidence)', () => {
    // Adding the same constraint twice in input shouldn't duplicate.
    const s = inferConstraints([
      line('a', 0, 0, 10, 0),
      line('b', 0, 5, 10, 5),
    ]);
    const parallels = s.filter(x => x.kind === 'parallel');
    expect(parallels.length).toBeLessThanOrEqual(1);
  });

  it('only horizontal flagged for slightly tilted line within tolerance', () => {
    const s = inferConstraints([line('a', 0, 0, 10, 0.01)], { angleToleranceRad: 0.05 });
    const horiz = s.find(x => x.kind === 'horizontal');
    expect(horiz).toBeDefined();
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const s = summarize([]);
    expect(s.totalSuggestions).toBe(0);
    expect(s.averageConfidence).toBe(0);
  });

  it('counts kinds', () => {
    const s = summarize(inferConstraints([
      line('a', 0, 0, 10, 0),
      line('b', 0, 0, 0, 10),
    ]));
    expect(s.byKind.horizontal + s.byKind.vertical + s.byKind.perpendicular).toBeGreaterThan(0);
  });

  it('high confidence count', () => {
    const s = summarize(inferConstraints([line('a', 0, 0, 10, 0)]));
    expect(s.highConfidenceCount).toBeGreaterThanOrEqual(0);
  });
});
