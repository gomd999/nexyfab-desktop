/**
 * referenceGeometry/types.ts — `ReferenceNode` data model.
 *
 * Wave 2 Phase 2 Track D Week 1. Pure types. No React, no Zustand, no Three.
 *
 * Spec: `docs/wave-2-phase-2-reference-geometry-spec.md` §6.1, §6.2, §6.3.
 *
 * Design notes:
 *
 *   - Spec §6.1 defines a `ReferenceNode` discriminated union over four
 *     kinds (plane / axis / point / csys). Each kind carries a `method`
 *     discriminant inside `params` so a single tree can hold the entire
 *     family.
 *   - Spec §6.3 defines the `PlaneRef` consumer union (4 variants:
 *     `standard` / `reference` / `face` / `inline`). We mirror that shape
 *     for `AxisRef`, `PointRef`, `CsysRef`, plus `EdgeRef` / `FaceRef` /
 *     `VertexRef` for topology-named entities (still strings until the
 *     topology-naming layer lands in Phase 2 Week 1 spike).
 *   - Method params are strongly typed per method via a discriminated
 *     union (`PlaneParams`, `AxisParams`, ...). The runtime `ReferenceNode`
 *     stores them in a single `params` field; type guards narrow at the
 *     consumer.
 *   - `dependsOn: string[]` is denormalized — it's the source of truth for
 *     the dep solver. Constructors compute it from the params and stash it
 *     so the solver doesn't need to know about every method shape. This
 *     keeps the solver method-agnostic.
 *
 * The 4 plane-creation methods that ship with Track D Week 1 are
 * `standard` / `offset` / `through3Points` / `parallelThroughPoint` /
 * `midBetween` (5 total — methods 1–5 of spec §2). Methods 6–8 (angle,
 * lineAndPoint, tangentToCylinder) ship Week 2.
 */

// ─── Primitives ──────────────────────────────────────────────────

/** mm, right-handed. */
export type Vec3 = readonly [number, number, number];

/** Spec §6.3. Includes 'xy'/'xz'/'yz' as aliases for back-compat reads. */
export type StandardPlaneId = 'front' | 'top' | 'right' | 'xy' | 'xz' | 'yz';

export type StandardAxisId = 'x' | 'y' | 'z';

// ─── Topology refs (worker-side ids) ────────────────────────────

/** Stable worker-side edge id. Replaced by topology-naming layer later. */
export interface EdgeRef {
  readonly kind: 'edge';
  readonly bodyId: string;
  readonly edgeId: string;
}

export interface FaceRef {
  readonly kind: 'face';
  readonly bodyId: string;
  readonly faceId: string;
}

export interface VertexRef {
  readonly kind: 'vertex';
  readonly bodyId: string;
  readonly vertexId: string;
}

// ─── Consumer refs (sketch / mate / extrude pick these up) ──────

/** Spec §6.3. The `PlaneRef` union sketches consume. */
export type PlaneRef =
  | { readonly kind: 'standard'; readonly id: StandardPlaneId }
  | { readonly kind: 'reference'; readonly nodeId: string }
  | { readonly kind: 'face'; readonly bodyId: string; readonly faceId: string }
  | {
      readonly kind: 'inline';
      readonly origin: Vec3;
      readonly uAxis: Vec3;
      readonly vAxis: Vec3;
      readonly normal: Vec3;
    };

export type AxisRef =
  | { readonly kind: 'standard'; readonly id: StandardAxisId }
  | { readonly kind: 'reference'; readonly nodeId: string }
  | { readonly kind: 'edge'; readonly bodyId: string; readonly edgeId: string }
  | {
      readonly kind: 'inline';
      readonly origin: Vec3;
      readonly direction: Vec3;
    };

export type PointRef =
  | { readonly kind: 'reference'; readonly nodeId: string }
  | { readonly kind: 'vertex'; readonly bodyId: string; readonly vertexId: string }
  | { readonly kind: 'inline'; readonly position: Vec3 };

export type CsysRef =
  | { readonly kind: 'world' }
  | { readonly kind: 'reference'; readonly nodeId: string };

// ─── Method discriminants ───────────────────────────────────────

export type PlaneMethod =
  | 'standard'
  | 'offset'
  | 'through3Points'
  | 'parallelThroughPoint'
  | 'midBetween'
  | 'angle'
  | 'throughLineAndPoint'
  | 'tangentToCylinder';

export type AxisMethod =
  | 'standard'
  | 'through2Points'
  | 'alongEdge'
  | 'twoPlaneIntersect'
  | 'normalToPlaneAtPoint'
  | 'cylinderConeAxis';

export type PointMethod =
  | 'vertex'
  | 'midOfEdge'
  | 'centerOfFace'
  | 'intersectLineAndPlane'
  | 'intersectThreePlanes'
  | 'projectPointOntoPlane'
  | 'byCoordinates';

export type CsysMethod =
  | 'world'
  | 'originAndTwoAxes'
  | 'originAndPlane'
  | 'byFaceVertex';

// ─── Plane params (method-specific) ─────────────────────────────

export interface PlaneParams_Standard {
  readonly method: 'standard';
  readonly id: StandardPlaneId;
}
export interface PlaneParams_Offset {
  readonly method: 'offset';
  readonly parent: PlaneRef;
  readonly distanceMm: number;
  readonly direction: 1 | -1;
}
export interface PlaneParams_Through3Points {
  readonly method: 'through3Points';
  readonly points: readonly [PointRef, PointRef, PointRef];
}
export interface PlaneParams_ParallelThroughPoint {
  readonly method: 'parallelThroughPoint';
  readonly parent: PlaneRef;
  readonly point: PointRef;
}
export interface PlaneParams_MidBetween {
  readonly method: 'midBetween';
  readonly a: PlaneRef;
  readonly b: PlaneRef;
}
export interface PlaneParams_Angle {
  readonly method: 'angle';
  readonly parent: PlaneRef;
  readonly axis: AxisRef;
  readonly angleDeg: number;
  readonly flip?: boolean;
}
export interface PlaneParams_ThroughLineAndPoint {
  readonly method: 'throughLineAndPoint';
  readonly line: AxisRef;
  readonly point: PointRef;
}
export interface PlaneParams_TangentToCylinder {
  readonly method: 'tangentToCylinder';
  readonly face: FaceRef;
  readonly refPlane: PlaneRef;
}

export type PlaneParams =
  | PlaneParams_Standard
  | PlaneParams_Offset
  | PlaneParams_Through3Points
  | PlaneParams_ParallelThroughPoint
  | PlaneParams_MidBetween
  | PlaneParams_Angle
  | PlaneParams_ThroughLineAndPoint
  | PlaneParams_TangentToCylinder;

// ─── Axis params ────────────────────────────────────────────────

export interface AxisParams_Standard {
  readonly method: 'standard';
  readonly id: StandardAxisId;
}
export interface AxisParams_Through2Points {
  readonly method: 'through2Points';
  readonly points: readonly [PointRef, PointRef];
}
export interface AxisParams_AlongEdge {
  readonly method: 'alongEdge';
  readonly edge: EdgeRef;
}
export interface AxisParams_TwoPlaneIntersect {
  readonly method: 'twoPlaneIntersect';
  readonly a: PlaneRef;
  readonly b: PlaneRef;
}
export interface AxisParams_NormalToPlaneAtPoint {
  readonly method: 'normalToPlaneAtPoint';
  readonly plane: PlaneRef;
  readonly point: PointRef;
}
export interface AxisParams_CylinderConeAxis {
  readonly method: 'cylinderConeAxis';
  readonly face: FaceRef;
}

export type AxisParams =
  | AxisParams_Standard
  | AxisParams_Through2Points
  | AxisParams_AlongEdge
  | AxisParams_TwoPlaneIntersect
  | AxisParams_NormalToPlaneAtPoint
  | AxisParams_CylinderConeAxis;

// ─── Point params ───────────────────────────────────────────────

export interface PointParams_Vertex {
  readonly method: 'vertex';
  readonly vertex: VertexRef;
}
export interface PointParams_MidOfEdge {
  readonly method: 'midOfEdge';
  readonly edge: EdgeRef;
}
export interface PointParams_CenterOfFace {
  readonly method: 'centerOfFace';
  readonly face: FaceRef;
}
export interface PointParams_IntersectLineAndPlane {
  readonly method: 'intersectLineAndPlane';
  readonly line: AxisRef;
  readonly plane: PlaneRef;
}
export interface PointParams_IntersectThreePlanes {
  readonly method: 'intersectThreePlanes';
  readonly planes: readonly [PlaneRef, PlaneRef, PlaneRef];
}
export interface PointParams_ProjectPointOntoPlane {
  readonly method: 'projectPointOntoPlane';
  readonly point: PointRef;
  readonly plane: PlaneRef;
}
export interface PointParams_ByCoordinates {
  readonly method: 'byCoordinates';
  readonly position: Vec3;
  readonly csys?: CsysRef;
}

export type PointParams =
  | PointParams_Vertex
  | PointParams_MidOfEdge
  | PointParams_CenterOfFace
  | PointParams_IntersectLineAndPlane
  | PointParams_IntersectThreePlanes
  | PointParams_ProjectPointOntoPlane
  | PointParams_ByCoordinates;

// ─── CSys params ────────────────────────────────────────────────

export interface CsysParams_World {
  readonly method: 'world';
}
export interface CsysParams_OriginAndTwoAxes {
  readonly method: 'originAndTwoAxes';
  readonly origin: PointRef;
  readonly xDir: AxisRef;
  readonly yDir: AxisRef;
}
export interface CsysParams_OriginAndPlane {
  readonly method: 'originAndPlane';
  readonly origin: PointRef;
  readonly plane: PlaneRef;
  readonly inPlaneRef: AxisRef;
}
export interface CsysParams_ByFaceVertex {
  readonly method: 'byFaceVertex';
  readonly face: FaceRef;
  readonly vertex: VertexRef;
  readonly edge: EdgeRef;
}

export type CsysParams =
  | CsysParams_World
  | CsysParams_OriginAndTwoAxes
  | CsysParams_OriginAndPlane
  | CsysParams_ByFaceVertex;

// ─── Reference node union ───────────────────────────────────────

export type ReferenceKind = 'plane' | 'axis' | 'point' | 'csys';

/** Spec §7.4 — reasons a node's evaluation failed. */
export type ReferenceErrorCode =
  | 'parent_missing'
  | 'degenerate'
  | 'cycle'
  | 'unsupported';

export interface ReferenceNodeBase {
  /** UUID. Stable across renames; used by every cross-reference and CRDT. */
  readonly id: string;
  readonly kind: ReferenceKind;
  /** Discriminant within the kind. Stored separately from `params.method`
   *  so a renderer or tree row can show the method without narrowing params. */
  readonly method: string;
  /** User-visible name. Auto-generated by namer.ts on creation. */
  readonly label: string;
  /** When `true`, viewport hides the visual but tree still shows it. */
  readonly hidden: boolean;
  /** Spec §7.1 — ids of upstream entities (other refs, sketches, ...).
   *  Set-semantic; insertion order doesn't matter for the solver. */
  readonly dependsOn: readonly string[];
  /** Monotonic version stamp from the dep solver (spec §7.3). */
  readonly evaluatedAt: number;
  /** Spec §7.4. Populated when `params` could not be evaluated. */
  readonly error?: ReferenceErrorCode;
}

export interface ReferencePlaneNode extends ReferenceNodeBase {
  readonly kind: 'plane';
  readonly method: PlaneMethod;
  readonly params: PlaneParams;
}

export interface ReferenceAxisNode extends ReferenceNodeBase {
  readonly kind: 'axis';
  readonly method: AxisMethod;
  readonly params: AxisParams;
}

export interface ReferencePointNode extends ReferenceNodeBase {
  readonly kind: 'point';
  readonly method: PointMethod;
  readonly params: PointParams;
}

export interface ReferenceCsysNode extends ReferenceNodeBase {
  readonly kind: 'csys';
  readonly method: CsysMethod;
  readonly params: CsysParams;
}

export type ReferenceNode =
  | ReferencePlaneNode
  | ReferenceAxisNode
  | ReferencePointNode
  | ReferenceCsysNode;

// ─── Type guards ────────────────────────────────────────────────

export function isPlaneNode(n: ReferenceNode): n is ReferencePlaneNode {
  return n.kind === 'plane';
}
export function isAxisNode(n: ReferenceNode): n is ReferenceAxisNode {
  return n.kind === 'axis';
}
export function isPointNode(n: ReferenceNode): n is ReferencePointNode {
  return n.kind === 'point';
}
export function isCsysNode(n: ReferenceNode): n is ReferenceCsysNode {
  return n.kind === 'csys';
}

/** Extract upstream node ids from a `PlaneRef` (only `reference` kind has one). */
export function planeRefNodeId(r: PlaneRef): string | null {
  return r.kind === 'reference' ? r.nodeId : null;
}
export function axisRefNodeId(r: AxisRef): string | null {
  return r.kind === 'reference' ? r.nodeId : null;
}
export function pointRefNodeId(r: PointRef): string | null {
  return r.kind === 'reference' ? r.nodeId : null;
}
export function csysRefNodeId(r: CsysRef): string | null {
  return r.kind === 'reference' ? r.nodeId : null;
}

/** Compute `dependsOn[]` for a node from its params alone. Method-agnostic
 *  walker — extends as new methods land. Spec §7.1.
 *
 *  Only `reference` kind refs contribute; `standard`, `inline`, `face`,
 *  `edge`, `vertex` are leaf inputs (no upstream node id). Topology refs
 *  may eventually depend on a feature node id once the topology-naming
 *  layer lands, but that's W3 work, not W1. */
export function computeDependsOn(node: Omit<ReferenceNode, 'dependsOn' | 'evaluatedAt'>): string[] {
  const ids = new Set<string>();
  const pushPlane = (r: PlaneRef): void => {
    const id = planeRefNodeId(r);
    if (id !== null) ids.add(id);
  };
  const pushAxis = (r: AxisRef): void => {
    const id = axisRefNodeId(r);
    if (id !== null) ids.add(id);
  };
  const pushPoint = (r: PointRef): void => {
    const id = pointRefNodeId(r);
    if (id !== null) ids.add(id);
  };
  const pushCsys = (r: CsysRef): void => {
    const id = csysRefNodeId(r);
    if (id !== null) ids.add(id);
  };

  switch (node.kind) {
    case 'plane': {
      const p = node.params;
      switch (p.method) {
        case 'standard':
          break;
        case 'offset':
        case 'parallelThroughPoint':
          pushPlane(p.parent);
          if (p.method === 'parallelThroughPoint') pushPoint(p.point);
          break;
        case 'through3Points':
          for (const pt of p.points) pushPoint(pt);
          break;
        case 'midBetween':
          pushPlane(p.a);
          pushPlane(p.b);
          break;
        case 'angle':
          pushPlane(p.parent);
          pushAxis(p.axis);
          break;
        case 'throughLineAndPoint':
          pushAxis(p.line);
          pushPoint(p.point);
          break;
        case 'tangentToCylinder':
          pushPlane(p.refPlane);
          break;
      }
      break;
    }
    case 'axis': {
      const p = node.params;
      switch (p.method) {
        case 'standard':
        case 'alongEdge':
        case 'cylinderConeAxis':
          break;
        case 'through2Points':
          pushPoint(p.points[0]);
          pushPoint(p.points[1]);
          break;
        case 'twoPlaneIntersect':
          pushPlane(p.a);
          pushPlane(p.b);
          break;
        case 'normalToPlaneAtPoint':
          pushPlane(p.plane);
          pushPoint(p.point);
          break;
      }
      break;
    }
    case 'point': {
      const p = node.params;
      switch (p.method) {
        case 'vertex':
        case 'midOfEdge':
        case 'centerOfFace':
        case 'byCoordinates':
          if (p.method === 'byCoordinates' && p.csys !== undefined) pushCsys(p.csys);
          break;
        case 'intersectLineAndPlane':
          pushAxis(p.line);
          pushPlane(p.plane);
          break;
        case 'intersectThreePlanes':
          for (const pl of p.planes) pushPlane(pl);
          break;
        case 'projectPointOntoPlane':
          pushPoint(p.point);
          pushPlane(p.plane);
          break;
      }
      break;
    }
    case 'csys': {
      const p = node.params;
      switch (p.method) {
        case 'world':
          break;
        case 'originAndTwoAxes':
          pushPoint(p.origin);
          pushAxis(p.xDir);
          pushAxis(p.yDir);
          break;
        case 'originAndPlane':
          pushPoint(p.origin);
          pushPlane(p.plane);
          pushAxis(p.inPlaneRef);
          break;
        case 'byFaceVertex':
          // Topology-only inputs; no upstream ref node ids until Phase 2 W3
          // promotes face/vertex/edge to first-class refs.
          break;
      }
      break;
    }
  }

  return [...ids];
}

// ─── Resolved values (the output of the math layer) ─────────────

export interface ResolvedPlane {
  readonly origin: Vec3;
  readonly normal: Vec3;
}

export interface ResolvedAxis {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

export interface ResolvedPoint {
  readonly position: Vec3;
}

export interface ResolvedCsys {
  readonly origin: Vec3;
  readonly xAxis: Vec3;
  readonly yAxis: Vec3;
  readonly zAxis: Vec3;
}

export type ResolvedValue =
  | { readonly kind: 'plane'; readonly value: ResolvedPlane }
  | { readonly kind: 'axis'; readonly value: ResolvedAxis }
  | { readonly kind: 'point'; readonly value: ResolvedPoint }
  | { readonly kind: 'csys'; readonly value: ResolvedCsys };
