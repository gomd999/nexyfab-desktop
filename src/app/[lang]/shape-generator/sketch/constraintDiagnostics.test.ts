import { describe, it, expect } from 'vitest';
import {
  analyzeDof,
  detectConflicts,
  suggestLineConstraints,
  checkSketchHealth,
  type SketchEntity,
  type ConstraintRef,
} from './constraintDiagnostics';

describe('analyzeDof', () => {
  it('unconstrained line has 4 DOF', () => {
    const entities: SketchEntity[] = [{ id: 'l1', kind: 'line' }];
    const r = analyzeDof(entities, []);
    expect(r.rows[0]!.remaining).toBe(4);
    expect(r.totalRemainingDof).toBe(4);
    expect(r.fullyDetermined).toBe(false);
  });

  it('horizontal constraint reduces DOF by 1', () => {
    const entities: SketchEntity[] = [{ id: 'l1', kind: 'line' }];
    const constraints: ConstraintRef[] = [
      { id: 'c1', type: 'horizontal', entityIds: ['l1'] },
    ];
    const r = analyzeDof(entities, constraints);
    expect(r.rows[0]!.remaining).toBe(3);
  });

  it('fixed constraint subtracts 2 DOF', () => {
    const entities: SketchEntity[] = [{ id: 'p1', kind: 'point' }];
    const constraints: ConstraintRef[] = [
      { id: 'c1', type: 'fixed', entityIds: ['p1'] },
    ];
    const r = analyzeDof(entities, constraints);
    expect(r.rows[0]!.remaining).toBe(0);
    expect(r.fullyDetermined).toBe(true);
  });

  it('over-determined when too many constraints', () => {
    const entities: SketchEntity[] = [{ id: 'p1', kind: 'point' }];
    const constraints: ConstraintRef[] = [
      { id: 'c1', type: 'fixed', entityIds: ['p1'] },
      { id: 'c2', type: 'fixed', entityIds: ['p1'] },
    ];
    const r = analyzeDof(entities, constraints);
    expect(r.overDetermined).toBe(true);
  });

  it('lists constraints per entity', () => {
    const entities: SketchEntity[] = [
      { id: 'l1', kind: 'line' },
      { id: 'l2', kind: 'line' },
    ];
    const constraints: ConstraintRef[] = [
      { id: 'c1', type: 'parallel', entityIds: ['l1', 'l2'] },
    ];
    const r = analyzeDof(entities, constraints);
    expect(r.rows[0]!.constraintsApplied).toEqual(['c1']);
    expect(r.rows[1]!.constraintsApplied).toEqual(['c1']);
  });
});

describe('detectConflicts', () => {
  it('returns null when no conflict', () => {
    const entities: SketchEntity[] = [{ id: 'p1', kind: 'point' }];
    const constraints: ConstraintRef[] = [
      { id: 'c1', type: 'fixed', entityIds: ['p1'] },
    ];
    const r = detectConflicts(entities, constraints);
    expect(r.firstConflictAt).toBeNull();
  });

  it('reports first conflicting constraint position', () => {
    const entities: SketchEntity[] = [{ id: 'p1', kind: 'point' }];
    const constraints: ConstraintRef[] = [
      { id: 'c1', type: 'fixed', entityIds: ['p1'] },
      { id: 'c2', type: 'fixed', entityIds: ['p1'] },
    ];
    const r = detectConflicts(entities, constraints);
    expect(r.firstConflictAt).toBe(1);
    expect(r.conflictingConstraintId).toBe('c2');
  });
});

describe('suggestLineConstraints', () => {
  it('suggests horizontal for nearly horizontal line', () => {
    const newLine = { id: 'new', x1: 0, y1: 0, x2: 100, y2: 1 };
    const r = suggestLineConstraints(newLine, [], []);
    expect(r.some(s => s.type === 'horizontal')).toBe(true);
  });

  it('suggests vertical for nearly vertical line', () => {
    const newLine = { id: 'new', x1: 0, y1: 0, x2: 1, y2: 100 };
    const r = suggestLineConstraints(newLine, [], []);
    expect(r.some(s => s.type === 'vertical')).toBe(true);
  });

  it('suggests parallel when angle matches existing', () => {
    const existing = { id: 'L1', x1: 0, y1: 0, x2: 50, y2: 25 };
    const newLine = { id: 'new', x1: 100, y1: 0, x2: 150, y2: 25.1 };
    const r = suggestLineConstraints(newLine, [existing], []);
    expect(r.some(s => s.type === 'parallel')).toBe(true);
  });

  it('suggests perpendicular at 90°', () => {
    const existing = { id: 'L1', x1: 0, y1: 0, x2: 100, y2: 0 };
    const newLine = { id: 'new', x1: 0, y1: 0, x2: 0.5, y2: 100 };
    const r = suggestLineConstraints(newLine, [existing], []);
    expect(r.some(s => s.type === 'perpendicular')).toBe(true);
  });

  it('suggests coincident when endpoint near existing point', () => {
    const point = { id: 'P1', x: 50, y: 50 };
    const newLine = { id: 'new', x1: 0, y1: 0, x2: 50.5, y2: 50 };
    const r = suggestLineConstraints(newLine, [], [point]);
    expect(r.some(s => s.type === 'coincident')).toBe(true);
  });

  it('sorts suggestions by confidence (highest first)', () => {
    const newLine = { id: 'new', x1: 0, y1: 0, x2: 100, y2: 0.5 };
    const r = suggestLineConstraints(newLine, [], []);
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1]!.confidence).toBeGreaterThanOrEqual(r[i]!.confidence);
    }
  });

  it('no suggestions for distinct line in empty sketch', () => {
    const newLine = { id: 'new', x1: 0, y1: 0, x2: 100, y2: 75 };
    const r = suggestLineConstraints(newLine, [], []);
    expect(r).toHaveLength(0);
  });
});

describe('checkSketchHealth', () => {
  it('returns under-determined for free entity', () => {
    const r = checkSketchHealth(
      [{ id: 'p1', kind: 'point' }],
      [],
    );
    expect(r.status).toBe('under-determined');
    expect(r.underDeterminedEntityIds).toEqual(['p1']);
  });

  it('returns fully-determined when all entities locked', () => {
    const r = checkSketchHealth(
      [{ id: 'p1', kind: 'point' }],
      [{ id: 'c1', type: 'fixed', entityIds: ['p1'] }],
    );
    expect(r.status).toBe('fully-determined');
  });

  it('returns over-determined for double-fixed point', () => {
    const r = checkSketchHealth(
      [{ id: 'p1', kind: 'point' }],
      [
        { id: 'c1', type: 'fixed', entityIds: ['p1'] },
        { id: 'c2', type: 'fixed', entityIds: ['p1'] },
      ],
    );
    expect(r.status).toBe('over-determined');
    expect(r.conflict.firstConflictAt).toBe(1);
  });
});
