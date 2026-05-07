import { describe, it, expect } from 'vitest';
import { solveConstraints } from './constraintSolver';
import type { SketchConstraint, SketchDimension, SketchSegment } from './types';

describe('solveConstraints', () => {
  it('returns under-defined with no constraints (no residuals)', () => {
    const segments: SketchSegment[] = [
      {
        type: 'line',
        id: 's0',
        points: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 10, y: 0 },
        ],
      },
    ];
    const r = solveConstraints(segments, [], []);
    expect(r.satisfied).toBe(true);
    expect(r.unsatisfiedConstraints).toEqual([]);
    expect(r.solveResult?.status).toBe('under-defined');
  });

  it('makes a line horizontal when one endpoint is fixed', () => {
    const segments: SketchSegment[] = [
      {
        type: 'line',
        id: 'seg1',
        points: [
          { id: 'p1', x: 0, y: 0 },
          { id: 'p2', x: 10, y: 5 },
        ],
      },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'c_fix', type: 'fixed', entityIds: ['p1'], satisfied: false },
      { id: 'c_h', type: 'horizontal', entityIds: ['seg1'], satisfied: false },
    ];
    const r = solveConstraints(segments, constraints, [], 80, 1e-8);
    const p2 = r.points.get('p2');
    expect(p2).toBeDefined();
    expect(p2!.y).toBeCloseTo(0, 4);
    expect(p2!.x).toBeCloseTo(10, 2);
    expect(r.satisfied).toBe(true);
  });

  it('makes a line vertical when one endpoint is fixed', () => {
    const segments: SketchSegment[] = [
      {
        type: 'line',
        id: 'seg2',
        points: [
          { id: 'p1', x: 0, y: 0 },
          { id: 'p2', x: 4, y: 10 },
        ],
      },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'c_fix', type: 'fixed', entityIds: ['p1'], satisfied: false },
      { id: 'c_v', type: 'vertical', entityIds: ['seg2'], satisfied: false },
    ];
    const r = solveConstraints(segments, constraints, [], 80, 1e-8);
    const p2 = r.points.get('p2');
    expect(p2).toBeDefined();
    expect(p2!.x).toBeCloseTo(0, 4);
    expect(p2!.y).toBeCloseTo(10, 2);
    expect(r.satisfied).toBe(true);
  });

  it('honours a driving linear dimension between fixed horizontal endpoints', () => {
    const segments: SketchSegment[] = [
      {
        type: 'line',
        id: 'segL',
        points: [
          { id: 'pa', x: 0, y: 0 },
          { id: 'pb', x: 50, y: 3 },
        ],
      },
    ];
    const constraints: SketchConstraint[] = [
      { id: 'fix_a', type: 'fixed', entityIds: ['pa'], satisfied: false },
      { id: 'hor', type: 'horizontal', entityIds: ['segL'], satisfied: false },
    ];
    const dimensions: SketchDimension[] = [
      {
        id: 'd1',
        type: 'linear',
        entityIds: ['segL'],
        value: 40,
        position: { x: 20, y: -10 },
        locked: true,
      },
    ];
    const r = solveConstraints(segments, constraints, dimensions, 80, 1e-7);
    const pb = r.points.get('pb');
    expect(pb).toBeDefined();
    expect(pb!.y).toBeCloseTo(0, 3);
    expect(pb!.x).toBeCloseTo(40, 2);
    expect(r.satisfied).toBe(true);
  });
});
