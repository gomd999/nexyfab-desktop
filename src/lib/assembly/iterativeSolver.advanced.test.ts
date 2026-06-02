/**
 * iterativeSolver — Phase 3.2.6 advanced-mate analytical coverage.
 *
 * The 4 advanced mate kinds (hinge / slot / gear / rack_pinion) now have
 * analytical solver support:
 *   - hinge: placement = concentric on shared axis (Phase 1: axial limit
 *     enforced via residual only).
 *   - slot: placement = project pin axis origin onto slot edge line and
 *     align pin direction perpendicular to slot direction (Phase 1:
 *     straight slot, no length / range clamping).
 *   - gear: placement is a no-op (velocity coupling) — residual checks
 *     the two shafts are coplanar (parallel or intersecting).
 *   - rack_pinion: placement is a no-op (velocity coupling) — residual
 *     checks pinion axis sits at distance == pinionRadius from rack.
 */
import { describe, it, expect } from 'vitest';
import { iterativeSolve, type GeometryResolver, type ResolvedGeometry } from './iterativeSolver';
import {
  partInstance,
  IDENTITY_QUAT,
  quat,
  type AssemblyState,
  type PartInstance,
  type Quat,
} from './assemblyState';
import { validateMate, MateValidationError, type Mate, type MateRef, type HingeMate } from './mate';
import { vec3 } from '@/lib/sketch/sketchPlane';
import { rotateVec } from './mateSolver';

// Axis-angle → unit quaternion (test-local helper).
function quatAxisAngle(ax: number, ay: number, az: number, angleRad: number): Quat {
  const h = angleRad / 2;
  const s = Math.sin(h);
  return quat(ax * s, ay * s, az * s, Math.cos(h));
}

// ─── fixtures (mirror of iterativeSolver.test.ts helpers) ────────────────

function makeResolver(
  refs: Map<string, { local: ResolvedGeometry }>,
): GeometryResolver {
  return (ref: MateRef, part: PartInstance): ResolvedGeometry | null => {
    const key = `${ref.partId}/${ref.refId}`;
    const entry = refs.get(key);
    if (!entry) return null;
    return transformInWorld(entry.local, part);
  };
}

function transformInWorld(local: ResolvedGeometry, part: PartInstance): ResolvedGeometry {
  if (local.kind === 'point') {
    const r = rotateVec(local.world, part.orientation);
    return {
      kind: 'point',
      world: {
        x: part.position.x + r.x,
        y: part.position.y + r.y,
        z: part.position.z + r.z,
      },
    };
  }
  if (local.kind === 'axis') {
    const ro = rotateVec(local.world.origin, part.orientation);
    const rd = rotateVec(local.world.direction, part.orientation);
    return {
      kind: 'axis',
      world: {
        origin: {
          x: part.position.x + ro.x,
          y: part.position.y + ro.y,
          z: part.position.z + ro.z,
        },
        direction: rd,
      },
    };
  }
  // plane (unused by advanced-mate fixtures here but kept for completeness)
  const ro = rotateVec(local.world.origin, part.orientation);
  const rn = rotateVec(local.world.normal, part.orientation);
  return {
    kind: 'plane',
    world: {
      origin: {
        x: part.position.x + ro.x,
        y: part.position.y + ro.y,
        z: part.position.z + ro.z,
      },
      normal: rn,
    },
  };
}

function makePart(
  id: string,
  opts: {
    position?: { x: number; y: number; z: number };
    fixed?: boolean;
    orientation?: Quat;
  } = {},
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

function ref(partId: string, refId: string, refKind: MateRef['refKind']): MateRef {
  return { partId, refId, refKind };
}

// ─── solver-side coverage for advanced mates ─────────────────────────────

describe('iterativeSolve — advanced mate analytical solvers', () => {
  it('hinge mate is supported and converges (shared axis collinear, residual ~0)', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    // Free part starts offset; the hinge should snap its axis onto the
    // fixed part's axis (concentric-like placement).
    const free = makePart('g', { position: vec3(5, 5, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'h1',
          kind: 'hinge',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals).toHaveLength(1);
    expect(r.residuals[0]!.mateId).toBe('h1');
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
    expect(r.success).toBe(true);
  });

  it('slot mate is supported and residual reduces (pin snapped to slot line + perpendicular)', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    // Free pin starts offset by +y from the slot line (slot lies along x).
    const free = makePart('g', { position: vec3(3, 5, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 's1',
          kind: 'slot',
          a: ref('f', 'slot_e', 'edge'),
          b: ref('g', 'pin_ax', 'axis'),
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      // Slot edge along +x at world origin
      ['f/slot_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
      // Pin along +z (already perpendicular to slot's +x — alignment OK)
      ['g/pin_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals).toHaveLength(1);
    expect(r.residuals[0]!.mateId).toBe('s1');
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
    expect(r.success).toBe(true);
  });

  it('gear mate is supported; residual ~0 for parallel coplanar shafts', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    // Free gear shaft is parallel to fixed gear shaft at offset (5, 0, 0).
    // Both axes are along +z → parallel → skew distance = 0 (parallel
    // shafts at any offset are coplanar in gear context).
    const free = makePart('g', { position: vec3(5, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'gr1',
          kind: 'gear',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
          ratio: 2,
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals).toHaveLength(1);
    expect(r.residuals[0]!.mateId).toBe('gr1');
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('gear mate residual is nonzero for skew (non-parallel non-intersecting) axes', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    // Fixed: z-axis through origin. Free: x-axis through (0, 5, 0).
    // These are genuinely skew (perpendicular directions; no point in
    // common because the closest approach is 5 along +y at z=0).
    const free = makePart('g', { position: vec3(0, 5, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'gr_skew',
          kind: 'gear',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
          ratio: 2,
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      // local +x stays +x in world; with part at (0, 5, 0) the axis is
      // the line through (0,5,0) along +x — skew to the fixed z-axis.
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals).toHaveLength(1);
    expect(r.residuals[0]!.supported).toBe(true);
    // Gear placement is a no-op. Skew distance = 5 (perpendicular gap
    // between the two skew lines).
    expect(r.residuals[0]!.residual).toBeGreaterThan(4);
    expect(r.residuals[0]!.residual).toBeLessThan(6);
  });

  it('rack_pinion mate is supported; residual ~0 when pinion axis is at pinionRadius from rack', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    // Pinion axis along +z at world (0, 10, 0) — perpendicular to rack
    // edge (along +x at origin). Perpendicular distance = 10 = pinionRadius.
    const free = makePart('g', { position: vec3(0, 10, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'rp1',
          kind: 'rack_pinion',
          a: ref('g', 'pinion_ax', 'axis'),
          b: ref('f', 'rack_e', 'edge'),
          pinionRadius: 10,
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['g/pinion_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['f/rack_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals).toHaveLength(1);
    expect(r.residuals[0]!.mateId).toBe('rp1');
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('rack_pinion mate residual nonzero when pinion-to-rack distance mismatches pinionRadius', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    // Pinion sits 25 mm from rack, but pinionRadius is 10 → 15 mm mismatch.
    const free = makePart('g', { position: vec3(0, 25, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'rp_off',
          kind: 'rack_pinion',
          a: ref('g', 'pinion_ax', 'axis'),
          b: ref('f', 'rack_e', 'edge'),
          pinionRadius: 10,
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['g/pinion_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['f/rack_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals).toHaveLength(1);
    expect(r.residuals[0]!.supported).toBe(true);
    // |25 - 10| = 15, pin already perpendicular to rack (cos=0) → ~15.
    expect(r.residuals[0]!.residual).toBeGreaterThan(10);
  });
});

// ─── extra edge-case coverage ────────────────────────────────────────────

describe('iterativeSolve — advanced mate edge cases', () => {
  it('hinge mate with angular limit still converges on axis alignment (limit wide enough not to trigger)', () => {
    // The hinge solver rotates the free part to align axes — this
    // rotation is now visible to the Phase 3.2.5.1 limit-residual proxy.
    // To keep this test focused on placement convergence (its original
    // intent), use a wide limit that the post-alignment proxy angle
    // stays inside.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(7, -3, 2) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'h_limit',
          kind: 'hinge',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
          limit: { minAngleDeg: -180, maxAngleDeg: 180 },
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 1, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('hinge mate aligns when fixed and free axes start non-parallel', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(2, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'h_skew',
          kind: 'hinge',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      // Free part axis points along +x (90° off fixed)
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
    expect(r.success).toBe(true);
  });

  it('slot mate snaps pin direction perpendicular to slot when starting parallel', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    // Pin starts ALONG the slot direction (not perpendicular).
    const free = makePart('g', { position: vec3(2, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 's_align',
          kind: 'slot',
          a: ref('f', 'slot_e', 'edge'),
          b: ref('g', 'pin_ax', 'axis'),
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/slot_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
      // Pin direction local = +y; aligns perpendicular to +x slot, so
      // residual should converge to ~0.
      ['g/pin_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 1, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('hinge with limit [-30°, 30°] when within bounds → no extra residual', () => {
    // Both parts identity orientation → proxy swing angle = 0° → inside
    // limit → no length penalty. Residual = axis alignment only (≈ 0).
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(2, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'h_in',
          kind: 'hinge',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
          limit: { minAngleDeg: -30, maxAngleDeg: 30 },
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('hinge with limit [-30°, 30°] starting at proxy 60° → secondary > 0', () => {
    // Free part is rotated 60° around z. Both local axes are (0,0,1) so
    // the axis direction is invariant under z-rotation — solver's
    // quatFromTo returns identity, leaving the free part's orientation
    // intact. dot(q_a=identity, q_b=Rz(60°)) = cos(30°); proxy = 60°.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', {
      position: vec3(0, 0, 0),
      orientation: quatAxisAngle(0, 0, 1, (60 * Math.PI) / 180),
    });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'h_over',
          kind: 'hinge',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
          limit: { minAngleDeg: -30, maxAngleDeg: 30 },
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    // Axes are coincident (alignErr ≈ 0); secondary should be the
    // out-of-limit penalty = (60 - 30) deg → (30·π/180) ≈ 0.524 rad.
    expect(r.residuals[0]!.residual).toBeGreaterThan(0.4);
    expect(r.residuals[0]!.residual).toBeLessThan(0.7);
  });

  it('slot with slotLength=100, pin at parameter t=50 → no length penalty', () => {
    // Slot from origin along +x. Pin sits 50 mm down the slot at (50,0,0).
    // perpDist=0, perpErr=0 (pin along +z), t=50 in [0,100] → secondary=0.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(50, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 's_in',
          kind: 'slot',
          a: ref('f', 'slot_e', 'edge'),
          b: ref('g', 'pin_ax', 'axis'),
          slotLength: 100,
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/slot_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
      ['g/pin_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('slot with slotLength=100, pin at parameter t=-10 → length penalty = 10', () => {
    // Pin starts at (-10, 0, 0) → t = -10 < 0, penalty = 10.
    // Solver's slot placement preserves the along-slot slide DoF, so
    // after solve the pin's t stays at -10.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(-10, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 's_below',
          kind: 'slot',
          a: ref('f', 'slot_e', 'edge'),
          b: ref('g', 'pin_ax', 'axis'),
          slotLength: 100,
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/slot_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
      ['g/pin_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    // perpDist=0, perpErr=0, lengthPenalty=|-10|=10.
    expect(r.residuals[0]!.residual).toBeGreaterThan(9.99);
    expect(r.residuals[0]!.residual).toBeLessThan(10.01);
  });

  it('slot with slotLength=100, pin at parameter t=120 → length penalty = 20', () => {
    // Pin past the slot's end. t = 120, slotLength = 100 → penalty = 20.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(120, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 's_above',
          kind: 'slot',
          a: ref('f', 'slot_e', 'edge'),
          b: ref('g', 'pin_ax', 'axis'),
          slotLength: 100,
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/slot_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
      ['g/pin_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeGreaterThan(19.99);
    expect(r.residuals[0]!.residual).toBeLessThan(20.01);
  });

  it('gear with backlash=0.01rad, parallel-aligned shafts → residual ~0 (within zone)', () => {
    // Parallel shafts (both +z) at offset → coplanarityErr=0 AND angular
    // misalignment theta=0 ≤ backlash → backlashPenalty=0. Total ≈ 0.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(5, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'gr_back',
          kind: 'gear',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
          ratio: 2,
          backlash: 0.01,
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('rack_pinion with rackTravel within bounds → no travel penalty', () => {
    // Pinion part orientation = IDENTITY → approxAngle = 0 → rackPos = 0,
    // inside [-50, 50] → travelPenalty = 0. Mount geometry is correct
    // (perpDist=10=pinionRadius, perpendicular). Residual ≈ 0.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(0, 10, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'rp_in',
          kind: 'rack_pinion',
          a: ref('g', 'pinion_ax', 'axis'),
          b: ref('f', 'rack_e', 'edge'),
          pinionRadius: 10,
          rackTravel: { min: -50, max: 50 },
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['g/pinion_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['f/rack_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('rack_pinion with rackTravel out-of-bounds → travel penalty > 0', () => {
    // Pinion part rotated by π/2 around its pinion axis (the +z axis of
    // part g, here at world origin). Since +z is invariant under +z-axis
    // rotation, the solver's placement won't undo this. Pinion's part `a`
    // (the part identified by mate.a.partId = 'g') has q.w = cos(π/4).
    // approxAngle ≈ π/2 rad → rackPos = (π/2)·10 ≈ 15.7 > rackTravel.max=5
    // → travelPenalty ≈ 10.7.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', {
      position: vec3(0, 10, 0),
      orientation: quatAxisAngle(0, 0, 1, Math.PI / 2),
    });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'rp_over',
          kind: 'rack_pinion',
          a: ref('g', 'pinion_ax', 'axis'),
          b: ref('f', 'rack_e', 'edge'),
          pinionRadius: 10,
          rackTravel: { min: -5, max: 5 },
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['g/pinion_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['f/rack_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeGreaterThan(5);
  });

  it('gear mate residual ~0 for intersecting (bevel-gear-like) axes', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    // Free axis perpendicular to fixed axis but intersects at origin.
    // Bevel-gear case: coplanar (intersecting) → mesh-compatible →
    // residual ≈ 0.
    const free = makePart('g', { position: vec3(0, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'gr_bevel',
          kind: 'gear',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
          ratio: 1,
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    // Intersecting axes are coplanar → residual = 0.
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });
});

// ─── Phase 2: signed-swing hinge (body-frame zero reference) ─────────────
//
// These cover the Phase 2 upgrade documented in mate.ts's HingeZeroAngleRef.
// When the mate provides `zeroAngleRef`, the residual measures swing as
// `atan2((A × B) · axis, A · B)` (signed). Phase 1 unsigned proxy is
// retained as the fallback — covered by the existing tests above.
describe('iterativeSolve — Phase 2 hinge with signed-swing zeroAngleRef', () => {
  // Local helper: build a fixed/free pair sharing a +z hinge axis at world
  // origin. The free part's orientation around +z is set by `freeYawRad`.
  // Body-frame zero-vectors on both sides are +x (perpendicular to +z axis).
  function buildSignedHingeFixture(opts: {
    freeYawRad: number;
    limit?: { minAngleDeg: number; maxAngleDeg: number };
    withZeroRef?: boolean;
  }): { state: AssemblyState; resolver: GeometryResolver } {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', {
      position: vec3(0, 0, 0),
      fixed: true, // freeze placement so we measure ORIENTATION-driven residual
      orientation: quatAxisAngle(0, 0, 1, opts.freeYawRad),
    });
    const mate: HingeMate = {
      id: 'h_signed',
      kind: 'hinge',
      a: ref('f', 'ax_f', 'axis'),
      b: ref('g', 'ax_g', 'axis'),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.withZeroRef ?? true
        ? {
            zeroAngleRef: {
              a: vec3(1, 0, 0),
              b: vec3(1, 0, 0),
              axisA: vec3(0, 0, 1),
              axisB: vec3(0, 0, 1),
            },
          }
        : {}),
    };
    const state: AssemblyState = { parts: [fixed, free], mates: [mate] };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    return { state, resolver: makeResolver(refs) };
  }

  it('swing = 0° with limit [-90°, 90°] → limit residual ≈ 0', () => {
    const { state, resolver } = buildSignedHingeFixture({
      freeYawRad: 0,
      limit: { minAngleDeg: -90, maxAngleDeg: 90 },
    });
    const r = iterativeSolve(state, resolver);
    expect(r.residuals).toHaveLength(1);
    expect(r.residuals[0]!.supported).toBe(true);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('swing = 45° within [-90°, 90°] → limit residual ≈ 0', () => {
    const { state, resolver } = buildSignedHingeFixture({
      freeYawRad: (45 * Math.PI) / 180,
      limit: { minAngleDeg: -90, maxAngleDeg: 90 },
    });
    const r = iterativeSolve(state, resolver);
    expect(r.residuals[0]!.residual).toBeLessThan(1e-4);
  });

  it('swing = +120° outside [-90°, 90°] → limit residual ≈ 30° (~0.524 rad)', () => {
    const { state, resolver } = buildSignedHingeFixture({
      freeYawRad: (120 * Math.PI) / 180,
      limit: { minAngleDeg: -90, maxAngleDeg: 90 },
    });
    const r = iterativeSolve(state, resolver);
    const expectedRad = (30 * Math.PI) / 180;
    expect(r.residuals[0]!.residual).toBeGreaterThan(expectedRad - 1e-3);
    expect(r.residuals[0]!.residual).toBeLessThan(expectedRad + 1e-3);
  });

  it('swing = -120° outside [-90°, 90°] → limit residual ≈ 30° (signed clamp on neg side)', () => {
    const { state, resolver } = buildSignedHingeFixture({
      freeYawRad: (-120 * Math.PI) / 180,
      limit: { minAngleDeg: -90, maxAngleDeg: 90 },
    });
    const r = iterativeSolve(state, resolver);
    const expectedRad = (30 * Math.PI) / 180;
    expect(r.residuals[0]!.residual).toBeGreaterThan(expectedRad - 1e-3);
    expect(r.residuals[0]!.residual).toBeLessThan(expectedRad + 1e-3);
  });

  it('signed swing distinguishes CW vs CCW (asymmetric limit [0°, 90°])', () => {
    // +30° is inside → residual ≈ 0.
    const ccw = buildSignedHingeFixture({
      freeYawRad: (30 * Math.PI) / 180,
      limit: { minAngleDeg: 0, maxAngleDeg: 90 },
    });
    const rCcw = iterativeSolve(ccw.state, ccw.resolver);
    expect(rCcw.residuals[0]!.residual).toBeLessThan(1e-4);

    // -30° is OUTSIDE the [0°, 90°] window → residual ≈ 30° in radians.
    const cw = buildSignedHingeFixture({
      freeYawRad: (-30 * Math.PI) / 180,
      limit: { minAngleDeg: 0, maxAngleDeg: 90 },
    });
    const rCw = iterativeSolve(cw.state, cw.resolver);
    const expectedRad = (30 * Math.PI) / 180;
    expect(rCw.residuals[0]!.residual).toBeGreaterThan(expectedRad - 1e-3);
    expect(rCw.residuals[0]!.residual).toBeLessThan(expectedRad + 1e-3);
  });

  it('validateMate throws when zeroAngleRef.a is not perpendicular to axisA', () => {
    const m: HingeMate = {
      id: 'h_bad_a',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      zeroAngleRef: {
        // a is NOT perpendicular to axisA (has a +z component along axisA)
        a: vec3(1, 0, 1),
        b: vec3(1, 0, 0),
        axisA: vec3(0, 0, 1),
        axisB: vec3(0, 0, 1),
      },
    };
    expect(() => validateMate(m)).toThrow(MateValidationError);
    expect(() => validateMate(m)).toThrow(/perpendicular/);
  });

  it('validateMate throws when zeroAngleRef.b is not perpendicular to axisB', () => {
    const m: HingeMate = {
      id: 'h_bad_b',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      zeroAngleRef: {
        a: vec3(1, 0, 0),
        // b has a component along axisB
        b: vec3(0, 1, 1),
        axisA: vec3(0, 0, 1),
        axisB: vec3(0, 0, 1),
      },
    };
    expect(() => validateMate(m)).toThrow(MateValidationError);
    expect(() => validateMate(m)).toThrow(/perpendicular/);
  });

  it('validateMate throws when any zeroAngleRef vector is zero-length', () => {
    const m: HingeMate = {
      id: 'h_zero',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      zeroAngleRef: {
        a: vec3(0, 0, 0),
        b: vec3(1, 0, 0),
        axisA: vec3(0, 0, 1),
        axisB: vec3(0, 0, 1),
      },
    };
    expect(() => validateMate(m)).toThrow(/non-zero/);
  });

  it('validateMate accepts perpendicular zeroAngleRef (no throw)', () => {
    const m: HingeMate = {
      id: 'h_ok',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      limit: { minAngleDeg: -90, maxAngleDeg: 90 },
      zeroAngleRef: {
        a: vec3(1, 0, 0),
        b: vec3(0, 1, 0),
        axisA: vec3(0, 0, 1),
        axisB: vec3(0, 0, 1),
      },
    };
    expect(() => validateMate(m)).not.toThrow();
  });

  it('Phase 1 proxy still in effect when zeroAngleRef is absent (back-compat)', () => {
    // Same fixture as the existing "h_over" test but assert sentinel
    // values directly here to lock the Phase 1 branch in place.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', {
      position: vec3(0, 0, 0),
      fixed: true,
      orientation: quatAxisAngle(0, 0, 1, (60 * Math.PI) / 180),
    });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'h_phase1',
          kind: 'hinge',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
          limit: { minAngleDeg: -30, maxAngleDeg: 30 },
          // zeroAngleRef intentionally OMITTED → Phase 1 unsigned proxy.
        } as Mate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    // Same proxy behavior as the older test: ~30° beyond limit → ~0.524 rad.
    expect(r.residuals[0]!.residual).toBeGreaterThan(0.4);
    expect(r.residuals[0]!.residual).toBeLessThan(0.7);
  });

  it('signed swing computes gracefully when concentric residual > 0 (axes misaligned)', () => {
    // Side-A axis is +z; side-B axis is +y (90° misaligned). Free part has
    // an additional 45° yaw around its own +z (= world +y after solver
    // alignment would normally rotate the part, but here we freeze it).
    // The Phase 2 swing path uses the side-A world axis as the swing
    // axis (ag.world.direction), so the swing remains a finite measure
    // of A_world vs B_world's angle around side-A's axis — graceful, not
    // NaN. We just assert finite residual + supported=true.
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', {
      position: vec3(0, 0, 0),
      fixed: true,
      orientation: IDENTITY_QUAT,
    });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        {
          id: 'h_misaligned',
          kind: 'hinge',
          a: ref('f', 'ax_f', 'axis'),
          b: ref('g', 'ax_g', 'axis'),
          limit: { minAngleDeg: -180, maxAngleDeg: 180 },
          zeroAngleRef: {
            a: vec3(1, 0, 0),
            b: vec3(1, 0, 0),
            axisA: vec3(0, 0, 1),
            axisB: vec3(1, 0, 0), // matches side-B local axis
          },
        } as HingeMate,
      ],
    };
    const refs = new Map<string, { local: ResolvedGeometry }>([
      ['f/ax_f', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      // side-B axis in world is +y → genuinely misaligned with side-A's +z.
      ['g/ax_g', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 1, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(true);
    // Residual must be finite; the concentric alignErr dominates here
    // (perpendicular axes intersecting at origin → align distance 0, but
    // the part can't be moved because it's fixed; key check is "no NaN").
    expect(Number.isFinite(r.residuals[0]!.residual)).toBe(true);
  });
});
