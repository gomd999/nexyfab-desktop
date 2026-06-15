/**
 * Phase 2 (SolidWorks-parity roadmap) — limit-distance / limit-angle / width
 * mate residuals on the Gauss-Seidel viewport solver.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  solveAssembly,
  calculateDOF,
  type AssemblyState,
  type AssemblyBody,
  type Mate,
  type MateSelection,
} from './matesSolver';

function body(name: string, pos: [number, number, number], fixed = false): AssemblyBody {
  return {
    name,
    position: new THREE.Vector3(...pos),
    rotation: new THREE.Euler(0, 0, 0),
    fixed,
  };
}

function sel(
  bodyIndex: number,
  point: [number, number, number] = [0, 0, 0],
  normal: [number, number, number] = [0, 0, 1],
): MateSelection {
  return {
    bodyIndex,
    type: 'face',
    localPoint: new THREE.Vector3(...point),
    localNormal: new THREE.Vector3(...normal),
  };
}

// ─── limitDistance ────────────────────────────────────────────────────────────

describe('solveAssembly · limitDistance (inequality band)', () => {
  function state(bx: number, min: number, max: number): AssemblyState {
    return {
      bodies: [body('A', [0, 0, 0], true), body('B', [bx, 0, 0])],
      mates: [{
        id: 'lim', type: 'limitDistance', enabled: true,
        selections: [sel(0), sel(1)],
        min, max,
      } as Mate],
    };
  }

  it('inside the band → no movement, converges immediately', () => {
    const r = solveAssembly(state(15, 10, 20));
    expect(r.converged).toBe(true);
    expect(r.bodies[1].position.x).toBeCloseTo(15, 6);
    expect(r.unsatisfied).toHaveLength(0);
  });

  it('beyond max → pulled back to the max bound', () => {
    const r = solveAssembly(state(35, 10, 20));
    expect(r.converged).toBe(true);
    expect(r.bodies[1].position.distanceTo(r.bodies[0].position)).toBeCloseTo(20, 3);
    expect(r.unsatisfied).toHaveLength(0);
  });

  it('below min → pushed out to the min bound', () => {
    const r = solveAssembly(state(4, 10, 20));
    expect(r.converged).toBe(true);
    expect(r.bodies[1].position.distanceTo(r.bodies[0].position)).toBeCloseTo(10, 3);
  });

  it('removes no DOF in the bookkeeping (inequality constraint)', () => {
    const s = state(15, 10, 20);
    expect(calculateDOF(s)).toBe(6); // one free body, limit mate counts 0
  });
});

// ─── limitAngle ───────────────────────────────────────────────────────────────

describe('solveAssembly · limitAngle (inequality band, degrees)', () => {
  function state(rotZdeg: number, min: number, max: number): AssemblyState {
    const b = body('B', [10, 0, 0]);
    b.rotation = new THREE.Euler(0, 0, (rotZdeg * Math.PI) / 180);
    return {
      bodies: [body('A', [0, 0, 0], true), b],
      mates: [{
        id: 'limA', type: 'limitAngle', enabled: true,
        // Normals along +Y so a Z-rotation changes the angle between them.
        selections: [sel(0, [0, 0, 0], [0, 1, 0]), sel(1, [0, 0, 0], [0, 1, 0])],
        min, max,
      } as Mate],
    };
  }

  function angleBetween(r: ReturnType<typeof solveAssembly>, s: AssemblyState): number {
    const n0 = new THREE.Vector3(0, 1, 0); // A fixed, rotation 0
    const n1 = new THREE.Vector3(0, 1, 0).applyEuler(r.bodies[1].rotation);
    void s;
    return (Math.acos(THREE.MathUtils.clamp(n0.dot(n1), -1, 1)) * 180) / Math.PI;
  }

  it('inside the band → orientation untouched', () => {
    const s = state(45, 30, 90);
    const r = solveAssembly(s);
    expect(angleBetween(r, s)).toBeCloseTo(45, 4);
    expect(r.unsatisfied).toHaveLength(0);
  });

  it('below min → rotated out to the min bound', () => {
    const s = state(0, 30, 90); // parallel start (degenerate cross product path)
    const r = solveAssembly(s);
    expect(angleBetween(r, s)).toBeCloseTo(30, 1);
    expect(r.unsatisfied).toHaveLength(0);
  });

  it('beyond max → rotated back to the max bound', () => {
    const s = state(120, 30, 90);
    const r = solveAssembly(s);
    expect(angleBetween(r, s)).toBeCloseTo(90, 1);
  });
});

// ─── Regression: angle/perpendicular from a NON-parallel start ───────────────
// All prior angle/perpendicular tests began at the parallel (degenerate) pose
// where the rotation direction is arbitrary, hiding inverted correction signs
// that made the solver run AWAY from the target for any real start angle.

describe('solveAssembly · angle/perpendicular sign regression (non-parallel start)', () => {
  function angleState(startDeg: number, targetDeg: number, type: 'angle' | 'perpendicular'): AssemblyState {
    const b = body('B', [10, 0, 0]);
    b.rotation = new THREE.Euler(0, 0, (startDeg * Math.PI) / 180);
    const m: Mate = {
      id: 'm', type, enabled: true,
      selections: [sel(0, [0, 0, 0], [0, 1, 0]), sel(1, [0, 0, 0], [0, 1, 0])],
    };
    if (type === 'angle') m.angle = targetDeg;
    return { bodies: [body('A', [0, 0, 0], true), b], mates: [m] };
  }

  function solvedAngle(r: ReturnType<typeof solveAssembly>): number {
    const n1 = new THREE.Vector3(0, 1, 0).applyEuler(r.bodies[1].rotation);
    return (Math.acos(THREE.MathUtils.clamp(new THREE.Vector3(0, 1, 0).dot(n1), -1, 1)) * 180) / Math.PI;
  }

  it('angle mate converges DOWN: 120° start → 90° target', () => {
    const r = solveAssembly(angleState(120, 90, 'angle'));
    expect(solvedAngle(r)).toBeCloseTo(90, 1);
    expect(r.unsatisfied).toHaveLength(0);
  });

  it('angle mate converges UP: 20° start → 60° target', () => {
    const r = solveAssembly(angleState(20, 60, 'angle'));
    expect(solvedAngle(r)).toBeCloseTo(60, 1);
    expect(r.unsatisfied).toHaveLength(0);
  });

  it('perpendicular converges from an acute 30° start', () => {
    const r = solveAssembly(angleState(30, 90, 'perpendicular'));
    expect(solvedAngle(r)).toBeCloseTo(90, 1);
    expect(r.unsatisfied).toHaveLength(0);
  });

  it('perpendicular converges from an obtuse 150° start', () => {
    const r = solveAssembly(angleState(150, 90, 'perpendicular'));
    expect(solvedAngle(r)).toBeCloseTo(90, 1);
    expect(r.unsatisfied).toHaveLength(0);
  });
});

// ─── width ────────────────────────────────────────────────────────────────────

describe('solveAssembly · width (center between two reference planes)', () => {
  it('centers B between the two planes on fixed A; in-plane offset stays free', () => {
    // A (fixed) carries two planes: x = 0 and x = 10, both with normal +X.
    // B starts off-center at x = 7 with a lateral offset y = 3.
    const st: AssemblyState = {
      bodies: [body('A', [0, 0, 0], true), body('B', [7, 3, 0])],
      mates: [{
        id: 'w', type: 'width', enabled: true,
        selections: [sel(0, [0, 0, 0], [1, 0, 0]), sel(1, [0, 0, 0], [1, 0, 0])],
        widthSecond: sel(0, [10, 0, 0], [1, 0, 0]),
      } as Mate],
    };
    const r = solveAssembly(st);
    expect(r.converged).toBe(true);
    expect(r.bodies[1].position.x).toBeCloseTo(5, 3); // midplane
    expect(r.bodies[1].position.y).toBeCloseTo(3, 6); // in-plane untouched
    expect(r.unsatisfied).toHaveLength(0);
  });

  it('without widthSecond the mate is inert (incomplete — UI gates creation)', () => {
    const st: AssemblyState = {
      bodies: [body('A', [0, 0, 0], true), body('B', [7, 0, 0])],
      mates: [{
        id: 'w', type: 'width', enabled: true,
        selections: [sel(0, [0, 0, 0], [1, 0, 0]), sel(1, [0, 0, 0], [1, 0, 0])],
      } as Mate],
    };
    const r = solveAssembly(st);
    expect(r.bodies[1].position.x).toBeCloseTo(7, 6);
    expect(r.unsatisfied).toHaveLength(0);
  });

  it('splits the correction when both bodies are free', () => {
    const st: AssemblyState = {
      bodies: [body('A', [0, 0, 0]), body('B', [9, 0, 0])],
      mates: [{
        id: 'w', type: 'width', enabled: true,
        selections: [sel(0, [0, 0, 0], [1, 0, 0]), sel(1, [0, 0, 0], [1, 0, 0])],
        widthSecond: sel(0, [10, 0, 0], [1, 0, 0]),
      } as Mate],
    };
    const r = solveAssembly(st);
    // Final: B's point must sit on the midplane of A's two planes wherever
    // the pair drifted to.
    const aX = r.bodies[0].position.x;
    const mid = aX + 5;
    expect(r.bodies[1].position.x).toBeCloseTo(mid, 3);
  });
});
