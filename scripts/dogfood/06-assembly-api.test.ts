/**
 * DOGFOOD 06 — the assembly programmatic path (F14 reproduction, W5-F).
 *
 * F14 (docs/dogfood-findings-260719.md): the mate solver engine is strong
 * but every call a designer writes on first contact was rejected by the
 * types — no `solveMates` export on '@/lib/assembly/mateSolver', no
 * `partId` on part instances, no `converged`/`parts` on the result.
 *
 * This file IS the executable reproduction: it imports exactly what the
 * failed exploration files imported, builds a 2-part assembly purely
 * programmatically, adds coincident + distance mates, and asserts the
 * final placements against hand-computed values.
 *
 * Hand computation for the main case (base fixed at origin, identity):
 *   - base.wall  = plane { origin (20,0,0), normal (-1,0,0) }
 *   - base.anchor = point (20,0,0)
 *   - block starts at (5,6,8), identity. block.yz_plane normal = +X.
 *   - coincident(block.yz_plane, base.wall):
 *       normals already anti-parallel (+X vs -X) → rotation = identity.
 *       translate along wall normal: along = ((20,0,0)-(5,6,8))·(-1,0,0)
 *       = -15 → shift = (-1,0,0)·(-15) = (+15,0,0) → block = (20,6,8).
 *   - distance(block.origin, base.anchor, 25... no — value 5):
 *       separation = (20,6,8)-(20,0,0) = (0,6,8), |·| = 10, unit (0,.6,.8)
 *       → new origin = (20,0,0) + 5·(0,.6,.8) = (20,3,4).
 *   - Both mates constrain disjoint directions (x vs y/z) → exact
 *     simultaneous solution: block = (20,3,4), orientation = identity.
 */
import { describe, it, expect } from 'vitest';
// F14 line 1: this exact import used to fail with "no export named solveMates".
import { solveMates, AssemblyApiError, rotateVec } from '@/lib/assembly/mateSolver';
import type { SolvePartSpec, SolveMateSpec } from '@/lib/assembly/mateSolver';

const basePart: SolvePartSpec = {
  partId: 'base', // F14 line 2: `partId` (not `id`) now accepted
  fixed: true,
  refs: {
    wall: { kind: 'plane', origin: { x: 20, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } },
    anchor: { kind: 'point', origin: { x: 20, y: 0, z: 0 } },
  },
};

describe('DOGFOOD 06 — assembly programmatic API (F14)', () => {
  it('A: solveMates is importable from @/lib/assembly/mateSolver (F14 repro)', () => {
    expect(typeof solveMates).toBe('function');
  });

  it('B: coincident point/point — pure translation, exact placement', () => {
    const result = solveMates(
      [
        {
          partId: 'base',
          fixed: true,
          refs: { anchor: { kind: 'point', origin: { x: 10, y: -2, z: 7 } } },
        },
        { partId: 'block', position: { x: 1, y: 1, z: 1 } },
      ],
      [
        {
          kind: 'coincident',
          a: { partId: 'block', refId: 'origin' }, // built-in ref, refKind inferred
          b: { partId: 'base', refId: 'anchor' },
        },
      ],
      { tolerance: 1e-9 },
    );
    // F14 line 3: `converged` and `parts` now exist on the result.
    expect(result.converged).toBe(true);
    const block = result.part('block');
    expect(Math.abs(block.position.x - 10)).toBeLessThan(1e-6);
    expect(Math.abs(block.position.y - -2)).toBeLessThan(1e-6);
    expect(Math.abs(block.position.z - 7)).toBeLessThan(1e-6);
    // Pure translation: orientation stays identity.
    expect(Math.abs(block.orientation.w - 1)).toBeLessThan(1e-9);
    // Fixed part did not move.
    const base = result.part('base');
    expect(base.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(base.fixed).toBe(true);
  });

  it('C: coincident(plane) + distance(point) — hand-computed (20,3,4)', () => {
    const mates: SolveMateSpec[] = [
      {
        id: 'on_wall',
        kind: 'coincident',
        a: { partId: 'block', refId: 'yz_plane' },
        b: { partId: 'base', refId: 'wall' },
      },
      {
        id: 'stand_off',
        kind: 'distance',
        value: 5,
        a: { partId: 'block', refId: 'origin' },
        b: { partId: 'base', refId: 'anchor' },
      },
    ];
    const result = solveMates(
      [basePart, { partId: 'block', position: { x: 5, y: 6, z: 8 } }],
      mates,
      { tolerance: 1e-9 },
    );
    expect(result.converged).toBe(true);
    expect(result.finalMaxResidual).toBeLessThan(1e-9);
    // The two mates constrain disjoint axes → exact solution in one pass.
    expect(result.iterations).toBeLessThanOrEqual(2);

    const block = result.part('block');
    expect(Math.abs(block.position.x - 20)).toBeLessThan(1e-6);
    expect(Math.abs(block.position.y - 3)).toBeLessThan(1e-6);
    expect(Math.abs(block.position.z - 4)).toBeLessThan(1e-6);
    expect(Math.abs(block.orientation.x)).toBeLessThan(1e-9);
    expect(Math.abs(block.orientation.y)).toBeLessThan(1e-9);
    expect(Math.abs(block.orientation.z)).toBeLessThan(1e-9);
    expect(Math.abs(block.orientation.w - 1)).toBeLessThan(1e-9);

    // Cross-check via the residual list: both mates satisfied.
    for (const r of result.residuals) {
      expect(r.residual).toBeLessThan(1e-9);
    }
    // `parts` is ordered and carries partId (F14 line 2+3 together).
    expect(result.parts.map((p) => p.partId)).toEqual(['base', 'block']);
  });

  it('D: coincident plane mate that requires a real rotation (90°)', () => {
    // ceiling = plane z=30 with normal -Z. block.yz_plane normal starts at
    // +X → must rotate +X onto +Z (anti-parallel to -Z): 90° about -Y.
    // Position: part origin keeps (x,y) = (2,3); plane through part origin
    // must land on z=30 → (2,3,30).
    const result = solveMates(
      [
        {
          partId: 'base',
          fixed: true,
          refs: {
            ceiling: { kind: 'plane', origin: { x: 0, y: 0, z: 30 }, normal: { x: 0, y: 0, z: -1 } },
          },
        },
        { partId: 'block', position: { x: 2, y: 3, z: 4 } },
      ],
      [
        {
          kind: 'coincident',
          a: { partId: 'block', refId: 'yz_plane' },
          b: { partId: 'base', refId: 'ceiling' },
        },
      ],
      { tolerance: 1e-9 },
    );
    expect(result.converged).toBe(true);
    const block = result.part('block');
    expect(Math.abs(block.position.x - 2)).toBeLessThan(1e-6);
    expect(Math.abs(block.position.y - 3)).toBeLessThan(1e-6);
    expect(Math.abs(block.position.z - 30)).toBeLessThan(1e-6);
    // Assert the rotation behaviorally (quaternion sign is ambiguous):
    // the block's local +X must now point at world +Z.
    const xWorld = rotateVec({ x: 1, y: 0, z: 0 }, block.orientation);
    expect(Math.abs(xWorld.x)).toBeLessThan(1e-6);
    expect(Math.abs(xWorld.y)).toBeLessThan(1e-6);
    expect(Math.abs(xWorld.z - 1)).toBeLessThan(1e-6);
    // |w| = cos(45°) = 1/√2 for a 90° rotation.
    expect(Math.abs(Math.abs(block.orientation.w) - Math.SQRT1_2)).toBeLessThan(1e-9);
  });

  it('E: newton engine — translation-unique system reaches the same point', () => {
    // NOTE (measured, not assumed — re-measured after W5-F2/F3): on the
    // plane+distance system of test C the Newton engine used to report
    // converged=true at a DIFFERENT placement (x ≈ 15.91) because the
    // plane-coincident residual lacked a normal-alignment term. Since the
    // W5-F2 alignment term, Newton no longer fake-converges there — it
    // now honestly reports converged=false (measured at this commit:
    // finalMaxResidual ≈ 3.617, x ≈ 16.38 at the default iteration
    // budget; the summed |·|-kinked scalar is hard for LM on that
    // fixture). Gauss-Seidel (default engine) solves it exactly via the
    // analytic full placement — hence it is the default. Here we use a
    // translation-unique system where the residual zero-set is a single
    // point, which Newton does solve.
    const result = solveMates(
      [
        {
          partId: 'base',
          fixed: true,
          refs: { anchor: { kind: 'point', origin: { x: 10, y: -2, z: 7 } } },
        },
        { partId: 'block', position: { x: 1, y: 1, z: 1 } },
      ],
      [
        {
          kind: 'coincident',
          a: { partId: 'block', refId: 'origin' },
          b: { partId: 'base', refId: 'anchor' },
        },
      ],
      { engine: 'newton', tolerance: 1e-6 },
    );
    expect(result.converged).toBe(true);
    expect(result.finalMaxResidual).toBeLessThan(1e-6);
    const block = result.part('block');
    expect(Math.abs(block.position.x - 10)).toBeLessThan(1e-4);
    expect(Math.abs(block.position.y - -2)).toBeLessThan(1e-4);
    expect(Math.abs(block.position.z - 7)).toBeLessThan(1e-4);
  });

  it('F: rejections carry reasons — unknown partId / refId, no fixed part', () => {
    // Unknown partId in a mate.
    expect(() =>
      solveMates(
        [basePart, { partId: 'block' }],
        [{ kind: 'coincident', a: { partId: 'blok', refId: 'origin' }, b: { partId: 'base', refId: 'anchor' } }],
      ),
    ).toThrow(/unknown partId 'blok'/);

    // Typo'd refId — must fail loudly, NOT be silently skipped by the engine.
    expect(() =>
      solveMates(
        [basePart, { partId: 'block' }],
        [{ kind: 'coincident', a: { partId: 'block', refId: 'orign' }, b: { partId: 'base', refId: 'anchor' } }],
      ),
    ).toThrow(/no ref 'orign'/);

    // Assembly with no fixed part floats — refuse with the engine's reason.
    expect(() =>
      solveMates(
        [{ partId: 'a' }, { partId: 'b' }],
        [{ kind: 'coincident', a: { partId: 'a', refId: 'origin' }, b: { partId: 'b', refId: 'origin' } }],
      ),
    ).toThrow(/no fixed part/);

    // Missing required mate parameter.
    expect(() =>
      solveMates(
        [basePart, { partId: 'block' }],
        [{ kind: 'distance', a: { partId: 'block', refId: 'origin' }, b: { partId: 'base', refId: 'anchor' } }],
      ),
    ).toThrow(AssemblyApiError);
  });

  it('G: gear + hinges — placement solves; ratio is NOT consumed (known limit)', () => {
    // Two gears hinged onto parallel shafts of a fixed frame, plus a gear
    // mate. The static solver places both gears on their shafts. NOTE:
    // GearMate.ratio is a velocity coupling — by design (documented in
    // iterativeSolver) the static placement ignores it; only coplanarity
    // is checked. This test pins the CURRENT semantics so a future
    // kinematic pass changes it consciously, not accidentally.
    const result = solveMates(
      [
        {
          partId: 'frame',
          fixed: true,
          refs: {
            shaft_a: { kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
            shaft_b: { kind: 'axis', origin: { x: 30, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
          },
        },
        { partId: 'gear_a', position: { x: 1, y: 2, z: 3 } },
        { partId: 'gear_b', position: { x: 28, y: 1, z: -2 } },
      ],
      [
        { kind: 'hinge', a: { partId: 'gear_a', refId: 'z_axis' }, b: { partId: 'frame', refId: 'shaft_a' } },
        { kind: 'hinge', a: { partId: 'gear_b', refId: 'z_axis' }, b: { partId: 'frame', refId: 'shaft_b' } },
        { kind: 'gear', ratio: 2, a: { partId: 'gear_a', refId: 'z_axis' }, b: { partId: 'gear_b', refId: 'z_axis' } },
      ],
      { tolerance: 1e-9 },
    );
    expect(result.converged).toBe(true);
    const a = result.part('gear_a');
    const b = result.part('gear_b');
    // Hinge = concentric placement: perpendicular offset removed, axial
    // slide preserved (z stays where it started).
    expect(Math.abs(a.position.x - 0)).toBeLessThan(1e-6);
    expect(Math.abs(a.position.y - 0)).toBeLessThan(1e-6);
    expect(Math.abs(a.position.z - 3)).toBeLessThan(1e-6);
    expect(Math.abs(b.position.x - 30)).toBeLessThan(1e-6);
    expect(Math.abs(b.position.y - 0)).toBeLessThan(1e-6);
    expect(Math.abs(b.position.z - -2)).toBeLessThan(1e-6);
    // Parallel shafts → gear coplanarity residual is 0 regardless of ratio.
    const gearResidual = result.residuals.find((r) => r.mateId === 'mate_3');
    expect(gearResidual?.residual).toBeLessThan(1e-9);
  });
});
