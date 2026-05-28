/**
 * configStoreYjs.divergence.test.ts — A5 multi-peer convergence cases.
 *
 * Two-peer pattern: both docs bootstrap with the same `addConfig("Master")`
 * to share a common id space, then concurrent ops on DIFFERENT configs,
 * concurrent ops on SAME config different keys (LWW per-key merge), then
 * sync. After bidirectional sync, both docs must canonicalize to the same
 * state.
 *
 * The 10 cases below cover every conflict surface in spec §9.2:
 *  - add/add concurrent on different ids → both survive
 *  - add/add concurrent on SAME id → LWW
 *  - remove/update concurrent → LWW per key (Yjs tombstone semantics)
 *  - setParent concurrent (one wins LWW)
 *  - setActive concurrent (LWW)
 *  - setOverride concurrent on disjoint configs → both survive
 *  - setOverride concurrent on same (config, feature, key) → LWW
 *  - setOverride concurrent on same (config, feature) different KEYS → both survive
 *  - setSuppressed concurrent on disjoint features → both survive
 *  - setGlobalVar concurrent on same key → LWW
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applyConfigOp,
  configsEqual,
  readAllConfigs,
  readActiveConfigId,
  readGlobalVars,
  syncDocs,
  ORIGIN_REMOTE_UPDATE,
} from '../configStoreYjs';
import type { ConfigEntry } from '../types';

function blank(id: string, name?: string): ConfigEntry {
  return { id, name: name ?? id, overrides: {}, expressionVars: {} };
}

/** Bootstrap: docA owns the initial state, docB joins via initial sync. */
function pair(initial: ConfigEntry[] = [blank('m', 'Master')]) {
  const docA = new Y.Doc();
  for (const e of initial) {
    applyConfigOp(docA, { kind: 'addConfig', entry: e });
  }
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), ORIGIN_REMOTE_UPDATE);
  return { docA, docB };
}

/** Both directions of sync — A→B then B→A — until both docs have all updates. */
function bidirectionalSync(a: Y.Doc, b: Y.Doc): void {
  syncDocs(a, b);
}

function assertConvergence(a: Y.Doc, b: Y.Doc) {
  const configsA = readAllConfigs(a);
  const configsB = readAllConfigs(b);
  if (!configsEqual(configsA, configsB)) {
    console.error('Diverged:\n  A=', JSON.stringify(configsA), '\n  B=', JSON.stringify(configsB));
  }
  expect(configsEqual(configsA, configsB)).toBe(true);
  expect(readActiveConfigId(a)).toBe(readActiveConfigId(b));
  expect(readGlobalVars(a)).toEqual(readGlobalVars(b));
}

describe('configStoreYjs — convergence (10 cases)', () => {
  it('#1 add/add concurrent on different ids → both survive', () => {
    const { docA, docB } = pair();
    applyConfigOp(docA, { kind: 'addConfig', entry: blank('a', 'A-Side') });
    applyConfigOp(docB, { kind: 'addConfig', entry: blank('b', 'B-Side') });
    bidirectionalSync(docA, docB);
    const ids = readAllConfigs(docA).map(e => e.id).sort();
    expect(ids).toEqual(['a', 'b', 'm']);
    assertConvergence(docA, docB);
  });

  it('#2 add/add concurrent on SAME id → LWW (one wins), both docs agree', () => {
    const { docA, docB } = pair();
    applyConfigOp(docA, { kind: 'addConfig', entry: blank('shared', 'A-Variant') });
    applyConfigOp(docB, { kind: 'addConfig', entry: blank('shared', 'B-Variant') });
    bidirectionalSync(docA, docB);
    // Both docs converge to the same winner — LWW is deterministic, but the
    // particular value is non-deterministic in test (Yjs clock).
    assertConvergence(docA, docB);
    const winner = readAllConfigs(docA).find(e => e.id === 'shared')!;
    expect(['A-Variant', 'B-Variant']).toContain(winner.name);
  });

  it('#3 remove/update concurrent → edit on tombstone merged into shared state', () => {
    const { docA, docB } = pair([blank('m'), blank('x', 'Target')]);
    bidirectionalSync(docA, docB);
    // Verify B sees 'x' before the race.
    expect(readAllConfigs(docB).map(e => e.id).sort()).toEqual(['m', 'x']);

    applyConfigOp(docA, { kind: 'removeConfig', id: 'x' });
    applyConfigOp(docB, { kind: 'setOverride', configId: 'x', featureId: 'f1', paramKey: 'r', value: 7 });

    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    // Yjs default: writes on a deleted Y.Map sub-tree resurrect the sub-tree
    // partially (the new keys appear). Either outcome (resurrected with the
    // override, or fully removed) is acceptable as long as both peers agree.
    const configs = readAllConfigs(docA);
    const x = configs.find(e => e.id === 'x');
    if (x) {
      // Sub-tree partially resurrected — both peers must agree on this shape.
      expect(x.overrides.f1).toEqual({ params: { r: 7 } });
    }
  });

  it('#4 setParent concurrent → LWW, doc state stable', () => {
    const { docA, docB } = pair([blank('m'), blank('a'), blank('b'), blank('c')]);
    bidirectionalSync(docA, docB);
    applyConfigOp(docA, { kind: 'setParent', id: 'c', parentId: 'a' });
    applyConfigOp(docB, { kind: 'setParent', id: 'c', parentId: 'b' });
    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    const c = readAllConfigs(docA).find(e => e.id === 'c')!;
    expect(['a', 'b']).toContain(c.parentId);
  });

  it('#5 setActive concurrent → LWW', () => {
    const { docA, docB } = pair([blank('m'), blank('a'), blank('b')]);
    bidirectionalSync(docA, docB);
    applyConfigOp(docA, { kind: 'setActive', id: 'a' });
    applyConfigOp(docB, { kind: 'setActive', id: 'b' });
    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    expect(['a', 'b']).toContain(readActiveConfigId(docA));
  });

  it('#6 setOverride concurrent on DISJOINT configs → both survive', () => {
    const { docA, docB } = pair([blank('m'), blank('a'), blank('b')]);
    bidirectionalSync(docA, docB);
    applyConfigOp(docA, { kind: 'setOverride', configId: 'a', featureId: 'f1', paramKey: 'r', value: 5 });
    applyConfigOp(docB, { kind: 'setOverride', configId: 'b', featureId: 'f1', paramKey: 'r', value: 10 });
    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    const a = readAllConfigs(docA).find(e => e.id === 'a')!;
    const b = readAllConfigs(docA).find(e => e.id === 'b')!;
    expect(a.overrides.f1!.params).toEqual({ r: 5 });
    expect(b.overrides.f1!.params).toEqual({ r: 10 });
  });

  it('#7 setOverride concurrent on SAME (config, feature, key) → LWW', () => {
    const { docA, docB } = pair([blank('m'), blank('a')]);
    bidirectionalSync(docA, docB);
    applyConfigOp(docA, { kind: 'setOverride', configId: 'a', featureId: 'f1', paramKey: 'r', value: 5 });
    applyConfigOp(docB, { kind: 'setOverride', configId: 'a', featureId: 'f1', paramKey: 'r', value: 10 });
    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    const a = readAllConfigs(docA).find(e => e.id === 'a')!;
    expect([5, 10]).toContain(a.overrides.f1!.params!.r);
  });

  it('#8 setOverride concurrent on SAME (config, feature) different KEYS → both survive', () => {
    const { docA, docB } = pair([blank('m'), blank('a')]);
    bidirectionalSync(docA, docB);
    applyConfigOp(docA, { kind: 'setOverride', configId: 'a', featureId: 'f1', paramKey: 'r', value: 5 });
    applyConfigOp(docB, { kind: 'setOverride', configId: 'a', featureId: 'f1', paramKey: 'd', value: 10 });
    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    const a = readAllConfigs(docA).find(e => e.id === 'a')!;
    expect(a.overrides.f1!.params).toEqual({ r: 5, d: 10 });
  });

  it('#9 setSuppressed concurrent on DISJOINT features → both survive', () => {
    const { docA, docB } = pair([blank('m'), blank('a')]);
    bidirectionalSync(docA, docB);
    applyConfigOp(docA, { kind: 'setSuppressed', configId: 'a', featureId: 'f1', suppressed: true });
    applyConfigOp(docB, { kind: 'setSuppressed', configId: 'a', featureId: 'f2', suppressed: true });
    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    const a = readAllConfigs(docA).find(e => e.id === 'a')!;
    expect(a.overrides.f1).toEqual({ suppressed: true });
    expect(a.overrides.f2).toEqual({ suppressed: true });
  });

  it('#10 setGlobalVar concurrent on SAME key → LWW', () => {
    const { docA, docB } = pair();
    applyConfigOp(docA, { kind: 'setGlobalVar', name: 'D', value: 25 });
    applyConfigOp(docB, { kind: 'setGlobalVar', name: 'D', value: 50 });
    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    expect([25, 50]).toContain(readGlobalVars(docA).D);
  });

  it('#11 (bonus) renameConfig concurrent → LWW on name', () => {
    const { docA, docB } = pair([blank('m'), blank('a', 'Original')]);
    bidirectionalSync(docA, docB);
    applyConfigOp(docA, { kind: 'renameConfig', id: 'a', name: 'A-Name' });
    applyConfigOp(docB, { kind: 'renameConfig', id: 'a', name: 'B-Name' });
    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    const a = readAllConfigs(docA).find(e => e.id === 'a')!;
    expect(['A-Name', 'B-Name']).toContain(a.name);
  });

  it('#12 (bonus) interleaved ops on chains converge', () => {
    const { docA, docB } = pair();
    // Create a chain on A, override on B, both reference different configs.
    applyConfigOp(docA, { kind: 'addConfig', entry: blank('a') });
    applyConfigOp(docA, { kind: 'addConfig', entry: blank('b') });
    applyConfigOp(docA, { kind: 'setParent', id: 'b', parentId: 'a' });
    applyConfigOp(docB, { kind: 'addConfig', entry: blank('c') });
    applyConfigOp(docB, { kind: 'setOverride', configId: 'c', featureId: 'f1', paramKey: 'r', value: 99 });
    bidirectionalSync(docA, docB);
    assertConvergence(docA, docB);
    const all = readAllConfigs(docA);
    expect(all.map(e => e.id).sort()).toEqual(['a', 'b', 'c', 'm']);
  });
});
