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

/**
 * DOF & diagnostics — the rank-based analysis layer (dof count, redundancy /
 * over-defined detection, conflict, scale-robust rank) drives the sketch's
 * fully-constrained UI signal but had almost no coverage (only the empty-sketch
 * under-defined case). Each case below has an analytically known answer; they
 * pin estimateRank / findRedundantConstraints against it.
 */
describe('solveConstraints — DOF & diagnostics (verified)', () => {
  const oneLine = (): SketchSegment[] => [
    { type: 'line', id: 's1', points: [{ id: 'p0', x: 0, y: 0 }, { id: 'p1', x: 10, y: 3 }] },
  ];

  it('one free endpoint + horizontal ⇒ exactly 1 DOF (slides in x)', () => {
    const r = solveConstraints(oneLine(), [
      { id: 'fix', type: 'fixed', entityIds: ['p0'], satisfied: false },
      { id: 'h', type: 'horizontal', entityIds: ['s1'], satisfied: false },
    ], [], 200, 1e-9);
    expect(r.solveResult?.status).toBe('under-defined');
    expect(r.solveResult?.dof).toBe(1);
    expect(r.solveResult?.redundant).toBeUndefined();
  });

  it('horizontal + vertical pins both coords ⇒ 0 DOF, ok, no false redundancy', () => {
    const r = solveConstraints(oneLine(), [
      { id: 'fix', type: 'fixed', entityIds: ['p0'], satisfied: false },
      { id: 'h', type: 'horizontal', entityIds: ['s1'], satisfied: false },
      { id: 'v', type: 'vertical', entityIds: ['s1'], satisfied: false },
    ], [], 200, 1e-9);
    expect(r.solveResult?.status).toBe('ok');
    expect(r.solveResult?.dof).toBe(0);
    expect(r.solveResult?.redundant).toBeUndefined(); // independent — NOT redundant
  });

  it('two independent horizontals ⇒ over-defined with both flagged redundant', () => {
    const r = solveConstraints(oneLine(), [
      { id: 'fix', type: 'fixed', entityIds: ['p0'], satisfied: false },
      { id: 'h1', type: 'horizontal', entityIds: ['s1'], satisfied: false },
      { id: 'h2', type: 'horizontal', entityIds: ['s1'], satisfied: false },
    ], [], 200, 1e-9);
    expect(r.solveResult?.status).toBe('over-defined');
    expect(r.solveResult?.dof).toBe(1); // rank still 1 → 1 DOF left
    expect(r.solveResult?.redundant).toEqual(expect.arrayContaining(['h1', 'h2']));
  });

  it('coincident + non-zero distance on the same pair ⇒ inconsistent (not rubber-stamped)', () => {
    const r = solveConstraints(oneLine(), [
      { id: 'fix', type: 'fixed', entityIds: ['p0'], satisfied: false },
      { id: 'coin', type: 'coincident', entityIds: ['p1', 'p0'], satisfied: false },
      { id: 'dist', type: 'distance', entityIds: ['p0', 'p1'], value: 10, satisfied: false },
    ], [], 200, 1e-9);
    expect(r.satisfied).toBe(false);
    expect(r.unsatisfiedConstraints).toEqual(expect.arrayContaining(['coin', 'dist']));
    expect(r.solveResult?.status).not.toBe('ok');
  });

  it('rank is scale-robust: horizontal + a 1000-unit distance ⇒ 0 DOF, ok', () => {
    // The two constraints differ in Jacobian scale by ~10³; a naive absolute
    // rank tolerance would mis-count. estimateRank must still see rank 2.
    const seg: SketchSegment[] = [
      { type: 'line', id: 's1', points: [{ id: 'p0', x: 0, y: 0 }, { id: 'p1', x: 1000, y: 0.0001 }] },
    ];
    const r = solveConstraints(seg, [
      { id: 'fix', type: 'fixed', entityIds: ['p0'], satisfied: false },
      { id: 'h', type: 'horizontal', entityIds: ['s1'], satisfied: false },
      { id: 'dist', type: 'distance', entityIds: ['p0', 'p1'], value: 1000, satisfied: false },
    ], [], 200, 1e-9);
    expect(r.solveResult?.status).toBe('ok');
    expect(r.solveResult?.dof).toBe(0);
  });
});
