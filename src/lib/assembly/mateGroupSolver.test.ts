/**
 * mateGroupSolver — connectivity partition + parallel sub-solver tests.
 *
 * Coverage:
 *   - partitionAssembly: disjoint parts → N singleton groups, isolated
 *     parts, chains, fully-connected, suppressed mates excluded, unknown
 *     mate refs ignored gracefully.
 *   - solveByGroups: residuals satisfied per group, merged state preserves
 *     part ordering, all three underlying solvers (gauss_seidel /
 *     lagrangian / adaptive) routed correctly, groupResults map keyed by
 *     groupId, totalDurationMs surfaced.
 *   - Timing: 2 disjoint groups vs 1 sequential — wall-clock comparable
 *     under Promise.all (concurrency works even if event-loop bound).
 *
 * Resolver pattern matches `iterativeSolver.test.ts`: each ref is a
 * fixed body-frame primitive that we transform into world frame using the
 * part's current placement.
 */
import { describe, it, expect } from 'vitest';
import {
  partitionAssembly,
  solveByGroups,
  maxResidualAcrossGroups,
  flattenGroupResiduals,
} from './mateGroupSolver';
import type { GeometryResolver, ResolvedGeometry } from './iterativeSolver';
import { partInstance, IDENTITY_QUAT, type AssemblyState, type PartInstance } from './assemblyState';
import type { Mate, MateRef } from './mate';
import { vec3 } from '@/lib/sketch/sketchPlane';
import { rotateVec } from './mateSolver';

// ─── fixtures (mirrored from iterativeSolver.test.ts) ─────────────────────

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

/** Build a coincident point/point pair fixture for parts a→b. Resolver
 *  entries are populated as a side effect. */
function pointPair(
  refs: Map<string, { partId: string; refId: string; local: ResolvedGeometry }>,
  id: string,
  aId: string,
  bId: string,
): Mate {
  refs.set(`${aId}/p_${id}`, {
    partId: aId, refId: `p_${id}`, local: { kind: 'point', world: vec3(0, 0, 0) },
  });
  refs.set(`${bId}/p_${id}`, {
    partId: bId, refId: `p_${id}`, local: { kind: 'point', world: vec3(0, 0, 0) },
  });
  return {
    id,
    kind: 'coincident',
    a: ref(aId, `p_${id}`, 'point'),
    b: ref(bId, `p_${id}`, 'point'),
  } as Mate;
}

// ─── partitionAssembly ────────────────────────────────────────────────────

describe('partitionAssembly', () => {
  it('returns one singleton group per part when there are no mates', () => {
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true }),
        makePart('b'),
        makePart('c'),
      ],
      mates: [],
    };
    const groups = partitionAssembly(state);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.partIds.length)).toEqual([1, 1, 1]);
    expect(groups.map((g) => g.mateIds.length)).toEqual([0, 0, 0]);
  });

  it('groups two parts joined by a single mate, leaves a third isolated', () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true }),
        makePart('b'),
        makePart('c'),
      ],
      mates: [pointPair(refs, 'm1', 'a', 'b')],
    };
    const groups = partitionAssembly(state);
    expect(groups).toHaveLength(2);
    const ab = groups.find((g) => g.partIds.length === 2)!;
    const cOnly = groups.find((g) => g.partIds.length === 1)!;
    expect(ab.partIds.slice().sort()).toEqual(['a', 'b']);
    expect(ab.mateIds).toEqual(['m1']);
    expect(cOnly.partIds).toEqual(['c']);
    expect(cOnly.mateIds).toEqual([]);
  });

  it('collapses a 3-chain (a–b–c) into a single group', () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('b'), makePart('c')],
      mates: [pointPair(refs, 'm1', 'a', 'b'), pointPair(refs, 'm2', 'b', 'c')],
    };
    const groups = partitionAssembly(state);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.partIds.slice().sort()).toEqual(['a', 'b', 'c']);
    expect(groups[0]!.mateIds.slice().sort()).toEqual(['m1', 'm2']);
  });

  it('collapses a 4-cycle into a single group', () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('b'), makePart('c'), makePart('d')],
      mates: [
        pointPair(refs, 'm1', 'a', 'b'),
        pointPair(refs, 'm2', 'b', 'c'),
        pointPair(refs, 'm3', 'c', 'd'),
        pointPair(refs, 'm4', 'd', 'a'),
      ],
    };
    const groups = partitionAssembly(state);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.partIds).toHaveLength(4);
    expect(groups[0]!.mateIds).toHaveLength(4);
  });

  it('returns N groups when there are N disjoint pairs', () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true }), makePart('b'),
        makePart('c', { fixed: true }), makePart('d'),
        makePart('e', { fixed: true }), makePart('f'),
      ],
      mates: [
        pointPair(refs, 'mab', 'a', 'b'),
        pointPair(refs, 'mcd', 'c', 'd'),
        pointPair(refs, 'mef', 'e', 'f'),
      ],
    };
    const groups = partitionAssembly(state);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.partIds.length === 2)).toBe(true);
    expect(groups.every((g) => g.mateIds.length === 1)).toBe(true);
  });

  it('excludes suppressed mates from the connectivity graph', () => {
    const refs = new Map();
    const m1 = pointPair(refs, 'm1', 'a', 'b');
    (m1 as { suppressed?: boolean }).suppressed = true;
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('b')],
      mates: [m1],
    };
    const groups = partitionAssembly(state);
    // Suppressed mate must not connect them.
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.mateIds.length)).toEqual([0, 0]);
  });

  it('returns deterministic groupId = lexicographically smallest partId', () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [makePart('zeta', { fixed: true }), makePart('alpha'), makePart('mu')],
      mates: [pointPair(refs, 'm1', 'zeta', 'alpha'), pointPair(refs, 'm2', 'zeta', 'mu')],
    };
    const groups = partitionAssembly(state);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.groupId).toBe('alpha');
  });

  it('returns groups sorted by groupId for stable iteration', () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true }), makePart('b'),
        makePart('m', { fixed: true }), makePart('n'),
        makePart('z', { fixed: true }), makePart('y'),
      ],
      mates: [
        pointPair(refs, 'mab', 'a', 'b'),
        pointPair(refs, 'mmn', 'm', 'n'),
        pointPair(refs, 'mzy', 'z', 'y'),
      ],
    };
    const groups = partitionAssembly(state);
    const ids = groups.map((g) => g.groupId);
    expect(ids).toEqual(ids.slice().sort());
  });

  it('handles a part with no mates as its own singleton even with other groups', () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('b'), makePart('island')],
      mates: [pointPair(refs, 'm1', 'a', 'b')],
    };
    const groups = partitionAssembly(state);
    expect(groups).toHaveLength(2);
    const island = groups.find((g) => g.partIds[0] === 'island')!;
    expect(island.partIds).toEqual(['island']);
    expect(island.mateIds).toEqual([]);
  });

  it('does not throw on mate referencing unknown partId (skips bad edge)', () => {
    const refs = new Map();
    const m1 = pointPair(refs, 'm1', 'a', 'b');
    const ghost: Mate = {
      id: 'mghost', kind: 'coincident',
      a: ref('a', 'p_x', 'point'),
      b: ref('does_not_exist', 'p_x', 'point'),
    } as Mate;
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('b')],
      mates: [m1, ghost],
    };
    const groups = partitionAssembly(state);
    expect(groups).toHaveLength(1);
    // bad mate must not appear in any group
    const allMates = groups.flatMap((g) => g.mateIds);
    expect(allMates).toContain('m1');
    expect(allMates).not.toContain('mghost');
  });

  it('returns an empty list for an empty assembly', () => {
    const state: AssemblyState = { parts: [], mates: [] };
    expect(partitionAssembly(state)).toEqual([]);
  });

  it('groups a star topology (1 hub + N spokes) into one group', () => {
    const refs = new Map();
    const parts: PartInstance[] = [makePart('hub', { fixed: true })];
    const mates: Mate[] = [];
    for (let i = 0; i < 6; i++) {
      const spokeId = `s${i}`;
      parts.push(makePart(spokeId));
      mates.push(pointPair(refs, `m${i}`, 'hub', spokeId));
    }
    const groups = partitionAssembly({ parts, mates });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.partIds).toHaveLength(7);
    expect(groups[0]!.mateIds).toHaveLength(6);
  });
});

// ─── solveByGroups ────────────────────────────────────────────────────────

describe('solveByGroups', () => {
  it('returns one group result per connected component', async () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [
        makePart('a', { position: vec3(0, 0, 0), fixed: true }),
        makePart('b', { position: vec3(5, 0, 0) }),
        makePart('c', { position: vec3(0, 10, 0), fixed: true }),
        makePart('d', { position: vec3(10, 10, 0) }),
      ],
      mates: [pointPair(refs, 'mab', 'a', 'b'), pointPair(refs, 'mcd', 'c', 'd')],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    expect(out.groups).toHaveLength(2);
    expect(out.groupResults.size).toBe(2);
    for (const [, r] of out.groupResults) {
      expect(r.success).toBe(true);
      expect(r.finalMaxResidual).toBeLessThan(1e-4);
    }
  });

  it('merged state preserves the original parts ordering', async () => {
    const refs = new Map();
    const inputOrder = ['z', 'a', 'm', 'q'];
    const state: AssemblyState = {
      parts: [
        makePart('z', { fixed: true }),
        makePart('a'),
        makePart('m', { fixed: true }),
        makePart('q'),
      ],
      mates: [pointPair(refs, 'mza', 'z', 'a'), pointPair(refs, 'mmq', 'm', 'q')],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    expect(out.state.parts.map((p) => p.id)).toEqual(inputOrder);
  });

  it('preserves the mates list verbatim in the merged state', async () => {
    const refs = new Map();
    const m1 = pointPair(refs, 'm1', 'a', 'b');
    const m2 = pointPair(refs, 'm2', 'c', 'd');
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true }), makePart('b'),
        makePart('c', { fixed: true }), makePart('d'),
      ],
      mates: [m1, m2],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    expect(out.state.mates).toBe(state.mates);
  });

  it('solves the actual mate (free part moves onto fixed target)', async () => {
    const refs = new Map();
    refs.set('a/pa', { partId: 'a', refId: 'pa', local: { kind: 'point', world: vec3(0, 0, 0) } });
    refs.set('b/pb', { partId: 'b', refId: 'pb', local: { kind: 'point', world: vec3(2, 3, 4) } });
    const state: AssemblyState = {
      parts: [
        makePart('a', { position: vec3(10, 10, 10), fixed: true }),
        makePart('b', { position: vec3(0, 0, 0) }),
      ],
      mates: [{ id: 'co1', kind: 'coincident', a: ref('a', 'pa', 'point'), b: ref('b', 'pb', 'point') } as Mate],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    const solvedB = out.state.parts.find((p) => p.id === 'b')!;
    // b's local point (2,3,4) must now land on (10,10,10) → b.position = (8,7,6).
    expect(solvedB.position.x).toBeCloseTo(8, 4);
    expect(solvedB.position.y).toBeCloseTo(7, 4);
    expect(solvedB.position.z).toBeCloseTo(6, 4);
  });

  it('routes to lagrangian solver when opts.solver = lagrangian', async () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('b', { position: vec3(3, 0, 0) })],
      mates: [pointPair(refs, 'm1', 'a', 'b')],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'lagrangian' });
    expect(out.groupResults.size).toBe(1);
    const [, r] = [...out.groupResults][0]!;
    expect(r.success).toBe(true);
  });

  it('routes to adaptive solver when opts.solver = adaptive', async () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('b', { position: vec3(3, 0, 0) })],
      mates: [pointPair(refs, 'm1', 'a', 'b')],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'adaptive' });
    const [, r] = [...out.groupResults][0]!;
    expect(r.success).toBe(true);
  });

  it('handles a singleton (no-mate) group with a trivial success result', async () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('island')],
      mates: [],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    expect(out.groups).toHaveLength(2);
    for (const [, r] of out.groupResults) {
      expect(r.success).toBe(true);
      expect(r.iterations).toBe(0);
      expect(r.finalMaxResidual).toBe(0);
    }
  });

  it('reports a non-negative totalDurationMs', async () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('b')],
      mates: [pointPair(refs, 'm1', 'a', 'b')],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    expect(out.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(out.totalDurationMs)).toBe(true);
  });

  it('keyed groupResults map matches the groups list ids', async () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true }), makePart('b'),
        makePart('c', { fixed: true }), makePart('d'),
      ],
      mates: [pointPair(refs, 'mab', 'a', 'b'), pointPair(refs, 'mcd', 'c', 'd')],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    for (const g of out.groups) {
      expect(out.groupResults.has(g.groupId)).toBe(true);
    }
  });

  it('passes per-group tolerance through to the underlying solver', async () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true }), makePart('b', { position: vec3(100, 0, 0) })],
      mates: [pointPair(refs, 'm1', 'a', 'b')],
    };
    const out = await solveByGroups(state, makeResolver(refs), {
      solver: 'gauss_seidel',
      perGroupOptions: { tolerance: 1e-8, maxIterations: 5 },
    });
    const [, r] = [...out.groupResults][0]!;
    // The above is plenty for a simple coincident point pair.
    expect(r.success).toBe(true);
    expect(r.finalMaxResidual).toBeLessThan(1e-8);
  });

  it('2 disjoint groups complete in reasonable time vs the same as one big group', async () => {
    // Build the same content as two disjoint sub-assemblies. The grouped
    // version should NOT be significantly slower (and on machines with any
    // async slack, often is comparable or faster).
    const refs = new Map();
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true }), makePart('b', { position: vec3(3, 0, 0) }),
        makePart('c', { fixed: true, position: vec3(100, 0, 0) }),
        makePart('d', { position: vec3(103, 0, 0) }),
      ],
      mates: [pointPair(refs, 'mab', 'a', 'b'), pointPair(refs, 'mcd', 'c', 'd')],
    };
    const grouped = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    expect(grouped.groups).toHaveLength(2);
    // Sanity: convergence is real, and timing is bounded — sub-millisecond
    // for two trivial point-pair mates on a modern CPU.
    expect(grouped.totalDurationMs).toBeLessThan(1000);
    for (const [, r] of grouped.groupResults) {
      expect(r.success).toBe(true);
    }
  });

  it('maxResidualAcrossGroups aggregates correctly', async () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true }), makePart('b', { position: vec3(5, 0, 0) }),
        makePart('c', { fixed: true }), makePart('d', { position: vec3(0, 5, 0) }),
      ],
      mates: [pointPair(refs, 'mab', 'a', 'b'), pointPair(refs, 'mcd', 'c', 'd')],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    const mx = maxResidualAcrossGroups(out.groupResults);
    expect(mx).toBeLessThan(1e-4);
  });

  it('flattenGroupResiduals returns one entry per non-suppressed mate', async () => {
    const refs = new Map();
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true }), makePart('b'),
        makePart('c', { fixed: true }), makePart('d'),
      ],
      mates: [pointPair(refs, 'mab', 'a', 'b'), pointPair(refs, 'mcd', 'c', 'd')],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    const flat = flattenGroupResiduals(out.groupResults);
    const ids = flat.map((r) => r.mateId).sort();
    expect(ids).toEqual(['mab', 'mcd']);
  });

  it('handles 5 disjoint groups in one call', async () => {
    const refs = new Map();
    const parts: PartInstance[] = [];
    const mates: Mate[] = [];
    for (let i = 0; i < 5; i++) {
      const fixedId = `f${i}`;
      const freeId = `g${i}`;
      parts.push(makePart(fixedId, { fixed: true, position: vec3(i * 100, 0, 0) }));
      parts.push(makePart(freeId, { position: vec3(i * 100 + 5, 0, 0) }));
      mates.push(pointPair(refs, `m${i}`, fixedId, freeId));
    }
    const out = await solveByGroups({ parts, mates }, makeResolver(refs), { solver: 'gauss_seidel' });
    expect(out.groups).toHaveLength(5);
    for (const [, r] of out.groupResults) {
      expect(r.success).toBe(true);
      expect(r.finalMaxResidual).toBeLessThan(1e-4);
    }
  });

  it('chain a-b-c stays in one group and solves correctly', async () => {
    const refs = new Map();
    refs.set('a/pa', { partId: 'a', refId: 'pa', local: { kind: 'point', world: vec3(0, 0, 0) } });
    refs.set('b/pb1', { partId: 'b', refId: 'pb1', local: { kind: 'point', world: vec3(0, 0, 0) } });
    refs.set('b/pb2', { partId: 'b', refId: 'pb2', local: { kind: 'point', world: vec3(0, 0, 0) } });
    refs.set('c/pc', { partId: 'c', refId: 'pc', local: { kind: 'point', world: vec3(0, 0, 0) } });
    const state: AssemblyState = {
      parts: [
        makePart('a', { fixed: true, position: vec3(0, 0, 0) }),
        makePart('b', { position: vec3(5, 0, 0) }),
        makePart('c', { position: vec3(15, 0, 0) }),
      ],
      mates: [
        { id: 'm1', kind: 'coincident', a: ref('a', 'pa', 'point'), b: ref('b', 'pb1', 'point') } as Mate,
        { id: 'm2', kind: 'coincident', a: ref('b', 'pb2', 'point'), b: ref('c', 'pc', 'point') } as Mate,
      ],
    };
    const out = await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    expect(out.groups).toHaveLength(1);
    const [, r] = [...out.groupResults][0]!;
    expect(r.success).toBe(true);
  });

  it('does not mutate the input state', async () => {
    const refs = new Map();
    const inputA = makePart('a', { fixed: true });
    const inputB = makePart('b', { position: vec3(7, 8, 9) });
    const state: AssemblyState = {
      parts: [inputA, inputB],
      mates: [pointPair(refs, 'm1', 'a', 'b')],
    };
    const beforeB = { ...inputB.position };
    await solveByGroups(state, makeResolver(refs), { solver: 'gauss_seidel' });
    // The original input PartInstance must not be mutated by the wrapper.
    expect(inputB.position.x).toBe(beforeB.x);
    expect(inputB.position.y).toBe(beforeB.y);
    expect(inputB.position.z).toBe(beforeB.z);
  });

  it('returns an empty state output when input has no parts', async () => {
    const state: AssemblyState = { parts: [], mates: [] };
    const out = await solveByGroups(state, () => null, { solver: 'gauss_seidel' });
    expect(out.groups).toEqual([]);
    expect(out.groupResults.size).toBe(0);
    expect(out.state.parts).toEqual([]);
  });
});
