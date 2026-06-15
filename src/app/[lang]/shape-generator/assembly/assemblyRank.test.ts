import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzeAssemblyRank } from './assemblyRank';
import type { AssemblyBody, AssemblyState, Mate, MateSelection } from './matesSolver';

function body(name: string, x = 0, y = 0, z = 0, fixed = false): AssemblyBody {
  return { name, position: new THREE.Vector3(x, y, z), rotation: new THREE.Euler(0, 0, 0), fixed };
}
function sel(bodyIndex: number, lp: [number, number, number], ln: [number, number, number] = [0, 1, 0], axis?: [number, number, number]): MateSelection {
  return {
    bodyIndex, type: 'point',
    localPoint: new THREE.Vector3(...lp),
    localNormal: new THREE.Vector3(...ln),
    localAxis: axis ? new THREE.Vector3(...axis) : undefined,
  };
}
function mate(id: string, type: Mate['type'], s0: MateSelection, s1: MateSelection, extra: Partial<Mate> = {}): Mate {
  return { id, type, selections: [s0, s1], enabled: true, ...extra };
}

describe('analyzeAssemblyRank — accurate DOF', () => {
  it('no mates → full DOF, nothing redundant', () => {
    const r = analyzeAssemblyRank({ bodies: [body('a')], mates: [] });
    expect(r.effectiveConstrainedDOF).toBe(0);
    expect(r.remainingDOF).toBe(6);
    expect(r.overConstrained).toBe(false);
  });

  it('one coincident removes exactly 3 DOF (rank 3)', () => {
    const state: AssemblyState = {
      bodies: [body('a', 50, 0, 0), body('fix', 0, 0, 0, true)],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    };
    const r = analyzeAssemblyRank(state);
    expect(r.effectiveConstrainedDOF).toBe(3);
    expect(r.remainingDOF).toBe(3); // 6 − 3
    expect(r.redundantMateIds).toEqual([]);
  });

  it('two coincidences on DISTINCT points are NOT redundant (no false positive)', () => {
    // Pinning two points of `a` to a fixed body removes 5 DOF (1 rotation about
    // the line through the points stays free). Both mates are independent.
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0), body('fix', 0, 0, 0, true)],
      mates: [
        mate('m1', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0])),
        mate('m2', 'coincident', sel(0, [10, 0, 0]), sel(1, [10, 0, 0])),
      ],
    };
    const r = analyzeAssemblyRank(state);
    expect(r.effectiveConstrainedDOF).toBe(5);
    expect(r.remainingDOF).toBe(1);
    expect(r.overConstrained).toBe(false);
    expect(r.redundantMateIds).toEqual([]);
  });

  it('a duplicate coincident IS redundant (over-defining)', () => {
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0), body('fix', 0, 0, 0, true)],
      mates: [
        mate('m1', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0])),
        mate('m2', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0])), // identical → redundant
      ],
    };
    const r = analyzeAssemblyRank(state);
    expect(r.effectiveConstrainedDOF).toBe(3); // the pair still only removes 3
    expect(r.overConstrained).toBe(true);
    // Leave-one-out flags both members of the redundant pair.
    expect(r.redundantMateIds.length).toBeGreaterThanOrEqual(1);
  });

  it('a redundant parallel-on-top-of-concentric is detected', () => {
    // concentric already aligns the axes; an extra parallel on the same axes
    // adds nothing → redundant.
    const state: AssemblyState = {
      bodies: [body('a', 0, 5, 0), body('fix', 0, 0, 0, true)],
      mates: [
        mate('c', 'concentric', sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]), sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
        mate('p', 'parallel', sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]), sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
      ],
    };
    const r = analyzeAssemblyRank(state);
    expect(r.overConstrained).toBe(true);
    expect(r.redundantMateIds).toContain('p');
  });

  it('reports unmodelled mate types instead of mis-flagging them', () => {
    const state: AssemblyState = {
      bodies: [body('a'), body('fix', 0, 0, 0, true)],
      mates: [mate('g', 'gear', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]), { gearRatio: 2 })],
    };
    const r = analyzeAssemblyRank(state);
    expect(r.unsupportedMates).toContain('g');
    expect(r.overConstrained).toBe(false);
  });
});
