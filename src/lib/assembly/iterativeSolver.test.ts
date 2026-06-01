/**
 * iterativeSolver — multi-mate Gauss-Seidel relaxation tests.
 */
import { describe, it, expect } from 'vitest';
import { iterativeSolve, type GeometryResolver, type ResolvedGeometry } from './iterativeSolver';
import { partInstance, IDENTITY_QUAT, type AssemblyState, type PartInstance } from './assemblyState';
import type { Mate, MateRef } from './mate';
import { vec3 } from '@/lib/sketch/sketchPlane';
import { rotateVec } from './mateSolver';

// ─── test fixtures ────────────────────────────────────────────────────────

/** Build a resolver where each ref is a fixed local primitive transformed
 *  by the part's placement. */
function makeResolver(
  refs: Map<string, { partId: string; refId: string; local: ResolvedGeometry }>,
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
    const rotatedOrigin = rotateVec(local.world.origin, part.orientation);
    const rotatedDir = rotateVec(local.world.direction, part.orientation);
    return {
      kind: 'axis',
      world: {
        origin: {
          x: part.position.x + rotatedOrigin.x,
          y: part.position.y + rotatedOrigin.y,
          z: part.position.z + rotatedOrigin.z,
        },
        direction: rotatedDir,
      },
    };
  }
  if (local.kind === 'plane') {
    const rotatedOrigin = rotateVec(local.world.origin, part.orientation);
    const rotatedNormal = rotateVec(local.world.normal, part.orientation);
    return {
      kind: 'plane',
      world: {
        origin: {
          x: part.position.x + rotatedOrigin.x,
          y: part.position.y + rotatedOrigin.y,
          z: part.position.z + rotatedOrigin.z,
        },
        normal: rotatedNormal,
      },
    };
  }
  return local;
}

function makePart(id: string, opts: { position?: { x: number; y: number; z: number }; fixed?: boolean } = {}): PartInstance {
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

// ─── tests ────────────────────────────────────────────────────────────────

describe('iterativeSolve — single concentric mate', () => {
  it('converges in 1 iteration (analytical), residual ~0', () => {
    const fixed = makePart('f', { position: vec3(5, 5, 0), fixed: true });
    const free = makePart('g', { position: vec3(10, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'c1', kind: 'concentric', a: ref('f', 'ax_f', 'axis'), b: ref('g', 'ax_g', 'axis') } as Mate,
      ],
    };
    const refs = new Map<string, { partId: string; refId: string; local: ResolvedGeometry }>([
      ['f/ax_f', { partId: 'f', refId: 'ax_f', local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) } } }],
      ['g/ax_g', { partId: 'g', refId: 'ax_g', local: { kind: 'axis', world: { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    expect(r.finalMaxResidual).toBeLessThan(1e-4);
  });
});

describe('iterativeSolve — coincident point/point', () => {
  it('moves free part so its named point lands on the fixed part target', () => {
    const fixed = makePart('f', { position: vec3(10, 10, 10), fixed: true });
    const free = makePart('g', { position: vec3(0, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'co1', kind: 'coincident', a: ref('f', 'p_f', 'point'), b: ref('g', 'p_g', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, { partId: string; refId: string; local: ResolvedGeometry }>([
      ['f/p_f', { partId: 'f', refId: 'p_f', local: { kind: 'point', world: vec3(0, 0, 0) } }],
      ['g/p_g', { partId: 'g', refId: 'p_g', local: { kind: 'point', world: vec3(2, 3, 4) } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.success).toBe(true);
    const movedG = r.state.parts.find((p) => p.id === 'g')!;
    // Local (2,3,4) on g should map to world (10,10,10).
    expect(movedG.position.x).toBeCloseTo(8, 4);
    expect(movedG.position.y).toBeCloseTo(7, 4);
    expect(movedG.position.z).toBeCloseTo(6, 4);
  });
});

describe('iterativeSolve — over-constrained warning', () => {
  it('reports unsupported mate kinds via residuals.supported=false', () => {
    const fixed = makePart('f', { fixed: true });
    const free = makePart('g');
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'par', kind: 'parallel', a: ref('f', 'f1', 'face'), b: ref('g', 'f2', 'face') } as Mate,
      ],
    };
    const refs = new Map<string, { partId: string; refId: string; local: ResolvedGeometry }>([
      ['f/f1', { partId: 'f', refId: 'f1', local: { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(0, 0, 1) } } }],
      ['g/f2', { partId: 'g', refId: 'f2', local: { kind: 'plane', world: { origin: vec3(0, 0, 0), normal: vec3(1, 0, 0) } } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs));
    expect(r.residuals[0]!.supported).toBe(false);
  });
});

describe('iterativeSolve — multi-mate chain', () => {
  it('two coincident point/point mates in a chain both satisfied', () => {
    const f = makePart('f', { position: vec3(0, 0, 0), fixed: true });
    const a = makePart('a', { position: vec3(0, 0, 0) });
    const b = makePart('b', { position: vec3(0, 0, 0) });
    const state: AssemblyState = {
      parts: [f, a, b],
      mates: [
        { id: 'm1', kind: 'coincident', a: ref('f', 'pf', 'point'), b: ref('a', 'pa', 'point') } as Mate,
        { id: 'm2', kind: 'coincident', a: ref('a', 'pa2', 'point'), b: ref('b', 'pb', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, { partId: string; refId: string; local: ResolvedGeometry }>([
      ['f/pf', { partId: 'f', refId: 'pf', local: { kind: 'point', world: vec3(10, 0, 0) } }],
      ['a/pa', { partId: 'a', refId: 'pa', local: { kind: 'point', world: vec3(0, 0, 0) } }],
      ['a/pa2', { partId: 'a', refId: 'pa2', local: { kind: 'point', world: vec3(5, 0, 0) } }],
      ['b/pb', { partId: 'b', refId: 'pb', local: { kind: 'point', world: vec3(0, 0, 0) } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs), { maxIterations: 50 });
    expect(r.success).toBe(true);
    expect(r.residuals.every((rr) => rr.residual < 1e-3)).toBe(true);
  });
});

describe('iterativeSolve — relaxation parameter', () => {
  it('relaxation=0.5 still converges (more iterations)', () => {
    const fixed = makePart('f', { fixed: true });
    const free = makePart('g', { position: vec3(20, 0, 0) });
    const state: AssemblyState = {
      parts: [fixed, free],
      mates: [
        { id: 'co1', kind: 'coincident', a: ref('f', 'p_f', 'point'), b: ref('g', 'p_g', 'point') } as Mate,
      ],
    };
    const refs = new Map<string, { partId: string; refId: string; local: ResolvedGeometry }>([
      ['f/p_f', { partId: 'f', refId: 'p_f', local: { kind: 'point', world: vec3(0, 0, 0) } }],
      ['g/p_g', { partId: 'g', refId: 'p_g', local: { kind: 'point', world: vec3(0, 0, 0) } }],
    ]);
    const r = iterativeSolve(state, makeResolver(refs), { relaxation: 0.5, maxIterations: 200 });
    expect(r.success).toBe(true);
  });
});
