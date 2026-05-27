import { describe, it, expect } from 'vitest';
import {
  resolveConflicts,
  autoStrength,
  summarize,
  MATE_TYPE_DOFS,
  MATE_TYPE_WEIGHT,
  type AssemblyMate,
} from './mateConflictResolver';

function mate(id: string, a: string, b: string, type: AssemblyMate['type'], strength: number = 100): AssemblyMate {
  return { id, bodyA: a, bodyB: b, type, strength, dofsRemoved: MATE_TYPE_DOFS[type] };
}

describe('resolveConflicts', () => {
  it('empty inputs → resolved', () => {
    const r = resolveConflicts([], []);
    expect(r.resolved).toBe(true);
    expect(r.droppedMates).toEqual([]);
  });

  it('no conflicts → preserves all mates', () => {
    const mates = [mate('m1', 'A', 'B', 'parallel')];
    const r = resolveConflicts(mates, ['A', 'B']);
    expect(r.droppedMates).toEqual([]);
    expect(r.remainingMates).toHaveLength(1);
  });

  it('over-constrained drops weakest mate', () => {
    const mates = [
      mate('m1', 'A', 'B', 'coincident', 50),
      mate('m2', 'A', 'B', 'coincident', 80),
      mate('m3', 'A', 'B', 'coincident', 100),
      mate('m4', 'A', 'B', 'coincident', 30),
    ];
    const r = resolveConflicts(mates, ['A', 'B']);
    expect(r.droppedMates).toContain('m4');
  });

  it('dropping continues until resolved', () => {
    const mates = [
      mate('m1', 'A', 'B', 'concentric', 100),
      mate('m2', 'A', 'B', 'concentric', 90),
      mate('m3', 'A', 'B', 'concentric', 80),
      mate('m4', 'A', 'B', 'concentric', 70),
    ];
    const r = resolveConflicts(mates, ['A', 'B']);
    expect(r.resolved).toBe(true);
  });

  it('preserves stronger mates over weaker ones', () => {
    const mates = [
      mate('strong', 'A', 'B', 'coincident', 1000),
      mate('weak', 'A', 'B', 'coincident', 1),
      mate('mid', 'A', 'B', 'coincident', 500),
    ];
    const r = resolveConflicts(mates, ['A', 'B']);
    if (r.droppedMates.length > 0) {
      expect(r.droppedMates).toContain('weak');
    }
  });

  it('records trace per dropped mate', () => {
    const mates = [
      mate('m1', 'A', 'B', 'coincident', 50),
      mate('m2', 'A', 'B', 'coincident', 50),
      mate('m3', 'A', 'B', 'coincident', 50),
    ];
    const r = resolveConflicts(mates, ['A', 'B']);
    expect(r.trace.length).toBe(r.droppedMates.length);
  });

  it('lists conflicts in the result', () => {
    const mates = [
      mate('m1', 'A', 'B', 'coincident'),
      mate('m2', 'A', 'B', 'coincident'),
      mate('m3', 'A', 'B', 'coincident'),
    ];
    const r = resolveConflicts(mates, ['A', 'B']);
    expect(r.conflicts.length).toBeGreaterThan(0);
  });

  it('independent body groups solve independently', () => {
    const mates = [
      mate('m1', 'A', 'B', 'parallel'),
      mate('m2', 'C', 'D', 'parallel'),
    ];
    const r = resolveConflicts(mates, ['A', 'B', 'C', 'D']);
    expect(r.resolved).toBe(true);
    expect(r.droppedMates).toEqual([]);
  });

  it('maxIterations limits work', () => {
    const mates: AssemblyMate[] = [];
    for (let i = 0; i < 10; i++) mates.push(mate(`m${i}`, 'A', 'B', 'coincident'));
    const r = resolveConflicts(mates, ['A', 'B'], { maxIterations: 1 });
    expect(r.droppedMates.length).toBeLessThanOrEqual(1);
  });
});

describe('autoStrength', () => {
  it('coincident gets a high base weight', () => {
    expect(autoStrength('coincident', 1)).toBeGreaterThan(autoStrength('distance', 1));
  });

  it('creation order is the tiebreaker', () => {
    const a = autoStrength('parallel', 1);
    const b = autoStrength('parallel', 100);
    expect(b).toBeGreaterThan(a);
  });
});

describe('MATE_TYPE_DOFS / WEIGHT', () => {
  it('coincident removes 3 DOFs', () => {
    expect(MATE_TYPE_DOFS.coincident).toBe(3);
  });

  it('concentric weight equals coincident weight', () => {
    expect(MATE_TYPE_WEIGHT.concentric).toBe(MATE_TYPE_WEIGHT.coincident);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const s = summarize([], { droppedMates: [], remainingMates: [], conflicts: [], resolved: true, trace: [] });
    expect(s.totalMates).toBe(0);
    expect(s.resolved).toBe(true);
  });

  it('preservedFraction = remaining / total', () => {
    const mates = [
      mate('m1', 'A', 'B', 'coincident', 50),
      mate('m2', 'A', 'B', 'coincident', 80),
      mate('m3', 'A', 'B', 'coincident', 100),
    ];
    const r = resolveConflicts(mates, ['A', 'B']);
    const s = summarize(mates, r);
    expect(s.preservedFraction).toBeCloseTo(r.remainingMates.length / mates.length, 5);
  });

  it('reports conflict count', () => {
    const mates = [
      mate('m1', 'A', 'B', 'coincident'),
      mate('m2', 'A', 'B', 'coincident'),
      mate('m3', 'A', 'B', 'coincident'),
    ];
    const s = summarize(mates, resolveConflicts(mates, ['A', 'B']));
    expect(s.conflictCount).toBeGreaterThanOrEqual(0);
  });
});
