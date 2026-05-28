/**
 * configStoreYjs.test.ts — A5 unit cases for the Y-helper layer.
 *
 * Covers the Y.Map ↔ ConfigEntry encoding, every applyConfigOp branch,
 * top-level meta-map reads, and cycle rejection in setParent. Plain
 * Y.Doc instances — no React, no IndexedDB, no transport.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applyConfigOp,
  getActiveConfigMap,
  getConfigsRoot,
  getGlobalVarsMap,
  readActiveConfigId,
  readAllConfigs,
  readConfig,
  readGlobalVars,
  snapshotToYDoc,
  populateDoc,
  syncDocs,
  configsEqual,
  ORIGIN_LOCAL_UI,
  ORIGIN_IMPORT_NFAB,
  ORIGIN_REMOTE_UPDATE,
} from '../configStoreYjs';
import type { ConfigEntry } from '../types';

function blankEntry(id: string, name?: string): ConfigEntry {
  return { id, name: name ?? id, overrides: {}, expressionVars: {} };
}

describe('configStoreYjs — accessors', () => {
  it('getConfigsRoot returns a fresh empty Y.Map', () => {
    const doc = new Y.Doc();
    const root = getConfigsRoot(doc);
    expect(root.size).toBe(0);
  });

  it('getActiveConfigMap returns a fresh empty Y.Map', () => {
    const doc = new Y.Doc();
    expect(getActiveConfigMap(doc).size).toBe(0);
  });

  it('getGlobalVarsMap returns a fresh empty Y.Map', () => {
    const doc = new Y.Doc();
    expect(getGlobalVarsMap(doc).size).toBe(0);
  });

  it('readActiveConfigId returns null on a fresh doc', () => {
    expect(readActiveConfigId(new Y.Doc())).toBeNull();
  });

  it('readAllConfigs returns [] on a fresh doc', () => {
    expect(readAllConfigs(new Y.Doc())).toEqual([]);
  });

  it('readGlobalVars returns {} on a fresh doc', () => {
    expect(readGlobalVars(new Y.Doc())).toEqual({});
  });

  it('readConfig returns null when id missing', () => {
    expect(readConfig(new Y.Doc(), 'nope')).toBeNull();
  });
});

describe('configStoreYjs — addConfig / readAllConfigs', () => {
  it('addConfig writes an entry observable via readAllConfigs', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('cfg-0', 'Small') });
    const list = readAllConfigs(doc);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('cfg-0');
    expect(list[0]!.name).toBe('Small');
    expect(list[0]!.overrides).toEqual({});
    expect(list[0]!.expressionVars).toEqual({});
    expect(list[0]!.parentId).toBeUndefined();
  });

  it('addConfig auto-activates the first config', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('cfg-0') });
    expect(readActiveConfigId(doc)).toBe('cfg-0');
  });

  it('addConfig does NOT re-activate when one is already active', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('cfg-0') });
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('cfg-1') });
    expect(readActiveConfigId(doc)).toBe('cfg-0');
  });

  it('addConfig with parentId encodes/decodes parent', () => {
    const doc = new Y.Doc();
    const entry: ConfigEntry = { id: 'b', name: 'B', parentId: 'a', overrides: {}, expressionVars: {} };
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'addConfig', entry });
    const list = readAllConfigs(doc);
    expect(list.find(e => e.id === 'b')!.parentId).toBe('a');
  });

  it('addConfig encodes overrides correctly', () => {
    const doc = new Y.Doc();
    const entry: ConfigEntry = {
      id: 'cfg-0',
      name: 'X',
      overrides: {
        feat1: { params: { radius: 5, label: 'big' } },
        feat2: { suppressed: true, params: { thickness: 2 } },
        feat3: { suppressed: false },
      },
      expressionVars: { D: 10 },
    };
    applyConfigOp(doc, { kind: 'addConfig', entry });
    const out = readAllConfigs(doc)[0]!;
    expect(out.overrides.feat1).toEqual({ params: { radius: 5, label: 'big' } });
    expect(out.overrides.feat2).toEqual({ suppressed: true, params: { thickness: 2 } });
    expect(out.overrides.feat3).toEqual({ suppressed: false });
    expect(out.expressionVars).toEqual({ D: 10 });
  });
});

describe('configStoreYjs — applyConfigOp branches', () => {
  it('removeConfig drops the entry and detaches children', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('p') });
    applyConfigOp(doc, { kind: 'addConfig', entry: { ...blankEntry('c'), parentId: 'p' } });
    applyConfigOp(doc, { kind: 'removeConfig', id: 'p' });
    const list = readAllConfigs(doc);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('c');
    expect(list[0]!.parentId).toBeUndefined();
  });

  it('removeConfig picks next active when the active one is removed', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('b') });
    expect(readActiveConfigId(doc)).toBe('a');
    applyConfigOp(doc, { kind: 'removeConfig', id: 'a' });
    expect(readActiveConfigId(doc)).toBe('b');
  });

  it('removeConfig returns applied=false for unknown id', () => {
    const doc = new Y.Doc();
    const r = applyConfigOp(doc, { kind: 'removeConfig', id: 'nope' });
    expect(r.applied).toBe(false);
  });

  it('renameConfig updates the name', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a', 'Old') });
    applyConfigOp(doc, { kind: 'renameConfig', id: 'a', name: 'New' });
    expect(readConfig(doc, 'a')!.name).toBe('New');
  });

  it('renameConfig returns applied=false for unknown id', () => {
    const r = applyConfigOp(new Y.Doc(), { kind: 'renameConfig', id: 'nope', name: 'X' });
    expect(r.applied).toBe(false);
  });

  it('setActive(null) clears the active id', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'setActive', id: null });
    expect(readActiveConfigId(doc)).toBeNull();
  });

  it('setActive switches active', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('b') });
    applyConfigOp(doc, { kind: 'setActive', id: 'b' });
    expect(readActiveConfigId(doc)).toBe('b');
  });

  it('setActive refuses unknown id', () => {
    const r = applyConfigOp(new Y.Doc(), { kind: 'setActive', id: 'nope' });
    expect(r.applied).toBe(false);
  });

  it('setOverride writes a param', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'setOverride', configId: 'a', featureId: 'f1', paramKey: 'r', value: 5 });
    expect(readConfig(doc, 'a')!.overrides.f1).toEqual({ params: { r: 5 } });
  });

  it('setOverride stacks multiple keys on same featureId', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'setOverride', configId: 'a', featureId: 'f1', paramKey: 'r', value: 5 });
    applyConfigOp(doc, { kind: 'setOverride', configId: 'a', featureId: 'f1', paramKey: 'd', value: 10 });
    expect(readConfig(doc, 'a')!.overrides.f1).toEqual({ params: { r: 5, d: 10 } });
  });

  it('setOverride for unknown config returns applied=false', () => {
    const r = applyConfigOp(new Y.Doc(), { kind: 'setOverride', configId: 'nope', featureId: 'f1', paramKey: 'r', value: 5 });
    expect(r.applied).toBe(false);
  });

  it('clearOverride drops a param', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'setOverride', configId: 'a', featureId: 'f1', paramKey: 'r', value: 5 });
    applyConfigOp(doc, { kind: 'clearOverride', configId: 'a', featureId: 'f1', paramKey: 'r' });
    // Snapshot read filters out empty slots; param 'r' should not appear.
    const entry = readConfig(doc, 'a')!;
    expect(entry.overrides.f1).toBeUndefined();
  });

  it('clearOverride is a no-op for unknown key', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    const r = applyConfigOp(doc, { kind: 'clearOverride', configId: 'a', featureId: 'f1', paramKey: 'r' });
    expect(r.applied).toBe(false);
  });

  it('setSuppressed toggles suppress flag', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'setSuppressed', configId: 'a', featureId: 'f1', suppressed: true });
    expect(readConfig(doc, 'a')!.overrides.f1!.suppressed).toBe(true);
    applyConfigOp(doc, { kind: 'setSuppressed', configId: 'a', featureId: 'f1', suppressed: false });
    expect(readConfig(doc, 'a')!.overrides.f1!.suppressed).toBe(false);
  });

  it('setGlobalVar writes a global var', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'setGlobalVar', name: 'D', value: 25 });
    expect(readGlobalVars(doc)).toEqual({ D: 25 });
  });

  it('unsetGlobalVar removes a global var', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'setGlobalVar', name: 'D', value: 25 });
    applyConfigOp(doc, { kind: 'unsetGlobalVar', name: 'D' });
    expect(readGlobalVars(doc)).toEqual({});
  });

  it('unsetGlobalVar for unknown name is a no-op', () => {
    const r = applyConfigOp(new Y.Doc(), { kind: 'unsetGlobalVar', name: 'nope' });
    expect(r.applied).toBe(false);
  });

  it('setExpressionVar writes a config-scoped var', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'setExpressionVar', configId: 'a', varName: 'L', value: 50 });
    expect(readConfig(doc, 'a')!.expressionVars).toEqual({ L: 50 });
  });

  it('setExpressionVar accepts string values (expressions)', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'setExpressionVar', configId: 'a', varName: 'L', value: 'D * 2' });
    expect(readConfig(doc, 'a')!.expressionVars.L).toBe('D * 2');
  });
});

describe('configStoreYjs — cycle rejection on setParent', () => {
  it('self-loop refused', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    const r = applyConfigOp(doc, { kind: 'setParent', id: 'a', parentId: 'a' });
    expect(r.applied).toBe(false);
    expect(r.notes).toMatch(/self-loop/);
  });

  it('transitive cycle refused', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('b') });
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('c') });
    applyConfigOp(doc, { kind: 'setParent', id: 'b', parentId: 'a' });
    applyConfigOp(doc, { kind: 'setParent', id: 'c', parentId: 'b' });
    // Now a → b → c. Setting a's parent to c would close the cycle.
    const r = applyConfigOp(doc, { kind: 'setParent', id: 'a', parentId: 'c' });
    expect(r.applied).toBe(false);
    expect(r.notes).toMatch(/cycle/);
    // Doc state unchanged — a still has no parent.
    expect(readConfig(doc, 'a')!.parentId).toBeUndefined();
  });

  it('non-cycle reparent applies', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('b') });
    const r = applyConfigOp(doc, { kind: 'setParent', id: 'b', parentId: 'a' });
    expect(r.applied).toBe(true);
    expect(readConfig(doc, 'b')!.parentId).toBe('a');
  });

  it('setParent(null) detaches', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('b') });
    applyConfigOp(doc, { kind: 'setParent', id: 'b', parentId: 'a' });
    applyConfigOp(doc, { kind: 'setParent', id: 'b', parentId: null });
    expect(readConfig(doc, 'b')!.parentId).toBeUndefined();
  });

  it('setParent unknown_parent refused', () => {
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') });
    const r = applyConfigOp(doc, { kind: 'setParent', id: 'a', parentId: 'nope' });
    expect(r.applied).toBe(false);
    expect(r.notes).toMatch(/unknown parent/);
  });
});

describe('configStoreYjs — bootstrap + populate', () => {
  it('snapshotToYDoc creates a populated doc', () => {
    const doc = snapshotToYDoc({
      configs: [blankEntry('a'), blankEntry('b')],
      activeConfigId: 'a',
      globalVars: { D: 25 },
    });
    expect(readAllConfigs(doc)).toHaveLength(2);
    expect(readActiveConfigId(doc)).toBe('a');
    expect(readGlobalVars(doc)).toEqual({ D: 25 });
  });

  it('populateDoc writes into an existing doc atomically', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    populateDoc(doc, {
      configs: [blankEntry('a'), blankEntry('b'), blankEntry('c')],
      activeConfigId: 'a',
      globalVars: { D: 25, L: 10 },
    });
    // One transact = one update event for the whole population.
    expect(updates).toBe(1);
    expect(readAllConfigs(doc)).toHaveLength(3);
  });

  it('populateDoc uses origin ORIGIN_IMPORT_NFAB by default', () => {
    const doc = new Y.Doc();
    let lastOrigin: unknown = null;
    doc.on('update', (_u: Uint8Array, origin: unknown) => { lastOrigin = origin; });
    populateDoc(doc, { configs: [blankEntry('a')], activeConfigId: 'a', globalVars: {} });
    expect(lastOrigin).toBe(ORIGIN_IMPORT_NFAB);
  });
});

describe('configStoreYjs — round-trip + equality helpers', () => {
  it('configsEqual returns true for identical lists', () => {
    expect(configsEqual([blankEntry('a')], [blankEntry('a')])).toBe(true);
  });

  it('configsEqual is order-insensitive', () => {
    expect(configsEqual(
      [blankEntry('a'), blankEntry('b')],
      [blankEntry('b'), blankEntry('a')],
    )).toBe(true);
  });

  it('configsEqual returns false on diff name', () => {
    expect(configsEqual([blankEntry('a', 'X')], [blankEntry('a', 'Y')])).toBe(false);
  });

  it('configsEqual is param-order insensitive', () => {
    const a: ConfigEntry = { id: 'a', name: 'A', overrides: { f1: { params: { r: 5, d: 10 } } }, expressionVars: {} };
    const b: ConfigEntry = { id: 'a', name: 'A', overrides: { f1: { params: { d: 10, r: 5 } } }, expressionVars: {} };
    expect(configsEqual([a], [b])).toBe(true);
  });

  it('round-trip preserves a full config entry', () => {
    const entry: ConfigEntry = {
      id: 'c1',
      name: 'C1',
      parentId: undefined,
      overrides: {
        feat1: { params: { radius: 5 } },
        feat2: { suppressed: true },
        feat3: { suppressed: false, params: { d: 10, label: 'big' } },
      },
      expressionVars: { D: 25, L: 'D * 2' },
    };
    const doc = new Y.Doc();
    applyConfigOp(doc, { kind: 'addConfig', entry });
    const out = readAllConfigs(doc)[0]!;
    expect(configsEqual([entry], [out])).toBe(true);
  });
});

describe('configStoreYjs — sync between docs', () => {
  it('syncDocs propagates updates A→B and B→A', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    applyConfigOp(docA, { kind: 'addConfig', entry: blankEntry('a') });
    applyConfigOp(docB, { kind: 'addConfig', entry: blankEntry('b') });
    syncDocs(docA, docB);
    const aIds = readAllConfigs(docA).map(e => e.id).sort();
    const bIds = readAllConfigs(docB).map(e => e.id).sort();
    expect(aIds).toEqual(['a', 'b']);
    expect(bIds).toEqual(['a', 'b']);
  });

  it('origin tags propagate through transact', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => { origins.push(origin); });
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('a') }, ORIGIN_LOCAL_UI);
    applyConfigOp(doc, { kind: 'addConfig', entry: blankEntry('b') }, ORIGIN_REMOTE_UPDATE);
    expect(origins).toContain(ORIGIN_LOCAL_UI);
    expect(origins).toContain(ORIGIN_REMOTE_UPDATE);
  });
});
