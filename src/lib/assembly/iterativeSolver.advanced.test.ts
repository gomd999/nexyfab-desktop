/**
 * iterativeSolver — Phase 3.2.5 advanced-mate placeholder coverage.
 *
 * The 4 advanced mate kinds (hinge / slot / gear / rack_pinion) have IR
 * support but NO analytical solver yet. The iterative solver must:
 *   - report `supported=false` for them in residuals,
 *   - not crash when given an assembly containing one,
 *   - leave the free part's placement essentially untouched (since no
 *     analytical correction fires).
 *
 * Analytical placements for these arrive in a follow-up Phase 3.2.6 task.
 */
import { describe, it, expect } from 'vitest';
import { iterativeSolve, type GeometryResolver, type ResolvedGeometry } from './iterativeSolver';
import {
  partInstance,
  IDENTITY_QUAT,
  type AssemblyState,
  type PartInstance,
} from './assemblyState';
import type { Mate, MateRef } from './mate';
import { vec3 } from '@/lib/sketch/sketchPlane';
import { rotateVec } from './mateSolver';

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
  opts: { position?: { x: number; y: number; z: number }; fixed?: boolean } = {},
): PartInstance {
  return partInstance({
    id,
    name: id,
    partTemplateId: 'tpl',
    position: opts.position ?? vec3(0, 0, 0),
    orientation: IDENTITY_QUAT,
    fixed: opts.fixed,
  });
}

function ref(partId: string, refId: string, refKind: MateRef['refKind']): MateRef {
  return { partId, refId, refKind };
}

// ─── solver-side coverage for advanced mates ─────────────────────────────

describe('iterativeSolve — advanced mate placeholders', () => {
  it('hinge mate is reported supported=false and does not crash the solver', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
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
    expect(r.residuals[0]!.supported).toBe(false);
  });

  it('slot mate is reported supported=false and does not crash the solver', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(3, 0, 0) });
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
      // Slot edge is exposed as an axis-like resolved geometry (the solver
      // currently doesn't unpack 'edge' specially — this is fine; we only
      // care that the call doesn't throw and that supported=false is set).
      ['f/slot_e', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
      ['g/pin_ax', { local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals).toHaveLength(1);
    expect(r.residuals[0]!.mateId).toBe('s1');
    expect(r.residuals[0]!.supported).toBe(false);
  });

  it('gear mate is reported supported=false and does not crash the solver', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(10, 0, 0) });
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
    expect(r.residuals[0]!.supported).toBe(false);
  });

  it('rack_pinion mate is reported supported=false and does not crash the solver', () => {
    const fixed = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const free = makePart('g', { position: vec3(0, 5, 0) });
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
    expect(r.residuals[0]!.supported).toBe(false);
  });
});
