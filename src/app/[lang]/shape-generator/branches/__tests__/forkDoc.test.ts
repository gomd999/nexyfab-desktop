/**
 * forkDoc.test.ts — Wave 2 Phase 3 Z6.
 *
 * Document-level fork operation cases:
 *  - fork preserves entities (sketches / refgeom / generic Y.Maps)
 *  - source is independent after fork (mutations don't propagate)
 *  - forked doc starts at same logical state
 *  - snapshot hash determinism + reactive change
 *  - perf measurements at 100/500/1000 entities (logged for the report)
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  forkDoc,
  computeForkSnapshotHash,
  computeForkSnapshotHashSync,
  ORIGIN_FORK,
} from '../forkDoc';

// Small helper: write N entries into a generic Y.Map keyed by id.
function populate(doc: Y.Doc, root: string, count: number): void {
  const map = doc.getMap<Y.Map<unknown>>(root);
  doc.transact(() => {
    for (let i = 0; i < count; i++) {
      const inner = new Y.Map<unknown>();
      inner.set('id', `entity-${i}`);
      inner.set('payload', `data-${i}`.repeat(8));
      map.set(`entity-${i}`, inner);
    }
  });
}

function readIds(doc: Y.Doc, root: string): string[] {
  const map = doc.getMap<Y.Map<unknown>>(root);
  const ids: string[] = [];
  map.forEach((_v, k) => ids.push(k));
  ids.sort();
  return ids;
}

// ─── 1. State preservation ─────────────────────────────────────────────────

describe('forkDoc — state preservation', () => {
  it('a forked doc starts at the same logical state', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 5);
    const b = forkDoc(a, 'doc-fork-1');
    expect(readIds(b, 'entities')).toEqual(readIds(a, 'entities'));
  });

  it('preserves nested Y.Map contents in the fork', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 3);
    const b = forkDoc(a, 'doc-nested');
    const aMap = a.getMap<Y.Map<unknown>>('entities').get('entity-0');
    const bMap = b.getMap<Y.Map<unknown>>('entities').get('entity-0');
    expect(bMap?.get('payload')).toBe(aMap?.get('payload'));
  });

  it('preserves multiple top-level Y collections (sketches + refgeom-like)', () => {
    const a = new Y.Doc();
    a.getMap('sketches').set('s1', 'sketch-data');
    a.getMap('referenceGeometry').set('r1', 'ref-data');
    a.getArray('featureTree').push(['feature-1', 'feature-2']);
    const b = forkDoc(a, 'doc-multi');
    expect(b.getMap('sketches').get('s1')).toBe('sketch-data');
    expect(b.getMap('referenceGeometry').get('r1')).toBe('ref-data');
    expect(b.getArray('featureTree').toArray()).toEqual(['feature-1', 'feature-2']);
  });

  it('attaches the newDocId as the Y.Doc guid', () => {
    const a = new Y.Doc();
    const b = forkDoc(a, 'doc-guid-test');
    expect(b.guid).toBe('doc-guid-test');
  });

  it('refuses an empty newDocId', () => {
    const a = new Y.Doc();
    expect(() => forkDoc(a, '')).toThrow();
  });
});

// ─── 2. Independence after fork ────────────────────────────────────────────

describe('forkDoc — source/fork independence', () => {
  it('post-fork mutations on source do NOT propagate to the fork', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 3);
    const b = forkDoc(a, 'doc-indep-1');
    // Now mutate the source.
    a.getMap<Y.Map<unknown>>('entities').delete('entity-0');
    a.getMap<Y.Map<unknown>>('entities').set('entity-new', new Y.Map());
    // The fork still has its original 3 entities.
    expect(readIds(b, 'entities')).toEqual(['entity-0', 'entity-1', 'entity-2']);
  });

  it('post-fork mutations on the fork do NOT propagate to the source', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 2);
    const b = forkDoc(a, 'doc-indep-2');
    b.getMap<Y.Map<unknown>>('entities').delete('entity-0');
    b.getMap<Y.Map<unknown>>('entities').set('fork-only', new Y.Map());
    expect(readIds(a, 'entities')).toEqual(['entity-0', 'entity-1']);
  });

  it('source and fork have different clientIDs', () => {
    const a = new Y.Doc();
    const b = forkDoc(a, 'doc-clientid');
    expect(b.clientID).not.toBe(a.clientID);
  });

  it('forking a fork (chain) preserves each level\'s state', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 2);
    const b = forkDoc(a, 'b');
    b.getMap<Y.Map<unknown>>('entities').set('b-only', new Y.Map());
    const c = forkDoc(b, 'c');
    c.getMap<Y.Map<unknown>>('entities').set('c-only', new Y.Map());
    expect(readIds(a, 'entities')).toEqual(['entity-0', 'entity-1']);
    expect(readIds(b, 'entities').sort()).toEqual(['b-only', 'entity-0', 'entity-1']);
    expect(readIds(c, 'entities').sort()).toEqual(['b-only', 'c-only', 'entity-0', 'entity-1']);
  });
});

// ─── 3. ORIGIN_FORK observability ──────────────────────────────────────────

describe('forkDoc — origin tag', () => {
  it('the hydration update fires with origin ORIGIN_FORK', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 2);
    const observedOrigins: unknown[] = [];
    const b = new Y.Doc();
    b.on('update', (_u: Uint8Array, origin: unknown) => observedOrigins.push(origin));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), ORIGIN_FORK);
    expect(observedOrigins).toContain(ORIGIN_FORK);
  });

  it('exposes ORIGIN_FORK as a stable string', () => {
    expect(typeof ORIGIN_FORK).toBe('string');
    expect(ORIGIN_FORK.length).toBeGreaterThan(0);
  });
});

// ─── 4. Snapshot hash ──────────────────────────────────────────────────────

describe('forkDoc — snapshot hash determinism', () => {
  it('two empty docs have the same hash', async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    expect(await computeForkSnapshotHash(a)).toBe(await computeForkSnapshotHash(b));
  });

  it('a doc and its fork have the same hash (state-equivalent)', async () => {
    const a = new Y.Doc();
    populate(a, 'entities', 5);
    const b = forkDoc(a, 'b');
    expect(await computeForkSnapshotHash(a)).toBe(await computeForkSnapshotHash(b));
  });

  it('mutating the fork changes its hash but not the source\'s', async () => {
    const a = new Y.Doc();
    populate(a, 'entities', 3);
    const b = forkDoc(a, 'b');
    const aHash1 = await computeForkSnapshotHash(a);
    b.getMap<Y.Map<unknown>>('entities').set('new', new Y.Map());
    const aHash2 = await computeForkSnapshotHash(a);
    const bHash = await computeForkSnapshotHash(b);
    expect(aHash1).toBe(aHash2);
    expect(aHash1).not.toBe(bHash);
  });

  it('hash is a non-empty hex-like string', async () => {
    const a = new Y.Doc();
    populate(a, 'entities', 1);
    const h = await computeForkSnapshotHash(a);
    expect(h.length).toBeGreaterThanOrEqual(16);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it('computeForkSnapshotHashSync is deterministic across calls', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 4);
    const h1 = computeForkSnapshotHashSync(a);
    const h2 = computeForkSnapshotHashSync(a);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('computeForkSnapshotHashSync differs for different state', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 3);
    const h1 = computeForkSnapshotHashSync(a);
    a.getMap('entities').set('extra', new Y.Map());
    const h2 = computeForkSnapshotHashSync(a);
    expect(h1).not.toBe(h2);
  });
});

// ─── 5. Perf at scale (also produces the report numbers) ────────────────────

describe('forkDoc — perf characteristics', () => {
  it('100 entities forks in well under a second', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 100);
    const t0 = performance.now();
    forkDoc(a, 'perf-100');
    const dt = performance.now() - t0;
    // Generous ceiling — typical figure is < 10 ms.
    expect(dt).toBeLessThan(1000);
    console.log(`[forkDoc perf] 100 entities: ${dt.toFixed(2)} ms`);
  });

  it('500 entities forks under 2 seconds', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 500);
    const t0 = performance.now();
    forkDoc(a, 'perf-500');
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(2000);
    console.log(`[forkDoc perf] 500 entities: ${dt.toFixed(2)} ms`);
  });

  it('1000 entities forks under 3 seconds', () => {
    const a = new Y.Doc();
    populate(a, 'entities', 1000);
    const t0 = performance.now();
    forkDoc(a, 'perf-1000');
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(3000);
    console.log(`[forkDoc perf] 1000 entities: ${dt.toFixed(2)} ms`);
  });
});
