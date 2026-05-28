/**
 * configsConvergence.test.ts — A5 browser-route convergence cases.
 *
 * Companion to the configStoreYjs.divergence.test.ts node-side cases.
 * Same code path, mirroring the runbook checklist for the
 * /[lang]/collab-smoke-configs harness so a reviewer can map a failing
 * test back to a specific runbook checklist step.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applyConfigOp,
  configsEqual,
  readActiveConfigId,
  readAllConfigs,
} from '../../shape-generator/configurations/configStoreYjs';
import type { ConfigEntry } from '../../shape-generator/configurations/types';

const ORIGIN_REMOTE = 'remote-update';

function blank(id: string, name?: string): ConfigEntry {
  return { id, name: name ?? id, overrides: {}, expressionVars: {} };
}

function pair() {
  const a = new Y.Doc();
  applyConfigOp(a, { kind: 'addConfig', entry: blank('master', 'Master') });
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), ORIGIN_REMOTE);
  const sync = (from: Y.Doc, to: Y.Doc) =>
    Y.applyUpdate(to, Y.encodeStateAsUpdate(from), ORIGIN_REMOTE);
  return { a, b, sync };
}

function configs(doc: Y.Doc): ConfigEntry[] { return readAllConfigs(doc); }

describe('collab-smoke-configs harness convergence', () => {
  it('checklist #1: auto-sync mirrors addConfig from A to B', () => {
    const { a, b, sync } = pair();
    for (let i = 0; i < 3; i++) {
      applyConfigOp(a, { kind: 'addConfig', entry: blank(`a-${i}`) });
      sync(a, b);
    }
    expect(configs(a)).toHaveLength(4);
    expect(configs(b)).toHaveLength(4);
    expect(configsEqual(configs(a), configs(b))).toBe(true);
  });

  it('checklist #2: concurrent different-id addConfig merges to union', () => {
    const { a, b, sync } = pair();
    applyConfigOp(a, { kind: 'addConfig', entry: blank('a-1') });
    applyConfigOp(a, { kind: 'addConfig', entry: blank('a-2') });
    applyConfigOp(b, { kind: 'addConfig', entry: blank('b-1') });
    applyConfigOp(b, { kind: 'addConfig', entry: blank('b-2') });
    sync(a, b);
    sync(b, a);
    const ids = (doc: Y.Doc) => configs(doc).map(c => c.id).sort();
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a)).toEqual(['a-1', 'a-2', 'b-1', 'b-2', 'master']);
  });

  it('checklist #3: concurrent setOverride on disjoint configs → both survive', () => {
    const { a, b, sync } = pair();
    applyConfigOp(a, { kind: 'addConfig', entry: blank('x') });
    applyConfigOp(a, { kind: 'addConfig', entry: blank('y') });
    sync(a, b);

    applyConfigOp(a, { kind: 'setOverride', configId: 'x', featureId: 'f1', paramKey: 'r', value: 5 });
    applyConfigOp(b, { kind: 'setOverride', configId: 'y', featureId: 'f1', paramKey: 'r', value: 10 });

    sync(a, b);
    sync(b, a);

    const find = (doc: Y.Doc, id: string) => configs(doc).find(c => c.id === id)!;
    expect(find(a, 'x').overrides.f1).toEqual({ params: { r: 5 } });
    expect(find(a, 'y').overrides.f1).toEqual({ params: { r: 10 } });
    expect(configsEqual(configs(a), configs(b))).toBe(true);
  });

  it('checklist #4: stress — 10 + 10 concurrent addConfigs converge to 20+master', () => {
    const { a, b, sync } = pair();
    for (let i = 0; i < 10; i++) {
      applyConfigOp(a, { kind: 'addConfig', entry: blank(`a-${i}`) });
      applyConfigOp(b, { kind: 'addConfig', entry: blank(`b-${i}`) });
    }
    sync(a, b);
    sync(b, a);
    expect(configs(a)).toHaveLength(21);
    expect(configs(b)).toHaveLength(21);
    expect(configsEqual(configs(a), configs(b))).toBe(true);
  });

  it('regression: setActive LWW propagates across sync', () => {
    const { a, b, sync } = pair();
    applyConfigOp(a, { kind: 'addConfig', entry: blank('x') });
    applyConfigOp(a, { kind: 'setActive', id: 'x' });
    sync(a, b);
    expect(readActiveConfigId(b)).toBe('x');
  });
});
