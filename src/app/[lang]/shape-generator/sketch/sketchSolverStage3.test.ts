import { describe, it, expect } from 'vitest';
import {
  validateHighOrderConstraint,
  autoRelaxToDriven,
  findSnap,
  propagateDrag,
  type ConstraintEntity,
  type HighOrderConstraint,
  type SketchDimension,
} from './sketchSolverStage3';

describe('equal-radius-group', () => {
  it('passes when all radii equal', () => {
    const ents: ConstraintEntity[] = [
      { id: 'c1', kind: 'circle', center: { x: 0, y: 0 }, radius: 5 },
      { id: 'c2', kind: 'circle', center: { x: 10, y: 0 }, radius: 5 },
      { id: 'c3', kind: 'circle', center: { x: 0, y: 10 }, radius: 5 },
    ];
    const c: HighOrderConstraint = { id: 'eq', kind: 'equal-radius-group', entityIds: ['c1', 'c2', 'c3'] };
    const r = validateHighOrderConstraint(c, ents);
    expect(r.satisfied).toBe(true);
    expect(r.residual).toBeCloseTo(0, 6);
  });

  it('fails when radii diverge', () => {
    const ents: ConstraintEntity[] = [
      { id: 'c1', kind: 'circle', center: { x: 0, y: 0 }, radius: 5 },
      { id: 'c2', kind: 'circle', center: { x: 10, y: 0 }, radius: 7 },
    ];
    const c: HighOrderConstraint = { id: 'eq', kind: 'equal-radius-group', entityIds: ['c1', 'c2'] };
    const r = validateHighOrderConstraint(c, ents);
    expect(r.satisfied).toBe(false);
    expect(r.reason).toContain('σ');
  });
});

describe('concentric-group', () => {
  it('passes when all centers coincide', () => {
    const ents: ConstraintEntity[] = [
      { id: 'a', kind: 'circle', center: { x: 0, y: 0 }, radius: 1 },
      { id: 'b', kind: 'arc', center: { x: 0, y: 0 }, radius: 2 },
    ];
    const c: HighOrderConstraint = { id: 'co', kind: 'concentric-group', entityIds: ['a', 'b'] };
    const r = validateHighOrderConstraint(c, ents);
    expect(r.satisfied).toBe(true);
  });

  it('fails when centers drift apart', () => {
    const ents: ConstraintEntity[] = [
      { id: 'a', kind: 'circle', center: { x: 0, y: 0 }, radius: 1 },
      { id: 'b', kind: 'arc', center: { x: 0.5, y: 0 }, radius: 2 },
    ];
    const c: HighOrderConstraint = { id: 'co', kind: 'concentric-group', entityIds: ['a', 'b'] };
    const r = validateHighOrderConstraint(c, ents);
    expect(r.satisfied).toBe(false);
  });
});

describe('collinear-group', () => {
  it('3 collinear points pass', () => {
    const ents: ConstraintEntity[] = [
      { id: 'p1', kind: 'point', center: { x: 0, y: 0 } },
      { id: 'p2', kind: 'point', center: { x: 5, y: 0 } },
      { id: 'p3', kind: 'point', center: { x: 10, y: 0 } },
    ];
    const c: HighOrderConstraint = { id: 'cl', kind: 'collinear-group', entityIds: ['p1', 'p2', 'p3'] };
    expect(validateHighOrderConstraint(c, ents).satisfied).toBe(true);
  });

  it('off-line point fails', () => {
    const ents: ConstraintEntity[] = [
      { id: 'p1', kind: 'point', center: { x: 0, y: 0 } },
      { id: 'p2', kind: 'point', center: { x: 5, y: 3 } },
      { id: 'p3', kind: 'point', center: { x: 10, y: 0 } },
    ];
    const c: HighOrderConstraint = { id: 'cl', kind: 'collinear-group', entityIds: ['p1', 'p2', 'p3'] };
    expect(validateHighOrderConstraint(c, ents).satisfied).toBe(false);
  });
});

describe('polygon-symmetry', () => {
  it('square vertices equidistant from centroid pass', () => {
    const ents: ConstraintEntity[] = [
      { id: 'v1', kind: 'point', center: { x: 1, y: 1 } },
      { id: 'v2', kind: 'point', center: { x: -1, y: 1 } },
      { id: 'v3', kind: 'point', center: { x: -1, y: -1 } },
      { id: 'v4', kind: 'point', center: { x: 1, y: -1 } },
    ];
    const c: HighOrderConstraint = { id: 'sq', kind: 'polygon-symmetry', entityIds: ['v1', 'v2', 'v3', 'v4'], value: 4 };
    expect(validateHighOrderConstraint(c, ents).satisfied).toBe(true);
  });

  it('wrong vertex count fails', () => {
    const ents: ConstraintEntity[] = [
      { id: 'v1', kind: 'point', center: { x: 1, y: 0 } },
      { id: 'v2', kind: 'point', center: { x: 0, y: 1 } },
    ];
    const c: HighOrderConstraint = { id: 'tri', kind: 'polygon-symmetry', entityIds: ['v1', 'v2'], value: 3 };
    expect(validateHighOrderConstraint(c, ents).satisfied).toBe(false);
  });
});

describe('parallel-group', () => {
  it('two parallel lines pass', () => {
    const ents: ConstraintEntity[] = [
      { id: 'l1', kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { id: 'l2', kind: 'line', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
    ];
    const c: HighOrderConstraint = { id: 'pl', kind: 'parallel-group', entityIds: ['l1', 'l2'] };
    expect(validateHighOrderConstraint(c, ents).satisfied).toBe(true);
  });

  it('perpendicular lines fail', () => {
    const ents: ConstraintEntity[] = [
      { id: 'l1', kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { id: 'l2', kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 10 } },
    ];
    const c: HighOrderConstraint = { id: 'pl', kind: 'parallel-group', entityIds: ['l1', 'l2'] };
    expect(validateHighOrderConstraint(c, ents).satisfied).toBe(false);
  });
});

describe('autoRelaxToDriven', () => {
  it('no-op when not over-constrained', () => {
    const dims: SketchDimension[] = [
      { id: 'd1', entityIds: [], value: 10, driver: 'driving' },
    ];
    const r = autoRelaxToDriven(dims, 0);
    expect(r.flippedDimensionIds).toHaveLength(0);
  });

  it('flips N dims when over-constrained by N', () => {
    const dims: SketchDimension[] = [
      { id: 'd1', entityIds: [], value: 100, driver: 'driving' },
      { id: 'd2', entityIds: [], value: 5, driver: 'driving' },
      { id: 'd3', entityIds: [], value: 50, driver: 'driving' },
    ];
    const r = autoRelaxToDriven(dims, 1);
    expect(r.flippedDimensionIds).toHaveLength(1);
  });

  it('prefers expression-bearing dims to flip first', () => {
    const dims: SketchDimension[] = [
      { id: 'd1', entityIds: [], value: 100, driver: 'driving' },
      { id: 'd2', entityIds: [], value: 5, driver: 'driving', expression: '2*L' },
    ];
    const r = autoRelaxToDriven(dims, 1);
    expect(r.flippedDimensionIds).toContain('d2');
  });

  it('reports when not enough driving dims', () => {
    const dims: SketchDimension[] = [
      { id: 'd1', entityIds: [], value: 10, driver: 'driven' },
    ];
    const r = autoRelaxToDriven(dims, 1);
    expect(r.flippedDimensionIds).toHaveLength(0);
    expect(r.reason).toContain('Not enough');
  });
});

describe('findSnap', () => {
  const ents: ConstraintEntity[] = [
    { id: 'p1', kind: 'point', center: { x: 0, y: 0 } },
    { id: 'l1', kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { id: 'c1', kind: 'circle', center: { x: 50, y: 50 }, radius: 5 },
  ];

  it('snaps to vertex within pickup radius', () => {
    const r = findSnap({
      cursorPos: { x: 0.1, y: 0 },
      entities: ents, pickupRadiusMm: 1, activeKinds: ['vertex'],
    });
    expect(r?.kind).toBe('vertex');
    expect(r?.position.x).toBe(0);
  });

  it('snaps to line midpoint', () => {
    const r = findSnap({
      cursorPos: { x: 5, y: 0.1 },
      entities: ents, pickupRadiusMm: 1, activeKinds: ['midpoint'],
    });
    expect(r?.kind).toBe('midpoint');
    expect(r?.position.x).toBeCloseTo(5, 6);
  });

  it('snaps to circle center', () => {
    const r = findSnap({
      cursorPos: { x: 50.2, y: 50 },
      entities: ents, pickupRadiusMm: 1, activeKinds: ['center'],
    });
    expect(r?.kind).toBe('center');
    expect(r?.position.x).toBe(50);
  });

  it('returns null when nothing in range', () => {
    const r = findSnap({
      cursorPos: { x: 1000, y: 1000 },
      entities: ents, pickupRadiusMm: 1, activeKinds: ['vertex', 'midpoint', 'center'],
    });
    expect(r).toBeNull();
  });

  it('snaps to grid', () => {
    const r = findSnap({
      cursorPos: { x: 11.2, y: 4.9 },
      entities: [], pickupRadiusMm: 2, activeKinds: ['grid'],
      gridSpacingMm: 5,
    });
    expect(r?.kind).toBe('grid');
    expect(r?.position.x).toBe(10);
    expect(r?.position.y).toBe(5);
  });

  it('snaps to line-line intersection', () => {
    const crossEnts: ConstraintEntity[] = [
      { id: 'l1', kind: 'line', start: { x: -5, y: 0 }, end: { x: 5, y: 0 } },
      { id: 'l2', kind: 'line', start: { x: 0, y: -5 }, end: { x: 0, y: 5 } },
    ];
    const r = findSnap({
      cursorPos: { x: 0.1, y: 0.1 },
      entities: crossEnts, pickupRadiusMm: 1, activeKinds: ['intersection'],
    });
    expect(r?.kind).toBe('intersection');
    expect(r?.position.x).toBeCloseTo(0, 6);
    expect(r?.position.y).toBeCloseTo(0, 6);
  });

  it('returns closest of multiple candidates', () => {
    const r = findSnap({
      cursorPos: { x: 0.05, y: 0 },
      entities: ents, pickupRadiusMm: 5, activeKinds: ['vertex', 'midpoint'],
    });
    expect(r?.position.x).toBe(0);
  });
});

describe('propagateDrag', () => {
  it('drags target entity by delta', () => {
    const ents: ConstraintEntity[] = [
      { id: 'p1', kind: 'point', center: { x: 0, y: 0 } },
    ];
    const r = propagateDrag({
      entityId: 'p1',
      delta: { x: 5, y: 3 },
      entities: ents,
      constraints: [],
    });
    const moved = r.entities.find(e => e.id === 'p1');
    expect(moved?.center?.x).toBe(5);
    expect(moved?.center?.y).toBe(3);
  });

  it('converges when no propagation needed', () => {
    const ents: ConstraintEntity[] = [
      { id: 'p1', kind: 'point', center: { x: 0, y: 0 } },
    ];
    const r = propagateDrag({
      entityId: 'p1',
      delta: { x: 1, y: 0 },
      entities: ents,
      constraints: [],
    });
    expect(r.converged).toBe(true);
  });

  it('does not mutate the input entities array', () => {
    const ents: ConstraintEntity[] = [
      { id: 'p1', kind: 'point', center: { x: 0, y: 0 } },
    ];
    propagateDrag({
      entityId: 'p1',
      delta: { x: 5, y: 0 },
      entities: ents,
      constraints: [],
    });
    expect(ents[0]!.center?.x).toBe(0);
  });

  it('drag with concentric constraint moves linked entity too', () => {
    const ents: ConstraintEntity[] = [
      { id: 'c1', kind: 'circle', center: { x: 0, y: 0 }, radius: 1 },
      { id: 'c2', kind: 'circle', center: { x: 0, y: 0 }, radius: 2 },
    ];
    const cs: HighOrderConstraint[] = [
      { id: 'co', kind: 'concentric-group', entityIds: ['c1', 'c2'] },
    ];
    const r = propagateDrag({
      entityId: 'c1',
      delta: { x: 10, y: 0 },
      entities: ents,
      constraints: cs,
    });
    const c2 = r.entities.find(e => e.id === 'c2');
    expect(c2?.center?.x).toBeGreaterThan(0);
  });
});
