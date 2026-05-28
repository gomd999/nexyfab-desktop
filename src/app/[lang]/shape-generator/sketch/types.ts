export interface SketchPoint {
  x: number;
  y: number;
  id?: string;
} // millimeters

export interface SketchSegment {
  type: 'line' | 'arc' | 'circle' | 'rect' | 'polygon' | 'ellipse' | 'slot' | 'nurbs';
  // line: [start, end]
  // arc: [start, through, end]
  // circle: [center, edge]
  // rect: [corner1, corner2]
  // polygon: [center, edge]
  // ellipse: [center, rx-pt, ry-pt]  (rx-pt = center + {rx,0}, ry-pt = center + {0,ry})
  // slot: [center1, center2, radius-pt]  (radius-pt on outer edge of first cap)
  // nurbs: control points (n+1 points; knot vector auto-generated if not supplied)
  points: SketchPoint[];
  id?: string;
  /** Construction line: shown dashed, not included in geometry generation */
  construction?: boolean;
  /** NURBS-specific: curve degree (default 3). */
  degree?: number;
  /** NURBS-specific: knot vector; when absent a clamped uniform vector is auto-derived. */
  knots?: number[];
  /** NURBS-specific: rational weights per control point; defaults to 1. */
  weights?: number[];
}

export interface SketchProfile {
  segments: SketchSegment[];
  closed: boolean;
}

export type SketchTool =
  | 'line' | 'arc' | 'circle' | 'ellipse' | 'rect' | 'polygon' | 'slot'
  | 'spline' | 'offset' | 'fillet' | 'mirror'
  | 'trim' | 'select' | 'dimension' | 'constraint' | 'construction'
  // Phase 1 — sweep path drawing. Tool registered so the ribbon button
  // routes correctly; the canvas click handler that actually appends
  // points to `config.sweepPath` lands in phase 2.
  | 'sweep-path';

// ─── Constraint System ──────────────────────────────────────────────────────

export type ConstraintType =
  | 'horizontal'    // Line is horizontal
  | 'vertical'      // Line is vertical
  | 'perpendicular' // Two lines are perpendicular
  | 'parallel'      // Two lines are parallel
  | 'tangent'       // Line/arc tangent
  | 'coincident'    // Two points overlap
  | 'concentric'    // Two circles share center
  | 'equal'         // Two segments have equal length/radius
  | 'symmetric'     // Symmetric about a line
  | 'midpoint'      // Point is at midpoint of a line
  | 'angle'         // Angle between two lines
  | 'distance'      // Point-to-point or point-to-line distance
  | 'fixed';        // Point is locked in place

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  entityIds: string[];      // IDs of segments/points involved
  satisfied: boolean;
  value?: number;           // For dimension constraints
  /**
   * Optional expression string: enables parametric relations like "2*D1 + 10".
   * Evaluated against a named-dimension table (see evalExpression). When present,
   * overrides `value` at solve time.
   */
  expression?: string;
}

// ─── Smart Dimension ────────────────────────────────────────────────────────

export interface SketchDimension {
  id: string;
  type: 'linear' | 'angular' | 'radial' | 'diameter';
  entityIds: string[];
  value: number;            // The dimension value in mm or degrees
  position: SketchPoint;    // Where to display the dimension text
  locked: boolean;          // Is this a driving dimension?
  /** Optional named variable (e.g. "D1") — other dimensions can reference by expression */
  name?: string;
  /** Parametric expression evaluated at solve time (e.g. "2*D1 + 10") */
  expression?: string;
}

export type ExtrudeMode = 'extrude' | 'revolve' | 'extrudeCut' | 'sweep';

/** A 3-D path the profile sweeps along — series of points the geometry
 *  builder turns into a CatmullRom curve. Coordinates are world mm; the
 *  curve always starts at the sketch plane's origin so the profile
 *  attaches cleanly. */
export interface SweepPath {
  /** ≥ 2 points; less collapses to a normal straight-axis extrude. */
  points: { x: number; y: number; z: number }[];
  /** Number of cross-section samples along the path. Higher = smoother
   *  sweep, more triangles. */
  steps?: number;
}

/** 2d = SVG flat canvas, 3d = draw on a plane in the 3D viewport, drawing = ortho projection views */
export type SketchViewMode = '2d' | '3d' | 'drawing';

export interface SketchConfig {
  mode: ExtrudeMode;
  depth: number;        // mm, for extrude (default 50)
  revolveAngle: number; // degrees, for revolve (default 360)
  revolveAxis: 'x' | 'y'; // default 'y'
  segments: number;     // mesh resolution (default 32)
  cutDepth?: number;    // For extrude cut
  /** Path the profile follows when mode === 'sweep'. The path-drawing UI
   *  ships in a follow-up phase; the geometry builder already accepts a
   *  hand-supplied path so test fixtures and AI/CAD-Copilot can use it. */
  sweepPath?: SweepPath;
  // Tool-specific defaults (persisted so user doesn't re-enter each session)
  ellipseRx?: number;   // default 25
  ellipseRy?: number;   // default 15
  slotRadius?: number;  // default 10
  filletRadius?: number;// default 5
}

export interface MultiSketchState {
  profiles: SketchProfile[];   // profiles[0] = outer contour, rest = holes
  activeProfileIndex: number;  // which profile the user is currently drawing
}

// ─── Sketch plane spec (Wave 2 Phase 2 Track D3) ────────────────────────────
//
// Spec §6.3 / §10. The legacy `plane: 'xy' | 'xz' | 'yz'` literal stays valid
// as a back-compat read at every consumer that hasn't migrated yet. New
// writes use `SketchPlaneSpec` — a discriminated union that points at a
// standard world plane (with optional offset) OR at a reference-geometry
// node by id.
//
// CRDT note: this type is a plain JS value; D3 stores it through the
// existing `.nfab` JSON path (D2 schema, v3). Y.Doc-backed `ReferenceNode`
// storage is deferred to D3b — see spec §15 W3 CRDT block.

/** Standard world plane id. We keep the legacy `xy/xz/yz` literals because
 *  every existing consumer understands them; the spec §6.3 alias
 *  `front/top/right` is accepted as a future-write target by `toLegacyPlane`. */
export type SketchStandardPlaneId = 'xy' | 'xz' | 'yz';

/** Spec §6.3 — discriminated union sketches consume. The W3 version is
 *  intentionally narrower than the full `PlaneRef` (see
 *  `referenceGeometry/types.ts`): sketches don't yet consume `face` /
 *  `inline` directly, those still flow through `SketchNodeData.faceFrame`. */
export type SketchPlaneSpec =
  | { readonly kind: 'standard'; readonly plane: SketchStandardPlaneId; readonly offset?: number }
  | { readonly kind: 'refGeom'; readonly planeId: string };

/** Adapter for call sites that only know the legacy 3-string-literal API.
 *
 *  Spec §10.1, §17 — the literal `'xy'/'xz'/'yz'` union stays the API
 *  surface during the migration window. This helper collapses any
 *  `SketchPlaneSpec` (or legacy literal) down to the legacy literal so
 *  un-migrated consumers (Sketch3DCanvas, sceneStore, scriptApi, etc.)
 *  keep working without a structural rewrite.
 *
 *  For `refGeom` specs we fall back to `'xy'` — the canvas can still
 *  show *something* while the W3 resolver lands. Callers that care
 *  about the actual ref-geom frame should use `resolveSketchPlane`
 *  from `referenceGeometry` instead. */
export function toLegacyPlane(
  spec: SketchPlaneSpec | SketchStandardPlaneId,
): SketchStandardPlaneId {
  if (typeof spec === 'string') return spec;
  if (spec.kind === 'standard') return spec.plane;
  // refGeom — no legacy equivalent. Fall back to the world default.
  return 'xy';
}

/** Lift the legacy literal into a `SketchPlaneSpec` for code paths that
 *  want to unify on the new shape. Offset defaults to 0. */
export function toSketchPlaneSpec(
  plane: SketchStandardPlaneId,
  offset = 0,
): SketchPlaneSpec {
  return offset === 0
    ? { kind: 'standard', plane }
    : { kind: 'standard', plane, offset };
}

/** Type guard — narrows to the standard world-plane variant. */
export function isStandardPlaneSpec(
  spec: SketchPlaneSpec,
): spec is Extract<SketchPlaneSpec, { kind: 'standard' }> {
  return spec.kind === 'standard';
}

/** Type guard — narrows to the ref-geom variant. */
export function isRefGeomPlaneSpec(
  spec: SketchPlaneSpec,
): spec is Extract<SketchPlaneSpec, { kind: 'refGeom' }> {
  return spec.kind === 'refGeom';
}
