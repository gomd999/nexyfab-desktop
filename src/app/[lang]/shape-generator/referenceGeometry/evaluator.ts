/**
 * referenceGeometry/evaluator.ts — resolve a `ReferenceNode[]` graph into
 * concrete `{origin, normal}` / `{origin, direction}` / `{position}` /
 * trihedron values.
 *
 * Wave 2 Phase 2 Track D3. Spec §7.3 (lazy eval) + §11 (math).
 *
 * The evaluator is **pure** — it doesn't touch the store; the renderer
 * and `sketchPlaneAdapter` feed it a snapshot and read the result. Order
 * is topological (toposort runs first); a node enters `errors` if any
 * upstream ref is missing or evaluation returned null.
 *
 * D3 scope (non-CRDT):
 *
 *   - Supports the methods D1 + D2 actually wire: plane (standard/offset/
 *     through3Points/parallelThroughPoint/midBetween/angle/
 *     throughLineAndPoint), axis (standard/through2Points/
 *     twoPlaneIntersect/normalToPlaneAtPoint), point (intersectLineAndPlane/
 *     intersectThreePlanes/projectPointOntoPlane/byCoordinates), csys
 *     (world/originAndTwoAxes/originAndPlane).
 *   - Topology-pick methods (alongEdge, cylinderConeAxis, vertex,
 *     midOfEdge, centerOfFace, byFaceVertex, tangentToCylinder) are
 *     accepted but evaluate to `error: 'unsupported'` — the worker
 *     face-classification API ships Phase 2.5 (spec §15 soft deps).
 */

import { buildGraph, toposort } from './depSolver';
import {
  axisFromTwoPoints,
  axisFromTwoPlanes,
  axisNormalToPlaneAtPoint,
  csysFromOriginAndAxes,
  csysOnPlane,
  planeFromThreePoints,
  planeMidBetween,
  planeOffset,
  planeAngleAboutAxis,
  planeParallelThroughPoint,
  planeThroughLineAndPoint,
  pointLinePlaneIntersect,
  pointProjectToPlane,
  pointThreePlaneIntersect,
  standardAxis,
  standardPlane,
  WORLD_CSYS,
} from './math';
import type {
  AxisRef,
  PlaneRef,
  PointRef,
  ReferenceErrorCode,
  ReferenceNode,
  ResolvedAxis,
  ResolvedPlane,
  ResolvedPoint,
  ResolvedValue,
  Vec3,
} from './types';

/** Internal: per-node evaluation result during graph walking. */
type EvalEntry =
  | { ok: true; value: ResolvedValue }
  | { ok: false; code: ReferenceErrorCode };

export interface ResolvedNodes {
  /** Map of node id → resolved value. Only `ok` entries land here. */
  readonly values: ReadonlyMap<string, ResolvedValue>;
  /** Map of node id → error code. */
  readonly errors: ReadonlyMap<string, ReferenceErrorCode>;
  /** Topological eval order (parents before children). Cycle participants
   *  appear at the end and surface as `cycle` errors. */
  readonly order: readonly string[];
}

/** Resolve every node in `nodes` to its concrete frame.
 *
 *  Spec §7.3 — when the cycle/eval algorithm detects a missing parent
 *  or a degenerate constructor, the node enters `errors` with the
 *  appropriate `ReferenceErrorCode`. */
export function computeResolvedNodes(
  nodes: readonly ReferenceNode[],
): ResolvedNodes {
  const graph = buildGraph(nodes);
  const topo = toposort(graph);

  const idIndex = new Map<string, ReferenceNode>();
  for (const n of nodes) idIndex.set(n.id, n);

  const values = new Map<string, ResolvedValue>();
  const errors = new Map<string, ReferenceErrorCode>();

  // Cycle members surface as `cycle`; the toposort returns a partial order.
  if (topo.cycle !== null) {
    for (const id of topo.cycle) {
      if (id === topo.cycle[topo.cycle.length - 1]) continue; // skip duplicate
      errors.set(id, 'cycle');
    }
  }

  // Walk the toposort, evaluating each. Skip nodes already flagged.
  for (const id of topo.order) {
    if (errors.has(id)) continue;
    const node = idIndex.get(id);
    if (node === undefined) continue;
    const entry = evalNode(node, values, errors);
    if (entry.ok) {
      values.set(id, entry.value);
    } else {
      errors.set(id, entry.code);
    }
  }

  // Tail-end: nodes not in `topo.order` (cycle members) — already errored.
  for (const n of nodes) {
    if (!values.has(n.id) && !errors.has(n.id)) {
      errors.set(n.id, 'cycle');
    }
  }

  return { values, errors, order: topo.order };
}

// ─── Per-kind evaluators ────────────────────────────────────────

function evalNode(
  node: ReferenceNode,
  values: ReadonlyMap<string, ResolvedValue>,
  errors: ReadonlyMap<string, ReferenceErrorCode>,
): EvalEntry {
  switch (node.kind) {
    case 'plane':
      return evalPlane(node.params, values, errors);
    case 'axis':
      return evalAxis(node.params, values, errors);
    case 'point':
      return evalPoint(node.params, values, errors);
    case 'csys':
      return evalCsys(node.params, values, errors);
  }
}

function evalPlane(
  params: import('./types').PlaneParams,
  values: ReadonlyMap<string, ResolvedValue>,
  errors: ReadonlyMap<string, ReferenceErrorCode>,
): EvalEntry {
  switch (params.method) {
    case 'standard':
      return ok({ kind: 'plane', value: standardPlane(params.id) });
    case 'offset': {
      const parent = resolvePlaneRef(params.parent, values, errors);
      if (parent === null) return missing();
      return ok({
        kind: 'plane',
        value: planeOffset(parent, params.distanceMm, params.direction),
      });
    }
    case 'parallelThroughPoint': {
      const parent = resolvePlaneRef(params.parent, values, errors);
      const point = resolvePointRef(params.point, values, errors);
      if (parent === null || point === null) return missing();
      return ok({
        kind: 'plane',
        value: planeParallelThroughPoint(parent, point.position),
      });
    }
    case 'midBetween': {
      const a = resolvePlaneRef(params.a, values, errors);
      const b = resolvePlaneRef(params.b, values, errors);
      if (a === null || b === null) return missing();
      const r = planeMidBetween(a, b);
      return r === null ? degenerate() : ok({ kind: 'plane', value: r });
    }
    case 'through3Points': {
      const p1 = resolvePointRef(params.points[0], values, errors);
      const p2 = resolvePointRef(params.points[1], values, errors);
      const p3 = resolvePointRef(params.points[2], values, errors);
      if (p1 === null || p2 === null || p3 === null) return missing();
      const r = planeFromThreePoints(p1.position, p2.position, p3.position);
      return r === null ? degenerate() : ok({ kind: 'plane', value: r });
    }
    case 'angle': {
      const parent = resolvePlaneRef(params.parent, values, errors);
      const axis = resolveAxisRef(params.axis, values, errors);
      if (parent === null || axis === null) return missing();
      const r = planeAngleAboutAxis(parent, axis, params.angleDeg, params.flip);
      return r === null ? degenerate() : ok({ kind: 'plane', value: r });
    }
    case 'throughLineAndPoint': {
      const line = resolveAxisRef(params.line, values, errors);
      const point = resolvePointRef(params.point, values, errors);
      if (line === null || point === null) return missing();
      const r = planeThroughLineAndPoint(line.origin, line.direction, point.position);
      return r === null ? degenerate() : ok({ kind: 'plane', value: r });
    }
    case 'tangentToCylinder':
      // Needs face-classification (spec §15 soft deps). D3 reports unsupported.
      return { ok: false, code: 'unsupported' };
  }
}

function evalAxis(
  params: import('./types').AxisParams,
  values: ReadonlyMap<string, ResolvedValue>,
  errors: ReadonlyMap<string, ReferenceErrorCode>,
): EvalEntry {
  switch (params.method) {
    case 'standard':
      return ok({ kind: 'axis', value: standardAxis(params.id) });
    case 'through2Points': {
      const p1 = resolvePointRef(params.points[0], values, errors);
      const p2 = resolvePointRef(params.points[1], values, errors);
      if (p1 === null || p2 === null) return missing();
      const r = axisFromTwoPoints(p1.position, p2.position);
      return r === null ? degenerate() : ok({ kind: 'axis', value: r });
    }
    case 'twoPlaneIntersect': {
      const a = resolvePlaneRef(params.a, values, errors);
      const b = resolvePlaneRef(params.b, values, errors);
      if (a === null || b === null) return missing();
      const r = axisFromTwoPlanes(a, b);
      return r === null ? degenerate() : ok({ kind: 'axis', value: r });
    }
    case 'normalToPlaneAtPoint': {
      const plane = resolvePlaneRef(params.plane, values, errors);
      const point = resolvePointRef(params.point, values, errors);
      if (plane === null || point === null) return missing();
      return ok({
        kind: 'axis',
        value: axisNormalToPlaneAtPoint(plane, point.position),
      });
    }
    case 'alongEdge':
    case 'cylinderConeAxis':
      return { ok: false, code: 'unsupported' };
  }
}

function evalPoint(
  params: import('./types').PointParams,
  values: ReadonlyMap<string, ResolvedValue>,
  errors: ReadonlyMap<string, ReferenceErrorCode>,
): EvalEntry {
  switch (params.method) {
    case 'byCoordinates':
      // Spec §19.3 — for D3 we evaluate `byCoordinates` as world coords
      // (the `csys?: CsysRef` toggle is honoured if provided AND the
      // referenced csys resolves; otherwise default to world).
      if (params.csys !== undefined && params.csys.kind === 'reference') {
        const csys = values.get(params.csys.nodeId);
        if (csys !== undefined && csys.kind === 'csys') {
          const c = csys.value;
          const p = params.position;
          return ok({
            kind: 'point',
            value: {
              position: [
                c.origin[0] + p[0] * c.xAxis[0] + p[1] * c.yAxis[0] + p[2] * c.zAxis[0],
                c.origin[1] + p[0] * c.xAxis[1] + p[1] * c.yAxis[1] + p[2] * c.zAxis[1],
                c.origin[2] + p[0] * c.xAxis[2] + p[1] * c.yAxis[2] + p[2] * c.zAxis[2],
              ],
            },
          });
        }
      }
      return ok({ kind: 'point', value: { position: params.position } });

    case 'intersectLineAndPlane': {
      const line = resolveAxisRef(params.line, values, errors);
      const plane = resolvePlaneRef(params.plane, values, errors);
      if (line === null || plane === null) return missing();
      const r = pointLinePlaneIntersect(line.origin, line.direction, plane);
      return r === null ? degenerate() : ok({ kind: 'point', value: r });
    }
    case 'intersectThreePlanes': {
      const a = resolvePlaneRef(params.planes[0], values, errors);
      const b = resolvePlaneRef(params.planes[1], values, errors);
      const c = resolvePlaneRef(params.planes[2], values, errors);
      if (a === null || b === null || c === null) return missing();
      const r = pointThreePlaneIntersect(a, b, c);
      return r === null ? degenerate() : ok({ kind: 'point', value: r });
    }
    case 'projectPointOntoPlane': {
      const point = resolvePointRef(params.point, values, errors);
      const plane = resolvePlaneRef(params.plane, values, errors);
      if (point === null || plane === null) return missing();
      return ok({
        kind: 'point',
        value: pointProjectToPlane(point.position, plane),
      });
    }
    case 'vertex':
    case 'midOfEdge':
    case 'centerOfFace':
      return { ok: false, code: 'unsupported' };
  }
}

function evalCsys(
  params: import('./types').CsysParams,
  values: ReadonlyMap<string, ResolvedValue>,
  errors: ReadonlyMap<string, ReferenceErrorCode>,
): EvalEntry {
  switch (params.method) {
    case 'world':
      return ok({ kind: 'csys', value: WORLD_CSYS });
    case 'originAndTwoAxes': {
      const origin = resolvePointRef(params.origin, values, errors);
      const x = resolveAxisRef(params.xDir, values, errors);
      const y = resolveAxisRef(params.yDir, values, errors);
      if (origin === null || x === null || y === null) return missing();
      const r = csysFromOriginAndAxes(origin.position, x.direction, y.direction);
      return r === null ? degenerate() : ok({ kind: 'csys', value: r });
    }
    case 'originAndPlane': {
      const origin = resolvePointRef(params.origin, values, errors);
      const plane = resolvePlaneRef(params.plane, values, errors);
      const axis = resolveAxisRef(params.inPlaneRef, values, errors);
      if (origin === null || plane === null || axis === null) return missing();
      const r = csysOnPlane({ origin: origin.position, normal: plane.normal }, axis.direction);
      return r === null ? degenerate() : ok({ kind: 'csys', value: r });
    }
    case 'byFaceVertex':
      return { ok: false, code: 'unsupported' };
  }
}

// ─── Ref resolvers ──────────────────────────────────────────────

function resolvePlaneRef(
  r: PlaneRef,
  values: ReadonlyMap<string, ResolvedValue>,
  _errors: ReadonlyMap<string, ReferenceErrorCode>,
): ResolvedPlane | null {
  switch (r.kind) {
    case 'standard':
      return standardPlane(r.id);
    case 'reference': {
      const v = values.get(r.nodeId);
      if (v === undefined || v.kind !== 'plane') return null;
      return v.value;
    }
    case 'face':
      // Topology pick — unsupported in D3 evaluator.
      return null;
    case 'inline':
      return { origin: r.origin, normal: r.normal };
  }
}

function resolveAxisRef(
  r: AxisRef,
  values: ReadonlyMap<string, ResolvedValue>,
  _errors: ReadonlyMap<string, ReferenceErrorCode>,
): ResolvedAxis | null {
  switch (r.kind) {
    case 'standard':
      return standardAxis(r.id);
    case 'reference': {
      const v = values.get(r.nodeId);
      if (v === undefined || v.kind !== 'axis') return null;
      return v.value;
    }
    case 'edge':
      return null;
    case 'inline':
      return { origin: r.origin, direction: r.direction };
  }
}

function resolvePointRef(
  r: PointRef,
  values: ReadonlyMap<string, ResolvedValue>,
  _errors: ReadonlyMap<string, ReferenceErrorCode>,
): ResolvedPoint | null {
  switch (r.kind) {
    case 'reference': {
      const v = values.get(r.nodeId);
      if (v === undefined || v.kind !== 'point') return null;
      return v.value;
    }
    case 'vertex':
      return null;
    case 'inline':
      return { position: r.position };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function ok(value: ResolvedValue): EvalEntry {
  return { ok: true, value };
}

function missing(): EvalEntry {
  return { ok: false, code: 'parent_missing' };
}

function degenerate(): EvalEntry {
  return { ok: false, code: 'degenerate' };
}

// Convenience helper used by the viz renderer + adapter.
export function vec3ToTuple(v: Vec3): [number, number, number] {
  return [v[0], v[1], v[2]];
}
