import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  propagateChange,
  topologicalSolveOrder,
  analyzeOverConstraint,
  summarize,
  type EntityNode,
  type ConstraintNode,
} from './constraintPropagation';

const entities: EntityNode[] = [
  { id: 'p1', kind: 'point' },
  { id: 'p2', kind: 'point' },
  { id: 'p3', kind: 'point' },
  { id: 'l1', kind: 'line' },
];

const constraints: ConstraintNode[] = [
  { id: 'c1', kind: 'coincident', entityIds: ['p1', 'p2'], driving: true },
  { id: 'c2', kind: 'distance', entityIds: ['p2', 'p3'], driving: true },
  { id: 'c3', kind: 'parallel', entityIds: ['l1'], driving: true },
];

describe('buildGraph', () => {
  it('indexes entities + constraints', () => {
    const g = buildGraph(entities, constraints);
    expect(g.entities.size).toBe(4);
    expect(g.constraints.size).toBe(3);
  });

  it('entity → constraints lookup', () => {
    const g = buildGraph(entities, constraints);
    expect(g.entityToConstraints.get('p2')?.size).toBe(2);
  });
});

describe('propagateChange', () => {
  it('starting from p1, reaches p3 via c1 + c2', () => {
    const g = buildGraph(entities, constraints);
    const r = propagateChange(g, 'p1');
    expect(r.affectedEntities).toContain('p3');
  });

  it('isolated entity affects only itself', () => {
    const g = buildGraph(entities, constraints);
    const r = propagateChange(g, 'l1');
    expect(r.affectedEntities).toContain('l1');
  });

  it('reports visitedConstraints', () => {
    const g = buildGraph(entities, constraints);
    const r = propagateChange(g, 'p1');
    expect(r.visitedConstraints.length).toBeGreaterThan(0);
  });

  it('detects cycle in dependent subgraph', () => {
    // Entity ring: p1-p2-p3-p1.
    const ringConstraints: ConstraintNode[] = [
      { id: 'a', kind: 'distance', entityIds: ['p1', 'p2'], driving: true },
      { id: 'b', kind: 'distance', entityIds: ['p2', 'p3'], driving: true },
      { id: 'c', kind: 'distance', entityIds: ['p3', 'p1'], driving: true },
    ];
    const g = buildGraph(entities.slice(0, 3), ringConstraints);
    const r = propagateChange(g, 'p1');
    expect(r.hasCycle).toBe(true);
  });
});

describe('topologicalSolveOrder', () => {
  it('produces order', () => {
    const g = buildGraph(entities, constraints);
    const r = topologicalSolveOrder(g);
    expect(r.order.length).toBeGreaterThan(0);
  });

  it('cycle nodes empty in chain', () => {
    const chain: ConstraintNode[] = [
      { id: 'a', kind: 'coincident', entityIds: ['p1', 'p2'], driving: true },
      { id: 'b', kind: 'coincident', entityIds: ['p2', 'p3'], driving: true },
    ];
    const g = buildGraph(entities.slice(0, 3), chain);
    const r = topologicalSolveOrder(g);
    expect(r.cycleNodes).toEqual([]);
  });
});

describe('analyzeOverConstraint', () => {
  it('under-constrained → not flagged', () => {
    const g = buildGraph(entities, []);
    const r = analyzeOverConstraint(g);
    expect(r.overConstrained).toBe(false);
  });

  it('over-constrained → flagged + suggestions', () => {
    const tinyEntities: EntityNode[] = [{ id: 'p', kind: 'point' }];
    const overCs: ConstraintNode[] = [
      { id: 'a', kind: 'coincident', entityIds: ['p'], driving: true },
      { id: 'b', kind: 'coincident', entityIds: ['p'], driving: true },
    ];
    const g = buildGraph(tinyEntities, overCs);
    const r = analyzeOverConstraint(g);
    expect(r.overConstrained).toBe(true);
    expect(r.suggestDropIds.length).toBeGreaterThan(0);
  });

  it('DOF counts honored', () => {
    const g = buildGraph(entities, constraints);
    const r = analyzeOverConstraint(g);
    expect(r.availableDof).toBe(2 + 2 + 2 + 4); // 3 points + 1 line
  });
});

describe('summarize', () => {
  it('counts driving constraints', () => {
    const g = buildGraph(entities, constraints);
    expect(summarize(g).drivingCount).toBe(3);
  });

  it('averageEntityConstraints', () => {
    const g = buildGraph(entities, constraints);
    const s = summarize(g);
    expect(s.averageEntityConstraints).toBeGreaterThan(0);
  });
});
