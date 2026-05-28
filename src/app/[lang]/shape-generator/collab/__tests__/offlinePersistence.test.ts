// @vitest-environment jsdom

/**
 * offlinePersistence.test.ts — y-indexeddb persistence smoke + recovery tests.
 *
 * We use `fake-indexeddb/auto` for an in-memory IDBFactory so tests don't
 * touch the host machine. Each test resets the global indexedDB so DBs from
 * prior tests don't bleed across (otherwise the second test in a file picks
 * up the first test's state).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { IDBFactory } from 'fake-indexeddb';

import {
  setupOfflinePersistence,
  clearLocalCache,
  getCacheSize,
  formatCacheSize,
  dbNameFor,
  DB_NAMESPACE,
} from '../offlinePersistence';

/** Fresh in-memory IDB factory per test → zero cross-test contamination. */
beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

describe('offlinePersistence · dbNameFor', () => {
  it('namespaces under DB_NAMESPACE', () => {
    expect(dbNameFor('proj-42')).toBe(`${DB_NAMESPACE}::proj-42`);
  });

  it('keeps different docIds separate', () => {
    expect(dbNameFor('a')).not.toBe(dbNameFor('b'));
  });
});

describe('offlinePersistence · setupOfflinePersistence input validation', () => {
  it('rejects empty docId', () => {
    const doc = new Y.Doc();
    expect(() => setupOfflinePersistence(doc, '')).toThrow(/docId/);
    doc.destroy();
  });

  it('rejects non-string docId', () => {
    const doc = new Y.Doc();
    // @ts-expect-error — runtime guard
    expect(() => setupOfflinePersistence(doc, 123)).toThrow(/docId/);
    doc.destroy();
  });
});

describe('offlinePersistence · persistence round-trip', () => {
  it('recovers a sketch entity after doc destroy → fresh doc', async () => {
    // Round 1: write to doc + persistence.
    const docA = new Y.Doc();
    const persistenceA = setupOfflinePersistence(docA, 'rt-1');
    await persistenceA.whenSynced;
    docA.getMap('sketch').set('entity-1', { type: 'circle', r: 12 });
    docA.getMap('sketch').set('entity-2', { type: 'line', len: 50 });
    // y-indexeddb flushes synchronously on `update`, but the IDB request is
    // async — give the microtask queue a tick to settle.
    await persistenceA.destroy();
    docA.destroy();

    // Round 2: brand new doc, same name → expect entities restored.
    const docB = new Y.Doc();
    const persistenceB = setupOfflinePersistence(docB, 'rt-1');
    await persistenceB.whenSynced;
    expect(docB.getMap('sketch').get('entity-1')).toEqual({ type: 'circle', r: 12 });
    expect(docB.getMap('sketch').get('entity-2')).toEqual({ type: 'line', len: 50 });
    await persistenceB.destroy();
    docB.destroy();
  });

  it('two docs with the same docId converge', async () => {
    // Doc 1 writes first, then doc 2 attaches → doc 2 should see doc 1's data.
    const doc1 = new Y.Doc();
    const p1 = setupOfflinePersistence(doc1, 'shared');
    await p1.whenSynced;
    doc1.getMap('sketch').set('rect', { w: 100, h: 40 });
    await p1.destroy();
    doc1.destroy();

    const doc2 = new Y.Doc();
    const p2 = setupOfflinePersistence(doc2, 'shared');
    await p2.whenSynced;
    expect(doc2.getMap('sketch').get('rect')).toEqual({ w: 100, h: 40 });
    await p2.destroy();
    doc2.destroy();
  });

  it('docs with different docIds do not see each other', async () => {
    const docA = new Y.Doc();
    const pA = setupOfflinePersistence(docA, 'iso-a');
    await pA.whenSynced;
    docA.getMap('sketch').set('only-in-a', 1);
    await pA.destroy();
    docA.destroy();

    const docB = new Y.Doc();
    const pB = setupOfflinePersistence(docB, 'iso-b');
    await pB.whenSynced;
    expect(docB.getMap('sketch').get('only-in-a')).toBeUndefined();
    await pB.destroy();
    docB.destroy();
  });

  it('clearLocalCache wipes the entity', async () => {
    const doc1 = new Y.Doc();
    const p1 = setupOfflinePersistence(doc1, 'wipe-test');
    await p1.whenSynced;
    doc1.getMap('sketch').set('ghost', { type: 'arc' });
    await p1.destroy();
    doc1.destroy();

    await clearLocalCache('wipe-test');

    const doc2 = new Y.Doc();
    const p2 = setupOfflinePersistence(doc2, 'wipe-test');
    await p2.whenSynced;
    expect(doc2.getMap('sketch').get('ghost')).toBeUndefined();
    await p2.destroy();
    doc2.destroy();
  });

  it('clearLocalCache is a no-op for non-existent docs', async () => {
    await expect(clearLocalCache('never-existed')).resolves.toBeUndefined();
  });
});

describe('offlinePersistence · performance', () => {
  it('persists 1000 entities in under 500 ms', async () => {
    const doc = new Y.Doc();
    const persistence = setupOfflinePersistence(doc, 'perf-1000');
    await persistence.whenSynced;

    const sketch = doc.getMap('sketch');
    const t0 = performance.now();
    doc.transact(() => {
      for (let i = 0; i < 1000; i++) {
        sketch.set(`e-${i}`, { type: 'point', x: i, y: i * 2 });
      }
    });
    // The store happens via doc.on('update') inside y-indexeddb — flushing
    // through destroy() forces it to settle.
    await persistence.destroy();
    const elapsed = performance.now() - t0;
    doc.destroy();

    expect(elapsed).toBeLessThan(500);
  });
});

describe('offlinePersistence · getCacheSize / formatCacheSize', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 0 when navigator.storage.estimate is missing', async () => {
    // jsdom does not implement navigator.storage by default.
    const result = await getCacheSize();
    expect(result).toBe(0);
  });

  it('returns the estimate when available', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => ({ usage: 1024 * 50, quota: 1024 * 1024 }),
      },
    });
    const result = await getCacheSize();
    expect(result).toBe(1024 * 50);
  });

  it('returns 0 when estimate throws', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => {
          throw new Error('quota api unavailable');
        },
      },
    });
    const result = await getCacheSize();
    expect(result).toBe(0);
  });

  it('formats bytes into human-readable strings', () => {
    expect(formatCacheSize(0)).toBe('0 B');
    expect(formatCacheSize(512)).toBe('512 B');
    expect(formatCacheSize(2048)).toBe('2.0 KB');
    expect(formatCacheSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatCacheSize(2.5 * 1024 * 1024 * 1024)).toMatch(/GB$/);
    expect(formatCacheSize(-1)).toBe('0 B');
    expect(formatCacheSize(Number.NaN)).toBe('0 B');
  });

  it('drops the decimal for >=100 of a unit (cleaner display)', () => {
    // 150 KB → "150 KB", not "150.0 KB".
    expect(formatCacheSize(150 * 1024)).toBe('150 KB');
  });
});
