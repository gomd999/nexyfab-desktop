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
  | 'trim' | 'select' | 'dimension' | 'constraint' | 'construction';

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

export type ExtrudeMode = 'extrude' | 'revolve' | 'extrudeCut';

/** 2d = SVG flat canvas, 3d = draw on a plane in the 3D viewport, drawing = ortho projection views */
export type SketchViewMode = '2d' | '3d' | 'drawing';

export interface SketchConfig {
  mode: ExtrudeMode;
  depth: number;        // mm, for extrude (default 50)
  revolveAngle: number; // degrees, for revolve (default 360)
  revolveAxis: 'x' | 'y'; // default 'y'
  segments: number;     // mesh resolution (default 32)
  cutDepth?: number;    // For extrude cut
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
