import { describe, it, expect } from 'vitest';
import {
  generateHatch,
  pointInPolygon,
  summarize,
  PATTERN_LIBRARY,
  type Vec2,
} from './hatchPatternLibrary';

const unitSquare: Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('generateHatch', () => {
  it('empty polygon → empty output', () => {
    const r = generateHatch([], 'steel');
    expect(r.lines).toEqual([]);
    expect(r.dots).toEqual([]);
  });

  it('< 3 vertex polygon → empty', () => {
    const r = generateHatch([{ x: 0, y: 0 }, { x: 1, y: 0 }], 'steel');
    expect(r.lines).toEqual([]);
  });

  it('steel pattern produces parallel lines', () => {
    const r = generateHatch(unitSquare, 'steel');
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.dots).toEqual([]);
  });

  it('aluminum pattern adds dots', () => {
    const r = generateHatch(unitSquare, 'aluminum');
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.dots.length).toBeGreaterThan(0);
  });

  it('brass pattern has roughly twice the lines (cross-hatch)', () => {
    const steel = generateHatch(unitSquare, 'steel');
    const brass = generateHatch(unitSquare, 'brass');
    expect(brass.lines.length).toBeGreaterThan(steel.lines.length);
  });

  it('concrete pattern is dots-only', () => {
    const r = generateHatch(unitSquare, 'concrete');
    expect(r.lines).toEqual([]);
    expect(r.dots.length).toBeGreaterThan(0);
  });

  it('scale option affects line count', () => {
    const fine = generateHatch(unitSquare, 'steel', { scale: 0.5 });
    const coarse = generateHatch(unitSquare, 'steel', { scale: 2 });
    expect(fine.lines.length).toBeGreaterThan(coarse.lines.length);
  });

  it('all hatch lines lie inside the polygon (sampled)', () => {
    const r = generateHatch(unitSquare, 'steel');
    for (const line of r.lines.slice(0, 10)) {
      const mid = { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 };
      expect(pointInPolygon(mid, unitSquare)).toBe(true);
    }
  });

  it('all dots lie inside the polygon', () => {
    const r = generateHatch(unitSquare, 'concrete');
    for (const dot of r.dots) {
      expect(pointInPolygon(dot.position, unitSquare)).toBe(true);
    }
  });
});

describe('pointInPolygon', () => {
  it('center is inside', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, unitSquare)).toBe(true);
  });

  it('outside point returns false', () => {
    expect(pointInPolygon({ x: 200, y: 200 }, unitSquare)).toBe(false);
  });
});

describe('PATTERN_LIBRARY', () => {
  it('has 9 patterns', () => {
    expect(Object.keys(PATTERN_LIBRARY)).toHaveLength(9);
  });

  it('steel has 45° angle', () => {
    expect(PATTERN_LIBRARY.steel.primaryAngleDeg).toBe(45);
  });

  it('brass has secondary angle 135°', () => {
    expect(PATTERN_LIBRARY.brass.secondaryAngleDeg).toBe(135);
  });
});

describe('summarize', () => {
  it('reports line + dot counts', () => {
    const r = generateHatch(unitSquare, 'aluminum');
    const s = summarize(r);
    expect(s.lineCount).toBe(r.lines.length);
    expect(s.dotCount).toBe(r.dots.length);
  });

  it('reports secondary-angle flag', () => {
    const brass = summarize(generateHatch(unitSquare, 'brass'));
    const steel = summarize(generateHatch(unitSquare, 'steel'));
    expect(brass.hasSecondaryAngle).toBe(true);
    expect(steel.hasSecondaryAngle).toBe(false);
  });

  it('pitchMm matches library entry', () => {
    const s = summarize(generateHatch(unitSquare, 'plastic'));
    expect(s.pitchMm).toBe(PATTERN_LIBRARY.plastic.pitchMm);
  });
});
