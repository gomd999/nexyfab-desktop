/**
 * Phase 3.2.3 — extended mate kinds (parallel/perpendicular/distance/angle).
 */
import { describe, it, expect } from 'vitest';
import { iterativeSolve, type GeometryResolver, type ResolvedGeometry } from './iterativeSolver';
import { partInstance, IDENTITY_QUAT, type AssemblyState, type PartInstance } from './assemblyState';
import type { Mate, MateRef } from './mate';
import { vec3 } from '@/lib/sketch/sketchPlane';
import { rotateVec } from './mateSolver';

function ref(partId: string, refId: string, refKind: MateRef['refKind']): MateRef {
  return { partId, refId, refKind };
}

function makePart(id: string, fixed = false, position = vec3(0, 0, 0)): PartInstance {
  return partInstance({
    id, name: id, partTemplateId: 'tpl', position, orientation: IDENTITY_QUAT, fixed,
  });
}

function makeResolver(refs: Map<string, ResolvedGeometry>): GeometryResolver {
  return (r, part) => {
    const local = refs.get(`${r.partId}/${r.refId}`);
    if (!local) return null;
    return transformInWorld(local, part);
  };
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
  if (local.kind === 'plane') {
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
  return local;
}

// ─── parallel ─────────────────────────────────────────────────────────────

describe('parallel mate', () => {
  it('aligns moved axis to be parallel with fixed axis', () => {
    const fixed = makePart('f', true);
    const free = makePart('g');
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'pa', kind: 'parallel', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    expect(r.residuals.find((rr) => rr.mateId === 'pa')!.supported).toBe(true);
  });
});

// ─── perpendicular ───────────────────────────────────────────────────────

describe('perpendicular mate', () => {
  it('residual drops dramatically after solve (perpendicular = |a·b| ≈ 0)', () => {
    const fixed = makePart('f', true);
    const free = makePart('g');
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'pe', kind: 'perpendicular', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      // Start at 30° (cos=0.5) — solver should rotate to 90° (cos=0).
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0) } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    // Residual = |a · b|. Starting cos was ~0.866; expect << 0.01 after solve.
    const peResidual = r.residuals.find((rr) => rr.mateId === 'pe')!.residual;
    expect(peResidual).toBeLessThan(0.01);
  });
});

// ─── distance plane/plane ────────────────────────────────────────────────

describe('distance plane/plane mate', () => {
  it('translates moved plane to target gap from fixed', () => {
    const fixed = makePart('f', true);
    const free = makePart('g', false, vec3(0, 0, 5));
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'd', kind: 'distance', a: ref('f', 'pl', 'plane'), b: ref('g', 'pl', 'plane'), value: 20 } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
      ['g/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    const movedG = r.state.parts.find((p) => p.id === 'g')!;
    // g started at z=5; with target 20mm from fixed plane at z=0,
    // g should end at z=20.
    expect(movedG.position.z).toBeCloseTo(20, 3);
  });
});

// ─── distance point/point ────────────────────────────────────────────────

describe('distance point/point mate', () => {
  it('positions moved point at target distance from fixed point', () => {
    const fixed = makePart('f', true);
    const free = makePart('g', false, vec3(10, 0, 0));
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'd', kind: 'distance', a: ref('f', 'p', 'point'), b: ref('g', 'p', 'point'), value: 25 } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/p', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    const movedG = r.state.parts.find((p) => p.id === 'g')!;
    // g should end 25 units along the original (positive-x) direction.
    expect(Math.hypot(movedG.position.x, movedG.position.y, movedG.position.z)).toBeCloseTo(25, 3);
  });
});

// ─── angle ────────────────────────────────────────────────────────────────

describe('angle mate', () => {
  it('residual drops toward target angle after solve', () => {
    const fixed = makePart('f', true);
    const free = makePart('g');
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'an', kind: 'angle', a: ref('f', 'ax', 'axis'), b: ref('g', 'ax', 'axis'), value: 60 } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      // Start at 30° from x-axis; target 60°.
      ['f/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } }],
      ['g/ax', { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0) } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    // Residual = |currentAngle - targetAngle|. Should be small after solve.
    const anRes = r.residuals.find((rr) => rr.mateId === 'an')!.residual;
    expect(anRes).toBeLessThan(0.01);
  });
});

// ─── supported flag for all extended kinds ───────────────────────────────

describe('isAnalyticallySupported', () => {
  it('parallel, perpendicular, distance, angle all report supported=true', () => {
    const fixed = makePart('f', true);
    const free = makePart('g');
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'pa', kind: 'parallel', a: ref('f', 'pl', 'plane'), b: ref('g', 'pl', 'plane') } as Mate,
        { id: 'pe', kind: 'perpendicular', a: ref('f', 'pl', 'plane'), b: ref('g', 'pl', 'plane') } as Mate,
        { id: 'd', kind: 'distance', a: ref('f', 'p', 'point'), b: ref('g', 'p', 'point'), value: 10 } as Mate,
        { id: 'an', kind: 'angle', a: ref('f', 'pl', 'plane'), b: ref('g', 'pl', 'plane'), value: 30 } as Mate,
      ],
    };
    const refs = new Map<string, ResolvedGeometry>([
      ['f/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } }],
      ['g/pl', { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 1, 0) } }],
      ['f/p', { kind: 'point', world: vec3(0, 0, 0) }],
      ['g/p', { kind: 'point', world: vec3(0, 0, 0) }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs), { maxIterations: 200 });
    for (const id of ['pa', 'pe', 'd', 'an']) {
      const res = r.residuals.find((rr) => rr.mateId === id);
      expect(res?.supported).toBe(true);
    }
  });
});
