/**
 * measure — W3-C: reference → REAL measured value for drawing dimensions.
 *
 * Replaces the `<linear>` placeholder literal SheetRenderer currently prints:
 * given a `Dimension` (whose `refs` are SOURCE-model stable topology names)
 * and the viewport's standard projection view, this engine resolves the refs
 * against the model's named topology and measures the actual value on the
 * projection plane — or returns an EXPLICIT failure. It never fabricates.
 *
 * ─── CONSUMPTION GUIDE (W4-A wiring) ────────────────────────────────────────
 *
 * Inputs you must supply:
 *   1. `topo: NamedTopology` — the source model's named topology, built by
 *      `buildExtrudeTopo(feature)` (src/lib/cad/topoNaming.ts). This is the
 *      SAME namespace `Dimension.refs` documents ("source-model geometry ids"):
 *      faces `f.cap.bottom` / `f.cap.top` / `f.side.{i}` and edges
 *      `e.bottom.{i}-{j}` / `e.top.{i}-{j}` / `e.vert.{i}`.
 *   2. `view: ProjectionView` — the viewport's standard view ('front' | 'top'
 *      | ... | 'iso'). Only `projection.kind === 'standard'` viewports are
 *      measurable in W3-C; for section/auxiliary/detail viewports keep the
 *      existing placeholder. The projection basis is EXACTLY `viewBasis()`
 *      from projectView.ts — the same basis the drawn edges use, so measured
 *      values line up with the drawn geometry.
 *
 * Call:
 *   const res = measureDimension(dim, { topo, view: vp.projection.view });
 *   if (res.ok) {
 *     // res.value      — the number to print. MODEL millimetres for length
 *     //                  kinds, DEGREES for 'angular'. Independent of the
 *     //                  viewport render scale (drawings always show model
 *     //                  dimensions, not paper dimensions).
 *     // res.valueBasis — always 'projected': the value is measured ON the
 *     //                  projection plane (drawing convention).
 *     // res.trueValue3D / res.foreshortened — see "projected vs true" below.
 *   } else {
 *     // res.reason + res.detail — keep the placeholder / show a lost-ref
 *     // marker. NEVER print a number on !ok (값 날조 금지).
 *   }
 *   Precedence: `dim.valueOverride` (when set) still wins over measurement —
 *   that is the existing IR contract; this engine does not look at it.
 *
 * ─── Projected vs true value ────────────────────────────────────────────────
 *
 * `value` is ALWAYS the projected (in-view) measurement — the drafting
 * convention for what a dimension on that view shows. When the same pair of
 * entities also has a well-defined 3D measurement, it is returned as
 * `trueValue3D`, and `foreshortened` tells you whether projection shrank it:
 *
 *   - linear with an explicit/auto axis on two point-like refs measures the
 *     axis COMPONENT; its 3D counterpart along the same axis is identical by
 *     construction (an orthographic projection preserves in-plane axes), so
 *     trueValue3D === value and foreshortened === false.
 *   - linear/aligned between parallel edges/faces: trueValue3D is the 3D
 *     perpendicular distance between the entities (only when they are also
 *     parallel in 3D; skew pairs get trueValue3D === undefined).
 *   - angular: trueValue3D is the 3D angle between the edge directions.
 *   - radial/diametric require the circular face to be parallel to the view
 *     plane (else explicit 'oblique-in-view' failure), so projected === true.
 *   - `measureEdgeLength` returns the projected length of one edge with its
 *     3D length as trueValue3D — the classic slanted-edge foreshortening.
 *
 * ─── Failure vocabulary (명시적 실패 — W1-C 'lost' 사상과 동일) ────────────
 *
 *   unresolved-ref    ref not in this topology (edge consumed / feature
 *                     deleted / composed-boolean name, see below)
 *   wrong-ref-type    e.g. a face where an edge is required (angular), or an
 *                     edge for radial (mesh edges are straight — circles only
 *                     exist as tessellated face loops)
 *   wrong-ref-count   refs.length does not match the dimension kind's arity
 *   not-parallel      linear/aligned between edges that are not parallel in
 *                     this view
 *   not-axis-aligned  linear 'auto'/'x'/'y' on a span that has no axis-aligned
 *                     measurement in this view (use 'aligned' instead)
 *   oblique-in-view   a face that must be edge-on (linear) or view-parallel
 *                     (radial/diametric) is neither in this view
 *   not-circular      radial/diametric face whose projected loop is not a
 *                     circle (too few vertices, or vertices not concyclic)
 *   degenerate        an entity projects to a point where an extent is needed
 *
 * Scope note (근사는 명시): composed-boolean names (`base/e.vert.0`,
 * `<opId>/seam.k` from composedTopo.ts) resolve to midpoint ANCHORS only —
 * a midpoint cannot be measured for length/angle, so those refs return
 * 'unresolved-ref' with a detail explaining it. Circles are detected from
 * tessellated face loops whose vertices lie on the true circle (featureMesh
 * generates them that way); concyclicity is verified, never assumed.
 */

import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { sub, dot, cross, lengthOf } from '@/lib/sketch/sketchPlane';
import type { NamedTopology } from '@/lib/cad/topoNaming';
import { viewBasis, type Basis, type ProjectionView } from './projectView';
import type { Dimension, DimensionKind } from './dimension';
import { KIND_REF_COUNT } from './dimension';
import type { Pt } from './dimensionAnchor';

// ─── public types ────────────────────────────────────────────────────────

export type MeasureFailReason =
  | 'unresolved-ref'
  | 'wrong-ref-type'
  | 'wrong-ref-count'
  | 'not-parallel'
  | 'not-axis-aligned'
  | 'oblique-in-view'
  | 'not-circular'
  | 'degenerate';

export interface MeasureFail {
  ok: false;
  reason: MeasureFailReason;
  /** Human-readable diagnosis: which ref, and why it could not be measured. */
  detail: string;
}

export interface MeasureOk {
  ok: true;
  kind: DimensionKind | 'edge-length';
  /**
   * The measured value ON the projection plane — what the dimension on this
   * view shows (drawing convention). Model millimetres for length kinds,
   * degrees for 'angular'. Independent of viewport render scale.
   */
  value: number;
  /** Always 'projected' — states explicitly which convention `value` uses. */
  valueBasis: 'projected';
  unit: 'mm' | 'deg';
  /**
   * The corresponding TRUE (3D model) value, when well-defined for the
   * measured pair (see module header). Undefined for 3D-skew pairs.
   */
  trueValue3D?: number;
  /**
   * Present iff trueValue3D is present: true when projection changed the
   * value beyond tolerance (e.g. a slanted edge seen in a non-normal view).
   */
  foreshortened?: boolean;
}

export type MeasureResult = MeasureOk | MeasureFail;

export type MeasureAxis = 'x' | 'y' | 'auto';

export interface MeasureOptions {
  /**
   * linear only — measurement axis on the projection plane. 'x' / 'y' force
   * the horizontal / vertical component; 'auto' (default) uses the span's own
   * direction when it is axis-aligned and fails 'not-axis-aligned' otherwise.
   */
  axis?: MeasureAxis;
  /** Unit-vector parallelism tolerance (|cross| of unit dirs). Default 1e-7. */
  parallelTol?: number;
  /** Relative concyclicity tolerance for radial/diametric. Default 1e-6. */
  circularityTol?: number;
  /** Minimum face-loop vertices to accept as a circle. Default 8 (a square's
   *  4 corners are concyclic but a square is not a circle). */
  minCircleVertices?: number;
}

export interface MeasureContext {
  topo: NamedTopology;
  view: ProjectionView;
}

// ─── constants ───────────────────────────────────────────────────────────

const DEG = 180 / Math.PI;
const DEFAULT_PARALLEL_TOL = 1e-7;
const DEFAULT_CIRCULARITY_TOL = 1e-6;
const DEFAULT_MIN_CIRCLE_VERTICES = 8;
/** Projected extent below this (mm) is a point, not a segment. */
const DEGENERATE_LEN = 1e-9;
/** Relative threshold above which projected vs true counts as foreshortened. */
const FORESHORTEN_TOL = 1e-9;

// ─── small 2D helpers ────────────────────────────────────────────────────

function p2(v: Vec3, b: Basis): Pt {
  return { x: dot(v, b.right), y: dot(v, b.up) };
}

function sub2(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function len2(a: Pt): number {
  return Math.hypot(a.x, a.y);
}

function cross2(a: Pt, b: Pt): number {
  return a.x * b.y - a.y * b.x;
}

function dot2(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

function unit2(a: Pt): Pt | null {
  const l = len2(a);
  return l < DEGENERATE_LEN ? null : { x: a.x / l, y: a.y / l };
}

function unit3(v: Vec3): Vec3 | null {
  const l = lengthOf(v);
  return l < DEGENERATE_LEN ? null : { x: v.x / l, y: v.y / l, z: v.z / l };
}

function fail(reason: MeasureFailReason, detail: string): MeasureFail {
  return { ok: false, reason, detail };
}

function okResult(
  kind: MeasureOk['kind'],
  value: number,
  unit: MeasureOk['unit'],
  trueValue3D?: number,
): MeasureOk {
  const out: MeasureOk = { ok: true, kind, value, valueBasis: 'projected', unit };
  if (trueValue3D !== undefined) {
    out.trueValue3D = trueValue3D;
    out.foreshortened =
      Math.abs(value - trueValue3D) >
      FORESHORTEN_TOL * Math.max(1, Math.abs(trueValue3D));
  }
  return out;
}

// ─── ref resolution ──────────────────────────────────────────────────────

interface EdgeEntity {
  type: 'edge';
  ref: string;
  a3: Vec3;
  b3: Vec3;
  a2: Pt;
  b2: Pt;
}

interface FaceEntity {
  type: 'face';
  ref: string;
  /** Outward unit normal (featureMesh invariant). */
  normal: Vec3;
  /** A point on the face plane (first loop vertex, 3D). */
  p3: Vec3;
  /** Projected loop vertices. */
  loop2: Pt[];
}

type Entity = EdgeEntity | FaceEntity;

function isFail(x: Entity | MeasureFail): x is MeasureFail {
  return 'ok' in x && x.ok === false;
}

function resolveRef(topo: NamedTopology, basis: Basis, ref: string): Entity | MeasureFail {
  const loc = topo.byName.get(ref);
  if (!loc) {
    const composedHint = ref.includes('/')
      ? ' (composed-boolean names resolve to midpoint anchors only — not measurable in W3-C)'
      : '';
    return fail('unresolved-ref', `ref '${ref}' not found in topology${composedHint}`);
  }
  if (loc.kind === 'edge') {
    const e = topo.edges[loc.index];
    const a3 = topo.poly.vertices[e.a];
    const b3 = topo.poly.vertices[e.b];
    return { type: 'edge', ref, a3, b3, a2: p2(a3, basis), b2: p2(b3, basis) };
  }
  const f = topo.poly.faces[loc.index];
  return {
    type: 'face',
    ref,
    normal: f.normal,
    p3: topo.poly.vertices[f.vertices[0]],
    loop2: f.vertices.map((vi) => p2(topo.poly.vertices[vi], basis)),
  };
}

// ─── point/line reduction (linear + aligned) ─────────────────────────────

type Reduced =
  | { type: 'point'; p: Pt; src: Entity }
  | { type: 'line'; p: Pt; d: Pt; src: Entity }; // d is a unit direction

/**
 * Reduce an entity to its measurable 2D form in this view:
 *   edge  → its projected support line, or a point if it projects degenerate
 *           (an edge parallel to the view direction, e.g. e.vert.* in 'top').
 *   face  → its projected support line — only legal when the face is EDGE-ON
 *           in this view (plane contains the view direction; the standard
 *           drafting situation "dimension between two surfaces seen as lines").
 */
function reduce(entity: Entity, basis: Basis, parallelTol: number): Reduced | MeasureFail {
  if (entity.type === 'edge') {
    const d = unit2(sub2(entity.b2, entity.a2));
    if (!d) {
      return { type: 'point', p: { x: (entity.a2.x + entity.b2.x) / 2, y: (entity.a2.y + entity.b2.y) / 2 }, src: entity };
    }
    return { type: 'line', p: entity.a2, d, src: entity };
  }
  // Face: edge-on ⇔ normal ⟂ viewDir.
  if (Math.abs(dot(entity.normal, basis.viewDir)) > parallelTol) {
    return fail(
      'oblique-in-view',
      `face '${entity.ref}' is not edge-on in this view — a linear/aligned dimension needs the surface to appear as a line`,
    );
  }
  // With n ⟂ viewDir, the projected loop lies exactly on the line n2·q = n·p3.
  const n2: Pt = { x: dot(entity.normal, basis.right), y: dot(entity.normal, basis.up) };
  const nu = unit2(n2);
  if (!nu) return fail('degenerate', `face '${entity.ref}' has a degenerate projected normal`);
  return { type: 'line', p: entity.loop2[0], d: { x: -nu.y, y: nu.x }, src: entity };
}

// ─── 3D true-separation (parallel entities only — skew ⇒ undefined) ─────

function trueSeparation3D(a: Entity, b: Entity, parallelTol: number): number | undefined {
  const delta = a.type === 'edge'
    ? (b.type === 'edge' ? sub(b.a3, a.a3) : sub(b.p3, a.a3))
    : (b.type === 'edge' ? sub(b.a3, a.p3) : sub(b.p3, a.p3));

  if (a.type === 'edge' && b.type === 'edge') {
    const dA = unit3(sub(a.b3, a.a3));
    const dB = unit3(sub(b.b3, b.a3));
    if (!dA || !dB) return undefined;
    if (lengthOf(cross(dA, dB)) > parallelTol) return undefined; // 3D-skew
    return lengthOf(cross(delta, dA));
  }
  if (a.type === 'face' && b.type === 'face') {
    if (lengthOf(cross(a.normal, b.normal)) > parallelTol) return undefined;
    return Math.abs(dot(a.normal, delta));
  }
  // Mixed edge/face: line must be parallel to the plane.
  const edge = a.type === 'edge' ? a : (b as EdgeEntity);
  const face = a.type === 'face' ? a : (b as FaceEntity);
  const d = unit3(sub(edge.b3, edge.a3));
  if (!d) return undefined;
  if (Math.abs(dot(d, face.normal)) > parallelTol) return undefined;
  return Math.abs(dot(face.normal, delta));
}

// ─── linear + aligned ────────────────────────────────────────────────────

function measureSpan(
  kind: 'linear' | 'aligned',
  rA: Reduced,
  rB: Reduced,
  axis: MeasureAxis,
  parallelTol: number,
): MeasureResult {
  // point ↔ point
  if (rA.type === 'point' && rB.type === 'point') {
    const delta = sub2(rB.p, rA.p);
    if (kind === 'aligned') {
      const value = len2(delta);
      if (value < DEGENERATE_LEN) {
        return fail('degenerate', `refs '${rA.src.ref}' and '${rB.src.ref}' project to the same point`);
      }
      return okResult('aligned', value, 'mm', trueSeparation3D(rA.src, rB.src, parallelTol));
    }
    // linear: measure the axis component.
    let ax: 'x' | 'y';
    if (axis === 'auto') {
      const u = unit2(delta);
      if (!u) return fail('degenerate', `refs '${rA.src.ref}' and '${rB.src.ref}' project to the same point`);
      if (Math.abs(u.y) <= parallelTol) ax = 'x';
      else if (Math.abs(u.x) <= parallelTol) ax = 'y';
      else {
        return fail(
          'not-axis-aligned',
          `span '${rA.src.ref}'→'${rB.src.ref}' is not axis-aligned in this view — use an explicit axis or an aligned dimension`,
        );
      }
    } else {
      ax = axis;
    }
    const value = ax === 'x' ? Math.abs(delta.x) : Math.abs(delta.y);
    if (value < DEGENERATE_LEN) {
      return fail('degenerate', `refs '${rA.src.ref}' and '${rB.src.ref}' have zero ${ax}-span in this view`);
    }
    // Orthographic projection preserves in-plane axis components exactly, so
    // the 3D value along the same axis IS the projected value.
    return okResult('linear', value, 'mm', value);
  }

  // line ↔ line: perpendicular distance between parallel support lines.
  if (rA.type === 'line' && rB.type === 'line') {
    if (Math.abs(cross2(rA.d, rB.d)) > parallelTol) {
      return fail(
        'not-parallel',
        `edges/faces '${rA.src.ref}' and '${rB.src.ref}' are not parallel in this view`,
      );
    }
    const perp: Pt = { x: -rA.d.y, y: rA.d.x };
    const value = Math.abs(dot2(perp, sub2(rB.p, rA.p)));
    if (kind === 'linear') {
      const bad = axisViolation(axis, perp, parallelTol, `'${rA.src.ref}'↔'${rB.src.ref}'`);
      if (bad) return bad;
    }
    return okResult(kind, value, 'mm', trueSeparation3D(rA.src, rB.src, parallelTol));
  }

  // point ↔ line (either order): perpendicular distance to the support line.
  const pt = rA.type === 'point' ? rA : (rB as Extract<Reduced, { type: 'point' }>);
  const ln = rA.type === 'line' ? rA : (rB as Extract<Reduced, { type: 'line' }>);
  const perp: Pt = { x: -ln.d.y, y: ln.d.x };
  const value = Math.abs(dot2(perp, sub2(pt.p, ln.p)));
  if (kind === 'linear') {
    const bad = axisViolation(axis, perp, parallelTol, `'${rA.src.ref}'↔'${rB.src.ref}'`);
    if (bad) return bad;
  }
  return okResult(kind, value, 'mm', trueSeparation3D(rA.src, rB.src, parallelTol));
}

/**
 * For linear measurements between lines, the measured direction is the common
 * perpendicular. 'x'/'y' demand that perpendicular to BE that axis; 'auto'
 * accepts either axis and rejects oblique spans.
 */
function axisViolation(
  axis: MeasureAxis,
  measuredDir: Pt,
  tol: number,
  what: string,
): MeasureFail | null {
  const alongX = Math.abs(measuredDir.y) <= tol;
  const alongY = Math.abs(measuredDir.x) <= tol;
  if (axis === 'x' && !alongX) {
    return fail('not-axis-aligned', `linear x-dimension ${what}: measured direction is not the x-axis`);
  }
  if (axis === 'y' && !alongY) {
    return fail('not-axis-aligned', `linear y-dimension ${what}: measured direction is not the y-axis`);
  }
  if (axis === 'auto' && !alongX && !alongY) {
    return fail(
      'not-axis-aligned',
      `linear dimension ${what} is oblique in this view — use an aligned dimension`,
    );
  }
  return null;
}

// ─── angular ─────────────────────────────────────────────────────────────

/**
 * Angle between two DIRECTED edge vectors (each edge runs a→b in ascending
 * polyhedron vertex-index order — deterministic). Result in degrees, [0, 180].
 * The complementary callout is 180 − value; the renderer chooses.
 */
function measureAngularPair(eA: EdgeEntity, eB: EdgeEntity): MeasureResult {
  const dA = unit2(sub2(eA.b2, eA.a2));
  const dB = unit2(sub2(eB.b2, eB.a2));
  if (!dA) return fail('degenerate', `edge '${eA.ref}' projects to a point in this view`);
  if (!dB) return fail('degenerate', `edge '${eB.ref}' projects to a point in this view`);
  const value = Math.atan2(Math.abs(cross2(dA, dB)), dot2(dA, dB)) * DEG;

  const dA3 = unit3(sub(eA.b3, eA.a3));
  const dB3 = unit3(sub(eB.b3, eB.a3));
  const true3d =
    dA3 && dB3 ? Math.atan2(lengthOf(cross(dA3, dB3)), dot(dA3, dB3)) * DEG : undefined;
  return okResult('angular', value, 'deg', true3d);
}

// ─── radial / diametric ──────────────────────────────────────────────────

function circumcircle(a: Pt, b: Pt, c: Pt): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const span = Math.max(len2(sub2(b, a)), len2(sub2(c, a)), 1);
  if (Math.abs(d) < 1e-12 * span * span) return null; // collinear
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

function measureCircleFace(
  kind: 'radial' | 'diametric',
  face: FaceEntity,
  basis: Basis,
  parallelTol: number,
  circularityTol: number,
  minVertices: number,
): MeasureResult {
  // The face must be parallel to the view plane — an oblique circle projects
  // to an ellipse, which has no single radius. Drafting places R/⌀ on the
  // view normal to the circle; other views must explicitly fail.
  if (lengthOf(cross(face.normal, basis.viewDir)) > parallelTol) {
    return fail(
      'oblique-in-view',
      `face '${face.ref}' is not parallel to this view plane — radius/diameter must be measured on the normal view`,
    );
  }
  const loop = face.loop2;
  if (loop.length < minVertices) {
    return fail(
      'not-circular',
      `face '${face.ref}' has ${loop.length} loop vertices (< ${minVertices}) — refusing to call it a circle`,
    );
  }
  const fit = circumcircle(loop[0], loop[Math.floor(loop.length / 3)], loop[Math.floor((2 * loop.length) / 3)]);
  if (!fit) return fail('not-circular', `face '${face.ref}': sampled loop vertices are collinear`);
  let maxDev = 0;
  for (const q of loop) {
    const dev = Math.abs(Math.hypot(q.x - fit.cx, q.y - fit.cy) - fit.r);
    if (dev > maxDev) maxDev = dev;
  }
  if (maxDev > circularityTol * Math.max(1, fit.r)) {
    return fail(
      'not-circular',
      `face '${face.ref}': loop vertices deviate from the fitted circle by up to ${maxDev} mm`,
    );
  }
  const value = kind === 'diametric' ? 2 * fit.r : fit.r;
  // Face ∥ view plane ⇒ the projection is rigid: projected === true.
  return okResult(kind, value, 'mm', value);
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Measure a Dimension IR against the source model's named topology, on the
 * given standard projection view. See module header for the full contract.
 */
export function measureDimension(
  dimension: Dimension,
  ctx: MeasureContext,
  opts: MeasureOptions = {},
): MeasureResult {
  const expected = KIND_REF_COUNT[dimension.kind];
  if (dimension.refs.length !== expected) {
    return fail(
      'wrong-ref-count',
      `dimension '${dimension.id}': kind '${dimension.kind}' needs ${expected} refs, got ${dimension.refs.length}`,
    );
  }
  const parallelTol = opts.parallelTol ?? DEFAULT_PARALLEL_TOL;
  const basis = viewBasis(ctx.view);

  const entities: Entity[] = [];
  for (const ref of dimension.refs) {
    const e = resolveRef(ctx.topo, basis, ref);
    if (isFail(e)) return e;
    entities.push(e);
  }

  switch (dimension.kind) {
    case 'linear':
    case 'aligned': {
      const rA = reduce(entities[0], basis, parallelTol);
      if ('ok' in rA) return rA;
      const rB = reduce(entities[1], basis, parallelTol);
      if ('ok' in rB) return rB;
      return measureSpan(dimension.kind, rA, rB, opts.axis ?? 'auto', parallelTol);
    }
    case 'angular': {
      const bad = entities.find((e) => e.type !== 'edge');
      if (bad) {
        return fail('wrong-ref-type', `angular dimension needs two edges; ref '${bad.ref}' is a face`);
      }
      return measureAngularPair(entities[0] as EdgeEntity, entities[1] as EdgeEntity);
    }
    case 'radial':
    case 'diametric': {
      const e = entities[0];
      if (e.type !== 'face') {
        return fail(
          'wrong-ref-type',
          `${dimension.kind} dimension: ref '${e.ref}' is an edge — polyhedral edges are straight; reference the circular FACE (e.g. 'f.cap.top')`,
        );
      }
      return measureCircleFace(
        dimension.kind,
        e,
        basis,
        parallelTol,
        opts.circularityTol ?? DEFAULT_CIRCULARITY_TOL,
        opts.minCircleVertices ?? DEFAULT_MIN_CIRCLE_VERTICES,
      );
    }
  }
}

/**
 * Length of a single named edge in the given view: `value` is the PROJECTED
 * length (what the view shows), `trueValue3D` the real 3D length, and
 * `foreshortened` whether they differ (e.g. a 45° slanted edge in 'front').
 * Not a DimensionKind — a measurement primitive W4-A can use for edge-length
 * callouts and for choosing whether to warn about foreshortened views.
 */
export function measureEdgeLength(
  topo: NamedTopology,
  view: ProjectionView,
  ref: string,
): MeasureResult {
  const basis = viewBasis(view);
  const e = resolveRef(topo, basis, ref);
  if (isFail(e)) return e;
  if (e.type !== 'edge') {
    return fail('wrong-ref-type', `edge-length: ref '${ref}' is a face, not an edge`);
  }
  const trueLen = lengthOf(sub(e.b3, e.a3));
  if (trueLen < DEGENERATE_LEN) {
    return fail('degenerate', `edge '${ref}' has zero 3D length`);
  }
  const projLen = len2(sub2(e.b2, e.a2));
  return okResult('edge-length', projLen, 'mm', trueLen);
}
