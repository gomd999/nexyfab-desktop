import { describe, expect, it } from 'vitest';
import { createAssemblyRestorePatch, createAssemblySnapshot, type AssemblySnapshotState } from './assemblySnapshotController';

const state: AssemblySnapshotState = { placedParts: [{ id: 'p1', name: 'Part', shapeId: 'box', params: { width: 2 }, qty: 1, position: [1, 2, 3], rotation: [0, 0, 4], fixed: true }], mates: [{ id: 'm1', type: 'coincident', partA: 'p1', partB: 'p2', locked: true }], bodies: [{ id: 'b1', name: 'Body', color: '#fff', visible: true, locked: false }], activeBodyId: 'missing', selectedBodyIds: ['b1', 'missing'], hiddenParts: new Set(['p1']), transparentParts: new Set(), partColors: { p1: '#abc' } };

describe('assemblySnapshotController', () => {
  it('creates detached snapshots and preserves optional display state', () => {
    const snapshot = createAssemblySnapshot(state);
    expect(snapshot).toMatchObject({ activeBodyId: 'missing', selectedBodyIds: ['b1', 'missing'], hiddenParts: ['p1'], partColors: { p1: '#abc' } });
    state.placedParts[0]!.params.width = 9;
    expect(snapshot.placedParts[0]!.params.width).toBe(2);
  });

  it('restores with cloned collections and validates body selection', () => {
    const patch = createAssemblyRestorePatch(createAssemblySnapshot(state));
    expect(patch.activeBodyId).toBe('b1');
    expect(patch.selectedBodyIds).toEqual(['b1']);
    patch.hiddenParts.add('p2');
    expect(state.hiddenParts.has('p2')).toBe(false);
  });

  it('resets an omitted snapshot', () => {
    expect(createAssemblyRestorePatch()).toEqual({ placedParts: [], mates: [], bodies: [], activeBodyId: null, selectedBodyIds: [], hiddenParts: new Set(), transparentParts: new Set(), partColors: {} });
  });

  it('does not invoke hostile getters', () => {
    let executed = false;
    const hostile = Object.create(Object.prototype, { placedParts: { get: () => { executed = true; return []; } }, mates: { value: [] } });
    const patch = createAssemblyRestorePatch(hostile as never);
    expect(executed).toBe(false);
    expect(patch.placedParts).toEqual([]);
  });
});
