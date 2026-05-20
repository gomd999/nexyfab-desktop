import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  solveAssembly,
  calculateDOF,
  type AssemblyBody,
  type AssemblyState,
  type Mate,
  type MateSelection,
} from './matesSolver';

// ─── Helpers ──────────────────────────────────────────────────────────────

function body(name: string, x = 0, y = 0, z = 0, fixed = false): AssemblyBody {
  return {
    name,
    position: new THREE.Vector3(x, y, z),
    rotation: new THREE.Euler(0, 0, 0),
    fixed,
  };
}

function sel(bodyIndex: number, lp: [number, number, number], ln: [number, number, number] = [0, 1, 0], axis?: [number, number, number]): MateSelection {
  return {
    bodyIndex,
    type: 'point',
    localPoint: new THREE.Vector3(...lp),
    localNormal: new THREE.Vector3(...ln),
    localAxis: axis ? new THREE.Vector3(...axis) : undefined,
  };
}

function mate(id: string, type: Mate['type'], s0: MateSelection, s1: MateSelection, extra: Partial<Mate> = {}): Mate {
  return { id, type, selections: [s0, s1], enabled: true, ...extra };
}

// ─── DOF tests ────────────────────────────────────────────────────────────

describe('calculateDOF', () => {
  it('one free body has 6 DOF', () => {
    const state: AssemblyState = { bodies: [body('a')], mates: [] };
    expect(calculateDOF(state)).toBe(6);
  });

  it('one fixed body has 0 DOF', () => {
    const state: AssemblyState = { bodies: [body('a', 0, 0, 0, true)], mates: [] };
    expect(calculateDOF(state)).toBe(0);
  });

  it('two free bodies + coincident mate (3 DOF removed) leaves 9 DOF', () => {
    const state: AssemblyState = {
      bodies: [body('a'), body('b')],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [10, 0, 0]))],
    };
    // 2 × 6 - 3 = 9
    expect(calculateDOF(state)).toBe(9);
  });

  it('disabled mates do not consume DOF', () => {
    const state: AssemblyState = {
      bodies: [body('a'), body('b')],
      mates: [{ ...mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [10, 0, 0])), enabled: false }],
    };
    expect(calculateDOF(state)).toBe(12);
  });
});

// ─── Solver convergence ──────────────────────────────────────────────────

describe('solveAssembly · coincident', () => {
  it('moves a free body so its local point matches a fixed reference point', () => {
    const state: AssemblyState = {
      bodies: [body('fixed', 0, 0, 0, true), body('free', 50, 0, 0)],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    };
    const r = solveAssembly(state);
    expect(r.converged).toBe(true);
    // Free body should snap to origin (since its localPoint = origin too).
    expect(r.bodies[1].position.length()).toBeLessThan(0.01);
  });

  it('does NOT move a fixed body', () => {
    const state: AssemblyState = {
      bodies: [body('fixed', 100, 0, 0, true), body('free', 50, 0, 0)],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    };
    const r = solveAssembly(state);
    expect(r.bodies[0].position.x).toBe(100);
  });

  it('moves both free bodies to meet in the middle', () => {
    const state: AssemblyState = {
      bodies: [body('a', -10, 0, 0), body('b', 10, 0, 0)],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    };
    const r = solveAssembly(state);
    expect(r.converged).toBe(true);
    // Each should converge toward origin.
    expect(Math.abs(r.bodies[0].position.x)).toBeLessThan(0.5);
    expect(Math.abs(r.bodies[1].position.x)).toBeLessThan(0.5);
  });
});

describe('solveAssembly · distance', () => {
  it('separates two bodies by the requested distance along the normal', () => {
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b', 0, 0, 0)],
      mates: [
        mate('m', 'distance',
          sel(0, [0, 0, 0], [1, 0, 0]),
          sel(1, [0, 0, 0], [1, 0, 0]),
          { distance: 25 }),
      ],
    };
    const r = solveAssembly(state);
    expect(r.converged).toBe(true);
    // Body B should sit 25mm away from body A's reference point.
    const sep = r.bodies[1].position.length();
    expect(sep).toBeCloseTo(25, 0);
  });
});

describe('solveAssembly · parallel', () => {
  it('rotates body B so its local normal aligns with body A`s', () => {
    const b = body('b');
    b.rotation.set(0, 0, Math.PI / 4); // start 45° tilted
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), b],
      mates: [mate('m', 'parallel', sel(0, [0, 0, 0], [0, 1, 0]), sel(1, [0, 0, 0], [0, 1, 0]))],
    };
    const r = solveAssembly(state);
    // After parallel, body B's local +Y should still point +Y in world.
    const q = new THREE.Quaternion().setFromEuler(r.bodies[1].rotation);
    const worldY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(worldY.dot(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0.99);
  });
});

describe('solveAssembly · perpendicular', () => {
  it('makes body B`s local normal perpendicular to body A`s', () => {
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b')],
      mates: [mate('m', 'perpendicular', sel(0, [0, 0, 0], [0, 1, 0]), sel(1, [0, 0, 0], [0, 1, 0]))],
    };
    const r = solveAssembly(state);
    const q = new THREE.Quaternion().setFromEuler(r.bodies[1].rotation);
    const worldY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    // Dot ≈ 0 (cos 90°).
    expect(Math.abs(worldY.dot(new THREE.Vector3(0, 1, 0)))).toBeLessThan(0.05);
  });
});

describe('solveAssembly · concentric', () => {
  it('aligns body B`s axis with body A`s and brings origins together', () => {
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b', 50, 30, 0)],
      mates: [
        mate('m', 'concentric',
          sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
          sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
      ],
    };
    const r = solveAssembly(state);
    // Concentric should pull B's origin to A's origin (perpendicular axis offset).
    expect(r.bodies[1].position.length()).toBeLessThan(0.5);
  });
});

describe('solveAssembly · fixed', () => {
  it('leaves a fixed body untouched even with other free mates', () => {
    const state: AssemblyState = {
      bodies: [body('a', 25, 50, 75, true), body('b', 0, 0, 0)],
      mates: [mate('m', 'fixed', sel(0, [0, 0, 0]), sel(0, [0, 0, 0]))],
    };
    const r = solveAssembly(state);
    expect(r.bodies[0].position.x).toBe(25);
    expect(r.bodies[0].position.y).toBe(50);
    expect(r.bodies[0].position.z).toBe(75);
  });
});

describe('solveAssembly · conflict detection', () => {
  it('flags mates whose body index is out of range as conflicts', () => {
    const state: AssemblyState = {
      bodies: [body('a')],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(99, [0, 0, 0]))],
    };
    const r = solveAssembly(state);
    expect(r.conflicts).toContain('m');
  });

  it('disabled mates are skipped entirely', () => {
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b', 50, 0, 0)],
      mates: [{
        ...mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0])),
        enabled: false,
      }],
    };
    const r = solveAssembly(state);
    // B should remain at (50,0,0) because the mate didn't fire.
    expect(r.bodies[1].position.x).toBe(50);
  });
});

describe('solveAssembly · input immutability', () => {
  it('does not mutate the input state (bodies cloned internally)', () => {
    const originalPos = new THREE.Vector3(10, 20, 30);
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), { ...body('b', 10, 20, 30) }],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    };
    state.bodies[1].position = originalPos;
    solveAssembly(state);
    // Original Vector3 instance is unchanged.
    expect(originalPos.x).toBe(10);
    expect(originalPos.y).toBe(20);
    expect(originalPos.z).toBe(30);
  });
});

describe('solveAssembly · gear (kinematic ratio coupling)', () => {
  function gearTest(ratio: number, aAngleRad: number): { aAngle: number; bAngle: number } {
    const a = body('a', 0, 0, 0);
    a.rotation.set(0, aAngleRad, 0); // body A rotated around Y
    const b = body('b', 50, 0, 0);   // body B near A
    const state: AssemblyState = {
      bodies: [a, b],
      mates: [mate('m', 'gear',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        { gearRatio: ratio }),
      ],
    };
    const r = solveAssembly(state);
    const qa = new THREE.Quaternion().setFromEuler(r.bodies[0].rotation);
    const qb = new THREE.Quaternion().setFromEuler(r.bodies[1].rotation);
    const axis = new THREE.Vector3(0, 1, 0);
    // Extract twist around Y for each body — using the same helper logic
    // the solver uses internally (atan2-based, signed).
    const twist = (q: THREE.Quaternion) => {
      const proj = axis.clone().multiplyScalar(new THREE.Vector3(q.x, q.y, q.z).dot(axis));
      const t = new THREE.Quaternion(proj.x, proj.y, proj.z, q.w).normalize();
      const v = new THREE.Vector3(q.x, q.y, q.z);
      const sign = Math.sign(v.dot(axis)) || 1;
      return 2 * Math.atan2(sign * proj.length(), t.w);
    };
    return { aAngle: twist(qa), bAngle: twist(qb) };
  }

  it('ratio 1:1 — both bodies end at the same twist angle', () => {
    const { aAngle, bAngle } = gearTest(1, Math.PI / 4); // A at 45°
    // After solving: A·1 = B → both at ~22.5° (each absorbs half the
    // mismatch, since both are free).
    expect(Math.abs(aAngle - bAngle)).toBeLessThan(0.01);
  });

  it('ratio 2:1 — A rotates twice as fast as B', () => {
    const { aAngle, bAngle } = gearTest(2, Math.PI / 2); // A at 90°
    // Constraint: A × 2 = B. With both free, residuals share so the
    // final relation is twistA × 2 ≈ twistB.
    expect(Math.abs(aAngle * 2 - bAngle)).toBeLessThan(0.01);
  });

  it('negative ratio inverts B`s direction', () => {
    const { aAngle, bAngle } = gearTest(-1, Math.PI / 6); // A at 30°
    // A × -1 = B  →  bAngle = -aAngle
    expect(Math.abs(aAngle + bAngle)).toBeLessThan(0.01);
  });

  it('A fixed → B absorbs the full correction', () => {
    const a = body('a', 0, 0, 0, /* fixed */ true);
    a.rotation.set(0, Math.PI / 3, 0); // pinned at 60°
    const b = body('b', 50, 0, 0);     // free, starts at 0°
    const state: AssemblyState = {
      bodies: [a, b],
      mates: [mate('m', 'gear',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        { gearRatio: 1 }),
      ],
    };
    const r = solveAssembly(state);
    // A's pinned 60° must propagate to B at ratio 1 → B also ~60°.
    expect(r.bodies[0].rotation.y).toBeCloseTo(Math.PI / 3, 2);
    const qb = new THREE.Quaternion().setFromEuler(r.bodies[1].rotation);
    const yAngle = 2 * Math.atan2(qb.y, qb.w);
    expect(Math.abs(yAngle - Math.PI / 3)).toBeLessThan(0.01);
  });

  it('ratio 0 or NaN → no-op (constraint disabled)', () => {
    const a = body('a', 0, 0, 0);
    a.rotation.set(0, Math.PI / 4, 0);
    const b = body('b', 50, 0, 0);
    const state: AssemblyState = {
      bodies: [a, b],
      mates: [mate('m', 'gear',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        { gearRatio: 0 }),
      ],
    };
    const r = solveAssembly(state);
    // No coupling → B stays at 0.
    expect(r.bodies[1].rotation.y).toBe(0);
    expect(r.bodies[0].rotation.y).toBeCloseTo(Math.PI / 4, 4);
  });
});

describe('solveAssembly · belt / pulley (radius-derived ratio)', () => {
  function beltTest(
    r0: number,
    r1: number,
    aAngleRad: number,
    opts: { crossed?: boolean; a?: { fixed?: boolean }; b?: { fixed?: boolean } } = {},
  ): { aAngle: number; bAngle: number } {
    const a = body('a', 0, 0, 0, opts.a?.fixed ?? false);
    a.rotation.set(0, aAngleRad, 0);
    const b = body('b', 80, 0, 0, opts.b?.fixed ?? false);
    const state: AssemblyState = {
      bodies: [a, b],
      mates: [mate('m', 'belt',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        { beltRadius0: r0, beltRadius1: r1, beltCrossed: opts.crossed }),
      ],
    };
    const r = solveAssembly(state);
    const qa = new THREE.Quaternion().setFromEuler(r.bodies[0].rotation);
    const qb = new THREE.Quaternion().setFromEuler(r.bodies[1].rotation);
    const axis = new THREE.Vector3(0, 1, 0);
    const twist = (q: THREE.Quaternion) => {
      const proj = axis.clone().multiplyScalar(new THREE.Vector3(q.x, q.y, q.z).dot(axis));
      const t = new THREE.Quaternion(proj.x, proj.y, proj.z, q.w).normalize();
      const v = new THREE.Vector3(q.x, q.y, q.z);
      const sign = Math.sign(v.dot(axis)) || 1;
      return 2 * Math.atan2(sign * proj.length(), t.w);
    };
    return { aAngle: twist(qa), bAngle: twist(qb) };
  }

  it('same radius → 1:1 coupling (both end at same twist)', () => {
    const { aAngle, bAngle } = beltTest(20, 20, Math.PI / 4);
    expect(Math.abs(aAngle - bAngle)).toBeLessThan(0.01);
  });

  it('R_A = 2 × R_B → driver (A) spins half as fast as driven (B)', () => {
    // Open belt: ω_A × R_A = ω_B × R_B → twistA × (R_A/R_B) = twistB.
    // With R_A=20, R_B=10 → ratio 2. A pinned at 30°, B free should
    // settle at A × 2 = 60° via the gear-style coupling (or split when
    // both free — both-free case is what we measure here).
    const { aAngle, bAngle } = beltTest(20, 10, Math.PI / 3);
    expect(Math.abs(aAngle * 2 - bAngle)).toBeLessThan(0.02);
  });

  it('crossed belt flips direction (negative effective ratio)', () => {
    const { aAngle, bAngle } = beltTest(20, 20, Math.PI / 6, { crossed: true });
    // ratio -1 → twistA + twistB ≈ 0 (opposite signs).
    expect(Math.abs(aAngle + bAngle)).toBeLessThan(0.01);
  });

  it('A pinned at 60° with R_A = R_B → B follows to 60°', () => {
    const { aAngle, bAngle } = beltTest(15, 15, Math.PI / 3, { a: { fixed: true } });
    expect(aAngle).toBeCloseTo(Math.PI / 3, 2);
    expect(Math.abs(bAngle - Math.PI / 3)).toBeLessThan(0.01);
  });

  it('zero or missing radius → no coupling (constraint silently skipped)', () => {
    const { aAngle, bAngle } = beltTest(0, 20, Math.PI / 4);
    // R_A = 0 → effective ratio undefined, constraint no-ops. B stays at 0.
    expect(bAngle).toBe(0);
    expect(aAngle).toBeCloseTo(Math.PI / 4, 4);
  });
});

describe('solveAssembly · iteration limits', () => {
  it('reports iterations used (≤ maxIterations)', () => {
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b', 50, 0, 0)],
      mates: [mate('m', 'coincident', sel(0, [0, 0, 0]), sel(1, [0, 0, 0]))],
    };
    const r = solveAssembly(state, 50);
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.iterations).toBeLessThanOrEqual(50);
  });
});
