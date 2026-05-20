import { describe, it, expect } from 'vitest';
import {
  splitFace,
  validateSplit,
  summarize,
  centroid,
  pointInPolygon,
  signedArea,
  type BrepFace,
  type SplitCurve,
} from './brepFaceSplit';

function unitSquare(): BrepFace {
  return {
    id: 'sq',
    outer: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    holes: [],
  };
}

function squareWithHole(): BrepFace {
  return {
    id: 'sqh',
    outer: { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] },
    holes: [
      { points: [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 5, y: 5 }, { x: 3, y: 5 }] },
      { points: [{ x: 15, y: 3 }, { x: 17, y: 3 }, { x: 17, y: 5 }, { x: 15, y: 5 }] },
    ],
  };
}

describe('splitFace', () => {
  it('vertical split of a unit square produces 2 pieces', () => {
    const curve: SplitCurve = { points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] };
    const r = splitFace(unitSquare(), curve);
    expect(r.pieces).toHaveLength(2);
  });

  it('split records cut vertex indices', () => {
    const curve: SplitCurve = { points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] };
    const r = splitFace(unitSquare(), curve);
    expect(r.cutVertices.enter).toBeGreaterThanOrEqual(0);
    expect(r.cutVertices.exit).toBeGreaterThanOrEqual(0);
    expect(r.cutVertices.enter).not.toBe(r.cutVertices.exit);
  });

  it('split throws for too-short curve', () => {
    expect(() => splitFace(unitSquare(), { points: [{ x: 5, y: 0 }] })).toThrow();
  });

  it('split throws when endpoints share an edge', () => {
    const curve: SplitCurve = { points: [{ x: 2, y: 0 }, { x: 8, y: 0 }] };
    expect(() => splitFace(unitSquare(), curve)).toThrow();
  });

  it('split uses provided id prefix', () => {
    const curve: SplitCurve = { points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] };
    const r = splitFace(unitSquare(), curve, { newIdPrefix: 'custom' });
    expect(r.pieces[0].id).toBe('custom.0');
    expect(r.pieces[1].id).toBe('custom.1');
  });

  it('assigns holes to correct side by centroid', () => {
    const curve: SplitCurve = { points: [{ x: 10, y: 0 }, { x: 10, y: 10 }] };
    const r = splitFace(squareWithHole(), curve);
    expect(r.holeAssignments).toHaveLength(2);
    const sides = r.holeAssignments.map(a => a.sideIndex).sort();
    expect(sides).toEqual([0, 1]);
  });

  it('preserves total area roughly', () => {
    const curve: SplitCurve = { points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] };
    const original = unitSquare();
    const r = splitFace(original, curve);
    const aArea = Math.abs(signedArea(r.pieces[0].outer.points));
    const bArea = Math.abs(signedArea(r.pieces[1].outer.points));
    expect(aArea + bArea).toBeCloseTo(100, 0);
  });

  it('curved split produces 2 pieces with > 4 vertices each', () => {
    const curve: SplitCurve = {
      points: [
        { x: 5, y: 0 },
        { x: 6, y: 3 },
        { x: 4, y: 5 },
        { x: 6, y: 7 },
        { x: 5, y: 10 },
      ],
    };
    const r = splitFace(unitSquare(), curve);
    expect(r.pieces[0].outer.points.length).toBeGreaterThan(4);
    expect(r.pieces[1].outer.points.length).toBeGreaterThan(4);
  });
});

describe('validateSplit', () => {
  it('validates a clean vertical split', () => {
    const curve: SplitCurve = { points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] };
    const original = unitSquare();
    const r = splitFace(original, curve);
    const v = validateSplit(original, r);
    expect(v.isValid).toBe(true);
    expect(v.areaPreserved).toBe(true);
  });

  it('reports issues array', () => {
    const curve: SplitCurve = { points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] };
    const v = validateSplit(unitSquare(), splitFace(unitSquare(), curve));
    expect(Array.isArray(v.issues)).toBe(true);
  });
});

describe('summarize', () => {
  it('reports piece areas and vertex counts', () => {
    const curve: SplitCurve = { points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] };
    const s = summarize(unitSquare(), splitFace(unitSquare(), curve));
    expect(s.pieceAreas[0]).toBeGreaterThan(0);
    expect(s.pieceAreas[1]).toBeGreaterThan(0);
    expect(s.pieceVertexCounts[0]).toBeGreaterThan(2);
    expect(s.pieceVertexCounts[1]).toBeGreaterThan(2);
  });

  it('counts holes', () => {
    const curve: SplitCurve = { points: [{ x: 10, y: 0 }, { x: 10, y: 10 }] };
    const s = summarize(squareWithHole(), splitFace(squareWithHole(), curve));
    expect(s.totalHolesIn).toBe(2);
    expect(s.holesAssigned).toBe(2);
  });
});

describe('geometry helpers', () => {
  it('centroid of unit square = (0.5, 0.5)', () => {
    const c = centroid([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
    expect(c.x).toBeCloseTo(0.5, 5);
    expect(c.y).toBeCloseTo(0.5, 5);
  });

  it('pointInPolygon: center inside, corner outside', () => {
    const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 15 }, poly)).toBe(false);
  });

  it('signedArea of CCW unit square = 1', () => {
    expect(signedArea([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBeCloseTo(1, 5);
  });

  it('signedArea of CW square is negative', () => {
    expect(signedArea([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }])).toBeCloseTo(-1, 5);
  });
});
