import { describe, it, expect } from 'vitest';
import {
  detectRedundancy,
  suggestRemovals,
  perBodyDof,
  summarize,
  DOFS_REMOVED_BY_KIND,
  type Mate,
} from './mateRedundancyDetector';

function mate(id: string, a: string, b: string, kind: Mate['kind']): Mate {
  return { id, bodyA: a, bodyB: b, kind };
}

describe('DOFS_REMOVED_BY_KIND', () => {
  it('hinge removes 5 DOFs', () => {
    expect(DOFS_REMOVED_BY_KIND.hinge).toBe(5);
  });

  it('lock removes 6 DOFs', () => {
    expect(DOFS_REMOVED_BY_KIND.lock).toBe(6);
  });

  it('coincident removes 3 DOFs', () => {
    expect(DOFS_REMOVED_BY_KIND.coincident).toBe(3);
  });
});

describe('detectRedundancy', () => {
  it('single body, no mates → 0 DOFs total', () => {
    const r = detectRedundancy(['A'], []);
    expect(r.totalDofs).toBe(0);
    expect(r.dofRemoved).toBe(0);
  });

  it('two bodies → 6 free DOFs initially', () => {
    const r = detectRedundancy(['A', 'B'], []);
    expect(r.totalDofs).toBe(6);
  });

  it('two bodies + lock mate → fully constrained', () => {
    const r = detectRedundancy(['A', 'B'], [mate('m1', 'A', 'B', 'lock')]);
    expect(r.fullyConstrained).toBe(true);
    expect(r.remainingDof).toBe(0);
  });

  it('two bodies + hinge mate → 1 DOF remains', () => {
    const r = detectRedundancy(['A', 'B'], [mate('m1', 'A', 'B', 'hinge')]);
    expect(r.remainingDof).toBe(1);
    expect(r.overConstrained).toBe(false);
  });

  it('over-constraint detected', () => {
    const mates = [
      mate('m1', 'A', 'B', 'lock'),
      mate('m2', 'A', 'B', 'concentric'),
    ];
    const r = detectRedundancy(['A', 'B'], mates);
    expect(r.overConstrained).toBe(true);
    expect(r.redundantMateIds.length).toBeGreaterThan(0);
  });

  it('pairCounts groups by body pair', () => {
    const mates = [
      mate('m1', 'A', 'B', 'concentric'),
      mate('m2', 'B', 'A', 'coincident'),
    ];
    const r = detectRedundancy(['A', 'B'], mates);
    expect(r.pairCounts.size).toBe(1);
  });

  it('three-body chain: 12 DOFs, 2 hinges → 2 remaining', () => {
    const mates = [
      mate('m1', 'A', 'B', 'hinge'),
      mate('m2', 'B', 'C', 'hinge'),
    ];
    const r = detectRedundancy(['A', 'B', 'C'], mates);
    expect(r.totalDofs).toBe(12);
    expect(r.dofRemoved).toBe(10);
    expect(r.remainingDof).toBe(2);
  });

  it('redundant pair flagged when totalDofs > 6', () => {
    const mates = [
      mate('m1', 'A', 'B', 'concentric'),
      mate('m2', 'A', 'B', 'concentric'),
    ];
    const r = detectRedundancy(['A', 'B'], mates);
    expect(r.redundantMateIds).toContain('m2');
  });
});

describe('suggestRemovals', () => {
  it('suggests removing redundant mates', () => {
    const mates = [
      mate('m1', 'A', 'B', 'concentric'),
      mate('m2', 'A', 'B', 'concentric'),
    ];
    const r = detectRedundancy(['A', 'B'], mates);
    const suggestions = suggestRemovals(r, mates);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.mateId).toBe('m2');
  });

  it('empty if no redundancy', () => {
    const r = detectRedundancy(['A', 'B'], [mate('m1', 'A', 'B', 'hinge')]);
    expect(suggestRemovals(r, [mate('m1', 'A', 'B', 'hinge')])).toEqual([]);
  });
});

describe('perBodyDof', () => {
  it('counts mate references per body', () => {
    const mates = [
      mate('m1', 'A', 'B', 'hinge'),
      mate('m2', 'A', 'C', 'concentric'),
    ];
    const usage = perBodyDof(['A', 'B', 'C'], mates);
    const a = usage.find(u => u.bodyId === 'A')!;
    expect(a.mateCount).toBe(2);
    expect(a.dofsRemoved).toBe(5 + 4);
  });

  it('flags ground bodies', () => {
    const m: Mate = { id: 'm1', bodyA: 'A', bodyB: 'GROUND', kind: 'lock', groundedB: true };
    const usage = perBodyDof(['A', 'GROUND'], [m]);
    const g = usage.find(u => u.bodyId === 'GROUND')!;
    expect(g.isGround).toBe(true);
  });
});

describe('summarize', () => {
  it('reports counts + over-constraint', () => {
    const mates = [
      mate('m1', 'A', 'B', 'lock'),
      mate('m2', 'A', 'B', 'concentric'),
    ];
    const r = detectRedundancy(['A', 'B'], mates);
    const s = summarize(r, mates.length);
    expect(s.bodyCount).toBe(2);
    expect(s.mateCount).toBe(2);
    expect(s.overConstrained).toBe(true);
    expect(s.redundantMateCount).toBeGreaterThan(0);
  });

  it('highestPairDof tracks worst pair', () => {
    const mates = [
      mate('m1', 'A', 'B', 'lock'),
      mate('m2', 'A', 'B', 'concentric'),
    ];
    const r = detectRedundancy(['A', 'B'], mates);
    expect(summarize(r, mates.length).highestPairDof).toBe(10);
  });
});
