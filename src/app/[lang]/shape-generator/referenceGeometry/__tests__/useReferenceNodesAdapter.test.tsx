// @vitest-environment jsdom
/**
 * useReferenceNodesAdapter.test.tsx — React hook layer around store + solver.
 *
 * Tests the integration of the Zustand store with the dep-solver-based
 * adapter. We use `renderHook` from @testing-library/react to drive the
 * hook directly.
 *
 * Also covers `computeReferenceNodesView` (the pure compute helper that
 * the hook wraps), since that's the function the host's tree pane will
 * call after a `.nfab` load — before the store is hydrated.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useReferenceGeometryStore,
  _resetReferenceGeometryStore,
} from '../store';
import {
  useReferenceNodesAdapter,
  computeReferenceNodesView,
} from '../useReferenceNodesAdapter';
import type { ReferencePlaneNode } from '../types';

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

function offsetNode(id: string, parentId: string): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'offset',
    label: id,
    hidden: false,
    dependsOn: [parentId],
    evaluatedAt: 0,
    params: {
      method: 'offset',
      parent: { kind: 'reference', nodeId: parentId },
      distanceMm: 10,
      direction: 1,
    },
  };
}

describe('computeReferenceNodesView — pure', () => {
  it('empty input → empty view', () => {
    const v = computeReferenceNodesView([]);
    expect(v.orderedNodes).toEqual([]);
    expect(v.issues).toEqual([]);
    expect(v.hasCycle).toBe(false);
  });

  it('toposorts parents before children', () => {
    // Input: child first, parent second. View must reorder.
    const child = offsetNode('child', 'parent');
    const parent = planeNode('parent');
    const v = computeReferenceNodesView([child, parent]);
    const ids = v.orderedNodes.map((n) => n.id);
    expect(ids.indexOf('parent')).toBeLessThan(ids.indexOf('child'));
  });

  it('surfaces parent_missing issues', () => {
    const orphan = offsetNode('orphan', 'ghost'); // ghost doesn't exist
    const v = computeReferenceNodesView([orphan]);
    expect(v.issues.length).toBeGreaterThan(0);
    expect(v.issues[0].code).toBe('parent_missing');
    expect(v.issues[0].nodeId).toBe('orphan');
    expect(v.issues[0].detail).toBe('ghost');
  });

  it('detects a cycle and flags every participating node', () => {
    // Manually crafted cycle a → b → a (store would normally reject this,
    // but we may receive a corrupted graph on CRDT merge per spec §7.4).
    const a = offsetNode('a', 'b');
    const b = offsetNode('b', 'a');
    const v = computeReferenceNodesView([a, b]);
    expect(v.hasCycle).toBe(true);
    const cycleIssues = v.issues.filter((i) => i.code === 'cycle');
    const ids = new Set(cycleIssues.map((i) => i.nodeId));
    expect(ids.has('a') && ids.has('b')).toBe(true);
  });

  it('keeps cycle-participant nodes in orderedNodes (no silent drop)', () => {
    const a = offsetNode('a', 'b');
    const b = offsetNode('b', 'a');
    const v = computeReferenceNodesView([a, b]);
    expect(v.orderedNodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
});

describe('useReferenceNodesAdapter — React hook', () => {
  beforeEach(() => {
    _resetReferenceGeometryStore();
  });

  it('returns empty view from an empty store', () => {
    const { result } = renderHook(() => useReferenceNodesAdapter());
    expect(result.current.orderedNodes).toEqual([]);
    expect(result.current.issues).toEqual([]);
    expect(result.current.hasCycle).toBe(false);
  });

  it('re-runs when the store updates', () => {
    const { result } = renderHook(() => useReferenceNodesAdapter());
    expect(result.current.orderedNodes).toEqual([]);
    act(() => {
      useReferenceGeometryStore.getState().add(planeNode('a'));
    });
    expect(result.current.orderedNodes.map((n) => n.id)).toEqual(['a']);
  });

  it('orders parents before children after store inserts', () => {
    const { result } = renderHook(() => useReferenceNodesAdapter());
    act(() => {
      // Insert child first (store records insertion order); adapter must
      // still emit parent-first.
      useReferenceGeometryStore.getState().add(planeNode('parent'));
      useReferenceGeometryStore.getState().add(offsetNode('child', 'parent'));
    });
    const ids = result.current.orderedNodes.map((n) => n.id);
    expect(ids.indexOf('parent')).toBeLessThan(ids.indexOf('child'));
  });
});
