import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { commandHistory } from '../CommandHistory';
import {
  makeArrayAddCommand,
  makeArrayRemoveCommand,
  makeArrayUpdateCommand,
  makeToggleCommand,
  makeInsertStandardPartCommand,
  makePlacePartWithMatesCommand,
  makeRemoveFeatureCommand,
  snapshotFeatureTree,
  createFeatureParamCoalescer,
} from '../undoableCommands';
import type { HistoryNode } from '../../useFeatureStack';

/** In-memory stand-in for useYjsMapAsArray's setter (functional or plain). */
function makeStore<T>(initial: T[] = []) {
  const store = { items: initial };
  const set = (action: T[] | ((prev: T[]) => T[])) => {
    store.items = typeof action === 'function' ? (action as (prev: T[]) => T[])(store.items) : action;
  };
  return { store, set };
}

interface Mate { id: string; type: string; partA: string; partB: string; locked: boolean; value?: number }

const mate = (id: string, over: Partial<Mate> = {}): Mate =>
  ({ id, type: 'coincident', partA: 'a', partB: 'b', locked: false, ...over });

describe('undoableCommands — assembly array commands', () => {
  beforeEach(() => {
    commandHistory.clear();
  });

  it('mate add: execute appends, undo removes, redo re-adds (idempotent execute)', () => {
    const { store, set } = makeStore<Mate>([mate('m1')]);
    commandHistory.execute(makeArrayAddCommand({
      commandId: 'mate-add-m2', label: 'Add mate', labelKo: '메이트 추가',
      items: [mate('m2')], set,
    }));
    expect(store.items.map(m => m.id)).toEqual(['m1', 'm2']);
    commandHistory.undo();
    expect(store.items.map(m => m.id)).toEqual(['m1']);
    commandHistory.redo();
    expect(store.items.map(m => m.id)).toEqual(['m1', 'm2']);
  });

  it('mate remove: undo restores the captured item snapshot', () => {
    const removed = mate('m1', { type: 'distance', value: 12 });
    const { store, set } = makeStore<Mate>([removed, mate('m2')]);
    commandHistory.execute(makeArrayRemoveCommand({
      commandId: 'mate-remove-m1', label: 'Remove mate', labelKo: '메이트 제거',
      item: removed, set,
    }));
    expect(store.items.map(m => m.id)).toEqual(['m2']);
    commandHistory.undo();
    expect(store.items).toContainEqual(removed);
    // Undo twice must not duplicate (guarded re-add)
    commandHistory.redo();
    commandHistory.undo();
    expect(store.items.filter(m => m.id === 'm1')).toHaveLength(1);
  });

  it('mate update: undo restores the full pre-edit item', () => {
    const before = mate('m1', { type: 'distance', value: 5 });
    const { store, set } = makeStore<Mate>([before]);
    commandHistory.execute(makeArrayUpdateCommand({
      commandId: 'mate-update-m1', label: 'Edit mate', labelKo: '메이트 수정',
      before, updates: { value: 42 }, set,
    }));
    expect(store.items[0].value).toBe(42);
    commandHistory.undo();
    expect(store.items[0]).toEqual(before);
  });

  it('toggle command is self-inverse across undo/redo', () => {
    const { store, set } = makeStore<Mate>([mate('m1')]);
    const toggle = () => set(prev => prev.map(m => m.id === 'm1' ? { ...m, locked: !m.locked } : m));
    commandHistory.execute(makeToggleCommand({
      commandId: 'mate-lock-m1', label: 'Toggle mate lock', labelKo: '메이트 잠금 전환', toggle,
    }));
    expect(store.items[0].locked).toBe(true);
    commandHistory.undo();
    expect(store.items[0].locked).toBe(false);
    commandHistory.redo();
    expect(store.items[0].locked).toBe(true);
  });
});

describe('undoableCommands — COTS insert / smart placement', () => {
  beforeEach(() => {
    commandHistory.clear();
  });

  it('COTS insert undo removes both the placedPart and its bom entry', () => {
    const parts = makeStore<{ id: string; name: string }>([]);
    const bom = makeStore<{ name: string }>([]);
    const bomEntry = { name: 'M3 bolt' };
    commandHistory.execute(makeInsertStandardPartCommand({
      commandId: 'insert-standard-part-p1', label: 'Insert M3 bolt', labelKo: 'M3 bolt 삽입',
      part: { id: 'p1', name: 'M3 bolt' }, setParts: parts.set,
      bomEntry, setBom: bom.set,
    }));
    expect(parts.store.items).toHaveLength(1);
    expect(bom.store.items).toHaveLength(1);
    commandHistory.undo();
    expect(parts.store.items).toHaveLength(0);
    expect(bom.store.items).toHaveLength(0);
    commandHistory.redo();
    expect(parts.store.items.map(p => p.id)).toEqual(['p1']);
    expect(bom.store.items).toEqual([bomEntry]);
  });

  it('drag-place with smart mates undoes part + mates as ONE step', () => {
    const parts = makeStore<{ id: string }>([{ id: 'base' }]);
    const mates = makeStore<Mate>([]);
    commandHistory.execute(makePlacePartWithMatesCommand({
      commandId: 'place-standard-part-p2', label: 'Place standard part', labelKo: '규격 부품 배치',
      part: { id: 'p2' }, setParts: parts.set,
      mates: [mate('mc1', { partB: 'p2' }), mate('mc2', { type: 'concentric', partB: 'p2' })],
      setMates: mates.set,
    }));
    expect(parts.store.items).toHaveLength(2);
    expect(mates.store.items).toHaveLength(2);
    expect(commandHistory.past).toHaveLength(1); // single undo step
    commandHistory.undo();
    expect(parts.store.items.map(p => p.id)).toEqual(['base']);
    expect(mates.store.items).toHaveLength(0);
  });
});

describe('undoableCommands — remove feature (full tree restore)', () => {
  beforeEach(() => {
    commandHistory.clear();
  });

  const node = (id: string, over: Partial<HistoryNode> = {}): HistoryNode => ({
    id, type: 'feature', label: id, icon: '🔧', featureType: 'fillet',
    params: { radius: 3 }, enabled: true, expanded: true,
    parentId: null, children: [], editingActive: false, timestamp: 1,
    ...over,
  });

  it('undo restores nodes/rootId/activeNodeId via replaceHistory (not re-add at end)', () => {
    const root = node('root', { type: 'baseShape', featureType: undefined, children: ['f1'] });
    const f1 = node('f1', {
      parentId: 'root',
      children: ['f2'],
      edgeSelections: [{ featureId: 'x' } as unknown as NonNullable<HistoryNode['edgeSelections']>[number]],
    });
    const f2 = node('f2', { parentId: 'f1' });
    const snapshot = snapshotFeatureTree([root, f1, f2], 'root', 'f2');

    const removed: string[] = [];
    let restoredWith: { nodes: HistoryNode[]; rootId: string; activeNodeId: string } | null = null;

    commandHistory.execute(makeRemoveFeatureCommand({
      commandId: 'remove-feature-f1', label: 'Remove feature', labelKo: '피처 제거',
      featureId: 'f1',
      snapshot,
      removeFeature: (id) => removed.push(id),
      replaceHistory: (nodes, rootId, activeNodeId) => { restoredWith = { nodes, rootId, activeNodeId }; },
    }));
    expect(removed).toEqual(['f1']);

    commandHistory.undo();
    expect(restoredWith).not.toBeNull();
    const r = restoredWith!;
    expect(r.rootId).toBe('root');
    expect(r.activeNodeId).toBe('f2');
    expect(r.nodes.map(n => n.id)).toEqual(['root', 'f1', 'f2']); // original position kept
    const restoredF1 = r.nodes.find(n => n.id === 'f1')!;
    expect(restoredF1.edgeSelections).toHaveLength(1); // selections preserved
    expect(restoredF1.children).toEqual(['f2']); // descendants preserved
  });
});

describe('undoableCommands — feature param coalescing (commit-on-settle)', () => {
  beforeEach(() => {
    commandHistory.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Minimal feature-stack stand-in (params map per featureId). */
  function makeFeatureStore(initial: Record<string, Record<string, number>>) {
    const featureParams: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(initial));
    const coalescer = createFeatureParamCoalescer({
      getParams: (fid) => featureParams[fid] ?? null,
      applyParam: (fid, key, value) => { featureParams[fid] = { ...featureParams[fid], [key]: value }; },
      restoreParams: (fid, params) => { featureParams[fid] = { ...params }; },
      push: (cmd) => commandHistory.execute(cmd),
    });
    return { featureParams, coalescer };
  }

  it('two rapid edits to the same key → ONE command; undo restores original', () => {
    const { featureParams, coalescer } = makeFeatureStore({ f1: { radius: 3 } });
    coalescer.edit('f1', 'radius', 5);
    coalescer.edit('f1', 'radius', 8);
    expect(featureParams.f1.radius).toBe(8); // applied live
    expect(commandHistory.past).toHaveLength(0); // not yet settled
    vi.advanceTimersByTime(500);
    expect(commandHistory.past).toHaveLength(1); // one coalesced step
    commandHistory.undo();
    expect(featureParams.f1.radius).toBe(3); // back to pre-drag value
    commandHistory.redo();
    expect(featureParams.f1.radius).toBe(8);
  });

  it('editing a different key flushes the previous pending edit first', () => {
    const { featureParams, coalescer } = makeFeatureStore({ f1: { radius: 3, depth: 10 } });
    coalescer.edit('f1', 'radius', 7);
    coalescer.edit('f1', 'depth', 20); // different key → radius edit committed now
    expect(commandHistory.past).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(commandHistory.past).toHaveLength(2);
    commandHistory.undo(); // undo depth
    expect(featureParams.f1).toEqual({ radius: 7, depth: 10 });
    commandHistory.undo(); // undo radius
    expect(featureParams.f1).toEqual({ radius: 3, depth: 10 });
  });

  it('cp_* sibling keys (NURBS control-point drag) coalesce into one step', () => {
    const { featureParams, coalescer } = makeFeatureStore({ f1: { cp_0_x: 0, cp_0_y: 0, cp_0_z: 0 } });
    coalescer.edit('f1', 'cp_0_x', 1);
    coalescer.edit('f1', 'cp_0_y', 2);
    coalescer.edit('f1', 'cp_0_z', 3);
    vi.advanceTimersByTime(500);
    expect(commandHistory.past).toHaveLength(1);
    commandHistory.undo();
    expect(featureParams.f1).toEqual({ cp_0_x: 0, cp_0_y: 0, cp_0_z: 0 });
  });

  it('flush() commits a pending edit immediately (pre-undo drain hook)', () => {
    const { featureParams, coalescer } = makeFeatureStore({ f1: { radius: 3 } });
    coalescer.edit('f1', 'radius', 9);
    coalescer.flush(); // e.g. Ctrl+Z within the settle window
    expect(commandHistory.past).toHaveLength(1);
    commandHistory.undo();
    expect(featureParams.f1.radius).toBe(3);
  });

  it('no-op round trip (value back to start) pushes nothing', () => {
    const { coalescer } = makeFeatureStore({ f1: { radius: 3 } });
    coalescer.edit('f1', 'radius', 5);
    coalescer.edit('f1', 'radius', 3);
    vi.advanceTimersByTime(500);
    expect(commandHistory.past).toHaveLength(0);
  });
});
