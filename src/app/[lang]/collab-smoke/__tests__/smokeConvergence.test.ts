import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import {
  ORIGIN_LOCAL_UI,
  ORIGIN_REMOTE_UPDATE,
  applySketchOp,
  readSketch,
  type Sketch,
} from '../../shape-generator/collab/sketchYjs';

const SKETCH_ID = 'smoke-sketch';

function makeBaseSketch(): Sketch {
  return {
    id: SKETCH_ID,
    plane: 'xy',
    planeOffset: 0,
    operation: 'add',
    faceFrame: null,
    config: {
      mode: 'extrude',
      depth: 50,
      revolveAngle: 360,
      revolveAxis: 'y',
      segments: 32,
    },
    segments: [],
    constraints: [],
    dimensions: [],
  };
}

function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  // Bootstrap once on A; sync to B so both peers share the SAME root
  // sketch Y.Map. Two independent createSketch calls with the same
  // sketchId would LWW into one (sketchYjs.ts:417 docs the wart).
  applySketchOp(a, { kind: 'createSketch', sketch: makeBaseSketch() }, ORIGIN_LOCAL_UI);
  const sync = (from: Y.Doc, to: Y.Doc) =>
    Y.applyUpdate(to, Y.encodeStateAsUpdate(from), ORIGIN_REMOTE_UPDATE);
  sync(a, b);
  return { a, b, sync };
}

describe('collab-smoke harness convergence', () => {
  it('checklist #1: auto-sync mirrors adds from A to B', () => {
    const { a, b, sync } = pair();
    for (let i = 0; i < 3; i++) {
      applySketchOp(
        a,
        {
          kind: 'addSegment',
          sketchId: SKETCH_ID,
          segment: { id: `seg-A-${i}`, type: 'line', points: [{ x: i, y: 0 }, { x: i + 1, y: 1 }] },
        },
        ORIGIN_LOCAL_UI,
      );
      sync(a, b);
    }
    const skA = readSketch(a, SKETCH_ID)!;
    const skB = readSketch(b, SKETCH_ID)!;
    expect(skA.segments.length).toBe(3);
    expect(skB.segments.length).toBe(3);
    expect(skB.segments.map(s => s.id).sort()).toEqual(skA.segments.map(s => s.id).sort());
  });

  it('checklist #2: concurrent different-id ops merge to union', () => {
    const { a, b, sync } = pair();
    applySketchOp(a, {
      kind: 'addSegment', sketchId: SKETCH_ID,
      segment: { id: 'seg-A-1', type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    }, ORIGIN_LOCAL_UI);
    applySketchOp(a, {
      kind: 'addSegment', sketchId: SKETCH_ID,
      segment: { id: 'seg-A-2', type: 'line', points: [{ x: 2, y: 2 }, { x: 3, y: 3 }] },
    }, ORIGIN_LOCAL_UI);
    applySketchOp(b, {
      kind: 'addSegment', sketchId: SKETCH_ID,
      segment: { id: 'seg-B-1', type: 'line', points: [{ x: 4, y: 4 }, { x: 5, y: 5 }] },
    }, ORIGIN_LOCAL_UI);
    applySketchOp(b, {
      kind: 'addSegment', sketchId: SKETCH_ID,
      segment: { id: 'seg-B-2', type: 'line', points: [{ x: 6, y: 6 }, { x: 7, y: 7 }] },
    }, ORIGIN_LOCAL_UI);

    sync(a, b);
    sync(b, a);

    const skA = readSketch(a, SKETCH_ID)!;
    const skB = readSketch(b, SKETCH_ID)!;
    expect(skA.segments.length).toBe(4);
    expect(skB.segments.length).toBe(4);
    const idsA = skA.segments.map(s => s.id).sort();
    const idsB = skB.segments.map(s => s.id).sort();
    expect(idsA).toEqual(idsB);
    expect(idsA).toEqual(['seg-A-1', 'seg-A-2', 'seg-B-1', 'seg-B-2']);
  });

  it('checklist #3: concurrent same-id updates converge by LWW', () => {
    const { a, b, sync } = pair();
    applySketchOp(a, {
      kind: 'addSegment', sketchId: SKETCH_ID,
      segment: { id: 'seg-shared', type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    }, ORIGIN_LOCAL_UI);
    sync(a, b);

    applySketchOp(a, {
      kind: 'updateSegment', sketchId: SKETCH_ID, segmentId: 'seg-shared',
      patch: { points: [{ x: 10, y: 10 }, { x: 11, y: 11 }] },
    }, ORIGIN_LOCAL_UI);
    applySketchOp(b, {
      kind: 'updateSegment', sketchId: SKETCH_ID, segmentId: 'seg-shared',
      patch: { points: [{ x: 20, y: 20 }, { x: 21, y: 21 }] },
    }, ORIGIN_LOCAL_UI);

    sync(a, b);
    sync(b, a);

    const skA = readSketch(a, SKETCH_ID)!;
    const skB = readSketch(b, SKETCH_ID)!;
    expect(skA.segments.length).toBe(1);
    expect(skB.segments.length).toBe(1);
    expect(skA.segments[0]!.points).toEqual(skB.segments[0]!.points);
  });

  it('checklist #4: stress — 10+10 concurrent adds converge to 20', () => {
    const { a, b, sync } = pair();
    for (let i = 0; i < 10; i++) {
      applySketchOp(a, {
        kind: 'addSegment', sketchId: SKETCH_ID,
        segment: { id: `seg-A-${i}`, type: 'line', points: [{ x: i, y: 0 }, { x: i, y: 1 }] },
      }, ORIGIN_LOCAL_UI);
      applySketchOp(b, {
        kind: 'addSegment', sketchId: SKETCH_ID,
        segment: { id: `seg-B-${i}`, type: 'line', points: [{ x: i, y: 2 }, { x: i, y: 3 }] },
      }, ORIGIN_LOCAL_UI);
    }
    sync(a, b);
    sync(b, a);
    const skA = readSketch(a, SKETCH_ID)!;
    const skB = readSketch(b, SKETCH_ID)!;
    expect(skA.segments.length).toBe(20);
    expect(skB.segments.length).toBe(20);
    expect(skA.segments.map(s => s.id).sort()).toEqual(skB.segments.map(s => s.id).sort());
  });
});
