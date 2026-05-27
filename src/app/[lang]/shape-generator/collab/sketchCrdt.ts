/**
 * sketchCrdt.ts — Yjs CRDT binding for sketch segments.
 *
 * Sketches store their segments as `SketchSegment[]` in the legacy
 * store. Mapping that to Yjs gives us conflict-free concurrent edits:
 * two users adding distinct lines, modifying different attributes of
 * the same segment, or reordering segments all merge deterministically
 * with no manual reconciliation.
 *
 * Shape on the wire:
 *   `sketchSegments` (Y.Array<Y.Map>) — one Y.Map per segment, keyed
 *      by stable `id`. Each Y.Map carries the SketchSegment fields:
 *      - `type` (string)
 *      - `points` (JSON string of SketchPoint[])
 *      - `construction` (boolean)
 *      - `id` (string)
 *      - degree / knots / weights (for nurbs) — JSON strings
 *
 * Why JSON-string the points array instead of nesting another Y.Array?
 * Points are an atomic geometric unit — a "move this vertex" edit
 * always replaces the whole array. Nesting would let two users edit
 * different vertices of the same segment concurrently but the merge
 * doesn't carry sketch-solver semantics (the two edits often produce
 * an inconsistent geometry), so atomic LWW on the points array is the
 * better semantic match.
 */

import * as Y from 'yjs';
import type { SketchSegment, SketchPoint } from '../sketch/types';

const SEGMENTS_KEY = 'sketchSegments';

export type SketchSegmentMap = Y.Map<unknown>;
export type SketchSegmentsArray = Y.Array<SketchSegmentMap>;

/** Get (creating if needed) the shared sketch-segments array on a doc. */
export function getSharedSegments(doc: Y.Doc): SketchSegmentsArray {
  return doc.getArray<SketchSegmentMap>(SEGMENTS_KEY);
}

/** Build a Y.Map representing a single SketchSegment. */
export function segmentToYMap(seg: SketchSegment): SketchSegmentMap {
  const map = new Y.Map<unknown>();
  map.set('id', seg.id ?? '');
  map.set('type', seg.type);
  map.set('points', JSON.stringify(seg.points));
  if (seg.construction !== undefined) map.set('construction', seg.construction);
  if (seg.degree !== undefined) map.set('degree', seg.degree);
  if (seg.knots !== undefined) map.set('knots', JSON.stringify(seg.knots));
  if (seg.weights !== undefined) map.set('weights', JSON.stringify(seg.weights));
  return map;
}

/** Convert a Y.Map back into a plain SketchSegment for legacy consumers. */
export function yMapToSegment(map: SketchSegmentMap): SketchSegment {
  const out: SketchSegment = {
    type: (map.get('type') as SketchSegment['type']) ?? 'line',
    points: JSON.parse((map.get('points') as string) ?? '[]') as SketchPoint[],
  };
  const id = map.get('id') as string | undefined;
  if (id) out.id = id;
  const construction = map.get('construction') as boolean | undefined;
  if (construction !== undefined) out.construction = construction;
  const degree = map.get('degree') as number | undefined;
  if (degree !== undefined) out.degree = degree;
  const knots = map.get('knots') as string | undefined;
  if (knots) out.knots = JSON.parse(knots) as number[];
  const weights = map.get('weights') as string | undefined;
  if (weights) out.weights = JSON.parse(weights) as number[];
  return out;
}

/** Snapshot the shared array as a plain SketchSegment[]. */
export function readSegments(arr: SketchSegmentsArray): SketchSegment[] {
  const out: SketchSegment[] = [];
  arr.forEach(map => out.push(yMapToSegment(map)));
  return out;
}

/** Append a new segment to the shared array. Returns the Y.Map so the
 *  caller can attach observers if needed. */
export function appendSegment(arr: SketchSegmentsArray, seg: SketchSegment): SketchSegmentMap {
  const map = segmentToYMap(seg);
  arr.push([map]);
  return map;
}

/** Find a segment by id and return its Y.Map (or null). Linear scan —
 *  fine for the dozens-of-segments range that real sketches hit. */
export function findSegmentById(arr: SketchSegmentsArray, id: string): SketchSegmentMap | null {
  for (let i = 0; i < arr.length; i++) {
    const m = arr.get(i);
    if (m.get('id') === id) return m;
  }
  return null;
}

/** Patch the construction flag on a specific segment. */
export function setConstruction(
  arr: SketchSegmentsArray,
  id: string,
  construction: boolean,
): boolean {
  const m = findSegmentById(arr, id);
  if (!m) return false;
  m.set('construction', construction);
  return true;
}

/** Remove a segment by id. Returns true when removed, false when not found. */
export function removeSegment(arr: SketchSegmentsArray, id: string): boolean {
  for (let i = 0; i < arr.length; i++) {
    const m = arr.get(i);
    if (m.get('id') === id) {
      arr.delete(i, 1);
      return true;
    }
  }
  return false;
}

/** Bulk-load a plain array into the shared structure. Used on initial
 *  hydration when a user opens a sketch that's not yet been
 *  collaboratively edited. Existing entries are cleared. */
export function hydrateSegments(arr: SketchSegmentsArray, segments: SketchSegment[]): void {
  arr.doc?.transact(() => {
    arr.delete(0, arr.length);
    for (const seg of segments) arr.push([segmentToYMap(seg)]);
  });
}

/** Sync two docs by exchanging update vectors. Returns the diff bytes
 *  exchanged in each direction — useful for telemetry / tests. */
export function syncDocs(a: Y.Doc, b: Y.Doc): { aToB: number; bToA: number } {
  const stateA = Y.encodeStateVector(a);
  const stateB = Y.encodeStateVector(b);
  const updateForB = Y.encodeStateAsUpdate(a, stateB);
  const updateForA = Y.encodeStateAsUpdate(b, stateA);
  Y.applyUpdate(b, updateForB);
  Y.applyUpdate(a, updateForA);
  return { aToB: updateForB.byteLength, bToA: updateForA.byteLength };
}
