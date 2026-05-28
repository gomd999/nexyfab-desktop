// Contract tests for the persistence smoke harness flow. These are
// node-side (fake-indexeddb) — the corresponding browser smoke lives
// at /[lang]/collab-smoke-persistence and is what the Phase 1 checkpoint
// signal #1 actually wants verified.
//
// What this tests: the exact open → mutate → close → reopen → read-back
// sequence the smoke page performs, so a regression at this layer fails
// CI before the user notices it in browser.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as Y from 'yjs';

import {
  clearLocalCache,
  dbNameFor,
  formatCacheSize,
  setupOfflinePersistence,
} from '../../shape-generator/collab/offlinePersistence';
import {
  ORIGIN_LOCAL_UI,
  applySketchOp,
  readSketch,
  type Sketch,
} from '../../shape-generator/collab/sketchYjs';

const DOC_ID = 'survival-contract-doc';
const SKETCH_ID = 'survival-contract-sketch';

function makeSketch(): Sketch {
  return {
    id: SKETCH_ID,
    plane: 'xy',
    planeOffset: 0,
    operation: 'add',
    faceFrame: null,
    config: { mode: 'extrude', depth: 50, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
    segments: [],
    constraints: [],
    dimensions: [],
  };
}

beforeAll(async () => {
  const fakeIdb = await import('fake-indexeddb');
  // Wire fake-indexeddb globals so the persistence module's
  // typeof indexedDB check passes.
  (globalThis as Record<string, unknown>).indexedDB = fakeIdb.indexedDB;
  (globalThis as Record<string, unknown>).IDBKeyRange = fakeIdb.IDBKeyRange;
});

beforeEach(async () => {
  // Reset DB between tests so cycle starts clean.
  await clearLocalCache(DOC_ID);
});

describe('persistence smoke harness — survival contract', () => {
  it('round-trip: open → add 3 → close → reopen → 3 survive', async () => {
    {
      const doc = new Y.Doc();
      const p = setupOfflinePersistence(doc, DOC_ID);
      await p.whenSynced;
      applySketchOp(doc, { kind: 'createSketch', sketch: makeSketch() }, ORIGIN_LOCAL_UI);
      for (let i = 0; i < 3; i++) {
        applySketchOp(doc, {
          kind: 'addSegment',
          sketchId: SKETCH_ID,
          segment: { id: `seg-${i}`, type: 'line', points: [{ x: i, y: 0 }, { x: i + 1, y: 1 }] },
        }, ORIGIN_LOCAL_UI);
      }
      expect(readSketch(doc, SKETCH_ID)!.segments).toHaveLength(3);
      await p.destroy();
      doc.destroy();
    }

    {
      const doc = new Y.Doc();
      const p = setupOfflinePersistence(doc, DOC_ID);
      await p.whenSynced;
      const sk = readSketch(doc, SKETCH_ID);
      expect(sk).not.toBeNull();
      expect(sk!.segments).toHaveLength(3);
      expect(sk!.segments.map(s => s.id)).toEqual(['seg-0', 'seg-1', 'seg-2']);
      await p.destroy();
      doc.destroy();
    }
  });

  it('wipe contract: clearLocalCache resets, reopen sees empty', async () => {
    {
      const doc = new Y.Doc();
      const p = setupOfflinePersistence(doc, DOC_ID);
      await p.whenSynced;
      applySketchOp(doc, { kind: 'createSketch', sketch: makeSketch() }, ORIGIN_LOCAL_UI);
      applySketchOp(doc, {
        kind: 'addSegment',
        sketchId: SKETCH_ID,
        segment: { id: 'seed', type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      }, ORIGIN_LOCAL_UI);
      await p.destroy();
      doc.destroy();
    }

    await clearLocalCache(DOC_ID);

    {
      const doc = new Y.Doc();
      const p = setupOfflinePersistence(doc, DOC_ID);
      await p.whenSynced;
      const sk = readSketch(doc, SKETCH_ID);
      // After clearLocalCache, the DB is gone — reopening starts empty.
      expect(sk).toBeNull();
      await p.destroy();
      doc.destroy();
    }
  });

  it('dbName / formatCacheSize integration: smoke-readable values', () => {
    expect(dbNameFor(DOC_ID)).toBe(`nexyfab-collab::${DOC_ID}`);
    expect(formatCacheSize(0)).toBe('0 B');
    expect(formatCacheSize(1024)).toBe('1.0 KB');
    expect(formatCacheSize(1024 * 1024 * 4.2)).toBe('4.2 MB');
  });

  it('cycle counter: three open/close cycles preserve data each time', async () => {
    let expected = 0;
    for (let cycle = 1; cycle <= 3; cycle++) {
      const doc = new Y.Doc();
      const p = setupOfflinePersistence(doc, DOC_ID);
      await p.whenSynced;
      if (cycle === 1) {
        applySketchOp(doc, { kind: 'createSketch', sketch: makeSketch() }, ORIGIN_LOCAL_UI);
      }
      // Each cycle adds 2 segments.
      for (let i = 0; i < 2; i++) {
        applySketchOp(doc, {
          kind: 'addSegment',
          sketchId: SKETCH_ID,
          segment: { id: `c${cycle}-s${i}`, type: 'line', points: [{ x: i, y: 0 }, { x: i, y: 1 }] },
        }, ORIGIN_LOCAL_UI);
      }
      expected += 2;
      expect(readSketch(doc, SKETCH_ID)!.segments).toHaveLength(expected);
      await p.destroy();
      doc.destroy();
    }
  });
});
