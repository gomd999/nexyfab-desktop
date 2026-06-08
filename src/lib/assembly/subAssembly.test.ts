/**
 * Phase 3.5 — sub-assembly hierarchy tests.
 */
import { describe, it, expect } from 'vitest';
import { subAssemblyRef, flattenAssembly, exposedRefs, type NestedAssemblyState } from './subAssembly';
import { partInstance, IDENTITY_QUAT, type AssemblyState } from './assemblyState';
import type { Mate } from './mate';
import { vec3 } from '@/lib/sketch/sketchPlane';

function makePart(id: string, position: { x: number; y: number; z: number } = vec3(0, 0, 0), fixed = false) {
  return partInstance({
    id,
    name: id,
    partTemplateId: 'template',
    position,
    orientation: IDENTITY_QUAT,
    fixed,
  });
}

function concentric(id: string, partA: string, partB: string): Mate {
  return {
    id, kind: 'concentric',
    a: { partId: partA, refId: 'a1', refKind: 'axis' },
    b: { partId: partB, refId: 'a2', refKind: 'axis' },
  };
}

describe('subAssemblyRef', () => {
  it('builds with sensible defaults (identity orientation, origin, rigid=true)', () => {
    const inner: AssemblyState = { parts: [makePart('p1', vec3(0, 0, 0), true)], mates: [] };
    const sub = subAssemblyRef({ id: 's1', name: 'Sub 1', state: inner });
    expect(sub.id).toBe('s1');
    expect(sub.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(sub.orientation).toEqual(IDENTITY_QUAT);
    expect(sub.rigid).toBe(true);
  });
});

describe('flattenAssembly', () => {
  it('no sub-assemblies: returns the input unchanged', () => {
    const state: NestedAssemblyState = {
      parts: [makePart('p1', vec3(0, 0, 0), true), makePart('p2')],
      mates: [],
    };
    const flat = flattenAssembly(state);
    expect(flat.parts.length).toBe(2);
    expect(flat.parts[0]!.id).toBe('p1');
    expect(flat.parts[1]!.id).toBe('p2');
  });

  it('one FLEXIBLE sub-assembly: parts get sub-id prefixed; internal mates preserved', () => {
    const inner: AssemblyState = {
      parts: [makePart('a', vec3(1, 2, 3), true), makePart('b', vec3(5, 5, 5))],
      mates: [concentric('m1', 'a', 'b')],
    };
    const parent: NestedAssemblyState = {
      parts: [makePart('chassis', vec3(0, 0, 0), true)],
      mates: [],
      // rigid:false → the parent solver should still see the sub's internal mate.
      subs: [subAssemblyRef({ id: 'mech', name: 'Mechanism', state: inner, rigid: false })],
    };
    const flat = flattenAssembly(parent);
    expect(flat.parts.map((p) => p.id)).toEqual(['chassis', 'mech/a', 'mech/b']);
    // Sub-assembly mate id is prefixed too.
    expect(flat.mates[0]!.id).toBe('mech/m1');
    // Sub-assembly mate refs are remapped to flat part ids.
    expect(flat.mates[0]!.a.partId).toBe('mech/a');
    expect(flat.mates[0]!.b.partId).toBe('mech/b');
  });

  it('RIGID sub-assembly: internal mates are dropped (A2 constraint reduction)', () => {
    const inner: AssemblyState = {
      parts: [makePart('a', vec3(1, 2, 3), true), makePart('b', vec3(5, 5, 5))],
      mates: [concentric('m1', 'a', 'b')],
    };
    const parent: NestedAssemblyState = {
      parts: [makePart('chassis', vec3(0, 0, 0), true)],
      // A parent-level mate referencing a sub part survives; only the sub's
      // OWN internal mates collapse away.
      mates: [concentric('pm', 'chassis', 'chassis')],
      subs: [subAssemblyRef({ id: 'rigid', name: 'Rigid', state: inner, rigid: true })],
    };
    const flat = flattenAssembly(parent);
    // Both inner parts present + frozen, but the inner mate 'rigid/m1' is gone.
    expect(flat.parts.map((p) => p.id)).toEqual(['chassis', 'rigid/a', 'rigid/b']);
    expect(flat.parts.every((p) => (p.id.startsWith('rigid/') ? p.fixed : true))).toBe(true);
    expect(flat.mates.map((m) => m.id)).toEqual(['pm']); // parent mate kept, inner dropped
    expect(flat.mates.some((m) => m.id === 'rigid/m1')).toBe(false);
  });

  it('rigid sub: all internal parts are marked fixed in the flattened output', () => {
    const inner: AssemblyState = {
      parts: [makePart('a', vec3(0, 0, 0), true), makePart('b', vec3(5, 0, 0), false)],
      mates: [],
    };
    const parent: NestedAssemblyState = {
      parts: [makePart('chassis', vec3(0, 0, 0), true)],
      mates: [],
      subs: [subAssemblyRef({ id: 'rigid', name: 'Rigid', state: inner, rigid: true })],
    };
    const flat = flattenAssembly(parent);
    // 'rigid/b' was not fixed in the inner, but rigid sub-assembly freezes it.
    const bFlat = flat.parts.find((p) => p.id === 'rigid/b');
    expect(bFlat?.fixed).toBe(true);
  });

  it('flexible sub: preserves the inner fixed flags', () => {
    const inner: AssemblyState = {
      parts: [makePart('a', vec3(0, 0, 0), true), makePart('b', vec3(5, 0, 0), false)],
      mates: [],
    };
    const parent: NestedAssemblyState = {
      parts: [makePart('chassis', vec3(0, 0, 0), true)],
      mates: [],
      subs: [subAssemblyRef({ id: 'flex', name: 'Flex', state: inner, rigid: false })],
    };
    const flat = flattenAssembly(parent);
    const bFlat = flat.parts.find((p) => p.id === 'flex/b');
    expect(bFlat?.fixed).toBe(false);
  });

  it('sub-assembly placement: translates inner part positions by sub.position', () => {
    const inner: AssemblyState = {
      parts: [makePart('a', vec3(1, 0, 0), true), makePart('b', vec3(2, 0, 0))],
      mates: [],
    };
    const parent: NestedAssemblyState = {
      parts: [],
      mates: [],
      subs: [
        subAssemblyRef({
          id: 'sub',
          name: 'Shifted',
          state: { ...inner, parts: [makePart('a', vec3(1, 0, 0), true)] }, // need 1 fixed
          position: vec3(10, 0, 0),
        }),
      ],
    };
    const flat = flattenAssembly(parent);
    const a = flat.parts.find((p) => p.id === 'sub/a');
    // Inner a was at (1, 0, 0); shifted by sub origin (10, 0, 0) → (11, 0, 0).
    expect(a?.position.x).toBe(11);
  });

  it('nested 2 levels: ids get path-prefixed at each level', () => {
    const leaf: AssemblyState = { parts: [makePart('leaf', vec3(0, 0, 0), true)], mates: [] };
    const mid: NestedAssemblyState = {
      parts: [makePart('mid_p', vec3(0, 0, 0), true)],
      mates: [],
      subs: [subAssemblyRef({ id: 'leaf_sub', name: 'Leaf', state: leaf })],
    };
    const root: NestedAssemblyState = {
      parts: [],
      mates: [],
      subs: [subAssemblyRef({ id: 'mid_sub', name: 'Mid', state: mid })],
    };
    const flat = flattenAssembly(root);
    const ids = flat.parts.map((p) => p.id);
    expect(ids).toContain('mid_sub/mid_p');
    expect(ids).toContain('mid_sub/leaf_sub/leaf');
  });
});

describe('exposedRefs', () => {
  it('lists one entry per inner part with the sub path prefix', () => {
    const inner: AssemblyState = {
      parts: [makePart('a', vec3(0, 0, 0), true), makePart('b')],
      mates: [],
    };
    const sub = subAssemblyRef({ id: 's', name: 'S', state: inner });
    const refs = exposedRefs(sub);
    expect(refs.length).toBe(2);
    expect(refs[0]!.path).toBe('s/a');
    expect(refs[1]!.path).toBe('s/b');
    expect(refs[0]!.refId).toBe('origin');
  });
});
