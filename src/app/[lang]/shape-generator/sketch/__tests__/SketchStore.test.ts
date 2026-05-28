/**
 * SketchStore.test.ts — Wave 2 Phase 3 Track Z2 adapter cases.
 *
 * Both modes (local + Yjs) implement the same interface. We exercise:
 *  - local mode mirrors plain-array state behaviour
 *  - Yjs mode mutations roundtrip through the doc and rebuild snapshots
 *  - migrateToYjs preserves all entities
 *  - Subscribe / unsubscribe fires correctly
 *  - Switching modes mid-session doesn't lose data
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  SketchStore,
  migrateToYjs,
  emptySketch,
  type Sketch,
} from '../SketchStore';
import { readSketch } from '../../collab/sketchYjs';
import type {
  SketchSegment,
  SketchConstraint,
  SketchDimension,
} from '../types';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function line(id: string, x1 = 0, y1 = 0, x2 = 10, y2 = 0): SketchSegment {
  return { id, type: 'line', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] };
}
function hConstraint(id: string, ...entityIds: string[]): SketchConstraint {
  return { id, type: 'horizontal', entityIds, satisfied: true };
}
function linearDim(id: string, value: number, ...entityIds: string[]): SketchDimension {
  return { id, type: 'linear', entityIds, value, position: { x: 0, y: 5 }, locked: false };
}

function sampleSketch(id = 's1'): Sketch {
  return {
    ...emptySketch(id),
    segments: [line('seg-a'), line('seg-b', 0, 0, 0, 10)],
    constraints: [hConstraint('c-1', 'seg-a')],
    dimensions: [linearDim('d-1', 10, 'seg-a')],
  };
}

// ─── 1. Local mode ─────────────────────────────────────────────────────────

describe('SketchStore.local — basic state mirroring', () => {
  it('mode is "local"', () => {
    const s = SketchStore.local();
    expect(s.mode).toBe('local');
  });

  it('empty store reports the default sketchId', () => {
    const s = SketchStore.local();
    expect(s.sketchId).toBe('sketch-1');
    expect(s.getSegments()).toEqual([]);
  });

  it('accepts an initial Sketch and exposes its segments', () => {
    const s = SketchStore.local(sampleSketch());
    expect(s.getSegments().map(x => x.id)).toEqual(['seg-a', 'seg-b']);
  });

  it('addSegment appends and notifies', () => {
    const s = SketchStore.local();
    let count = 0;
    s.subscribe(() => { count += 1; });
    s.addSegment(line('seg-x'));
    expect(s.getSegments().map(x => x.id)).toEqual(['seg-x']);
    expect(count).toBe(1);
  });

  it('addSegment with same id replaces (LWW)', () => {
    const s = SketchStore.local();
    s.addSegment(line('seg-x', 0, 0, 1, 1));
    s.addSegment(line('seg-x', 5, 5, 6, 6));
    const segs = s.getSegments();
    expect(segs).toHaveLength(1);
    expect(segs[0]!.points[0]).toEqual({ x: 5, y: 5 });
  });

  it('updateSegment patches existing entries', () => {
    const s = SketchStore.local(sampleSketch());
    s.updateSegment('seg-a', { points: [{ x: 99, y: 99 }, { x: 100, y: 100 }] });
    expect(s.getSegments()[0]!.points[0]).toEqual({ x: 99, y: 99 });
  });

  it('updateSegment on missing id is a no-op', () => {
    const s = SketchStore.local(sampleSketch());
    let count = 0;
    s.subscribe(() => { count += 1; });
    s.updateSegment('seg-zzz', { construction: true });
    expect(count).toBe(0);
  });

  it('removeSegment drops the entry', () => {
    const s = SketchStore.local(sampleSketch());
    s.removeSegment('seg-a');
    expect(s.getSegments().map(x => x.id)).toEqual(['seg-b']);
  });

  it('constraint and dimension CRUD work', () => {
    const s = SketchStore.local();
    s.addConstraint(hConstraint('c-x', 's1'));
    s.addDimension(linearDim('d-x', 50, 's1'));
    expect(s.getConstraints()).toHaveLength(1);
    expect(s.getDimensions()).toHaveLength(1);
    s.updateConstraint('c-x', { satisfied: false });
    expect(s.getConstraints()[0]!.satisfied).toBe(false);
    s.updateDimension('d-x', { value: 75 });
    expect(s.getDimensions()[0]!.value).toBe(75);
    s.removeConstraint('c-x');
    s.removeDimension('d-x');
    expect(s.getConstraints()).toHaveLength(0);
    expect(s.getDimensions()).toHaveLength(0);
  });

  it('meta setters round-trip', () => {
    const s = SketchStore.local();
    s.setPlane('xz');
    s.setPlaneOffset(5);
    s.setOperation('subtract');
    s.setFaceFrame(null);
    s.setConfig({ ...s.getSketch().config, depth: 99 });
    const snap = s.getSketch();
    expect(snap.plane).toBe('xz');
    expect(snap.planeOffset).toBe(5);
    expect(snap.operation).toBe('subtract');
    expect(snap.config.depth).toBe(99);
  });

  it('setSegments replaces the whole array', () => {
    const s = SketchStore.local(sampleSketch());
    s.setSegments([line('seg-new')]);
    expect(s.getSegments().map(x => x.id)).toEqual(['seg-new']);
  });

  it('subscribe / unsubscribe lifecycle', () => {
    const s = SketchStore.local();
    let count = 0;
    const unsub = s.subscribe(() => { count += 1; });
    s.addSegment(line('a'));
    s.addSegment(line('b'));
    expect(count).toBe(2);
    unsub();
    s.addSegment(line('c'));
    expect(count).toBe(2);
  });

  it('destroy clears listeners', () => {
    const s = SketchStore.local();
    let count = 0;
    s.subscribe(() => { count += 1; });
    s.destroy();
    s.addSegment(line('a'));
    expect(count).toBe(0);
  });

  it('getSketch returns a defensive copy', () => {
    const s = SketchStore.local(sampleSketch());
    const snap = s.getSketch();
    snap.segments.push(line('mutated'));
    expect(s.getSegments()).toHaveLength(2); // unchanged
  });

  it('addSegment without id throws', () => {
    const s = SketchStore.local();
    expect(() => s.addSegment({ type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }))
      .toThrowError(/requires segment.id/);
  });
});

// ─── 2. Yjs mode ───────────────────────────────────────────────────────────

describe('SketchStore.fromYDoc — Yjs mode roundtrips', () => {
  it('mode is "yjs"', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    expect(s.mode).toBe('yjs');
  });

  it('creates an empty sketch on the doc on construction', () => {
    const doc = new Y.Doc();
    SketchStore.fromYDoc(doc, 's1');
    expect(readSketch(doc, 's1')).not.toBeNull();
  });

  it('addSegment lands in the doc', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    s.addSegment(line('seg-a'));
    expect(readSketch(doc, 's1')!.segments.map(x => x.id)).toEqual(['seg-a']);
  });

  it('updateSegment patches the doc entry', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    s.addSegment(line('seg-a'));
    s.updateSegment('seg-a', { points: [{ x: 100, y: 100 }, { x: 200, y: 200 }] });
    expect(readSketch(doc, 's1')!.segments[0]!.points[0]).toEqual({ x: 100, y: 100 });
  });

  it('removeSegment drops from the doc', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    s.addSegment(line('seg-a'));
    s.addSegment(line('seg-b'));
    s.removeSegment('seg-a');
    expect(readSketch(doc, 's1')!.segments.map(x => x.id)).toEqual(['seg-b']);
  });

  it('constraint + dimension CRUD route through Y ops', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    s.addSegment(line('seg-a'));
    s.addConstraint(hConstraint('c-1', 'seg-a'));
    s.addDimension(linearDim('d-1', 25, 'seg-a'));
    const snap = readSketch(doc, 's1')!;
    expect(snap.constraints).toHaveLength(1);
    expect(snap.dimensions).toHaveLength(1);
    expect(snap.dimensions[0]!.value).toBe(25);
  });

  it('setConfig persists through the doc', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    s.setConfig({ ...emptySketch('s1').config, depth: 77 });
    expect(readSketch(doc, 's1')!.config.depth).toBe(77);
  });

  it('subscribe fires on doc updates', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    let count = 0;
    s.subscribe(() => { count += 1; });
    s.addSegment(line('seg-a'));
    s.addSegment(line('seg-b'));
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('destroy detaches the doc observer', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    let count = 0;
    s.subscribe(() => { count += 1; });
    s.destroy();
    s.addSegment(line('seg-a')); // still applies but no notify because subscribers cleared
    expect(count).toBe(0);
  });

  it('getDoc returns the wrapped Y.Doc', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    expect(s.getDoc?.()).toBe(doc);
  });

  it('two stores on different docs sync via syncUpdate', () => {
    // Per smoke-harness rules: only one peer creates the sketch; the other
    // joins via initial sync. Otherwise two competing createSketch ops
    // collide via LWW and the loser drops the entire sub-tree.
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = SketchStore.fromYDoc(docA, 's1');
    a.addSegment(line('seg-a'));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    SketchStore.fromYDoc(docB, 's1'); // joins existing
    expect(readSketch(docB, 's1')!.segments.map(x => x.id)).toEqual(['seg-a']);
  });

  it('setSegments diffs against current to preserve unrelated entries', () => {
    const doc = new Y.Doc();
    const s = SketchStore.fromYDoc(doc, 's1');
    s.addSegment(line('seg-a'));
    s.addSegment(line('seg-b'));
    s.setSegments([line('seg-a', 0, 0, 1, 1), line('seg-c')]);
    const segs = readSketch(doc, 's1')!.segments;
    expect(segs.map(x => x.id).sort()).toEqual(['seg-a', 'seg-c']);
    expect(segs.find(x => x.id === 'seg-a')!.points[1]).toEqual({ x: 1, y: 1 });
  });
});

// ─── 3. migrateToYjs ───────────────────────────────────────────────────────

describe('migrateToYjs — preserves local state', () => {
  it('moves segments + constraints + dimensions into the doc', () => {
    const local = SketchStore.local(sampleSketch());
    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);

    expect(yjs.mode).toBe('yjs');
    const snap = readSketch(doc, 's1')!;
    expect(snap.segments).toHaveLength(2);
    expect(snap.constraints).toHaveLength(1);
    expect(snap.dimensions).toHaveLength(1);
  });

  it('throws when source store is already in yjs mode', () => {
    const doc = new Y.Doc();
    const yjs = SketchStore.fromYDoc(doc, 's1');
    expect(() => migrateToYjs(yjs, new Y.Doc())).toThrowError(/local mode/);
  });

  it('migrating an empty local store yields an empty yjs store', () => {
    const local = SketchStore.local();
    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);
    expect(yjs.getSegments()).toEqual([]);
  });

  it('overrides existing sketch under same id', () => {
    const doc = new Y.Doc();
    // Pre-populate the doc with a competing sketch.
    const pre = SketchStore.fromYDoc(doc, 's1');
    pre.addSegment(line('old-seg'));
    pre.destroy();

    const local = SketchStore.local(sampleSketch());
    const yjs = migrateToYjs(local, doc);
    const ids = yjs.getSegments().map(s => s.id);
    expect(ids).not.toContain('old-seg');
    expect(ids).toEqual(['seg-a', 'seg-b']);
  });

  it('switching modes mid-session does not lose data', () => {
    const local = SketchStore.local();
    local.addSegment(line('seg-x', 0, 0, 5, 5));
    local.addConstraint(hConstraint('c-x', 'seg-x'));

    const doc = new Y.Doc();
    const yjs = migrateToYjs(local, doc);

    expect(yjs.getSegments()).toHaveLength(1);
    expect(yjs.getConstraints()).toHaveLength(1);

    // New writes through Yjs land in the doc.
    yjs.addSegment(line('seg-y'));
    expect(readSketch(doc, yjs.sketchId)!.segments).toHaveLength(2);
  });
});

// ─── 4. Conflict semantics ─────────────────────────────────────────────────

describe('SketchStore — LWW + concurrent edit semantics', () => {
  it('two peers updating same segment converge on LWW', () => {
    // Single creator pattern (see smoke harness rule).
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = SketchStore.fromYDoc(docA, 's1');
    a.addSegment(line('seg-a', 0, 0, 1, 0));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = SketchStore.fromYDoc(docB, 's1');

    // Concurrent updates on the same key (LWW resolves).
    a.updateSegment('seg-a', { points: [{ x: 0, y: 0 }, { x: 99, y: 0 }] });
    b.updateSegment('seg-a', { points: [{ x: 0, y: 0 }, { x: 11, y: 0 }] });

    // Bidirectional sync.
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    const finalA = readSketch(docA, 's1')!.segments[0]!.points[1];
    const finalB = readSketch(docB, 's1')!.segments[0]!.points[1];
    expect(finalA).toEqual(finalB);
  });

  it('two peers adding different segments both survive', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = SketchStore.fromYDoc(docA, 's1');
    // Sync the empty-create to B before mutating.
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = SketchStore.fromYDoc(docB, 's1');

    a.addSegment(line('seg-a'));
    b.addSegment(line('seg-b'));

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    const idsA = readSketch(docA, 's1')!.segments.map(s => s.id).sort();
    const idsB = readSketch(docB, 's1')!.segments.map(s => s.id).sort();
    expect(idsA).toEqual(['seg-a', 'seg-b']);
    expect(idsB).toEqual(['seg-a', 'seg-b']);
  });
});
