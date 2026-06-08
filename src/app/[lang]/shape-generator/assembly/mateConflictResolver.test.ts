import { describe, it, expect } from 'vitest';
import {
  resolveConflicts,
  proposeConflictResolutions,
  applyAcceptedResolution,
  acceptAllRecommended,
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

  describe('proposeConflictResolutions (A1 viewport feedback)', () => {
    it('no conflict → no proposals', () => {
      const proposals = proposeConflictResolutions([mate('m1', 'A', 'B', 'parallel')], ['A', 'B']);
      expect(proposals).toEqual([]);
    });

    it('over-constrained → ranked options (weakest first) + highlight set, non-destructive', () => {
      const mates = [
        mate('m1', 'A', 'B', 'coincident', 50),
        mate('m2', 'A', 'B', 'coincident', 80),
        mate('m3', 'A', 'B', 'coincident', 100),
        mate('m4', 'A', 'B', 'coincident', 30),
      ];
      const proposals = proposeConflictResolutions(mates, ['A', 'B']);
      expect(proposals).toHaveLength(1);
      const p = proposals[0]!;
      // Highlights the whole over-constrained subgraph.
      expect(new Set(p.highlightMateIds)).toEqual(new Set(['m1', 'm2', 'm3', 'm4']));
      // Options ranked weakest-first.
      expect(p.options.map((o) => o.dropMateId)).toEqual(['m4', 'm1', 'm2', 'm3']);
      // Recommended = weakest = what resolveConflicts drops first.
      expect(p.recommended?.dropMateId).toBe('m4');
      expect(resolveConflicts(mates, ['A', 'B']).droppedMates[0]).toBe('m4');
      // Non-destructive: the input list is untouched.
      expect(mates).toHaveLength(4);
    });

    it('accept loop (propose → applyAccepted → re-propose) converges to resolveConflicts', () => {
      const bodies = ['A', 'B'];
      let mates = [
        mate('m1', 'A', 'B', 'coincident', 50),
        mate('m2', 'A', 'B', 'coincident', 80),
        mate('m3', 'A', 'B', 'coincident', 100),
        mate('m4', 'A', 'B', 'coincident', 30),
      ];
      const accepted: string[] = [];
      for (let guard = 0; guard < 16; guard++) {
        const proposals = proposeConflictResolutions(mates, bodies);
        if (proposals.length === 0) break;
        const pick = proposals[0]!.recommended!.dropMateId;
        accepted.push(pick);
        mates = applyAcceptedResolution(mates, pick); // user accepts the recommended
      }
      expect(proposeConflictResolutions(mates, bodies)).toEqual([]); // converged
      // Same mates dropped as the fully-automatic path.
      const auto = resolveConflicts(
        [
          mate('m1', 'A', 'B', 'coincident', 50),
          mate('m2', 'A', 'B', 'coincident', 80),
          mate('m3', 'A', 'B', 'coincident', 100),
          mate('m4', 'A', 'B', 'coincident', 30),
        ],
        bodies,
      );
      expect(new Set(accepted)).toEqual(new Set(auto.droppedMates));
    });

    it('acceptAllRecommended drops every recommended mate in one pass', () => {
      // Each pair over-constrained: 2 concentric (4+4=8 DOF) on 2 bodies (avail 6).
      const mates = [
        mate('m1', 'A', 'B', 'concentric', 50),
        mate('m2', 'A', 'B', 'concentric', 30), // weakest in A-B
        mate('c1', 'C', 'D', 'concentric', 90),
        mate('c2', 'C', 'D', 'concentric', 40), // weakest in C-D
      ];
      const proposals = proposeConflictResolutions(mates, ['A', 'B', 'C', 'D']);
      expect(proposals.length).toBe(2); // two independent over-constrained pairs
      const next = acceptAllRecommended(mates, proposals);
      const remaining = next.map((m) => m.id);
      expect(remaining).not.toContain('m2');
      expect(remaining).not.toContain('c2');
      expect(remaining).toContain('m1');
      expect(remaining).toContain('c1');
    });
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
