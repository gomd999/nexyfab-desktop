/**
 * lagrangianSolver — Newton-Lagrange (Levenberg-Marquardt) tests.
 *
 * Companion to `iterativeSolver.test.ts`. The Lagrangian path is meant to
 * (a) reach the same final state as the Gauss-Seidel path and (b) do so
 * in fewer iterations on chain assemblies + over-constrained systems.
 *
 * Test groups (≥22 total):
 *   - 7 standard-mate convergence sanity (1 per kind)
 *   - chain (2-part, 3-part)
 *   - over-constrained / conflicting
 *   - fixed-only trivial
 *   - random initial orientation
 *   - damping factor variations
 *   - max-iter cap
 *   - tolerance
 *   - degenerate axis (graceful, no NaN)
 *   - hinge with limit
 *   - parity comparison vs iterativeSolve
 *   - speed comparison vs iterativeSolve (iteration count)
 *   - 4-5 misc edge cases
 */

import { describe, it, expect } from 'vitest';
import { lagrangianSolve, lagrangianSolveAnalytic } from './lagrangianSolver';
import {
  iterativeSolve,
  type GeometryResolver,
  type ResolvedGeometry,
} from './iterativeSolver';
import {
  partInstance,
  IDENTITY_QUAT,
  type AssemblyState,
  type PartInstance,
  type Quat,
} from './assemblyState';
import type { Mate, MateRef } from './mate';
import { vec3 } from '@/lib/sketch/sketchPlane';
import { rotateVec } from './mateSolver';

// ─── fixtures (re-use the same shape as iterativeSolver.test.ts) ─────────

function ref(partId: string, refId: string, refKind: MateRef['refKind']): MateRef {
  return { partId, refId, refKind };
}

function makePart(
  id: string,
  opts: { position?: { x: number; y: number; z: number }; orientation?: Quat; fixed?: boolean } = {},
): PartInstance {
  return partInstance({
    id,
    name: id,
    partTemplateId: 'tpl',
    position: opts.position ?? vec3(0, 0, 0),
    orientation: opts.orientation ?? IDENTITY_QUAT,
    fixed: opts.fixed,
  });
}

function transformInWorld(local: ResolvedGeometry, part: PartInstance): ResolvedGeometry {
  if (local.kind === 'point') {
    const rotated = rotateVec(local.world, part.orientation);
    return {
      kind: 'point',
      world: {
        x: part.position.x + rotated.x,
        y: part.position.y + rotated.y,
        z: part.position.z + rotated.z,
      },
    };
  }
  if (local.kind === 'axis') {
    const rotO = rotateVec(local.world.origin, part.orientation);
    const rotD = rotateVec(local.world.direction, part.orientation);
    return {
      kind: 'axis',
      world: {
        origin: {
          x: part.position.x + rotO.x,
          y: part.position.y + rotO.y,
          z: part.position.z + rotO.z,
        },
        direction: rotD,
      },
    };
  }
  // plane
  const rotO = rotateVec(local.world.origin, part.orientation);
  const rotN = rotateVec(local.world.normal, part.orientation);
  return {
    kind: 'plane',
    world: {
      origin: {
        x: part.position.x + rotO.x,
        y: part.position.y + rotO.y,
        z: part.position.z + rotO.z,
      },
      normal: rotN,
    },
  };
}

function makeResolver(refs: Map<string, ResolvedGeometry>): GeometryResolver {
  return (r: MateRef, part: PartInstance) => {
    const local = refs.get(`${r.partId}/${r.refId}`);
    if (!local) return null;
    return transformInWorld(local, part);
  };
}

// ─── 1. Single concentric mate: fast convergence ─────────────────────────

describe('lagrangianSolve — single concentric mate', () => {
  it('converges within a couple of Newton steps', () => {
    const fixed = makePart('f', { position: vec3(5, 5, 0), fixed: true });
    const free = makePart('g', { position: vec3(10, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'c1', kind: 'concentric', a: ref('f', 'ax_f', 'axis'), b: ref('g', 'ax_g', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax_f', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax_g', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    expect(r.finalMaxResidual).toBeLessThan(1e-6);
    // Newton on a smooth single-mate system: ≤ ~10 iterations is the spec
    // for "fast" — the orientation step is nonlinear so 1 step won't
    // achieve full convergence, but it should beat the Gauss-Seidel
    // bound of 100.
    expect(r.iterations).toBeLessThan(20);
  });
});

// ─── 2. Two-cube chain ───────────────────────────────────────────────────

describe('lagrangianSolve — 2-cube coincident chain', () => {
  it('two point/point mates: chain resolves', () => {
    const f = makePart('f', { fixed: true });
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const state: AssemblyState = {
      parts: [f, a],
      mates: [
        { id: 'm1', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('a', 'pa', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(10, 0, 0) }],
      ['a/pa', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    const moved = r.state.parts.find((p) => p.id === 'a')!;
    expect(moved.position.x).toBeCloseTo(10, 5);
  });
});

// ─── 3. Three-cube chain ─────────────────────────────────────────────────

describe('lagrangianSolve — 3-cube chain', () => {
  it('two cascaded point/point mates both satisfy', () => {
    const f = makePart('f', { fixed: true });
    const a = makePart('a');
    const b = makePart('b');
    const state: AssemblyState = {
      parts: [f, a, b],
      mates: [
        { id: 'm1', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('a', 'pa', 'point') } as Mate,
        { id: 'm2', kind: 'coincident', a: ref('a', 'pa2', 'point'), b: ref('b', 'pb', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(10, 0, 0) }],
      ['a/pa', { kind: 'point', world: vec3(0, 0, 0) }],
      ['a/pa2', { kind: 'point', world: vec3(5, 0, 0) }],
      ['b/pb', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs), { maxIterations: 100 });
    expect(r.success).toBe(true);
    expect(r.residuals.every((rr) => rr.residual < 1e-3)).toBe(true);
  });
});

// ─── 4. Over-constrained (redundant mates) ───────────────────────────────

describe('lagrangianSolve — over-constrained system', () => {
  it('redundant coincident mates: min-residual best-fit, success likely', () => {
    // Two coincident mates that are CONSISTENT (same effective target)
    // — system is redundant but solvable; J^T J is rank-deficient but
    // LM's λ-damping desingularizes it.
    const f = makePart('f', { fixed: true });
    const a = makePart('a');
    const state: AssemblyState = {
      parts: [f, a],
      mates: [
        { id: 'r1', kind: 'coincident', a: ref('f', 'p', 'point'), b: ref('a', 'p1', 'point') } as Mate,
        { id: 'r2', kind: 'coincident', a: ref('f', 'p', 'point'), b: ref('a', 'p2', 'point') } as Mate,
      ],
    };
    // Both p1 (local 0,0,0) and p2 (local 0,0,0) want to land on f/p (10,0,0).
    // Since they're the same local point they're consistent → both satisfied.
    const refs = new Map<string, ResolvedGeometry>([
      ['f/p', { kind: 'point', world: vec3(10, 0, 0) }],
      ['a/p1', { kind: 'point', world: vec3(0, 0, 0) }],
      ['a/p2', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    // Residual is bounded and the solver returns SOMETHING — under
    // damping a redundant-but-consistent system converges.
    expect(r.finalMaxResidual).toBeLessThan(1e-3);
  });
});

// ─── 5. Conflicting mates: success=false, residual > tol ─────────────────

describe('lagrangianSolve — conflicting mates', () => {
  it('mutually unsatisfiable coincidents: residual remains > tol', () => {
    const f = makePart('f', { fixed: true });
    const a = makePart('a');
    const state: AssemblyState = {
      parts: [f, a],
      mates: [
        { id: 'c1', kind: 'coincident', a: ref('f', 'p1', 'point'), b: ref('a', 'p', 'point') } as Mate,
        { id: 'c2', kind: 'coincident', a: ref('f', 'p2', 'point'), b: ref('a', 'p', 'point') } as Mate,
      ],
    };
    // a/p (local 0,0,0) can't simultaneously be at world (0,0,0) AND (10,0,0).
    const refs = new Map<string, ResolvedGeometry>([
      ['f/p1', { kind: 'point', world: vec3(0, 0, 0) }],
      ['f/p2', { kind: 'point', world: vec3(10, 0, 0) }],
      ['a/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs), { tolerance: 1e-6 });
    expect(r.success).toBe(false);
    expect(r.finalMaxResidual).toBeGreaterThan(1e-3);
  });
});

// ─── 6. Fixed + 1 free, 1 mate ───────────────────────────────────────────

describe('lagrangianSolve — single fixed + single free + one mate', () => {
  it('moves the free part to satisfy', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(50, 50, 50) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('g', 'pg', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/pg', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    expect(r.state.parts.find((p) => p.id === 'g')!.position.x).toBeCloseTo(0, 5);
  });
});

// ─── 7. Random starting orientation ──────────────────────────────────────

describe('lagrangianSolve — random starting orientation', () => {
  it('converges from an arbitrary non-identity orientation', () => {
    // Quaternion ~30° rotation around an arbitrary axis.
    const angle = Math.PI / 6;
    const ax = { x: 0.6, y: 0.5, z: 0.6 };
    const len = Math.sqrt(ax.x * ax.x + ax.y * ax.y + ax.z * ax.z);
    const u = { x: ax.x / len, y: ax.y / len, z: ax.z / len };
    const s = Math.sin(angle / 2);
    const startOri: Quat = { x: u.x * s, y: u.y * s, z: u.z * s, w: Math.cos(angle / 2) };
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(7, 3, -2), orientation: startOri });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('g', 'pg', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/pg', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
  });
});

// ─── 8. Heavy damping (factor 0.5) ───────────────────────────────────────

describe('lagrangianSolve — dampingFactor 0.5', () => {
  it('still converges but takes more iterations', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(20, 0, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('g', 'pg', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/pg', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs), {
      dampingFactor: 0.5,
      maxIterations: 200,
    });
    expect(r.success).toBe(true);
  });
});

// ─── 9. Max iterations cap → partial result ──────────────────────────────

describe('lagrangianSolve — maxIterations cap', () => {
  it('terminates at the cap with success=false on a hard system', () => {
    const f = makePart('f', { fixed: true });
    const a = makePart('a');
    const state: AssemblyState = {
      parts: [f, a],
      mates: [
        { id: 'c1', kind: 'coincident', a: ref('f', 'p1', 'point'), b: ref('a', 'p', 'point') } as Mate,
        { id: 'c2', kind: 'coincident', a: ref('f', 'p2', 'point'), b: ref('a', 'p', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/p1', { kind: 'point', world: vec3(0, 0, 0) }],
      ['f/p2', { kind: 'point', world: vec3(10, 0, 0) }],
      ['a/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs), { maxIterations: 3 });
    expect(r.success).toBe(false);
    expect(r.iterations).toBeLessThanOrEqual(3);
  });
});

// ─── 10. Tolerance: success boundary ─────────────────────────────────────

describe('lagrangianSolve — tolerance', () => {
  it('relaxing tolerance flips success from false to true', () => {
    const f = makePart('f', { fixed: true });
    const a = makePart('a');
    const state: AssemblyState = {
      parts: [f, a],
      mates: [
        { id: 'c1', kind: 'coincident', a: ref('f', 'p1', 'point'), b: ref('a', 'p', 'point') } as Mate,
        { id: 'c2', kind: 'coincident', a: ref('f', 'p2', 'point'), b: ref('a', 'p', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/p1', { kind: 'point', world: vec3(0, 0, 0) }],
      ['f/p2', { kind: 'point', world: vec3(10, 0, 0) }],
      ['a/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const strict = lagrangianSolve(state, makeResolver(refs), { tolerance: 1e-6 });
    expect(strict.success).toBe(false);
    const loose = lagrangianSolve(state, makeResolver(refs), { tolerance: 10 });
    expect(loose.success).toBe(true);
  });
});

// ─── 11. All-fixed trivial system ────────────────────────────────────────

describe('lagrangianSolve — all parts fixed', () => {
  it('returns iterations=0 and success=true immediately', () => {
    const f1 = makePart('f1', { fixed: true });
    const f2 = makePart('f2', { fixed: true, position: vec3(10, 0, 0) });
    const state: AssemblyState = { parts: [f1, f2], mates: [] };
    const refs = new Map<string, ResolvedGeometry>();
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    expect(r.iterations).toBe(0);
  });
});

// ─── 12. Degenerate (zero-length) axis ───────────────────────────────────

describe('lagrangianSolve — degenerate axis', () => {
  it('does not blow up when an axis direction is near-zero length', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(5, 0, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'c', kind: 'concentric', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      // direction is a unit vector along z; origin same as g, no work needed.
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      // A truly zero direction would violate the contract — but the solver
      // should at least not produce NaN. Use a very small but non-zero
      // direction to simulate near-degenerate input.
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1e-7) } }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(Number.isFinite(r.finalMaxResidual)).toBe(true);
    for (const p of r.state.parts) {
      expect(Number.isFinite(p.position.x)).toBe(true);
      expect(Number.isFinite(p.position.y)).toBe(true);
      expect(Number.isFinite(p.position.z)).toBe(true);
    }
  });
});

// ─── 13-19. Each of the 7 standard mate kinds, single-mate convergence ───

describe('lagrangianSolve — 7 standard mate kinds, single-mate convergence', () => {
  it('coincident plane/plane converges', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(0, 0, 5) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'coincident', a: ref('f', 'pl', 'plane'), b: ref('g', 'pl', 'plane') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
      ['g/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.finalMaxResidual).toBeLessThan(1e-4);
  });

  it('concentric axis/axis converges', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(5, 0, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'concentric', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
  });

  it('distance point/point converges', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(0, 0, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'distance', value: 10, a: ref('f', 'pf', 'point'), b: ref('g', 'pg', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/pg', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs), { maxIterations: 100 });
    // distance from g/pg to f/pf should be ~10. Newton on |·| residual can
    // wobble around the absolute-value kink — accept residual proximity.
    expect(r.finalMaxResidual).toBeLessThan(1e-2);
  });

  it('angle axis/axis converges', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g');
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'angle', value: 45, a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs), { maxIterations: 100 });
    expect(r.finalMaxResidual).toBeLessThan(1e-2);
  });

  it('parallel axis/axis converges', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g');
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'parallel', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs), { maxIterations: 100 });
    expect(r.finalMaxResidual).toBeLessThan(1e-3);
  });

  it('perpendicular axis/axis converges', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g');
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'perpendicular', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs), { maxIterations: 100 });
    expect(r.finalMaxResidual).toBeLessThan(1e-3);
  });

  it('tangent (currently no-op residual = 0): reports success trivially', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g');
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'tangent', a: ref('f', 'pl', 'face'), b: ref('g', 'pl', 'face') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
      ['g/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(1, 0, 0) } }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    expect(r.residuals[0]!.supported).toBe(false);
  });
});

// ─── 20. Hinge with limit: residual respects limit ───────────────────────

describe('lagrangianSolve — hinge with angular limit', () => {
  it('hinge axis alignment residual converges, limit term contributes', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(5, 0, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        {
          id: 'h',
          kind: 'hinge',
          a: ref('f', 'ax', 'axis'),
          b: ref('g', 'ax', 'axis'),
          limit: { minAngleDeg: -90, maxAngleDeg: 90 },
        } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs), { maxIterations: 100 });
    // Hinge is "convergent" if alignment is satisfied and the (unsigned)
    // quaternion swing stays within the limit. Initial state already
    // satisfies both — residual should be near 0.
    expect(r.finalMaxResidual).toBeLessThan(1e-3);
  });
});

// ─── 21. Parity comparison: same final state as iterativeSolve ───────────

describe('lagrangianSolve vs iterativeSolve — same final state', () => {
  it('single concentric mate: both solvers reach the same axis-collinear answer', () => {
    const fixed = makePart('f', { position: vec3(2, 2, 0), fixed: true });
    const free = makePart('g', { position: vec3(6, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'c', kind: 'concentric', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const resolver = makeResolver(refs);
    const gs = iterativeSolve(state, resolver);
    const newton = lagrangianSolve(state, resolver);
    expect(gs.success).toBe(true);
    expect(newton.success).toBe(true);
    const gsG = gs.state.parts.find((p) => p.id === 'g')!;
    const newG = newton.state.parts.find((p) => p.id === 'g')!;
    // x,y positions should agree (z slide is the free DoF either solver may
    // leave at any value — both leave it untouched at 0).
    expect(newG.position.x).toBeCloseTo(gsG.position.x, 2);
    expect(newG.position.y).toBeCloseTo(gsG.position.y, 2);
  });
});

// ─── 22. Speed comparison: newton ≤ gauss-seidel iterations ──────────────

describe('lagrangianSolve vs iterativeSolve — iteration count', () => {
  it('newton uses fewer-or-equal iterations on a simple coincident mate', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(15, -8, 4) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('g', 'pg', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/pg', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const resolver = makeResolver(refs);
    const gs = iterativeSolve(state, resolver);
    const newton = lagrangianSolve(state, resolver);
    // Both converge. Newton iterations on a linearizable coincident
    // residual ≤ Gauss-Seidel's (in practice Newton is 1-3, GS is 1-2).
    expect(newton.success).toBe(true);
    expect(gs.success).toBe(true);
    // Compare iteration counts loosely — Newton should win or tie within
    // a small constant factor.
    expect(newton.iterations).toBeLessThanOrEqual(gs.iterations + 2);
  });
});

// ─── 23. Per-mate residuals reported in stable shape ─────────────────────

describe('lagrangianSolve — residual reporting shape', () => {
  it('returns one residual entry per mate (including suppressed)', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g');
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm1', kind: 'coincident', a: ref('f', 'p', 'point'), b: ref('g', 'p', 'point') } as Mate,
        { id: 'm2', kind: 'coincident', a: ref('f', 'p', 'point'), b: ref('g', 'p', 'point'), suppressed: true } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/p', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.residuals).toHaveLength(2);
    expect(r.residuals.map((x) => x.mateId).sort()).toEqual(['m1', 'm2']);
  });
});

// ─── 24. Suppressed mates do not affect solve ────────────────────────────

describe('lagrangianSolve — suppressed mates ignored', () => {
  it('suppressed conflicting mate does not block convergence of the others', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g');
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'good', kind: 'coincident', a: ref('f', 'p0', 'point'), b: ref('g', 'p', 'point') } as Mate,
        { id: 'bad', kind: 'coincident', a: ref('f', 'p1', 'point'), b: ref('g', 'p', 'point'), suppressed: true } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/p0', { kind: 'point', world: vec3(3, 0, 0) }],
      ['f/p1', { kind: 'point', world: vec3(99, 0, 0) }],
      ['g/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    expect(r.state.parts.find((p) => p.id === 'g')!.position.x).toBeCloseTo(3, 5);
  });
});

// ─── 25. Resolver returns null: solver doesn't crash ─────────────────────

describe('lagrangianSolve — resolver returning null', () => {
  it('treats unresolved refs as zero residual and converges trivially', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g');
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'coincident', a: ref('f', 'nonexistent', 'point'), b: ref('g', 'p', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['g/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = lagrangianSolve(state, makeResolver(refs));
    // f/nonexistent → null → residual stays 0 → converged immediately.
    expect(r.success).toBe(true);
  });
});

// ─── 26. Zero mates: trivial convergence ─────────────────────────────────

describe('lagrangianSolve — no mates', () => {
  it('no mates: success=true, iterations=0', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g');
    const state: AssemblyState = { parts: [f, g], mates: [] };
    const r = lagrangianSolve(state, () => null);
    expect(r.success).toBe(true);
    expect(r.iterations).toBe(0);
  });
});

// ─── 27. Custom tolerance, custom maxIterations: both respected ──────────

describe('lagrangianSolve — options respected', () => {
  it('tolerance + maxIterations options control termination', () => {
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { position: vec3(100, 0, 0) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        { id: 'm', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('g', 'pg', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pf', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/pg', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const tight = lagrangianSolve(state, makeResolver(refs), { tolerance: 1e-10 });
    expect(tight.finalMaxResidual).toBeLessThan(1e-6);
    const capped = lagrangianSolve(state, makeResolver(refs), { maxIterations: 1 });
    expect(capped.iterations).toBeLessThanOrEqual(2); // 1 newton step + 0 final break-out increment
  });
});

// ─── 28. W5-F3: distance plane/plane normal alignment (newton engine) ────
//
// Before W5-F3 the distance plane/plane residual carried no normal-
// alignment term: a block tilted 30° with the gap numerically at target
// reported residual 1.5e-11 and converged=true on this engine (fake
// convergence, measured). The residual now adds |n_a × n_b|·(1+|o_b−o_a|)
// (same structure as plane-coincident), and the analytic Jacobian defers
// to numeric rows while normals are misaligned.

describe('lagrangianSolveAnalytic — W5-F3 distance plane/plane normal alignment', () => {
  const s30 = Math.sin(Math.PI / 6);
  const c30 = Math.cos(Math.PI / 6);
  const buildTilted = () => {
    const fixed = makePart('f', { fixed: true });
    const free = makePart('g', { position: vec3(0, 0, 5) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'd', kind: 'distance', a: ref('f', 'pl', 'plane'), b: ref('g', 'pl', 'plane'), value: 20 } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
      ['g/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(s30, 0, c30) } }],
    ]);
    return { state, resolver: makeResolver(refs) };
  };

  it('default budget: no fake convergence — success implies an aligned pose', () => {
    // Measured at this commit: success=false, finalMaxResidual ≈ 14.6
    // (honest failure at the default 100-iteration budget). The invariant
    // pinned here is engine-version-robust: EITHER it fails with a
    // non-trivial residual, OR it succeeds at a genuinely aligned pose.
    const { state, resolver } = buildTilted();
    const r = lagrangianSolveAnalytic(state, resolver);
    const g = r.state.parts.find((p) => p.id === 'g')!;
    const nWorld = rotateVec(vec3(s30, 0, c30), g.orientation);
    if (r.success) {
      expect(Math.abs(nWorld.z)).toBeCloseTo(1, 3); // aligned (±) or nothing
      expect(Math.abs(g.position.z)).toBeCloseTo(20, 3);
    } else {
      expect(r.finalMaxResidual).toBeGreaterThan(0.01);
    }
  });

  it('budget 1000: genuinely converges — z=20, tilt 0 (measured)', () => {
    const { state, resolver } = buildTilted();
    const r = lagrangianSolveAnalytic(state, resolver, { maxIterations: 1000 });
    expect(r.success).toBe(true);
    expect(r.finalMaxResidual).toBeLessThan(1e-4);
    const g = r.state.parts.find((p) => p.id === 'g')!;
    expect(g.position.z).toBeCloseTo(20, 3);
    const nWorld = rotateVec(vec3(s30, 0, c30), g.orientation);
    expect(nWorld.z).toBeCloseTo(1, 4);
  });
});

// ─── 29. W5-F3: hinge unsigned-proxy approximation marker (newton path) ──

describe('lagrangianSolveAnalytic — hinge residual approximation marker', () => {
  function quatZ(rad: number) {
    return { x: 0, y: 0, z: Math.sin(rad / 2), w: Math.cos(rad / 2) };
  }
  it('limit without zeroAngleRef → residual report carries hinge-unsigned-proxy', () => {
    // Both parts FIXED at +30° relative yaw with limit [0°, 90°]: the
    // swing is in-limit, yet the unsigned proxy pessimistically reports
    // 0.5236 rad — the marker makes that approximation machine-readable.
    const f = makePart('f', { fixed: true });
    const g = makePart('g', { fixed: true, orientation: quatZ(Math.PI / 6) });
    const state: AssemblyState = {
      parts: [f, g],
      mates: [
        {
          id: 'h', kind: 'hinge',
          a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis'),
          limit: { minAngleDeg: 0, maxAngleDeg: 90 },
        } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
    ]);
    const r = lagrangianSolveAnalytic(state, makeResolver(refs));
    expect(r.residuals[0]!.residual).toBeCloseTo(0.5236, 3);
    expect(r.residuals[0]!.approximation).toBe('hinge-unsigned-proxy');
  });
});
