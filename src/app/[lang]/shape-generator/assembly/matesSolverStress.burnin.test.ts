/**
 * Assembly mate-solver stress burn-in (P2 gap probe).
 *
 * solveAssembly (Gauss-Seidel) passes its unit suite. This burn-in hammers the
 * robustness modes a pro assembly solver must get right and a toy one botches:
 *
 *   1. Contradictory mates must NOT report converged-with-everything-satisfied.
 *   2. Determinism: identical state → identical solved transforms.
 *   3. Convergence from a far initial placement.
 *   4. Invalid body indices become conflicts, never crashes.
 *   5. A long mate chain still converges.
 *   6. The input state is never mutated.
 *
 * Pure numerics — runs headless, no WASM, not gated.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { solveAssembly, type AssemblyBody, type AssemblyState, type Mate, type MateSelection } from './matesSolver';

function body(name: string, x = 0, y = 0, z = 0, fixed = false): AssemblyBody {
  return { name, position: new THREE.Vector3(x, y, z), rotation: new THREE.Euler(0, 0, 0), fixed };
}
function sel(bodyIndex: number, lp: [number, number, number], ln: [number, number, number] = [0, 1, 0]): MateSelection {
  return { bodyIndex, type: 'point', localPoint: new THREE.Vector3(...lp), localNormal: new THREE.Vector3(...ln) };
}
function mate(id: string, type: Mate['type'], s0: MateSelection, s1: MateSelection, extra: Partial<Mate> = {}): Mate {
  return { id, type, selections: [s0, s1], enabled: true, ...extra };
}

describe('mate solver stress — contradictions are never silently satisfied', () => {
  it('a point coincident to two different fixed points → not fully solved', () => {
    const state: AssemblyState = {
      bodies: [body('fixA', 0, 0, 0, true), body('free', 50, 0, 0), body('fixB', 100, 0, 0, true)],
      mates: [
        mate('m1', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0])),
        mate('m2', 'coincident', sel(2, [0, 0, 0]), sel(1, [0, 0, 0])),
      ],
    };
    const r = solveAssembly(state);
    // The free point cannot be at both 0 and 100 — the solver must surface that
    // rather than claim success.
    expect(r.converged && r.unsatisfied.length === 0).toBe(false);
    expect(r.unsatisfied.length).toBeGreaterThan(0);
  });

  it('two conflicting distance mates on the same pair → unsatisfied', () => {
    const state: AssemblyState = {
      bodies: [body('fix', 0, 0, 0, true), body('free', 20, 0, 0)],
      mates: [
        mate('d1', 'distance', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]), { distance: 10 }),
        mate('d2', 'distance', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]), { distance: 40 }),
      ],
    };
    const r = solveAssembly(state);
    expect(r.unsatisfied.length).toBeGreaterThan(0);
  });
});

describe('mate solver stress — determinism', () => {
  it('same state solved twice → identical solved positions', () => {
    const build = (): AssemblyState => ({
      bodies: [body('fix', 0, 0, 0, true), body('free', 37, 21, 9)],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    });
    const a = solveAssembly(build()).bodies[1]!.position;
    const b = solveAssembly(build()).bodies[1]!.position;
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.z).toBe(b.z);
  });
});

describe('mate solver stress — convergence', () => {
  it('coincident mate converges from a far initial placement', () => {
    const state: AssemblyState = {
      bodies: [body('fix', 0, 0, 0, true), body('free', 5000, -3000, 2000)],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    };
    const r = solveAssembly(state, 400);
    expect(r.converged).toBe(true);
    expect(r.unsatisfied.length).toBe(0);
    const p = r.bodies[1]!.position;
    expect(Math.hypot(p.x, p.y, p.z)).toBeLessThan(0.05);
  });
});

describe('mate solver stress — robustness', () => {
  it('invalid body index becomes a conflict, never crashes', () => {
    const state: AssemblyState = {
      bodies: [body('fix', 0, 0, 0, true), body('free', 10, 0, 0)],
      mates: [mate('bad', 'coincident', sel(0, [0, 0, 0]), sel(9, [0, 0, 0]))], // index 9 invalid
    };
    let r: ReturnType<typeof solveAssembly> | null = null;
    expect(() => { r = solveAssembly(state); }).not.toThrow();
    expect(r!.conflicts).toContain('bad');
  });

  it('a 20-body coincident chain converges with no unsatisfied mates', () => {
    const bodies: AssemblyBody[] = [body('ground', 0, 0, 0, true)];
    const mates: Mate[] = [];
    for (let i = 1; i <= 20; i++) {
      bodies.push(body(`b${i}`, i * 13, i * 7, i * 3));
      mates.push(mate(`m${i}`, 'coincident', sel(0, [0, 0, 0]), sel(i, [0, 0, 0])));
    }
    const r = solveAssembly({ bodies, mates }, 400);
    expect(r.converged).toBe(true);
    expect(r.unsatisfied.length).toBe(0);
  });

  it('does not mutate the input state', () => {
    const state: AssemblyState = {
      bodies: [body('fix', 0, 0, 0, true), body('free', 50, 0, 0)],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    };
    solveAssembly(state);
    expect(state.bodies[1]!.position.x).toBe(50); // unchanged
  });
});
