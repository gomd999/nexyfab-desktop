// Kernel-agnostic intent schema — the single source of truth from which both
// the draft kernel (OpenSCAD/JSCAD) and the record kernel (OCCT/replicad)
// deterministically emit geometry.
//
// Methodology: docs/drawing-to-3d-methodology.md
//   §5.2  kernel routing table            §12.1 4+1 primitive system
//   §12.2 semantic selector               §12.5 PMI / material as 1st-class data
//   §12.7.3 joint spec (penetration band)
//
// Rules encoded here:
//   - LLMs only ever produce/patch THIS structure; geometry emission is
//     deterministic code (§1.3 plan-execute split).
//   - Geometry is never handed between kernels — each kernel re-emits from
//     the same intent (§6 mixing rules).
//   - Selectors reference history + geometric conditions, never raw indices
//     (§12.2 persistent-naming mitigation).

// ─── 2D geometry ─────────────────────────────────────────────────────────────

export interface Pt2 {
  /** Radial (revolve) or local X, mm. Must be ≥ 0 for revolve profiles. */
  x: number;
  /** Height / local Y, mm. */
  y: number;
}

/** Closed 2D polygon profile (implicitly closed last→first). CCW = solid. */
export interface Profile2D {
  id: string;
  points: Pt2[];
  label?: string;
}

// ─── Semantic selector (§12.2) ───────────────────────────────────────────────

export type SelectorFilter =
  | 'IntersectingEdges' // edges created by the source feature's intersection
  | 'VerticalEdges'
  | 'HorizontalEdges'
  | 'TopRim'
  | 'BottomRim'
  | 'AllEdges';

/**
 * [source feature history] + [geometric condition] selector. NEVER raw
 * index/coordinate — those break on any upstream parametric edit
 * (persistent naming problem). Re-resolution failure follows the §12.7.1
 * 3-stage buffer: history propagation → geometric heuristic → diff-scored
 * acceptance with provenance mark, else flag.
 */
export interface SemanticSelector {
  /** Feature id whose result geometry this selector operates on. */
  sourceFeature: string;
  filter: SelectorFilter;
  condition?: {
    /** Edges whose direction matches this unit vector (dot ≥ cosTolerance). */
    directionVector?: [number, number, number];
    /** Ignore edges shorter than this, mm. */
    minLength?: number;
  };
}

// ─── Features (§12.1 primitives) ─────────────────────────────────────────────

/** Rigid placement of a feature/component. Angles in degrees. */
export interface Placement {
  translate?: [number, number, number];
  /** Full rotation [x, y, z] applied X→Y→Z (OpenSCAD rotate() order) —
   *  needed for horizontal vessels/pipes. */
  rotateDeg?: [number, number, number];
  /** Legacy Z-only rotation; ignored when rotateDeg is present. */
  rotateZDeg?: number;
}

/** Circular pattern about the Z axis (draft + record both support). */
export interface CircularPattern {
  type: 'circular';
  count: number;
  /** Total sweep, default 360 (evenly spaced). */
  sweepDeg?: number;
}

interface FeatureBase {
  id: string;
  at?: Placement;
  pattern?: CircularPattern;
  /** Boolean role — 'subtract' cuts the feature from the union of adds
   *  (holes/bores from 2D→3D drawing reconstruction). Default 'add'. */
  op?: 'add' | 'subtract';
}

/** #1 Sketch + Revolve — rotational solids (vessels, shafts, flanges). */
export interface RevolveFeature extends FeatureBase {
  kind: 'revolve';
  profile: Profile2D;
  angleDeg?: number; // default 360
}

/** #1 Sketch + Extrude — prismatic solids (baffles, plates, ribs). */
export interface ExtrudeFeature extends FeatureBase {
  kind: 'extrude';
  profile: Profile2D;
  height: number;
}

/** Convenience solid cylinder (shaft/impeller stubs). Draft + record. */
export interface CylinderFeature extends FeatureBase {
  kind: 'cylinder';
  diameter: number;
  height: number;
  centered?: boolean;
}

/** Convenience solid sphere — pipe corner joints, dished heads. */
export interface SphereFeature extends FeatureBase {
  kind: 'sphere';
  diameter: number;
}

/**
 * #3 Non-local feature — record-kernel only (§5.1: OpenSCAD has no true
 * fillet engine). Draft kernel emits a `// @nfab` tag comment and omits the
 * geometry; expected-ΔV bookkeeping happens in verify (§12.7.2).
 */
export interface FilletFeature extends FeatureBase {
  kind: 'fillet';
  selector: SemanticSelector;
  radius: number;
}

export interface ShellFeature extends FeatureBase {
  kind: 'shell';
  thickness: number;
  openingFaces?: SemanticSelector;
}

export type IntentFeature =
  | RevolveFeature
  | ExtrudeFeature
  | CylinderFeature
  | SphereFeature
  | FilletFeature
  | ShellFeature;

// ─── Material / PMI (§12.5, §13 #1 DFM gate input) ──────────────────────────

export interface MaterialSpec {
  /** e.g. 'STS304', 'STS316', 'SS275' */
  grade: string;
  /** Nominal plate/section thickness, mm (sheet-metal interlock input, §13 #5). */
  thicknessMm?: number;
}

export interface PmiAnnotation {
  /** Dimension or tolerance note carried from the drawing checkpoint. */
  target: string;
  note: string;
}

// ─── Component / assembly (§12.1 #4) ─────────────────────────────────────────

export type ShapeClass = 'revolute' | 'frame' | 'prismatic' | 'sheetMetal';

export interface ComponentIntent {
  id: string;
  name: string;
  /** Drives the §12.3 drawing-view routing and default kernel choice. */
  shapeClass: ShapeClass;
  features: IntentFeature[];
  material?: MaterialSpec;
  pmi?: PmiAnnotation[];
}

/** §12.7.3 — declared joints carry an allowed penetration band; the
 *  interference checker VALIDATES contact against the band instead of
 *  exempting it (blanket exemption forbidden). */
export interface JointSpec {
  type: 'threaded' | 'clearance' | 'pressFit' | 'weld' | 'rigid';
  a: string;
  b: string;
  /** [min, max] allowed radial/axial penetration, mm. */
  allowedPenetrationMm?: [number, number];
}

export interface PlacedComponent {
  component: ComponentIntent;
  at?: Placement;
}

export interface AssemblyIntent {
  id: string;
  name: string;
  components: PlacedComponent[];
  joints: JointSpec[];
}

// ─── Kernel routing (§5.2 / §6) ──────────────────────────────────────────────

export type KernelRoute = 'openscad' | 'occt';

/**
 * Route a feature to the kernel that can build it exactly. The draft kernel
 * may still PREVIEW occt-routed features approximately (or omit + tag), but
 * the kernel-of-record for the final STEP is what this returns.
 */
export function routeFeature(f: IntentFeature): KernelRoute {
  switch (f.kind) {
    case 'fillet':
    case 'shell':
      return 'occt';
    case 'revolve':
    case 'extrude':
    case 'cylinder':
    case 'sphere':
      return 'openscad';
  }
}
