/**
 * ConfigStore.test.ts — A5 adapter cases.
 *
 * Both modes (local + Yjs) implement the same interface. We exercise:
 *  - local mode mirrors ConfigurationTable behaviour
 *  - Yjs mode mutations roundtrip through the doc and survive a snapshot rebuild
 *  - migrateToYjs preserves state
 *  - subscribe / unsubscribe fires correctly
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { ConfigStore, migrateToYjs } from '../ConfigStore';
import { readAllConfigs, readActiveConfigId } from '../configStoreYjs';
import { ConfigurationTable } from '../ConfigurationTable';
import type { FeatureInstance } from '../../features/types';

function feat(id: string, params: Record<string, number>): FeatureInstance {
  return { id, type: 'fillet' as unknown as FeatureInstance['type'], params, enabled: true };
}

describe('ConfigStore.local — basic mirroring of ConfigurationTable', () => {
  it('mode is "local"', () => {
    const s = ConfigStore.local();
    expect(s.mode).toBe('local');
  });

  it('add() creates an entry with a generated id', () => {
    const s = ConfigStore.local();
    const a = s.add('Small');
    expect(a.id).toBe('cfg-0');
    expect(s.list()).toHaveLength(1);
  });

  it('add() auto-activates the first config', () => {
    const s = ConfigStore.local();
    expect(s.getActiveId()).toBeNull();
    s.add('A');
    expect(s.getActiveId()).toBe('cfg-0');
  });

  it('remove() drops the entry', () => {
    const s = ConfigStore.local();
    s.add('A', { id: 'a' });
    expect(s.remove('a')).toBe(true);
    expect(s.list()).toHaveLength(0);
  });

  it('rename() updates the name', () => {
    const s = ConfigStore.local();
    s.add('Old', { id: 'a' });
    s.rename('a', 'New');
    expect(s.get('a')!.name).toBe('New');
  });

  it('activate(null) clears the active id', () => {
    const s = ConfigStore.local();
    s.add('A');
    s.activate(null);
    expect(s.getActiveId()).toBeNull();
  });

  it('setParent applies and refuses cycles', () => {
    const s = ConfigStore.local();
    s.add('A', { id: 'a' });
    s.add('B', { id: 'b' });
    expect(s.setParent('b', 'a')).toEqual({ ok: true });
    const cycle = s.setParent('a', 'b');
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) {
      expect(cycle.error).toBe('cycle');
    }
  });

  it('setOverride / clearOverride round-trip', () => {
    const s = ConfigStore.local();
    s.add('A', { id: 'a' });
    s.setOverride('a', 'f1', 'r', 5);
    expect(s.get('a')!.overrides.f1).toEqual({ params: { r: 5 } });
    s.clearOverride('a', 'f1', 'r');
    expect(s.get('a')!.overrides.f1).toBeUndefined();
  });

  it('setSuppressed sets the flag', () => {
    const s = ConfigStore.local();
    s.add('A', { id: 'a' });
    s.setSuppressed('a', 'f1', true);
    expect(s.get('a')!.overrides.f1!.suppressed).toBe(true);
  });

  it('global vars round-trip', () => {
    const s = ConfigStore.local();
    s.setGlobalVar('D', 25);
    expect(s.getGlobalVars()).toEqual({ D: 25 });
  });

  it('resolveActive returns master features when no config active', () => {
    const s = ConfigStore.local();
    s.add('A', { id: 'a' });
    s.activate(null);
    const features = [feat('f1', { r: 5 })];
    const out = s.resolveActive(features);
    expect(out).toEqual(features);
  });

  it('resolveActive applies overrides from active config', () => {
    const s = ConfigStore.local();
    s.add('A', { id: 'a' });
    s.setOverride('a', 'f1', 'r', 10);
    const out = s.resolveActive([feat('f1', { r: 5 })]);
    expect(out[0]!.params.r).toBe(10);
  });

  it('toJSON returns a clean snapshot', () => {
    const s = ConfigStore.local();
    s.add('A', { id: 'a' });
    s.setGlobalVar('D', 25);
    const snap = s.toJSON();
    expect(snap.configs).toHaveLength(1);
    expect(snap.activeConfigId).toBe('a');
    expect(snap.globalVars).toEqual({ D: 25 });
  });

  it('initial ConfigurationTable instance survives the constructor', () => {
    const t = new ConfigurationTable();
    t.add('Pre', { id: 'pre' });
    const s = ConfigStore.local(t);
    expect(s.list().map(e => e.id)).toEqual(['pre']);
  });

  it('initial snapshot survives the constructor', () => {
    const t = new ConfigurationTable();
    t.add('Pre', { id: 'pre' });
    const s = ConfigStore.local(t.toJSON());
    expect(s.list().map(e => e.id)).toEqual(['pre']);
  });

  it('subscribe fires on add / remove', () => {
    const s = ConfigStore.local();
    let count = 0;
    const unsub = s.subscribe(() => { count += 1; });
    s.add('A');
    s.add('B');
    s.remove('cfg-0');
    expect(count).toBe(3);
    unsub();
    s.add('C');
    expect(count).toBe(3);
  });

  it('getTable returns the wrapped ConfigurationTable', () => {
    const t = new ConfigurationTable();
    t.add('X', { id: 'x' });
    const s = ConfigStore.local(t);
    expect(s.getTable()).toBe(t);
  });
});

describe('ConfigStore.fromYDoc — Yjs mode roundtrips', () => {
  it('mode is "yjs"', () => {
    const s = ConfigStore.fromYDoc(new Y.Doc());
    expect(s.mode).toBe('yjs');
  });

  it('add() lands in the underlying doc', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.add('A', { id: 'a' });
    expect(readAllConfigs(doc).map(e => e.id)).toEqual(['a']);
  });

  it('add() auto-activates first config (parity with local)', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.add('A');
    expect(s.getActiveId()).toBe('cfg-0');
  });

  it('remove() lands in the underlying doc', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.add('A', { id: 'a' });
    expect(s.remove('a')).toBe(true);
    expect(readAllConfigs(doc)).toEqual([]);
  });

  it('rename() lands in the underlying doc', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.add('Old', { id: 'a' });
    s.rename('a', 'New');
    expect(s.get('a')!.name).toBe('New');
  });

  it('setOverride lands in the underlying doc', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.add('A', { id: 'a' });
    s.setOverride('a', 'f1', 'r', 5);
    expect(s.get('a')!.overrides.f1).toEqual({ params: { r: 5 } });
  });

  it('setParent applies and surfaces cycle path on refusal', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.add('A', { id: 'a' });
    s.add('B', { id: 'b' });
    s.add('C', { id: 'c' });
    s.setParent('b', 'a');
    s.setParent('c', 'b');
    const r = s.setParent('a', 'c');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('cycle');
      expect(r.cyclePath).toBeDefined();
    }
  });

  it('setParent surfaces unknown_config / unknown_parent', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.add('A', { id: 'a' });
    expect(s.setParent('nope', 'a')).toEqual({ ok: false, error: 'unknown_config' });
    expect(s.setParent('a', 'nope')).toEqual({ ok: false, error: 'unknown_parent' });
  });

  it('global vars round-trip', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.setGlobalVar('D', 25);
    expect(s.getGlobalVars()).toEqual({ D: 25 });
  });

  it('resolveActive applies overrides from active config', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.add('A', { id: 'a' });
    s.setOverride('a', 'f1', 'r', 10);
    const out = s.resolveActive([feat('f1', { r: 5 })]);
    expect(out[0]!.params.r).toBe(10);
  });

  it('subscribe fires on doc update', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    let count = 0;
    const unsub = s.subscribe(() => { count += 1; });
    s.add('A');
    s.add('B');
    expect(count).toBeGreaterThanOrEqual(2);
    unsub();
  });

  it('nextId picks the first free slot', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    s.add('A'); // cfg-0
    s.add('B'); // cfg-1
    s.remove('cfg-0');
    const c = s.add('C'); // should be cfg-0 again (first free)
    expect(c.id).toBe('cfg-0');
  });

  it('getDoc returns the wrapped Y.Doc', () => {
    const doc = new Y.Doc();
    const s = ConfigStore.fromYDoc(doc);
    expect(s.getDoc?.()).toBe(doc);
  });
});

describe('migrateToYjs — preserves local state', () => {
  it('moves configs + activeId + globalVars into the doc', () => {
    const local = ConfigStore.local();
    local.add('A', { id: 'a' });
    local.add('B', { id: 'b' });
    local.setParent('b', 'a');
    local.setOverride('a', 'f1', 'r', 7);
    local.setSuppressed('b', 'f2', true);
    local.activate('b');
    local.setGlobalVar('D', 25);

    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);

    expect(yjs.mode).toBe('yjs');
    expect(readActiveConfigId(doc)).toBe('b');
    const configs = readAllConfigs(doc).sort((x, y) => x.id.localeCompare(y.id));
    expect(configs).toHaveLength(2);
    expect(configs.find(e => e.id === 'b')!.parentId).toBe('a');
    expect(configs.find(e => e.id === 'a')!.overrides.f1).toEqual({ params: { r: 7 } });
    expect(configs.find(e => e.id === 'b')!.overrides.f2).toEqual({ suppressed: true });
    expect(yjs.getGlobalVars()).toEqual({ D: 25 });
  });

  it('throws when source store is already in yjs mode', () => {
    const yjs = ConfigStore.fromYDoc(new Y.Doc());
    expect(() => migrateToYjs(yjs, new Y.Doc())).toThrow(/local mode/);
  });

  it('migrating an empty local store yields an empty yjs store', () => {
    const local = ConfigStore.local();
    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);
    expect(yjs.list()).toEqual([]);
    expect(yjs.getActiveId()).toBeNull();
  });
});
