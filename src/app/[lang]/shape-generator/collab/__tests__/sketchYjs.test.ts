/**
 * sketchYjs.test.ts — Wave 2 Phase 1 Week 2 CRDT prototype tests.
 *
 * Coverage:
 *   1. Round-trip — sketch → YDoc → sketch (idempotent).
 *   2. Two-peer concurrent add entity — no conflict because Y.Map keys differ.
 *   3. Two-peer concurrent update of the same constraint — LWW convergence.
 *   4. Entity rename — constraint cross-references survive.
 *   5. Op atomicity — composite ops (addSegmentWithConstraints) land as one
 *      update, observers never see partial state.
 *   6. Orphan-tolerance — updateSegment / updateConstraint on missing ids
 *      no-ops without throwing.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applySketchOp,
  getSketchesRoot,
  readAllSketches,
  readSketch,
  sketchToYDoc,
  yDocToSketch,
  sketchesEqual,
  syncDocs,
  type Sketch,
  ORIGIN_LOCAL_UI,
} from '../sketchYjs';
import type {
  SketchSegment,
  SketchConstraint,
  SketchDimension,
  SketchConfig,
  SketchPoint,
} from '../../sketch/types';

// ─── Test fixtures ─────────────────────────────────────────────────────────

const defaultConfig = (): SketchConfig => ({
  mode: 'extrude',
  depth: 50,
  revolveAngle: 360,
  revolveAxis: 'y',
  segments: 32,
});

const line = (id: string, p1: SketchPoint, p2: SketchPoint): SketchSegment => ({
  id,
  type: 'line',
  points: [p1, p2],
});

const horizontalConstraint = (id: string, ...entityIds: string[]): SketchConstraint => ({
  id,
  type: 'horizontal',
  entityIds,
  satisfied: true,
});

const linearDim = (id: string, value: number, ...entityIds: string[]): SketchDimension => ({
  id,
  type: 'linear',
  entityIds,
  value,
  position: { x: 0, y: 5 },
  locked: false,
});

const sampleSketch = (id = 'sketch-1'): Sketch => ({
  id,
  plane: 'xy',
  planeOffset: 0,
  operation: 'add',
  faceFrame: null,
  config: defaultConfig(),
  segments: [
    line('seg-a', { x: 0, y: 0 }, { x: 10, y: 0 }),
    line('seg-b', { x: 10, y: 0 }, { x: 10, y: 10 }),
    {
      id: 'seg-nurbs',
      type: 'nurbs',
      points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }],
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      weights: [1, 2, 1],
    },
  ],
  constraints: [
    horizontalConstraint('con-h1', 'seg-a'),
    {
      id: 'con-perp',
      type: 'perpendicular',
      entityIds: ['seg-a', 'seg-b'],
      satisfied: true,
    },
  ],
  dimensions: [linearDim('dim-len', 10, 'seg-a')],
});

// ─── 1. Round trip ─────────────────────────────────────────────────────────

describe('sketchToYDoc / yDocToSketch round trip', () => {
  it('preserves every field of a fully populated sketch', () => {
    const original = sampleSketch();
    const doc = sketchToYDoc(original);
    const back = yDocToSketch(doc);
    expect(back).not.toBeNull();
    expect(sketchesEqual(original, back!)).toBe(true);
  });

  it('round-trip is idempotent — feeding the snapshot back produces the same doc', () => {
    const original = sampleSketch();
    const doc1 = sketchToYDoc(original);
    const back1 = yDocToSketch(doc1)!;
    const doc2 = sketchToYDoc(back1);
    const back2 = yDocToSketch(doc2)!;
    expect(sketchesEqual(back1, back2)).toBe(true);
  });

  it('preserves NURBS-specific fields (degree, knots, weights)', () => {
    const original = sampleSketch();
    const doc = sketchToYDoc(original);
    const back = yDocToSketch(doc)!;
    const nurbsBack = back.segments.find(s => s.id === 'seg-nurbs')!;
    expect(nurbsBack.degree).toBe(2);
    expect(nurbsBack.knots).toEqual([0, 0, 0, 1, 1, 1]);
    expect(nurbsBack.weights).toEqual([1, 2, 1]);
  });

  it('preserves faceFrame data when present', () => {
    const original = sampleSketch();
    original.faceFrame = {
      origin: [1, 2, 3],
      normal: [0, 0, 1],
      uAxis: [1, 0, 0],
      vAxis: [0, 1, 0],
    };
    const doc = sketchToYDoc(original);
    const back = yDocToSketch(doc)!;
    expect(back.faceFrame).toEqual(original.faceFrame);
  });

  it('readAllSketches returns every sketch added to the doc', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s1') });
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s2') });
    const all = readAllSketches(doc);
    expect(all.size).toBe(2);
    expect(all.get('s1')!.id).toBe('s1');
    expect(all.get('s2')!.id).toBe('s2');
  });

  it('yDocToSketch returns null on an empty doc', () => {
    const doc = new Y.Doc();
    expect(yDocToSketch(doc)).toBeNull();
  });
});

// ─── 2. Two-peer concurrent add ─────────────────────────────────────────────

describe('two-peer concurrent ops — Y.Map keying eliminates spurious conflicts', () => {
  it('two peers adding distinct segments under the same sketch — both survive', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    // Bootstrap: both docs start with an empty sketch under the same id.
    const empty: Sketch = {
      ...sampleSketch('shared'),
      segments: [],
      constraints: [],
      dimensions: [],
    };
    applySketchOp(a, { kind: 'createSketch', sketch: empty });
    syncDocs(a, b);

    // Concurrent inserts — different segment ids.
    applySketchOp(a, {
      kind: 'addSegment',
      sketchId: 'shared',
      segment: line('a-seg', { x: 0, y: 0 }, { x: 1, y: 0 }),
    });
    applySketchOp(b, {
      kind: 'addSegment',
      sketchId: 'shared',
      segment: line('b-seg', { x: 0, y: 0 }, { x: 0, y: 1 }),
    });

    syncDocs(a, b);

    const aSketch = readSketch(a, 'shared')!;
    const bSketch = readSketch(b, 'shared')!;
    expect(aSketch.segments.map(s => s.id).sort()).toEqual(['a-seg', 'b-seg']);
    expect(bSketch.segments.map(s => s.id).sort()).toEqual(['a-seg', 'b-seg']);
    expect(sketchesEqual(aSketch, bSketch)).toBe(true);
  });

  it('two peers adding distinct constraints — both survive after sync', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applySketchOp(a, {
      kind: 'createSketch',
      sketch: { ...sampleSketch('s'), constraints: [], dimensions: [] },
    });
    syncDocs(a, b);

    applySketchOp(a, {
      kind: 'addConstraint',
      sketchId: 's',
      constraint: horizontalConstraint('c-a', 'seg-a'),
    });
    applySketchOp(b, {
      kind: 'addConstraint',
      sketchId: 's',
      constraint: horizontalConstraint('c-b', 'seg-b'),
    });

    syncDocs(a, b);
    const aIds = readSketch(a, 's')!.constraints.map(c => c.id).sort();
    const bIds = readSketch(b, 's')!.constraints.map(c => c.id).sort();
    expect(aIds).toEqual(['c-a', 'c-b']);
    expect(bIds).toEqual(['c-a', 'c-b']);
  });

  it('two peers adding distinct dimensions — both survive after sync', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applySketchOp(a, {
      kind: 'createSketch',
      sketch: { ...sampleSketch('s'), dimensions: [] },
    });
    syncDocs(a, b);

    applySketchOp(a, {
      kind: 'addDimension',
      sketchId: 's',
      dimension: linearDim('d-a', 10, 'seg-a'),
    });
    applySketchOp(b, {
      kind: 'addDimension',
      sketchId: 's',
      dimension: linearDim('d-b', 20, 'seg-b'),
    });

    syncDocs(a, b);
    const aIds = readSketch(a, 's')!.dimensions.map(d => d.id).sort();
    const bIds = readSketch(b, 's')!.dimensions.map(d => d.id).sort();
    expect(aIds).toEqual(['d-a', 'd-b']);
    expect(bIds).toEqual(['d-a', 'd-b']);
  });
});

// ─── 3. LWW: concurrent same-key edits ──────────────────────────────────────

describe('LWW — concurrent updates to the same constraint converge deterministically', () => {
  it('two peers update the same constraint value → both converge to one winner', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const start: Sketch = {
      ...sampleSketch('s'),
      constraints: [
        {
          id: 'c-shared',
          type: 'distance',
          entityIds: ['seg-a'],
          satisfied: true,
          value: 100,
        },
      ],
    };
    applySketchOp(a, { kind: 'createSketch', sketch: start });
    syncDocs(a, b);

    // Concurrent update of `value` on the SAME constraint.
    applySketchOp(a, {
      kind: 'updateConstraint',
      sketchId: 's',
      constraintId: 'c-shared',
      patch: { value: 200 },
    });
    applySketchOp(b, {
      kind: 'updateConstraint',
      sketchId: 's',
      constraintId: 'c-shared',
      patch: { value: 300 },
    });

    syncDocs(a, b);

    const aCon = readSketch(a, 's')!.constraints.find(c => c.id === 'c-shared')!;
    const bCon = readSketch(b, 's')!.constraints.find(c => c.id === 'c-shared')!;
    // Both peers MUST agree (CRDT convergence guarantee).
    expect(aCon.value).toBe(bCon.value);
    // Winner is one of the two writes.
    expect([200, 300]).toContain(aCon.value);
  });

  it('two peers update DIFFERENT keys of the same constraint → both edits land', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const start: Sketch = {
      ...sampleSketch('s'),
      constraints: [
        {
          id: 'c-shared',
          type: 'distance',
          entityIds: ['seg-a'],
          satisfied: false,
          value: 100,
        },
      ],
    };
    applySketchOp(a, { kind: 'createSketch', sketch: start });
    syncDocs(a, b);

    // A updates the value; B updates the satisfied flag. Different keys.
    applySketchOp(a, {
      kind: 'updateConstraint',
      sketchId: 's',
      constraintId: 'c-shared',
      patch: { value: 250 },
    });
    applySketchOp(b, {
      kind: 'updateConstraint',
      sketchId: 's',
      constraintId: 'c-shared',
      patch: { satisfied: true },
    });

    syncDocs(a, b);

    const aCon = readSketch(a, 's')!.constraints.find(c => c.id === 'c-shared')!;
    const bCon = readSketch(b, 's')!.constraints.find(c => c.id === 'c-shared')!;
    expect(aCon).toEqual(bCon);
    expect(aCon.value).toBe(250);
    expect(aCon.satisfied).toBe(true);
  });

  it('LWW also applies to segment points (JSON-string atomic geometric edit)', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applySketchOp(a, { kind: 'createSketch', sketch: sampleSketch('s') });
    syncDocs(a, b);

    applySketchOp(a, {
      kind: 'updateSegment',
      sketchId: 's',
      segmentId: 'seg-a',
      patch: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    });
    applySketchOp(b, {
      kind: 'updateSegment',
      sketchId: 's',
      segmentId: 'seg-a',
      patch: { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] },
    });

    syncDocs(a, b);

    const aSeg = readSketch(a, 's')!.segments.find(s => s.id === 'seg-a')!;
    const bSeg = readSketch(b, 's')!.segments.find(s => s.id === 'seg-a')!;
    expect(aSeg.points).toEqual(bSeg.points);
    // One of the two atomic writes wins; never a partial mix.
    const endX = aSeg.points[1].x;
    expect([100, 200]).toContain(endX);
  });
});

// ─── 4. Entity rename — constraint references survive ──────────────────────

describe('renameEntity — id stability across references', () => {
  it('renaming a segment rewrites every constraint+dimension that references it', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s') });

    // Before rename: con-h1 references seg-a; con-perp references both
    // seg-a and seg-b; dim-len references seg-a.
    const beforeCon = readSketch(doc, 's')!.constraints;
    expect(beforeCon.find(c => c.id === 'con-h1')!.entityIds).toEqual(['seg-a']);
    expect(beforeCon.find(c => c.id === 'con-perp')!.entityIds).toEqual(['seg-a', 'seg-b']);
    expect(readSketch(doc, 's')!.dimensions[0].entityIds).toEqual(['seg-a']);

    const result = applySketchOp(doc, {
      kind: 'renameEntity',
      sketchId: 's',
      oldId: 'seg-a',
      newId: 'seg-renamed',
    });
    expect(result.applied).toBe(true);
    // Notes should mention how many cross-references were rewritten.
    expect(result.notes).toContain('rewritten');

    const after = readSketch(doc, 's')!;
    // Segment now lives under the new id only.
    expect(after.segments.map(s => s.id).sort()).toEqual(['seg-b', 'seg-nurbs', 'seg-renamed']);
    // Every reference now points at the new id.
    const afterCon = after.constraints;
    expect(afterCon.find(c => c.id === 'con-h1')!.entityIds).toEqual(['seg-renamed']);
    expect(afterCon.find(c => c.id === 'con-perp')!.entityIds).toEqual(['seg-renamed', 'seg-b']);
    expect(after.dimensions[0].entityIds).toEqual(['seg-renamed']);
  });

  it('renaming a non-existent entity returns applied=false', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s') });
    const result = applySketchOp(doc, {
      kind: 'renameEntity',
      sketchId: 's',
      oldId: 'does-not-exist',
      newId: 'whatever',
    });
    expect(result.applied).toBe(false);
  });

  it('renaming to an already-taken id throws (collision guard)', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s') });
    expect(() => {
      applySketchOp(doc, {
        kind: 'renameEntity',
        sketchId: 's',
        oldId: 'seg-a',
        newId: 'seg-b', // already exists
      });
    }).toThrow(/already exists/);
  });

  it('rename propagates across two peers via sync', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applySketchOp(a, { kind: 'createSketch', sketch: sampleSketch('s') });
    syncDocs(a, b);

    applySketchOp(a, {
      kind: 'renameEntity',
      sketchId: 's',
      oldId: 'seg-a',
      newId: 'seg-x',
    });
    syncDocs(a, b);

    const bSketch = readSketch(b, 's')!;
    expect(bSketch.segments.find(s => s.id === 'seg-x')).toBeDefined();
    expect(bSketch.segments.find(s => s.id === 'seg-a')).toBeUndefined();
    expect(bSketch.constraints.find(c => c.id === 'con-h1')!.entityIds).toEqual(['seg-x']);
  });
});

// ─── 5. Op atomicity — one transact, one update event ──────────────────────

describe('op atomicity — composite ops are one transact', () => {
  it('addSegmentWithConstraints fires exactly one update event', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, {
      kind: 'createSketch',
      sketch: { ...sampleSketch('s'), segments: [], constraints: [], dimensions: [] },
    });

    let updateCount = 0;
    const handler = (_u: Uint8Array, origin: unknown) => {
      // Skip the no-op 'remote' tagged updates; we want local updates only.
      if (origin === ORIGIN_LOCAL_UI) updateCount++;
    };
    doc.on('update', handler);

    applySketchOp(doc, {
      kind: 'addSegmentWithConstraints',
      sketchId: 's',
      segment: line('seg-new', { x: 0, y: 0 }, { x: 5, y: 0 }),
      constraints: [
        horizontalConstraint('auto-h', 'seg-new'),
        { id: 'auto-fix', type: 'fixed', entityIds: ['seg-new'], satisfied: true },
      ],
    });
    doc.off('update', handler);

    expect(updateCount).toBe(1);
    const s = readSketch(doc, 's')!;
    expect(s.segments.map(x => x.id)).toEqual(['seg-new']);
    expect(s.constraints.map(c => c.id).sort()).toEqual(['auto-fix', 'auto-h']);
  });

  it('observers never see a partial state — segment + its auto-constraint arrive together', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applySketchOp(a, {
      kind: 'createSketch',
      sketch: { ...sampleSketch('s'), segments: [], constraints: [], dimensions: [] },
    });
    syncDocs(a, b);

    // Observe on peer B — every observer firing must see a consistent state.
    const observed: { segIds: string[]; conRefs: string[][] }[] = [];
    const root = getSketchesRoot(b);
    const handler = () => {
      const s = readSketch(b, 's');
      if (!s) return;
      observed.push({
        segIds: s.segments.map(x => x.id ?? ''),
        conRefs: s.constraints.map(c => c.entityIds),
      });
    };
    root.observeDeep(handler);

    applySketchOp(a, {
      kind: 'addSegmentWithConstraints',
      sketchId: 's',
      segment: line('seg-atomic', { x: 0, y: 0 }, { x: 5, y: 0 }),
      constraints: [horizontalConstraint('c-atomic', 'seg-atomic')],
    });
    syncDocs(a, b);

    root.unobserveDeep(handler);

    // No snapshot should show a constraint referencing seg-atomic without
    // seg-atomic itself being present.
    for (const snap of observed) {
      for (const refList of snap.conRefs) {
        if (refList.includes('seg-atomic')) {
          expect(snap.segIds).toContain('seg-atomic');
        }
      }
    }
  });
});

// ─── 6. Orphan tolerance ───────────────────────────────────────────────────

describe('orphan tolerance — missing ids no-op without throwing', () => {
  it('updateSegment for a missing id returns applied=false', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s') });
    const result = applySketchOp(doc, {
      kind: 'updateSegment',
      sketchId: 's',
      segmentId: 'ghost',
      patch: { construction: true },
    });
    expect(result.applied).toBe(false);
    expect(result.notes).toContain('orphan-tolerated');
  });

  it('updateConstraint for a missing id returns applied=false', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s') });
    const result = applySketchOp(doc, {
      kind: 'updateConstraint',
      sketchId: 's',
      constraintId: 'ghost',
      patch: { satisfied: false },
    });
    expect(result.applied).toBe(false);
  });

  it('removing a constraint after its referenced segment was deleted is fine — solver tolerates dangling refs', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s') });
    // Delete seg-a — con-h1 now references a non-existent segment.
    applySketchOp(doc, { kind: 'removeSegment', sketchId: 's', segmentId: 'seg-a' });
    // The constraint is still there — by design, the solver no-ops dangling refs.
    const s = readSketch(doc, 's')!;
    expect(s.constraints.find(c => c.id === 'con-h1')).toBeDefined();
    expect(s.segments.find(x => x.id === 'seg-a')).toBeUndefined();
  });

  it('deleteSketch on a missing id returns applied=false', () => {
    const doc = new Y.Doc();
    const result = applySketchOp(doc, { kind: 'deleteSketch', sketchId: 'nope' });
    expect(result.applied).toBe(false);
  });
});

// ─── 7. Sketch meta updates ────────────────────────────────────────────────

describe('updateSketchMeta', () => {
  it('updates plane / planeOffset / operation in one transact', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s') });
    const result = applySketchOp(doc, {
      kind: 'updateSketchMeta',
      sketchId: 's',
      patch: { plane: 'xz', planeOffset: 25, operation: 'subtract' },
    });
    expect(result.applied).toBe(true);
    const s = readSketch(doc, 's')!;
    expect(s.plane).toBe('xz');
    expect(s.planeOffset).toBe(25);
    expect(s.operation).toBe('subtract');
  });

  it('updateSketchMeta with config replaces the SketchConfig atomically', () => {
    const doc = new Y.Doc();
    applySketchOp(doc, { kind: 'createSketch', sketch: sampleSketch('s') });
    const newConfig: SketchConfig = {
      ...defaultConfig(),
      depth: 75,
      mode: 'revolve',
      revolveAngle: 180,
    };
    applySketchOp(doc, {
      kind: 'updateSketchMeta',
      sketchId: 's',
      patch: { config: newConfig },
    });
    expect(readSketch(doc, 's')!.config).toEqual(newConfig);
  });
});
