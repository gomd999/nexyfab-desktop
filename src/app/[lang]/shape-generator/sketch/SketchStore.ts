/**
 * SketchStore.ts — Wave 2 Phase 3 Week 2 Track Z2.
 *
 * Adapter that gives one API for both
 * "local in-memory sketch state" and "Y.Doc-backed sketch state".
 *
 * Mirrors the A5 ConfigStore pattern (configurations/ConfigStore.ts):
 *
 *   - **local mode** — `SketchStore.local(initial?)` wraps plain React-state
 *     arrays. Mutations apply in-memory and fire a `subscribe()` listener.
 *     This is the default path; `?crdt=v2` OFF leaves us here.
 *
 *   - **Yjs mode** — `SketchStore.fromYDoc(doc, sketchId)` wraps a `Y.Doc`.
 *     Every mutation routes through `applySketchOp` from sketchYjs.ts so it
 *     lands inside one `doc.transact()` block. Reads come from
 *     `readSketch(doc, sketchId)`.
 *
 * Both modes expose the same `SketchStore` interface, a strict subset of
 * the host's previous useState-based surface (segments / constraints /
 * dimensions arrays + matching setters that we already see in
 * `hooks/useSketchState.ts`).
 *
 * **Why an adapter instead of editing sketchYjs.ts?**
 *   - sketchYjs.ts is Phase 1 frozen — touching it risks the 161 collab
 *     tests + the keyed-by-id CRDT design.
 *   - The host UI today uses plain arrays and setters. Hot-swapping the
 *     underlying representation needs ONE seam, not a class rewrite.
 *
 * **Yjs read strategy** — on every Y.Doc update event we rebuild the
 * sketch snapshot. This is O(N segments + constraints + dimensions) per
 * notify; sketches are 50-200 entities so this is far below the OCCT tick
 * budget. We do NOT cache reads; cache invalidation under concurrent Y
 * updates is the same family of bugs the W1 configurations corruption fix
 * solved.
 *
 * **Migrate path** — `migrateToYjs(local, doc, sketchId)` writes the
 * whole local snapshot into the doc inside one transact, then returns a
 * fresh Yjs-mode store wrapping the doc. This is the local-→-collab path
 * when a user opens a single-tab sketch and a second tab joins.
 */

import * as Y from 'yjs';
import {
  applySketchOp,
  getSketchesRoot,
  getSketchYMap,
  readSketch,
  type Sketch,
  type SketchFaceFrame,
  type SketchOpOrigin,
  ORIGIN_LOCAL_UI,
} from '../collab/sketchYjs';
import type {
  SketchSegment,
  SketchConstraint,
  SketchDimension,
  SketchConfig,
} from './types';

// ─── Sketch identity shape (what local mode wraps) ─────────────────────────
//
// We intentionally use the same `Sketch` shape from sketchYjs.ts so the two
// modes are interchangeable at the snapshot level. Local mode just keeps a
// mutable copy; Yjs mode rebuilds on every read.

export type { Sketch, SketchFaceFrame } from '../collab/sketchYjs';

/** Empty sketch factory — used when the host doesn't supply an initial. */
export function emptySketch(id: string): Sketch {
  return {
    id,
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

// ─── Public interface ──────────────────────────────────────────────────────

/** The minimum API the host + SketchPanel need from a sketch store. Both
 *  local and Yjs modes implement this. Selection / hover are NOT here —
 *  they are per-user UI state and stay in React useState at the panel
 *  layer (the spec is explicit about this). */
export interface SketchStore {
  /** Is this store backed by a Y.Doc (collab) or just in-memory (offline)? */
  readonly mode: 'local' | 'yjs';

  /** The id of the sketch this store wraps (the doc may hold many sketches
   *  keyed by id; this store is bound to one of them). */
  readonly sketchId: string;

  // ── Reads ───────────────────────────────────────────────────────────────

  /** Snapshot the entire sketch (segments + constraints + dimensions +
   *  meta). Cheap in local mode (returns the live ref), O(N) in Yjs mode. */
  getSketch(): Sketch;

  getSegments(): SketchSegment[];
  getConstraints(): SketchConstraint[];
  getDimensions(): SketchDimension[];

  // ── Mutations — sketch entities ─────────────────────────────────────────

  addSegment(seg: SketchSegment): void;
  updateSegment(id: string, patch: Partial<Omit<SketchSegment, 'id'>>): void;
  removeSegment(id: string): void;

  addConstraint(c: SketchConstraint): void;
  updateConstraint(id: string, patch: Partial<Omit<SketchConstraint, 'id'>>): void;
  removeConstraint(id: string): void;

  addDimension(d: SketchDimension): void;
  updateDimension(id: string, patch: Partial<Omit<SketchDimension, 'id'>>): void;
  removeDimension(id: string): void;

  // ── Mutations — meta ────────────────────────────────────────────────────

  setConfig(config: SketchConfig): void;
  setPlane(plane: Sketch['plane']): void;
  setPlaneOffset(offset: number): void;
  setOperation(op: Sketch['operation']): void;
  setFaceFrame(frame: SketchFaceFrame | null): void;

  // ── Composite ──────────────────────────────────────────────────────────

  /** Replace the entire segments array (used by tools that rebuild the
   *  whole sketch, e.g. "Clear All", DXF import, text→sketch). Routes
   *  through removeSegment + addSegment in Yjs mode so the doc keeps
   *  per-entity CRDT history. */
  setSegments(segs: SketchSegment[]): void;

  // ── Subscription ────────────────────────────────────────────────────────

  /** Listen for any mutation (local or remote). Returns unsubscribe.
   *  React hosts increment a reducer counter to trigger re-render. */
  subscribe(listener: () => void): () => void;

  /** Release resources (Yjs observer, listener set). Idempotent. */
  destroy(): void;

  /** Yjs-mode only: the underlying doc. Exposed for tests and for the
   *  panel's awareness/peer-name lookup when surfacing LWW collision
   *  toasts. */
  getDoc?(): Y.Doc;
}

// ─── Local mode ────────────────────────────────────────────────────────────

class LocalSketchStore implements SketchStore {
  readonly mode = 'local' as const;
  readonly sketchId: string;
  private state: Sketch;
  private listeners = new Set<() => void>();

  constructor(initial?: Sketch, sketchId?: string) {
    if (initial) {
      // Defensive shallow copy of arrays so the caller's references stay
      // independent of our mutations.
      this.state = {
        ...initial,
        segments: [...initial.segments],
        constraints: [...initial.constraints],
        dimensions: [...initial.dimensions],
      };
      this.sketchId = initial.id;
    } else {
      const id = sketchId ?? 'sketch-1';
      this.state = emptySketch(id);
      this.sketchId = id;
    }
  }

  getSketch(): Sketch {
    return {
      ...this.state,
      segments: [...this.state.segments],
      constraints: [...this.state.constraints],
      dimensions: [...this.state.dimensions],
    };
  }

  getSegments(): SketchSegment[] { return [...this.state.segments]; }
  getConstraints(): SketchConstraint[] { return [...this.state.constraints]; }
  getDimensions(): SketchDimension[] { return [...this.state.dimensions]; }

  addSegment(seg: SketchSegment): void {
    if (!seg.id) throw new Error('[SketchStore] addSegment requires segment.id');
    // LWW on same-id: replace if present (mirrors Yjs Y.Map.set behaviour).
    const idx = this.state.segments.findIndex(s => s.id === seg.id);
    if (idx >= 0) {
      this.state.segments[idx] = seg;
    } else {
      this.state.segments.push(seg);
    }
    this.notify();
  }

  updateSegment(id: string, patch: Partial<Omit<SketchSegment, 'id'>>): void {
    const idx = this.state.segments.findIndex(s => s.id === id);
    if (idx < 0) return;
    this.state.segments[idx] = { ...this.state.segments[idx]!, ...patch } as SketchSegment;
    this.notify();
  }

  removeSegment(id: string): void {
    const before = this.state.segments.length;
    this.state.segments = this.state.segments.filter(s => s.id !== id);
    if (this.state.segments.length !== before) this.notify();
  }

  addConstraint(c: SketchConstraint): void {
    const idx = this.state.constraints.findIndex(x => x.id === c.id);
    if (idx >= 0) {
      this.state.constraints[idx] = c;
    } else {
      this.state.constraints.push(c);
    }
    this.notify();
  }

  updateConstraint(id: string, patch: Partial<Omit<SketchConstraint, 'id'>>): void {
    const idx = this.state.constraints.findIndex(c => c.id === id);
    if (idx < 0) return;
    this.state.constraints[idx] = { ...this.state.constraints[idx]!, ...patch } as SketchConstraint;
    this.notify();
  }

  removeConstraint(id: string): void {
    const before = this.state.constraints.length;
    this.state.constraints = this.state.constraints.filter(c => c.id !== id);
    if (this.state.constraints.length !== before) this.notify();
  }

  addDimension(d: SketchDimension): void {
    const idx = this.state.dimensions.findIndex(x => x.id === d.id);
    if (idx >= 0) {
      this.state.dimensions[idx] = d;
    } else {
      this.state.dimensions.push(d);
    }
    this.notify();
  }

  updateDimension(id: string, patch: Partial<Omit<SketchDimension, 'id'>>): void {
    const idx = this.state.dimensions.findIndex(d => d.id === id);
    if (idx < 0) return;
    this.state.dimensions[idx] = { ...this.state.dimensions[idx]!, ...patch } as SketchDimension;
    this.notify();
  }

  removeDimension(id: string): void {
    const before = this.state.dimensions.length;
    this.state.dimensions = this.state.dimensions.filter(d => d.id !== id);
    if (this.state.dimensions.length !== before) this.notify();
  }

  setConfig(config: SketchConfig): void {
    this.state.config = config;
    this.notify();
  }
  setPlane(plane: Sketch['plane']): void {
    this.state.plane = plane;
    this.notify();
  }
  setPlaneOffset(offset: number): void {
    this.state.planeOffset = offset;
    this.notify();
  }
  setOperation(op: Sketch['operation']): void {
    this.state.operation = op;
    this.notify();
  }
  setFaceFrame(frame: SketchFaceFrame | null): void {
    this.state.faceFrame = frame;
    this.notify();
  }

  setSegments(segs: SketchSegment[]): void {
    this.state.segments = [...segs];
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  destroy(): void {
    this.listeners.clear();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

// ─── Yjs mode ──────────────────────────────────────────────────────────────

class YjsSketchStore implements SketchStore {
  readonly mode = 'yjs' as const;
  readonly sketchId: string;
  private doc: Y.Doc;
  private listeners = new Set<() => void>();
  private detach: (() => void) | null = null;
  private origin: SketchOpOrigin;

  constructor(doc: Y.Doc, sketchId: string, origin: SketchOpOrigin = ORIGIN_LOCAL_UI) {
    this.doc = doc;
    this.sketchId = sketchId;
    this.origin = origin;

    // Ensure the sketch exists on the doc — if not, create an empty one so
    // first-write paths don't no-op against a missing sketch.
    if (!getSketchYMap(doc, sketchId)) {
      applySketchOp(doc, { kind: 'createSketch', sketch: emptySketch(sketchId) }, this.origin);
    }

    // Subscribe to ANY change on the doc. Listeners only care that
    // something moved. Filter by sketchId is unnecessary today (one sketch
    // per session in the W2 wiring), and observing the whole doc is what
    // the smoke harness already does.
    const handler = () => this.notify();
    doc.on('update', handler);
    this.detach = () => doc.off('update', handler);
  }

  // ── Reads — rebuild from the doc on every call ──────────────────────────

  getSketch(): Sketch {
    return readSketch(this.doc, this.sketchId) ?? emptySketch(this.sketchId);
  }

  getSegments(): SketchSegment[] { return this.getSketch().segments; }
  getConstraints(): SketchConstraint[] { return this.getSketch().constraints; }
  getDimensions(): SketchDimension[] { return this.getSketch().dimensions; }

  // ── Segments ────────────────────────────────────────────────────────────

  addSegment(seg: SketchSegment): void {
    if (!seg.id) throw new Error('[SketchStore] addSegment requires segment.id');
    applySketchOp(this.doc, { kind: 'addSegment', sketchId: this.sketchId, segment: seg }, this.origin);
  }
  updateSegment(id: string, patch: Partial<Omit<SketchSegment, 'id'>>): void {
    applySketchOp(this.doc, { kind: 'updateSegment', sketchId: this.sketchId, segmentId: id, patch }, this.origin);
  }
  removeSegment(id: string): void {
    applySketchOp(this.doc, { kind: 'removeSegment', sketchId: this.sketchId, segmentId: id }, this.origin);
  }

  // ── Constraints ─────────────────────────────────────────────────────────

  addConstraint(c: SketchConstraint): void {
    applySketchOp(this.doc, { kind: 'addConstraint', sketchId: this.sketchId, constraint: c }, this.origin);
  }
  updateConstraint(id: string, patch: Partial<Omit<SketchConstraint, 'id'>>): void {
    applySketchOp(this.doc, { kind: 'updateConstraint', sketchId: this.sketchId, constraintId: id, patch }, this.origin);
  }
  removeConstraint(id: string): void {
    applySketchOp(this.doc, { kind: 'removeConstraint', sketchId: this.sketchId, constraintId: id }, this.origin);
  }

  // ── Dimensions ──────────────────────────────────────────────────────────

  addDimension(d: SketchDimension): void {
    applySketchOp(this.doc, { kind: 'addDimension', sketchId: this.sketchId, dimension: d }, this.origin);
  }
  updateDimension(id: string, patch: Partial<Omit<SketchDimension, 'id'>>): void {
    applySketchOp(this.doc, { kind: 'updateDimension', sketchId: this.sketchId, dimensionId: id, patch }, this.origin);
  }
  removeDimension(id: string): void {
    applySketchOp(this.doc, { kind: 'removeDimension', sketchId: this.sketchId, dimensionId: id }, this.origin);
  }

  // ── Meta ────────────────────────────────────────────────────────────────

  setConfig(config: SketchConfig): void {
    applySketchOp(this.doc, { kind: 'updateSketchMeta', sketchId: this.sketchId, patch: { config } }, this.origin);
  }
  setPlane(plane: Sketch['plane']): void {
    applySketchOp(this.doc, { kind: 'updateSketchMeta', sketchId: this.sketchId, patch: { plane } }, this.origin);
  }
  setPlaneOffset(offset: number): void {
    applySketchOp(this.doc, { kind: 'updateSketchMeta', sketchId: this.sketchId, patch: { planeOffset: offset } }, this.origin);
  }
  setOperation(op: Sketch['operation']): void {
    applySketchOp(this.doc, { kind: 'updateSketchMeta', sketchId: this.sketchId, patch: { operation: op } }, this.origin);
  }
  setFaceFrame(frame: SketchFaceFrame | null): void {
    applySketchOp(this.doc, { kind: 'updateSketchMeta', sketchId: this.sketchId, patch: { faceFrame: frame } }, this.origin);
  }

  // ── Composite ───────────────────────────────────────────────────────────

  setSegments(segs: SketchSegment[]): void {
    // Whole-array replace — diff against current state to keep the CRDT
    // per-entity history meaningful (vs. a naive nuke-and-replace which
    // would lose every segment's id-keyed merge history).
    const current = this.getSegments();
    const currentIds = new Set(current.map(s => s.id ?? ''));
    const nextIds = new Set(segs.map(s => s.id ?? ''));

    this.doc.transact(() => {
      // Remove anything no longer present.
      for (const c of current) {
        if (!c.id) continue;
        if (!nextIds.has(c.id)) {
          applySketchOp(this.doc, { kind: 'removeSegment', sketchId: this.sketchId, segmentId: c.id }, this.origin);
        }
      }
      // Add or update everything from the new list.
      for (const s of segs) {
        if (!s.id) throw new Error('[SketchStore] setSegments requires every segment to have an id');
        if (currentIds.has(s.id)) {
          // Replace contents via patch.
          applySketchOp(this.doc, {
            kind: 'updateSegment',
            sketchId: this.sketchId,
            segmentId: s.id,
            patch: {
              type: s.type,
              points: s.points,
              construction: s.construction,
              degree: s.degree,
              knots: s.knots,
              weights: s.weights,
            },
          }, this.origin);
        } else {
          applySketchOp(this.doc, { kind: 'addSegment', sketchId: this.sketchId, segment: s }, this.origin);
        }
      }
    }, this.origin);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getDoc(): Y.Doc { return this.doc; }

  destroy(): void {
    if (this.detach) this.detach();
    this.detach = null;
    this.listeners.clear();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

// ─── Factory + migration ───────────────────────────────────────────────────

/** Construct a local-mode store. With no initial, an empty sketch is
 *  created bound to `sketchId ?? 'sketch-1'`. Pass an initial Sketch (eg.
 *  loaded from .nfab) to start with content. */
export const SketchStore = {
  local(initial?: Sketch, sketchId?: string): SketchStore {
    return new LocalSketchStore(initial, sketchId);
  },

  /** Construct a Yjs-mode store backed by the given doc + sketchId. If the
   *  doc has no sketch under that id yet, an empty one is created in one
   *  transact (mirrors the bootstrap behaviour in the smoke harness). */
  fromYDoc(doc: Y.Doc, sketchId: string, origin?: SketchOpOrigin): SketchStore {
    return new YjsSketchStore(doc, sketchId, origin);
  },
};

/** Hot-swap from local mode to Yjs mode without losing state. Writes the
 *  whole local snapshot into the provided doc in one transact and returns
 *  a fresh Yjs-mode store. The previous local store is destroyed.
 *
 *  Used by the host hook on the local→collab transition (e.g. user opens
 *  a single-tab sketch then a peer joins via Z1's CollabProvider — the
 *  host hot-swaps the store underneath without losing the user's work). */
export function migrateToYjs(local: SketchStore, doc: Y.Doc, sketchId?: string): SketchStore {
  if (local.mode !== 'local') {
    throw new Error('[SketchStore] migrateToYjs: source store must be in local mode');
  }
  const snap = local.getSketch();
  const targetId = sketchId ?? snap.id ?? local.sketchId;
  const payload: Sketch = { ...snap, id: targetId };

  doc.transact(() => {
    const root = getSketchesRoot(doc);
    if (root.has(targetId)) {
      root.delete(targetId);
    }
    applySketchOp(doc, { kind: 'createSketch', sketch: payload }, ORIGIN_LOCAL_UI);
  }, ORIGIN_LOCAL_UI);

  local.destroy();
  return SketchStore.fromYDoc(doc, targetId);
}
