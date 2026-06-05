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

describe('solveAssembly · angle', () => {
  // The angle mate previously did nothing from a parallel start: cross(n0,n1)=0 returned
  // early, and only b0 was ever rotated, so a fixed b0 left a free b1 untouched (measured
  // angle stayed 0). Now it falls back to a ⟂ axis and rotates whichever body is free.
  for (const target of [30, 45, 60, 90]) {
    it(`rotates a free body to ${target}° from a fixed reference`, () => {
      const state: AssemblyState = {
        bodies: [body('a', 0, 0, 0, true), body('b')],
        mates: [mate('m', 'angle', sel(0, [0, 0, 0], [0, 1, 0]), sel(1, [0, 0, 0], [0, 1, 0]), { angle: target })],
      };
      const r = solveAssembly(state);
      expect(r.unsatisfied).not.toContain('m');
      const q = new THREE.Quaternion().setFromEuler(r.bodies[1].rotation);
      const worldY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const deg = Math.acos(Math.min(1, Math.max(-1, worldY.dot(new THREE.Vector3(0, 1, 0))))) * 180 / Math.PI;
      expect(deg).toBeCloseTo(target, 0);
    });
  }

  it('splits the angle between two free bodies', () => {
    const state: AssemblyState = {
      bodies: [body('a'), body('b')],
      mates: [mate('m', 'angle', sel(0, [0, 0, 0], [0, 1, 0]), sel(1, [0, 0, 0], [0, 1, 0]), { angle: 50 })],
    };
    const r = solveAssembly(state);
    const wy = (i: number) => new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(r.bodies[i].rotation));
    const deg = Math.acos(Math.min(1, Math.max(-1, wy(0).dot(wy(1))))) * 180 / Math.PI;
    expect(deg).toBeCloseTo(50, 0);
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

describe('solveAssembly · slider (1 translational DOF along the axis)', () => {
  // A slider pins the perpendicular offset to zero but leaves translation ALONG
  // the shared axis free — the defining difference from concentric, which also
  // pulls the origins together (zero axial offset). With axis = Y, body B may
  // slide in Y but its X/Z offset from A's axis line must collapse to 0.
  it('collapses the perpendicular (X,Z) offset while preserving axial Y travel', () => {
    const a = body('a', 0, 0, 0, /* fixed */ true);
    const b = body('b', 5, 50, 3); // 5 in +x, 3 in +z off the Y axis, 50 up the axis
    const state: AssemblyState = {
      bodies: [a, b],
      mates: [mate('m', 'slider',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
      ],
    };
    const r = solveAssembly(state);
    const p = r.bodies[1].position;
    expect(p.x).toBeCloseTo(0, 3);  // perpendicular offset removed
    expect(p.z).toBeCloseTo(0, 3);
    expect(p.y).toBeCloseTo(50, 3); // axial travel left untouched (the free DOF)
  });

  it('does NOT force the bodies coincident (Y is free, unlike concentric)', () => {
    // Same setup as the concentric test (B at y=30) — concentric pulls the
    // origin to <0.5; a correct slider keeps the 30-unit axial separation.
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b', 50, 30, 0)],
      mates: [mate('m', 'slider',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
      ],
    };
    const r = solveAssembly(state);
    expect(r.bodies[1].position.x).toBeCloseTo(0, 3); // perpendicular pinned
    expect(r.bodies[1].position.y).toBeCloseTo(30, 3); // axial NOT collapsed
  });
});

describe('solveAssembly · hinge (1 rotational DOF — delegates to concentric)', () => {
  // A hinge is concentric in disguise: it pins the origin onto the shared axis
  // and aligns the axes, leaving a single rotational DOF. It must therefore
  // reproduce concentric's origin-coincidence behaviour.
  it('pulls body B`s origin onto body A`s axis (like concentric)', () => {
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b', 50, 30, 0)],
      mates: [mate('m', 'hinge',
        sel(0, [0, 0, 0], [0, 1, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0], [0, 1, 0])),
      ],
    };
    const r = solveAssembly(state);
    expect(r.bodies[1].position.length()).toBeLessThan(0.5); // origin coincident
  });
});

describe('solveAssembly · tangent (faces touch on a common tangent plane)', () => {
  // Tangent opposes the outward normals (the two solids sit on either side of
  // the shared plane) and zeroes the gap ALONG that normal, leaving the two
  // in-plane translations free. Previously a silent no-op; now a real solve.
  it('flips B`s normal anti-parallel and brings the faces into contact', () => {
    // A fixed (face normal +Y at the origin). B floats at (7,20,4) with its
    // face normal also +Y — must rotate to −Y and drop onto y=0.
    const a = body('a', 0, 0, 0, /* fixed */ true);
    const b = body('b', 7, 20, 4);
    const state: AssemblyState = {
      bodies: [a, b],
      mates: [mate('m', 'tangent',
        sel(0, [0, 0, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, 1, 0])),
      ],
    };
    const r = solveAssembly(state);
    expect(r.converged).toBe(true);
    expect(r.unsatisfied).toHaveLength(0);
    const q = new THREE.Quaternion().setFromEuler(r.bodies[1].rotation);
    const n1 = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(n1.y).toBeCloseTo(-1, 3);          // opposed to A's +Y
    expect(r.bodies[1].position.y).toBeCloseTo(0, 3); // touching
    // The in-plane (X,Z) offset is a free DOF — tangent must NOT collapse it.
    expect(r.bodies[1].position.x).toBeCloseTo(7, 3);
    expect(r.bodies[1].position.z).toBeCloseTo(4, 3);
  });

  it('already-opposed faces are only pulled together (no spurious rotation)', () => {
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b', 3, 5, 2)],
      mates: [mate('m', 'tangent',
        sel(0, [0, 0, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, -1, 0])),  // normal already −Y
      ],
    };
    const r = solveAssembly(state);
    expect(r.bodies[1].position.y).toBeCloseTo(0, 3); // gap of 5 removed
    expect(r.bodies[1].position.x).toBeCloseTo(3, 3); // in-plane preserved
    expect(r.bodies[1].position.z).toBeCloseTo(2, 3);
    expect(r.bodies[1].rotation.x).toBeCloseTo(0, 5); // no rotation introduced
    expect(r.bodies[1].rotation.z).toBeCloseTo(0, 5);
  });

  it('is no longer a silent no-op (an unsatisfiable gap is reported)', () => {
    // Two fixed bodies separated along the normal: tangent cannot close the
    // gap, so it must surface as unsatisfied rather than falsely "satisfied".
    const state: AssemblyState = {
      bodies: [body('a', 0, 0, 0, true), body('b', 0, 50, 0, /* fixed */ true)],
      mates: [mate('m', 'tangent',
        sel(0, [0, 0, 0], [0, 1, 0]),
        sel(1, [0, 0, 0], [0, -1, 0])),
      ],
    };
    const r = solveAssembly(state);
    expect(r.unsatisfied).toContain('m'); // honestly flagged, not rubber-stamped
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

/**
 * Performance characteristics — pins the Gauss-Seidel solver's two regimes so a
 * future change can't silently regress them:
 *   - GROUNDED / star topology (the common real case: parts mated to a frame)
 *     converges in a couple of sweeps regardless of part count — independent of
 *     N because every correction reaches its fixed reference in one hop.
 *   - A deep mate CHAIN propagates one link per sweep, so it needs O(depth²)
 *     sweeps and does NOT converge inside the default budget — but that is
 *     reported HONESTLY via converged===false (the panel shows "Not Converged
 *     ⚠"), never silently presented as solved with wrong positions.
 * (Acceleration was evaluated — global SOR/momentum — but it overshoots into NaN
 *  on the nonlinear rotation-coupled mates, so the stable GS baseline stands;
 *  a real fix is a sparse linear / Newton solve, tracked as future work.)
 */
describe('solveAssembly · performance characteristics (verified)', () => {
  function star(n: number): AssemblyState {
    const bodies: AssemblyBody[] = [body('base', 0, 0, 0, /* fixed */ true)];
    const mates = [];
    for (let i = 1; i < n; i++) {
      bodies.push(body(`b${i}`, i * 10, i * 7, 0));
      mates.push(mate(`m${i}`, 'coincident', sel(0, [i * 2, i, 0]), sel(i, [0, 0, 0])));
    }
    return { bodies, mates };
  }

  function chain(n: number): AssemblyState {
    const bodies: AssemblyBody[] = [body('b0', 0, 0, 0, /* fixed */ true)];
    const mates = [];
    for (let i = 1; i < n; i++) {
      bodies.push(body(`b${i}`, i * 10, 0, 0));
      mates.push(mate(`m${i}`, 'coincident', sel(i - 1, [0, 0, 0]), sel(i, [0, 0, 0])));
    }
    return { bodies, mates };
  }

  it('grounded/star topology converges in a few sweeps, independent of part count', () => {
    const small = solveAssembly(star(20));
    const large = solveAssembly(star(200));
    expect(small.converged).toBe(true);
    expect(large.converged).toBe(true);
    expect(small.iterations).toBeLessThan(10);
    expect(large.iterations).toBeLessThan(10);      // O(1) in N — the fast path
    // Each part lands on its own fixed base anchor (not collapsed to origin).
    expect(large.bodies[5].position.x).toBeCloseTo(10, 3); // sel(0,[10,5,0]) → b5
    expect(large.bodies[5].position.y).toBeCloseTo(5, 3);
  });

  it('a deep chain is reported Not-Converged at the default budget — never silently wrong', () => {
    const r = solveAssembly(chain(30)); // default 200 sweeps; depth 29 needs far more
    expect(r.converged).toBe(false);     // honest: the panel surfaces this as ⚠
    expect(r.iterations).toBe(200);      // budget exhausted, not a false early "ok"
    // And given a large enough budget it DOES settle to the exact solution,
    // proving the non-convergence is a budget/rate limit, not a wrong fixed point.
    const settled = solveAssembly(chain(30), 20000);
    expect(settled.converged).toBe(true);
    let maxErr = 0;
    for (const b of settled.bodies) maxErr = Math.max(maxErr, b.position.length());
    expect(maxErr).toBeLessThan(1e-2);   // whole chain collapses onto the fixed base
  });
});
