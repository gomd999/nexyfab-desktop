import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  getSharedSegments,
  segmentToYMap,
  yMapToSegment,
  readSegments,
  appendSegment,
  findSegmentById,
  setConstruction,
  removeSegment,
  hydrateSegments,
  syncDocs,
} from '../sketchCrdt';
import type { SketchSegment } from '../../sketch/types';

const line = (id: string, x1 = 0, y1 = 0, x2 = 10, y2 = 0): SketchSegment => ({
  id,
  type: 'line',
  points: [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ],
});

describe('segment ↔ Y.Map round-trip (via doc-attached array)', () => {
  it('preserves type, id, points', () => {
    const doc = new Y.Doc();
    const arr = getSharedSegments(doc);
    appendSegment(arr, line('s1'));
    const back = yMapToSegment(arr.get(0));
    expect(back.id).toBe('s1');
    expect(back.type).toBe('line');
    expect(back.points).toEqual(line('s1').points);
  });

  it('preserves construction flag when set', () => {
    const doc = new Y.Doc();
    const arr = getSharedSegments(doc);
    appendSegment(arr, { ...line('s1'), construction: true });
    const back = yMapToSegment(arr.get(0));
    expect(back.construction).toBe(true);
  });

  it('preserves NURBS-specific fields (degree, knots, weights)', () => {
    const doc = new Y.Doc();
    const arr = getSharedSegments(doc);
    appendSegment(arr, {
      id: 's1', type: 'nurbs',
      points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }],
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      weights: [1, 2, 1],
    });
    const back = yMapToSegment(arr.get(0));
    expect(back.degree).toBe(2);
    expect(back.knots).toEqual([0, 0, 0, 1, 1, 1]);
    expect(back.weights).toEqual([1, 2, 1]);
  });
});

describe('single-doc operations', () => {
  it('appendSegment + readSegments round-trips', () => {
    const doc = new Y.Doc();
    const arr = getSharedSegments(doc);
    appendSegment(arr, line('s1'));
    appendSegment(arr, line('s2', 0, 0, 0, 10));
    const segs = readSegments(arr);
    expect(segs.map(s => s.id)).toEqual(['s1', 's2']);
  });

  it('findSegmentById returns the Y.Map', () => {
    const doc = new Y.Doc();
    const arr = getSharedSegments(doc);
    appendSegment(arr, line('s1'));
    const found = findSegmentById(arr, 's1');
    expect(found).not.toBeNull();
    expect(found!.get('id')).toBe('s1');
  });

  it('returns null when id not present', () => {
    const doc = new Y.Doc();
    const arr = getSharedSegments(doc);
    expect(findSegmentById(arr, 'ghost')).toBeNull();
  });

  it('setConstruction toggles the flag in-place', () => {
    const doc = new Y.Doc();
    const arr = getSharedSegments(doc);
    appendSegment(arr, line('s1'));
    expect(setConstruction(arr, 's1', true)).toBe(true);
    expect(readSegments(arr)[0].construction).toBe(true);
    expect(setConstruction(arr, 'ghost', true)).toBe(false);
  });

  it('removeSegment removes by id', () => {
    const doc = new Y.Doc();
    const arr = getSharedSegments(doc);
    appendSegment(arr, line('s1'));
    appendSegment(arr, line('s2'));
    expect(removeSegment(arr, 's1')).toBe(true);
    expect(readSegments(arr).map(s => s.id)).toEqual(['s2']);
  });

  it('hydrateSegments replaces the array atomically', () => {
    const doc = new Y.Doc();
    const arr = getSharedSegments(doc);
    appendSegment(arr, line('s1'));
    hydrateSegments(arr, [line('a'), line('b'), line('c')]);
    expect(readSegments(arr).map(s => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('two-doc concurrent sync', () => {
  it('two users adding distinct segments → both visible after sync', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    appendSegment(getSharedSegments(a), line('a-1'));
    appendSegment(getSharedSegments(b), line('b-1'));
    syncDocs(a, b);
    const aSegs = readSegments(getSharedSegments(a)).map(s => s.id).sort();
    const bSegs = readSegments(getSharedSegments(b)).map(s => s.id).sort();
    expect(aSegs).toEqual(['a-1', 'b-1']);
    expect(bSegs).toEqual(['a-1', 'b-1']);
  });

  it('concurrent edits to different keys of the same segment merge', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    // Both docs start with the same segment.
    appendSegment(getSharedSegments(a), line('shared'));
    syncDocs(a, b);
    // A flips construction; B updates the type (rare but legal).
    setConstruction(getSharedSegments(a), 'shared', true);
    findSegmentById(getSharedSegments(b), 'shared')?.set('type', 'arc');
    syncDocs(a, b);
    const segA = readSegments(getSharedSegments(a))[0];
    const segB = readSegments(getSharedSegments(b))[0];
    expect(segA.construction).toBe(true);
    expect(segA.type).toBe('arc');
    expect(segB.construction).toBe(true);
    expect(segB.type).toBe('arc');
  });

  it('concurrent deletes of different segments do not affect each other', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    hydrateSegments(getSharedSegments(a), [line('s1'), line('s2'), line('s3')]);
    syncDocs(a, b);
    removeSegment(getSharedSegments(a), 's1');
    removeSegment(getSharedSegments(b), 's3');
    syncDocs(a, b);
    const aIds = readSegments(getSharedSegments(a)).map(s => s.id);
    const bIds = readSegments(getSharedSegments(b)).map(s => s.id);
    expect(aIds).toEqual(['s2']);
    expect(bIds).toEqual(['s2']);
  });

  it('hydrate on both sides without sync produces correct local state', () => {
    const a = new Y.Doc();
    hydrateSegments(getSharedSegments(a), [line('a1'), line('a2')]);
    expect(readSegments(getSharedSegments(a)).length).toBe(2);
  });
});
