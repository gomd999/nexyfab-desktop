/**
 * store.test.ts — Zustand `useReferenceGeometryStore` invariants.
 *
 * Pure logic test. We poke `setState` / `getState` directly instead of
 * rendering React, because the store is environment-agnostic (no DOM
 * needed). The companion `useReferenceNodesAdapter.test.tsx` covers the
 * React hook layer with `@testing-library/react`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useReferenceGeometryStore,
  _resetReferenceGeometryStore,
} from '../store';
import type { ReferencePlaneNode, ReferenceAxisNode } from '../types';

/** Helper: build a standard-Front plane node by id. */
function planeNode(
  id: string,
  dependsOn: readonly string[] = [],
): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'standard',
    label: id,
    hidden: false,
    dependsOn,
    evaluatedAt: 0,
    params: { method: 'standard', id: 'front' },
  };
}

function offsetNode(
  id: string,
  parentNodeId: string,
  distanceMm: number,
): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'offset',
    label: id,
    hidden: false,
    dependsOn: [parentNodeId],
    evaluatedAt: 0,
    params: {
      method: 'offset',
      parent: { kind: 'reference', nodeId: parentNodeId },
      distanceMm,
      direction: 1,
    },
  };
}

function axisNode(id: string): ReferenceAxisNode {
  return {
    id,
    kind: 'axis',
    method: 'standard',
    label: id,
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'standard', id: 'x' },
  };
}

describe('useReferenceGeometryStore — basics', () => {
  beforeEach(() => {
    _resetReferenceGeometryStore();
  });

  it('starts empty', () => {
    expect(useReferenceGeometryStore.getState().nodes).toEqual([]);
  });

  it('add() inserts a node and returns true', () => {
    const ok = useReferenceGeometryStore.getState().add(planeNode('a'));
    expect(ok).toBe(true);
    expect(useReferenceGeometryStore.getState().nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('add() rejects duplicate ids without mutating state', () => {
    useReferenceGeometryStore.getState().add(planeNode('a'));
    const before = useReferenceGeometryStore.getState().nodes;
    const ok = useReferenceGeometryStore.getState().add(planeNode('a'));
    expect(ok).toBe(false);
    // Same reference — no mutation happened.
    expect(useReferenceGeometryStore.getState().nodes).toBe(before);
  });

  it('add() preserves insertion order across multiple inserts', () => {
    const s = useReferenceGeometryStore.getState();
    s.add(planeNode('a'));
    s.add(planeNode('b'));
    s.add(planeNode('c'));
    expect(useReferenceGeometryStore.getState().nodes.map((n) => n.id)).toEqual([
      'a', 'b', 'c',
    ]);
  });

  it('add() accepts mixed kinds (plane + axis)', () => {
    const s = useReferenceGeometryStore.getState();
    expect(s.add(planeNode('p1'))).toBe(true);
    expect(s.add(axisNode('a1'))).toBe(true);
    const kinds = useReferenceGeometryStore.getState().nodes.map((n) => n.kind);
    expect(kinds).toEqual(['plane', 'axis']);
  });

  it('remove() drops an existing node', () => {
    const s = useReferenceGeometryStore.getState();
    s.add(planeNode('a'));
    s.add(planeNode('b'));
    s.remove('a');
    expect(useReferenceGeometryStore.getState().nodes.map((n) => n.id)).toEqual(['b']);
  });

  it('remove() is no-op on unknown id', () => {
    const s = useReferenceGeometryStore.getState();
    s.add(planeNode('a'));
    s.remove('nope');
    expect(useReferenceGeometryStore.getState().nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('clear() empties the list', () => {
    const s = useReferenceGeometryStore.getState();
    s.add(planeNode('a'));
    s.add(planeNode('b'));
    s.clear();
    expect(useReferenceGeometryStore.getState().nodes).toEqual([]);
  });

  it('replaceAll() swaps the entire list', () => {
    const s = useReferenceGeometryStore.getState();
    s.add(planeNode('a'));
    s.replaceAll([planeNode('x'), planeNode('y')]);
    expect(useReferenceGeometryStore.getState().nodes.map((n) => n.id)).toEqual(['x', 'y']);
  });
});

describe('useReferenceGeometryStore — cycle prevention', () => {
  beforeEach(() => {
    _resetReferenceGeometryStore();
  });

  it('add() rejects a self-loop', () => {
    const s = useReferenceGeometryStore.getState();
    const ok = s.add(offsetNode('a', 'a', 10));
    expect(ok).toBe(false);
  });

  it('add() rejects when new node would close a cycle with existing graph', () => {
    const s = useReferenceGeometryStore.getState();
    // a (root) → b (depends on a) → would add c that depends on b and force a→c
    s.add(planeNode('a'));
    s.add(offsetNode('b', 'a', 10));
    // Now build a node 'c' that depends on b, and patch 'a' to depend on c.
    // We can't patch a's dependsOn directly via add — but we can simulate by
    // adding c then asking update() to add a self-cycle via a.
    s.add(offsetNode('c', 'b', 5));
    // Updating 'a' to depend on 'c' would create a → c → b → a cycle.
    const ok = s.update('a', { dependsOn: ['c'] });
    expect(ok).toBe(false);
    // State unchanged.
    expect(useReferenceGeometryStore.getState().nodes.find((n) => n.id === 'a')!.dependsOn).toEqual([]);
  });
});

describe('useReferenceGeometryStore — update()', () => {
  beforeEach(() => {
    _resetReferenceGeometryStore();
  });

  it('update() patches label without touching params', () => {
    const s = useReferenceGeometryStore.getState();
    s.add(planeNode('a'));
    const ok = s.update('a', { label: 'My Front Plane' });
    expect(ok).toBe(true);
    expect(useReferenceGeometryStore.getState().nodes[0].label).toBe('My Front Plane');
  });

  it('update() recomputes dependsOn when params change', () => {
    const s = useReferenceGeometryStore.getState();
    s.add(planeNode('a'));
    s.add(planeNode('b'));
    // Update 'b' to be an offset of 'a' — dependsOn must reflect that.
    const ok = s.update('b', {
      method: 'offset',
      params: {
        method: 'offset',
        parent: { kind: 'reference', nodeId: 'a' },
        distanceMm: 20,
        direction: 1,
      },
    });
    expect(ok).toBe(true);
    expect(useReferenceGeometryStore.getState().nodes.find((n) => n.id === 'b')!.dependsOn).toEqual(['a']);
  });

  it('update() returns false on unknown id', () => {
    const s = useReferenceGeometryStore.getState();
    expect(s.update('nope', { label: 'x' })).toBe(false);
  });

  it('update() rejects a kind change', () => {
    const s = useReferenceGeometryStore.getState();
    s.add(planeNode('a'));
    // Try to morph a plane into an axis — store must refuse to keep
    // downstream PlaneRef consumers safe.
    const ok = s.update('a', { kind: 'axis' });
    expect(ok).toBe(false);
    expect(useReferenceGeometryStore.getState().nodes[0].kind).toBe('plane');
  });

  it('update() rejects an id change', () => {
    const s = useReferenceGeometryStore.getState();
    s.add(planeNode('a'));
    const ok = s.update('a', { id: 'a2' });
    expect(ok).toBe(false);
    expect(useReferenceGeometryStore.getState().nodes[0].id).toBe('a');
  });
});
