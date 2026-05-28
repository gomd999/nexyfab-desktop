/**
 * assemblyMateApi.test.ts — Phase 3 stub smoke test.
 *
 * Wave 2 Phase 2 Track D Week 4. This file's purpose is to assert the
 * forward-declared type surface compiles, all 7 mate kinds are
 * constructible, and the helper guards narrow correctly. There is no
 * runtime logic to test — the goal is to lock in the API contract so
 * Phase 3 implementation can't silently rename a kind or drop a field.
 */

import { describe, it, expect } from 'vitest';
import {
  ASSEMBLY_MATE_KINDS,
  isAngleMate,
  isDistanceMate,
  isMateKind,
  type AssemblyMate,
  type AssemblyMateKind,
  type AssemblyMateRef,
} from '../assemblyMateApi';

function refOf(nodeId: string): AssemblyMateRef {
  return { kind: 'reference', nodeId };
}

function makeMate<K extends AssemblyMateKind>(kind: K): AssemblyMate {
  const entities: readonly [AssemblyMateRef, AssemblyMateRef] = [
    refOf('a'),
    refOf('b'),
  ];
  switch (kind) {
    case 'coincident':
      return {
        id: 'mate_1',
        kind: 'coincident',
        entities,
        constraints: { kind: 'coincident', params: {} },
        label: 'Mate',
        enabled: true,
      } as AssemblyMate;
    case 'concentric':
      return {
        id: 'mate_1',
        kind: 'concentric',
        entities,
        constraints: { kind: 'concentric', params: {} },
        label: 'Mate',
        enabled: true,
      } as AssemblyMate;
    case 'parallel':
      return {
        id: 'mate_1',
        kind: 'parallel',
        entities,
        constraints: { kind: 'parallel', params: {} },
        label: 'Mate',
        enabled: true,
      } as AssemblyMate;
    case 'perpendicular':
      return {
        id: 'mate_1',
        kind: 'perpendicular',
        entities,
        constraints: { kind: 'perpendicular', params: {} },
        label: 'Mate',
        enabled: true,
      } as AssemblyMate;
    case 'tangent':
      return {
        id: 'mate_1',
        kind: 'tangent',
        entities,
        constraints: { kind: 'tangent', params: {} },
        label: 'Mate',
        enabled: true,
      } as AssemblyMate;
    case 'distance':
      return {
        id: 'mate_1',
        kind: 'distance',
        entities,
        constraints: { kind: 'distance', params: { distanceMm: 12.5 } },
        label: 'Mate',
        enabled: true,
      } as AssemblyMate;
    case 'angle':
      return {
        id: 'mate_1',
        kind: 'angle',
        entities,
        constraints: { kind: 'angle', params: { angleDeg: 45 } },
        label: 'Mate',
        enabled: true,
      } as AssemblyMate;
  }
}

describe('Phase 3 AssemblyMate API surface (type-only)', () => {
  it('exports the closed kind union with 7 entries', () => {
    expect(ASSEMBLY_MATE_KINDS.length).toBe(7);
    expect(new Set(ASSEMBLY_MATE_KINDS).size).toBe(7);
  });

  it('all 7 mate kinds construct as AssemblyMate', () => {
    for (const kind of ASSEMBLY_MATE_KINDS) {
      const m = makeMate(kind);
      expect(m).toBeDefined();
      expect(m.kind).toBe(kind);
      expect(m.entities).toHaveLength(2);
      expect(m.constraints).toBeDefined();
    }
  });

  it('isMateKind narrows correctly', () => {
    const m = makeMate('coincident');
    expect(isMateKind(m, 'coincident')).toBe(true);
    expect(isMateKind(m, 'distance')).toBe(false);
  });

  it('isDistanceMate type-guards distance mates', () => {
    const dist = makeMate('distance');
    expect(isDistanceMate(dist)).toBe(true);
    if (isDistanceMate(dist)) {
      // TS narrows .constraints.params to DistanceMateConstraints.
      expect(dist.constraints.params.distanceMm).toBe(12.5);
    }

    const other = makeMate('parallel');
    expect(isDistanceMate(other)).toBe(false);
  });

  it('isAngleMate type-guards angle mates', () => {
    const ang = makeMate('angle');
    expect(isAngleMate(ang)).toBe(true);
    if (isAngleMate(ang)) {
      expect(ang.constraints.params.angleDeg).toBe(45);
    }
  });

  it('AssemblyMateRef.reference carries a nodeId', () => {
    const ref = refOf('node_xyz');
    expect(ref.kind).toBe('reference');
    expect(ref.nodeId).toBe('node_xyz');
  });

  it('distance mate accepts an optional flip flag', () => {
    const m: AssemblyMate = {
      id: 'dist_2',
      kind: 'distance',
      entities: [refOf('a'), refOf('b')],
      constraints: { kind: 'distance', params: { distanceMm: 5, flip: true } },
      label: 'Spaced 5mm',
      enabled: true,
    };
    if (isDistanceMate(m)) {
      expect(m.constraints.params.flip).toBe(true);
    }
  });
});
