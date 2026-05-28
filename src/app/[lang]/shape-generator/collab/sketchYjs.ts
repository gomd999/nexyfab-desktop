/**
 * sketchYjs.ts — Wave 2 Phase 1 Week 2 prototype.
 *
 * Replaces the v0 `sketchCrdt.ts` scaffold (segments-as-Y.Array) with the
 * Wave 2 design from `docs/wave-2-crdt-architecture.md` §2.2:
 *
 *   Y.Doc
 *   └── sketches: Y.Map<sketchId, Y.Map>           ← top-level keyed-by-id
 *         └── (one sketch Y.Map) {
 *               id, plane, planeOffset, operation,
 *               faceFrame:     string  (JSON-LWW, atomic),
 *               config:        string  (JSON-LWW, atomic SketchConfig),
 *               segments:      Y.Map<segId, Y.Map>        ← keyed-by-id
 *               constraints:   Y.Map<cId,   Y.Map>        ← keyed-by-id
 *               dimensions:    Y.Map<dId,   Y.Map>        ← keyed-by-id
 *             }
 *
 * Why keyed-by-id Y.Map over Y.Array of Y.Maps:
 *   - Sketch entities have NO inherent order — the solver iterates by id-set.
 *   - Y.Array forces a position; two peers appending the same id concurrently
 *     would dedupe poorly. With Y.Map<id, _>, "add" is set(id, _) and merges
 *     are by-key (per-id LWW for the same id, both kept for different ids).
 *   - Constraints reference entity ids; if an entity is concurrently deleted
 *     the constraint is silently orphan-tolerated by the solver
 *     (constraintSolver.ts:347-352 already returns nullish on lookup miss).
 *
 * Why JSON-LWW for `points`, `knots`, `weights`, `entityIds`, `position`,
 * `config`, `faceFrame`:
 *   - These are atomic geometric units. Two users editing different control
 *     points of the same NURBS curve without coordination produces a curve
 *     neither user intended; LWW is the right semantic match (see Wave 2 doc
 *     §2.2.1). Revisit in v2 if real users want per-point concurrent editing.
 *
 * All mutating ops route through `applySketchOp`, which wraps each op in
 * exactly one `doc.transact()` block. This guarantees observers see "add
 * entity + auto-constraints" as a single notification, never an inconsistent
 * intermediate where the constraint references a not-yet-extant segment.
 */

import * as Y from 'yjs';
import type {
  SketchPoint,
  SketchSegment,
  SketchConstraint,
  SketchDimension,
  SketchConfig,
  ConstraintType,
} from '../sketch/types';

// ─── Shared keys (string constants, kept here as the wire-format contract) ──

const SKETCHES_ROOT_KEY = 'sketches';

const SKETCH_FIELDS = {
  id: 'id',
  plane: 'plane',
  planeOffset: 'planeOffset',
  operation: 'operation',
  faceFrame: 'faceFrame',
  config: 'config',
  segments: 'segments',
  constraints: 'constraints',
  dimensions: 'dimensions',
} as const;

const SEG_FIELDS = {
  id: 'id',
  type: 'type',
  points: 'points',
  construction: 'construction',
  degree: 'degree',
  knots: 'knots',
  weights: 'weights',
} as const;

const CON_FIELDS = {
  id: 'id',
  type: 'type',
  entityIds: 'entityIds',
  satisfied: 'satisfied',
  value: 'value',
  expression: 'expression',
} as const;

const DIM_FIELDS = {
  id: 'id',
  type: 'type',
  entityIds: 'entityIds',
  value: 'value',
  position: 'position',
  locked: 'locked',
  name: 'name',
  expression: 'expression',
} as const;

// ─── Plain prototype types ─────────────────────────────────────────────────
//
// The eventual production type lives on `SketchNodeData` inside the feature
// tree, but for the Phase-1 prototype we want a single self-contained shape
// that the round-trip helpers can pin down without dragging in the entire
// useFeatureStack module. The shape is intentionally a strict subset of
// SketchNodeData + the `id` that the doc keys by.

/** Face-frame data attached to "sketch on tilted face" features. */
export interface SketchFaceFrame {
  origin: [number, number, number];
  normal: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
}

/** A complete sketch as stored under one Y.Map entry of the top-level
 *  `sketches` Y.Map. */
export interface Sketch {
  id: string;
  plane: 'xy' | 'xz' | 'yz';
  planeOffset: number;
  operation: 'add' | 'subtract';
  faceFrame: SketchFaceFrame | null;
  config: SketchConfig;
  segments: SketchSegment[];
  constraints: SketchConstraint[];
  dimensions: SketchDimension[];
}

// ─── Op union — every mutation goes through one of these ───────────────────

export type SketchOp =
  | { kind: 'createSketch'; sketch: Sketch }
  | { kind: 'deleteSketch'; sketchId: string }
  | { kind: 'updateSketchMeta'; sketchId: string; patch: Partial<Pick<Sketch, 'plane' | 'planeOffset' | 'operation' | 'faceFrame' | 'config'>> }
  | { kind: 'addSegment'; sketchId: string; segment: SketchSegment }
  | { kind: 'updateSegment'; sketchId: string; segmentId: string; patch: Partial<Omit<SketchSegment, 'id'>> }
  | { kind: 'removeSegment'; sketchId: string; segmentId: string }
  | { kind: 'addConstraint'; sketchId: string; constraint: SketchConstraint }
  | { kind: 'updateConstraint'; sketchId: string; constraintId: string; patch: Partial<Omit<SketchConstraint, 'id'>> }
  | { kind: 'removeConstraint'; sketchId: string; constraintId: string }
  | { kind: 'addDimension'; sketchId: string; dimension: SketchDimension }
  | { kind: 'updateDimension'; sketchId: string; dimensionId: string; patch: Partial<Omit<SketchDimension, 'id'>> }
  | { kind: 'removeDimension'; sketchId: string; dimensionId: string }
  /** Atomic "add segment plus inferred constraints" — one Y transact so peers
   *  never observe the segment without its auto-constraints. */
  | { kind: 'addSegmentWithConstraints'; sketchId: string; segment: SketchSegment; constraints: SketchConstraint[] }
  /** Atomic "rename entity id, keeping all references intact". The id field
   *  on segments / constraints / dimensions is stable across edits; this op is
   *  the only sanctioned way to change it. All constraints/dimensions whose
   *  entityIds contain the old id get rewritten in the same transact. */
  | { kind: 'renameEntity'; sketchId: string; oldId: string; newId: string };

// ─── Encoders (typed → Y.Map) ──────────────────────────────────────────────

function segmentToYMap(seg: SketchSegment): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set(SEG_FIELDS.id, seg.id ?? '');
  m.set(SEG_FIELDS.type, seg.type);
  m.set(SEG_FIELDS.points, JSON.stringify(seg.points));
  if (seg.construction !== undefined) m.set(SEG_FIELDS.construction, seg.construction);
  if (seg.degree !== undefined) m.set(SEG_FIELDS.degree, seg.degree);
  if (seg.knots !== undefined) m.set(SEG_FIELDS.knots, JSON.stringify(seg.knots));
  if (seg.weights !== undefined) m.set(SEG_FIELDS.weights, JSON.stringify(seg.weights));
  return m;
}

function constraintToYMap(c: SketchConstraint): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set(CON_FIELDS.id, c.id);
  m.set(CON_FIELDS.type, c.type);
  m.set(CON_FIELDS.entityIds, JSON.stringify(c.entityIds));
  m.set(CON_FIELDS.satisfied, c.satisfied);
  if (c.value !== undefined) m.set(CON_FIELDS.value, c.value);
  if (c.expression !== undefined) m.set(CON_FIELDS.expression, c.expression);
  return m;
}

function dimensionToYMap(d: SketchDimension): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set(DIM_FIELDS.id, d.id);
  m.set(DIM_FIELDS.type, d.type);
  m.set(DIM_FIELDS.entityIds, JSON.stringify(d.entityIds));
  m.set(DIM_FIELDS.value, d.value);
  m.set(DIM_FIELDS.position, JSON.stringify(d.position));
  m.set(DIM_FIELDS.locked, d.locked);
  if (d.name !== undefined) m.set(DIM_FIELDS.name, d.name);
  if (d.expression !== undefined) m.set(DIM_FIELDS.expression, d.expression);
  return m;
}

function sketchToYMap(sketch: Sketch): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set(SKETCH_FIELDS.id, sketch.id);
  m.set(SKETCH_FIELDS.plane, sketch.plane);
  m.set(SKETCH_FIELDS.planeOffset, sketch.planeOffset);
  m.set(SKETCH_FIELDS.operation, sketch.operation);
  m.set(SKETCH_FIELDS.faceFrame, JSON.stringify(sketch.faceFrame));
  m.set(SKETCH_FIELDS.config, JSON.stringify(sketch.config));

  const segMap = new Y.Map<Y.Map<unknown>>();
  for (const seg of sketch.segments) {
    if (!seg.id) {
      throw new Error('[sketchYjs] every SketchSegment must have an id to be stored in CRDT');
    }
    segMap.set(seg.id, segmentToYMap(seg));
  }
  m.set(SKETCH_FIELDS.segments, segMap);

  const conMap = new Y.Map<Y.Map<unknown>>();
  for (const c of sketch.constraints) conMap.set(c.id, constraintToYMap(c));
  m.set(SKETCH_FIELDS.constraints, conMap);

  const dimMap = new Y.Map<Y.Map<unknown>>();
  for (const d of sketch.dimensions) dimMap.set(d.id, dimensionToYMap(d));
  m.set(SKETCH_FIELDS.dimensions, dimMap);

  return m;
}

// ─── Decoders (Y.Map → typed) ──────────────────────────────────────────────

function yMapToSegment(m: Y.Map<unknown>): SketchSegment {
  const points = JSON.parse((m.get(SEG_FIELDS.points) as string) ?? '[]') as SketchPoint[];
  const out: SketchSegment = {
    type: (m.get(SEG_FIELDS.type) as SketchSegment['type']) ?? 'line',
    points,
  };
  const id = m.get(SEG_FIELDS.id) as string | undefined;
  if (id) out.id = id;
  const construction = m.get(SEG_FIELDS.construction) as boolean | undefined;
  if (construction !== undefined) out.construction = construction;
  const degree = m.get(SEG_FIELDS.degree) as number | undefined;
  if (degree !== undefined) out.degree = degree;
  const knots = m.get(SEG_FIELDS.knots) as string | undefined;
  if (knots) out.knots = JSON.parse(knots) as number[];
  const weights = m.get(SEG_FIELDS.weights) as string | undefined;
  if (weights) out.weights = JSON.parse(weights) as number[];
  return out;
}

function yMapToConstraint(m: Y.Map<unknown>): SketchConstraint {
  const out: SketchConstraint = {
    id: (m.get(CON_FIELDS.id) as string) ?? '',
    type: (m.get(CON_FIELDS.type) as ConstraintType) ?? 'horizontal',
    entityIds: JSON.parse((m.get(CON_FIELDS.entityIds) as string) ?? '[]') as string[],
    satisfied: (m.get(CON_FIELDS.satisfied) as boolean) ?? false,
  };
  const value = m.get(CON_FIELDS.value) as number | undefined;
  if (value !== undefined) out.value = value;
  const expression = m.get(CON_FIELDS.expression) as string | undefined;
  if (expression !== undefined) out.expression = expression;
  return out;
}

function yMapToDimension(m: Y.Map<unknown>): SketchDimension {
  const out: SketchDimension = {
    id: (m.get(DIM_FIELDS.id) as string) ?? '',
    type: (m.get(DIM_FIELDS.type) as SketchDimension['type']) ?? 'linear',
    entityIds: JSON.parse((m.get(DIM_FIELDS.entityIds) as string) ?? '[]') as string[],
    value: (m.get(DIM_FIELDS.value) as number) ?? 0,
    position: JSON.parse((m.get(DIM_FIELDS.position) as string) ?? '{"x":0,"y":0}') as SketchPoint,
    locked: (m.get(DIM_FIELDS.locked) as boolean) ?? false,
  };
  const name = m.get(DIM_FIELDS.name) as string | undefined;
  if (name !== undefined) out.name = name;
  const expression = m.get(DIM_FIELDS.expression) as string | undefined;
  if (expression !== undefined) out.expression = expression;
  return out;
}

function yMapToSketch(m: Y.Map<unknown>): Sketch {
  const segMap = m.get(SKETCH_FIELDS.segments) as Y.Map<Y.Map<unknown>> | undefined;
  const conMap = m.get(SKETCH_FIELDS.constraints) as Y.Map<Y.Map<unknown>> | undefined;
  const dimMap = m.get(SKETCH_FIELDS.dimensions) as Y.Map<Y.Map<unknown>> | undefined;

  const segments: SketchSegment[] = [];
  if (segMap) segMap.forEach(sub => segments.push(yMapToSegment(sub)));

  const constraints: SketchConstraint[] = [];
  if (conMap) conMap.forEach(sub => constraints.push(yMapToConstraint(sub)));

  const dimensions: SketchDimension[] = [];
  if (dimMap) dimMap.forEach(sub => dimensions.push(yMapToDimension(sub)));

  const faceFrameJson = m.get(SKETCH_FIELDS.faceFrame) as string | undefined;
  const faceFrame = faceFrameJson ? (JSON.parse(faceFrameJson) as SketchFaceFrame | null) : null;

  const configJson = m.get(SKETCH_FIELDS.config) as string | undefined;
  const config = configJson
    ? (JSON.parse(configJson) as SketchConfig)
    : ({
        mode: 'extrude',
        depth: 50,
        revolveAngle: 360,
        revolveAxis: 'y',
        segments: 32,
      } as SketchConfig);

  return {
    id: (m.get(SKETCH_FIELDS.id) as string) ?? '',
    plane: (m.get(SKETCH_FIELDS.plane) as Sketch['plane']) ?? 'xy',
    planeOffset: (m.get(SKETCH_FIELDS.planeOffset) as number) ?? 0,
    operation: (m.get(SKETCH_FIELDS.operation) as Sketch['operation']) ?? 'add',
    faceFrame,
    config,
    segments,
    constraints,
    dimensions,
  };
}

// ─── Public accessors ──────────────────────────────────────────────────────

/** Get (creating if needed) the shared `sketches` Y.Map on a doc. Each entry
 *  is one sketch keyed by sketchId. */
export function getSketchesRoot(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(SKETCHES_ROOT_KEY);
}

/** Look up the Y.Map for a single sketch (or null). */
export function getSketchYMap(doc: Y.Doc, sketchId: string): Y.Map<unknown> | null {
  const root = getSketchesRoot(doc);
  return root.get(sketchId) ?? null;
}

/** Snapshot one sketch as a plain `Sketch` (or null when not present). */
export function readSketch(doc: Y.Doc, sketchId: string): Sketch | null {
  const m = getSketchYMap(doc, sketchId);
  return m ? yMapToSketch(m) : null;
}

/** Snapshot every sketch on the doc as a `Map<sketchId, Sketch>`. */
export function readAllSketches(doc: Y.Doc): Map<string, Sketch> {
  const out = new Map<string, Sketch>();
  getSketchesRoot(doc).forEach((m, id) => {
    out.set(id, yMapToSketch(m));
  });
  return out;
}

// ─── Round-trip helpers ────────────────────────────────────────────────────

/** Bootstrap a fresh Y.Doc from an in-memory sketch (the .nfab import path,
 *  or "create new sketch in collab session"). The whole population runs in
 *  one transact so observers see the sketch land atomically. */
export function sketchToYDoc(sketch: Sketch): Y.Doc {
  const doc = new Y.Doc();
  populateSketchInDoc(doc, sketch);
  return doc;
}

/** Decode the (single) sketch out of a Y.Doc previously created by
 *  `sketchToYDoc`. Returns null when the doc has no sketches yet, or the
 *  first sketch when multiple are present. Use `readAllSketches` for the
 *  multi-sketch case. */
export function yDocToSketch(doc: Y.Doc): Sketch | null {
  const root = getSketchesRoot(doc);
  if (root.size === 0) return null;
  const first = root.values().next().value as Y.Map<unknown> | undefined;
  return first ? yMapToSketch(first) : null;
}

function populateSketchInDoc(doc: Y.Doc, sketch: Sketch): void {
  doc.transact(() => {
    const root = getSketchesRoot(doc);
    root.set(sketch.id, sketchToYMap(sketch));
  }, ORIGIN_LOCAL_UI);
}

// ─── Origins (see Wave 2 doc §3.2) ─────────────────────────────────────────

export const ORIGIN_LOCAL_UI = 'local-ui';
export const ORIGIN_SOLVER_COMMIT = 'solver-commit';
export const ORIGIN_REMOTE_UPDATE = 'remote-update';
export const ORIGIN_IMPORT_NFAB = 'import-nfab';
export const ORIGIN_GC = 'gc';

export type SketchOpOrigin =
  | typeof ORIGIN_LOCAL_UI
  | typeof ORIGIN_SOLVER_COMMIT
  | typeof ORIGIN_REMOTE_UPDATE
  | typeof ORIGIN_IMPORT_NFAB
  | typeof ORIGIN_GC;

// ─── Mutation API — applySketchOp ──────────────────────────────────────────

/** Apply one sketch operation to the doc inside a single transact() block.
 *
 *  Returns a small status payload (mostly for tests / telemetry):
 *   - `applied`: true if the op landed; false if it was a no-op
 *     (e.g. updateSegment for an id that doesn't exist on this peer).
 *   - `notes`: human-readable explanation of what happened on the slow paths
 *     (rename / orphan tolerate / etc.). Tests rely on this for diagnostics.
 *
 *  All writes are LWW per-key at the Y.Map level, so two peers updating the
 *  same field on the same constraint will deterministically converge.
 */
export interface ApplyOpResult {
  applied: boolean;
  notes?: string;
}

export function applySketchOp(
  doc: Y.Doc,
  op: SketchOp,
  origin: SketchOpOrigin = ORIGIN_LOCAL_UI,
): ApplyOpResult {
  let result: ApplyOpResult = { applied: false };
  doc.transact(() => {
    result = applyOpInner(doc, op);
  }, origin);
  return result;
}

function applyOpInner(doc: Y.Doc, op: SketchOp): ApplyOpResult {
  const root = getSketchesRoot(doc);

  switch (op.kind) {
    case 'createSketch': {
      // Overwrites any prior sketch under that id — the caller is responsible
      // for not colliding ids. (For collab cases, two peers creating the same
      // sketchId would be a UI bug; the second create LWW-wins on whichever
      // peer's transact reaches the merge last.)
      root.set(op.sketch.id, sketchToYMap(op.sketch));
      return { applied: true };
    }

    case 'deleteSketch': {
      if (!root.has(op.sketchId)) return { applied: false };
      root.delete(op.sketchId);
      return { applied: true };
    }

    case 'updateSketchMeta': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      if (op.patch.plane !== undefined) sketchMap.set(SKETCH_FIELDS.plane, op.patch.plane);
      if (op.patch.planeOffset !== undefined) sketchMap.set(SKETCH_FIELDS.planeOffset, op.patch.planeOffset);
      if (op.patch.operation !== undefined) sketchMap.set(SKETCH_FIELDS.operation, op.patch.operation);
      if (op.patch.faceFrame !== undefined) sketchMap.set(SKETCH_FIELDS.faceFrame, JSON.stringify(op.patch.faceFrame));
      if (op.patch.config !== undefined) sketchMap.set(SKETCH_FIELDS.config, JSON.stringify(op.patch.config));
      return { applied: true };
    }

    case 'addSegment': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      if (!op.segment.id) {
        throw new Error('[sketchYjs] addSegment requires segment.id');
      }
      const segments = sketchMap.get(SKETCH_FIELDS.segments) as Y.Map<Y.Map<unknown>>;
      segments.set(op.segment.id, segmentToYMap(op.segment));
      return { applied: true };
    }

    case 'updateSegment': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      const segments = sketchMap.get(SKETCH_FIELDS.segments) as Y.Map<Y.Map<unknown>>;
      const segMap = segments.get(op.segmentId);
      if (!segMap) return { applied: false, notes: 'segment not found (orphan-tolerated)' };
      // Per-key LWW. Two peers updating the same key get last-write-wins by
      // Yjs clock; two peers updating different keys merge cleanly.
      if (op.patch.type !== undefined) segMap.set(SEG_FIELDS.type, op.patch.type);
      if (op.patch.points !== undefined) segMap.set(SEG_FIELDS.points, JSON.stringify(op.patch.points));
      if (op.patch.construction !== undefined) segMap.set(SEG_FIELDS.construction, op.patch.construction);
      if (op.patch.degree !== undefined) segMap.set(SEG_FIELDS.degree, op.patch.degree);
      if (op.patch.knots !== undefined) segMap.set(SEG_FIELDS.knots, JSON.stringify(op.patch.knots));
      if (op.patch.weights !== undefined) segMap.set(SEG_FIELDS.weights, JSON.stringify(op.patch.weights));
      return { applied: true };
    }

    case 'removeSegment': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      const segments = sketchMap.get(SKETCH_FIELDS.segments) as Y.Map<Y.Map<unknown>>;
      if (!segments.has(op.segmentId)) return { applied: false };
      segments.delete(op.segmentId);
      // Note: we intentionally do NOT cascade-delete constraints that reference
      // this segment. The solver gracefully ignores orphan entityIds (see
      // constraintSolver.ts:347-352), and the periodic GC pass in
      // Phase-2 (Wave 2 doc §4 Scenario B) will sweep them.
      return { applied: true };
    }

    case 'addConstraint': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      const constraints = sketchMap.get(SKETCH_FIELDS.constraints) as Y.Map<Y.Map<unknown>>;
      constraints.set(op.constraint.id, constraintToYMap(op.constraint));
      return { applied: true };
    }

    case 'updateConstraint': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      const constraints = sketchMap.get(SKETCH_FIELDS.constraints) as Y.Map<Y.Map<unknown>>;
      const conMap = constraints.get(op.constraintId);
      if (!conMap) return { applied: false, notes: 'constraint not found' };
      if (op.patch.type !== undefined) conMap.set(CON_FIELDS.type, op.patch.type);
      if (op.patch.entityIds !== undefined) conMap.set(CON_FIELDS.entityIds, JSON.stringify(op.patch.entityIds));
      if (op.patch.satisfied !== undefined) conMap.set(CON_FIELDS.satisfied, op.patch.satisfied);
      if (op.patch.value !== undefined) conMap.set(CON_FIELDS.value, op.patch.value);
      if (op.patch.expression !== undefined) conMap.set(CON_FIELDS.expression, op.patch.expression);
      return { applied: true };
    }

    case 'removeConstraint': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      const constraints = sketchMap.get(SKETCH_FIELDS.constraints) as Y.Map<Y.Map<unknown>>;
      if (!constraints.has(op.constraintId)) return { applied: false };
      constraints.delete(op.constraintId);
      return { applied: true };
    }

    case 'addDimension': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      const dimensions = sketchMap.get(SKETCH_FIELDS.dimensions) as Y.Map<Y.Map<unknown>>;
      dimensions.set(op.dimension.id, dimensionToYMap(op.dimension));
      return { applied: true };
    }

    case 'updateDimension': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      const dimensions = sketchMap.get(SKETCH_FIELDS.dimensions) as Y.Map<Y.Map<unknown>>;
      const dimMap = dimensions.get(op.dimensionId);
      if (!dimMap) return { applied: false, notes: 'dimension not found' };
      if (op.patch.type !== undefined) dimMap.set(DIM_FIELDS.type, op.patch.type);
      if (op.patch.entityIds !== undefined) dimMap.set(DIM_FIELDS.entityIds, JSON.stringify(op.patch.entityIds));
      if (op.patch.value !== undefined) dimMap.set(DIM_FIELDS.value, op.patch.value);
      if (op.patch.position !== undefined) dimMap.set(DIM_FIELDS.position, JSON.stringify(op.patch.position));
      if (op.patch.locked !== undefined) dimMap.set(DIM_FIELDS.locked, op.patch.locked);
      if (op.patch.name !== undefined) dimMap.set(DIM_FIELDS.name, op.patch.name);
      if (op.patch.expression !== undefined) dimMap.set(DIM_FIELDS.expression, op.patch.expression);
      return { applied: true };
    }

    case 'removeDimension': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      const dimensions = sketchMap.get(SKETCH_FIELDS.dimensions) as Y.Map<Y.Map<unknown>>;
      if (!dimensions.has(op.dimensionId)) return { applied: false };
      dimensions.delete(op.dimensionId);
      return { applied: true };
    }

    case 'addSegmentWithConstraints': {
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      if (!op.segment.id) {
        throw new Error('[sketchYjs] addSegmentWithConstraints requires segment.id');
      }
      const segments = sketchMap.get(SKETCH_FIELDS.segments) as Y.Map<Y.Map<unknown>>;
      const constraints = sketchMap.get(SKETCH_FIELDS.constraints) as Y.Map<Y.Map<unknown>>;
      // Two writes inside the same transact — one update event, observers
      // never see "segment without its auto-constraints".
      segments.set(op.segment.id, segmentToYMap(op.segment));
      for (const c of op.constraints) constraints.set(c.id, constraintToYMap(c));
      return { applied: true };
    }

    case 'renameEntity': {
      // Stable entity-id rewrite. The doc keys segments / constraints /
      // dimensions by id, so a rename is "delete at old key, set at new key".
      // CRITICAL: in the same transact, rewrite every entityIds array on
      // constraints and dimensions that references oldId. Without this the
      // references silently dangle (solver no-ops them) and the user loses
      // their work.
      const sketchMap = root.get(op.sketchId);
      if (!sketchMap) return { applied: false };
      const segments = sketchMap.get(SKETCH_FIELDS.segments) as Y.Map<Y.Map<unknown>>;
      const constraints = sketchMap.get(SKETCH_FIELDS.constraints) as Y.Map<Y.Map<unknown>>;
      const dimensions = sketchMap.get(SKETCH_FIELDS.dimensions) as Y.Map<Y.Map<unknown>>;

      let foundEntity = false;

      // Try segments first (most common rename target).
      const segMap = segments.get(op.oldId);
      if (segMap) {
        foundEntity = true;
        if (segments.has(op.newId)) {
          throw new Error(`[sketchYjs] renameEntity: newId "${op.newId}" already exists`);
        }
        // Y.Map doesn't have a re-key primitive; we re-encode under the new
        // id and delete the old. The Y.Map at the new id is a fresh struct;
        // any in-flight observers attached to the OLD Y.Map are detached
        // after the delete (callers should re-subscribe — rare in practice).
        const seg = yMapToSegment(segMap);
        seg.id = op.newId;
        segments.set(op.newId, segmentToYMap(seg));
        segments.delete(op.oldId);
      } else {
        // Could also be a constraint/dimension rename — supported for symmetry.
        const conMap = constraints.get(op.oldId);
        if (conMap) {
          foundEntity = true;
          if (constraints.has(op.newId)) {
            throw new Error(`[sketchYjs] renameEntity: newId "${op.newId}" already exists`);
          }
          const c = yMapToConstraint(conMap);
          c.id = op.newId;
          constraints.set(op.newId, constraintToYMap(c));
          constraints.delete(op.oldId);
        } else {
          const dimMap = dimensions.get(op.oldId);
          if (dimMap) {
            foundEntity = true;
            if (dimensions.has(op.newId)) {
              throw new Error(`[sketchYjs] renameEntity: newId "${op.newId}" already exists`);
            }
            const d = yMapToDimension(dimMap);
            d.id = op.newId;
            dimensions.set(op.newId, dimensionToYMap(d));
            dimensions.delete(op.oldId);
          }
        }
      }

      if (!foundEntity) {
        return { applied: false, notes: `renameEntity: oldId "${op.oldId}" not found` };
      }

      // Now rewrite cross-references. Iterate constraints + dimensions; any
      // entry whose entityIds JSON contains oldId gets re-serialized with the
      // substitution. This is O(N_constraint + N_dimension) per rename, which
      // is fine at sketch scale (50-200 entities).
      let refsRewritten = 0;
      constraints.forEach((conMap, _cid) => {
        const ids = JSON.parse((conMap.get(CON_FIELDS.entityIds) as string) ?? '[]') as string[];
        if (ids.includes(op.oldId)) {
          const next = ids.map(x => (x === op.oldId ? op.newId : x));
          conMap.set(CON_FIELDS.entityIds, JSON.stringify(next));
          refsRewritten++;
        }
      });
      dimensions.forEach((dimMap, _did) => {
        const ids = JSON.parse((dimMap.get(DIM_FIELDS.entityIds) as string) ?? '[]') as string[];
        if (ids.includes(op.oldId)) {
          const next = ids.map(x => (x === op.oldId ? op.newId : x));
          dimMap.set(DIM_FIELDS.entityIds, JSON.stringify(next));
          refsRewritten++;
        }
      });

      return {
        applied: true,
        notes: `rename ${op.oldId}→${op.newId}; ${refsRewritten} cross-reference(s) rewritten`,
      };
    }

    default: {
      // Exhaustiveness check — TS will error if a new variant is added to
      // SketchOp without a corresponding case here.
      const _never: never = op;
      void _never;
      return { applied: false };
    }
  }
}

// ─── Sync helper (mirrors sketchCrdt.ts:syncDocs for test convenience) ─────

/** Exchange Yjs state vectors between two docs so each receives the other's
 *  updates. Used by multi-peer tests. Returns the byte counts in each
 *  direction for telemetry. */
export function syncDocs(a: Y.Doc, b: Y.Doc): { aToB: number; bToA: number } {
  const stateA = Y.encodeStateVector(a);
  const stateB = Y.encodeStateVector(b);
  const updateForB = Y.encodeStateAsUpdate(a, stateB);
  const updateForA = Y.encodeStateAsUpdate(b, stateA);
  Y.applyUpdate(b, updateForB, ORIGIN_REMOTE_UPDATE);
  Y.applyUpdate(a, updateForA, ORIGIN_REMOTE_UPDATE);
  return { aToB: updateForB.byteLength, bToA: updateForA.byteLength };
}

// ─── Equality helper for round-trip tests ──────────────────────────────────

/** Order-insensitive deep-ish equality for two Sketch values. Segments /
 *  constraints / dimensions are compared as id-keyed sets (the CRDT has no
 *  inherent ordering); other fields use plain JSON equality.
 *
 *  Exported so tests can assert "sketch survives a YDoc round trip" without
 *  fighting non-deterministic Y.Map iteration order. */
export function sketchesEqual(a: Sketch, b: Sketch): boolean {
  if (a.id !== b.id) return false;
  if (a.plane !== b.plane) return false;
  if (a.planeOffset !== b.planeOffset) return false;
  if (a.operation !== b.operation) return false;
  if (JSON.stringify(a.faceFrame) !== JSON.stringify(b.faceFrame)) return false;
  if (JSON.stringify(a.config) !== JSON.stringify(b.config)) return false;
  if (!sameById(a.segments, b.segments)) return false;
  if (!sameById(a.constraints, b.constraints)) return false;
  if (!sameById(a.dimensions, b.dimensions)) return false;
  return true;
}

function sameById<T extends { id?: string }>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const aMap = new Map(a.map(item => [item.id ?? '', canonicalJson(item)]));
  const bMap = new Map(b.map(item => [item.id ?? '', canonicalJson(item)]));
  if (aMap.size !== bMap.size) return false;
  for (const [k, v] of aMap) {
    if (bMap.get(k) !== v) return false;
  }
  return true;
}

/** Stable stringify with sorted object keys — needed because the decode path
 *  inserts keys in `type, points, id, ...` order while the input has
 *  `id, type, points, ...`. The data is equal; the JSON.stringify byte
 *  representation isn't. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}
