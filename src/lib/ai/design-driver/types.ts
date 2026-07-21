/**
 * design-driver/types — Wave A WA-A: DesignPlan IR + gate IR + package IR.
 *
 * The AI design driver (`designDriver.run(brief, deps)`) turns a natural-
 * language brief into a VERIFIED design package. The LLM's only job is to
 * produce a `DesignPlan` (via the injectable `DesignPlanner` interface —
 * WA-D wires a real LLM; WA-A tests use the deterministic fixture planner).
 * Everything downstream of the plan is deterministic: same plan ⇒ same
 * meshes, same solve, same measurements, same package.
 *
 * IR reuse (계획 문서 §1 재료 — 소비만, 수정 없음):
 *   - part geometry     = `MeshableFeature` (src/lib/cad/featureMesh) — the
 *     extrude/revolve/sweep/loft feature IRs the own-CAD pipeline already
 *     executes. Extrude bodies additionally get stable topo names via
 *     `buildExtrudeTopo` (src/lib/cad/topoNaming), which is what makes
 *     drawing dimensions measurable.
 *   - assembly          = `SolvePartSpec` / `SolveMateSpec` — the exact
 *     input shape of `solveMates` (src/lib/assembly/api).
 *   - drawing dimension = refs in the `Dimension.refs` namespace
 *     (src/lib/drawing/dimension + measure) — stable topo names like
 *     `f.cap.top`, `e.vert.0`, `e.bottom.0-1`.
 *
 * Honesty invariants encoded in these types:
 *   - `ExpectedVolumeSpec.basis` is REQUIRED — a theoretical volume without
 *     a stated derivation (including tessellation approximations) is not
 *     accepted by the geometry gate.
 *   - `GateResult.reason` is required on failure; `notes` carry explicit
 *     approximation statements (근사 명시).
 *   - A `DesignPackage` exists ONLY when every gate passed — the driver
 *     returns a refusal IR otherwise (패키지 미산출).
 */

import type { MeshableFeature } from '@/lib/cad/featureMesh';
import type { DimensionKind, Tolerance } from '@/lib/drawing/dimension';
import type { PaperSize, Sheet } from '@/lib/drawing/sheet';
import type {
  SolveMateSpec,
  SolvePartSpec,
  SolvedPartPlacement,
} from '@/lib/assembly/api';
import type { DfmProcess } from '@/lib/ai/scad-agent/dfmGate';
import type { BomItemRow } from '@/lib/drawing/bomBalloon';

// ─── brief ───────────────────────────────────────────────────────────────

export interface DesignBrief {
  id: string;
  /** The user's request text (planner input). */
  text: string;
  /** Optional structured parameters accompanying the text. */
  params?: Record<string, number | string>;
}

// ─── plan: parts ─────────────────────────────────────────────────────────

export interface PlanBody {
  /** Unique within the part. `bodyKey(partId, bodyId)` is the drawing
   *  viewport `sourceId` / topology-map key. */
  bodyId: string;
  /** Reused feature IR — executed by `featureToPolyhedron` (featureMesh). */
  feature: MeshableFeature;
  /**
   * Rigid placement of this body within the PART frame (mm). Meshing and
   * topo naming run in the feature's own frame; the translate affects only
   * part-level composite checks (AABB disjointness for the volume sum).
   * Lengths / angles / volumes are translation-invariant, so per-body
   * measurements stay exact.
   */
  translate?: { x: number; y: number; z: number };
}

export interface ExpectedVolumeSpec {
  /** Theoretical volume of the AS-MESHED geometry, mm³. */
  valueMm3: number;
  /** Relative tolerance for the gate. Default 1e-9. */
  tolRel?: number;
  /**
   * REQUIRED: how the theory was derived, including any tessellation
   * approximation (e.g. "24-gon prism formula (N/2)·r²·sin(2π/N)·h;
   * analytic cylinder πr²h = X, tessellation deviation −1.14%").
   */
  basis: string;
}

// ─── plan: sheet metal (WB-2 판금 전개 편입) ───────────────────────────────

/**
 * One forming op applied to the flat blank, in order. Consumed by the real
 * sheet-metal engine (features/sheetMetal: applyBend / applyFlange), so the
 * flat-pattern gate REAL-measures the developed length instead of asserting it.
 *   - 'bend'   folds the existing blank at a fraction along the unfold axis
 *              (consumes its bend allowance OUT of the blank — developed length
 *              unchanged).
 *   - 'flange' grows a NEW leg off an edge (arc + straight leg = added
 *              material — developed length increases by leg + bend allowance).
 */
export interface SheetMetalOp {
  kind: 'bend' | 'flange';
  /** Bend angle, degrees (0–180]. */
  angle: number;
  /** Inner bend radius, mm. */
  radius: number;
  /** 'bend': fraction 0–1 along the unfold axis. */
  position?: number;
  /** 'bend': fold direction. Default 'up'. */
  direction?: 'up' | 'down';
  /** 'flange': edge index 0=+Z 1=−Z 2=+X 3=−X (features/sheetMetal convention). */
  edgeIndex?: number;
  /** 'flange': leg height (reach from bend root), mm. */
  height?: number;
}

/**
 * A sheet-metal part definition. The part's `bodies[0]` is the flat base-panel
 * blank (a normal extrude — so geometry/drawing gates measure it unchanged);
 * this spec drives the ADDITIONAL flat-pattern gate, which reconstructs the
 * folded stack from `ops` via the real engine, unfolds it, and verifies the
 * developed length + emits a laser-ready flat DXF (CUT outline + BEND lines).
 */
export interface SheetMetalSpec {
  /** Sheet thickness, mm. */
  thicknessMm: number;
  /** Material key (features/sheetMetal SHEET_METAL_MATERIAL_ORDER). Default 'mildSteel'. */
  material?: string;
  /** Base blank panel width (along the bend-line axis), mm. */
  baseWidthMm: number;
  /** Base blank panel length (along the unfold axis), mm. */
  baseLengthMm: number;
  /** Ordered forming ops applied to the base panel. */
  ops: SheetMetalOp[];
  /**
   * Optional INDEPENDENT hand-calc of the developed (flat) length, mm. When
   * present the flat-pattern gate checks |measured − expected| ≤ devTolMm — a
   * cross-check against the engine's real unfold (mirrors expectedVolume).
   */
  expectedDevelopedLengthMm?: number;
  /** Absolute tolerance for the developed-length cross-check, mm. Default 1e-6. */
  devTolMm?: number;
}

// ─── plan: weldment (WB-3 웰드먼트 편입) ───────────────────────────────────

/** One structural-frame member as an axis segment (endpoints in PART frame, mm). */
export interface WeldmentSegment {
  start: [number, number, number];
  end: [number, number, number];
}

/**
 * A welded structural frame. Consumed by the real weldment engine
 * (welding/miterFrame): members are mitered at shared corners and a cut list
 * (per-member stock length + end-miter angles + mass) is REAL-measured off the
 * mitered solids — so the weldmentGate verifies fabrication data, not claims.
 *
 * `bodies[0]` stays a simple representative-stock prism (dimensioned by the
 * geometry/drawing gates); this spec drives the ADDITIONAL cut-list gate.
 */
export interface WeldmentSpec {
  /** miterFrame SECTION_TYPE: 0 rect-tube · 1 I-beam · 2 L-angle · 3 round-tube · 4 solid-rod. */
  sectionType: number;
  /** Section envelope size, mm. */
  sizeMm: number;
  /** Wall / web thickness, mm. */
  thicknessMm: number;
  /** Cut-list material designation. Default 'SS400'. */
  material?: string;
  /** Frame member axis segments. */
  segments: WeldmentSegment[];
  /** Apply bisector miters at 2-member corners. Default true. */
  miter?: boolean;
  /**
   * Optional INDEPENDENT hand-calc of the total raw stock length (Σ cut lengths),
   * mm. When present the gate checks |measured − expected| ≤ stockTolMm.
   */
  expectedTotalStockMm?: number;
  /** Absolute tolerance for the total-stock cross-check, mm. Default 1e-6. */
  stockTolMm?: number;
}

// ─── plan: fasteners / threads (WB-8 나사산·규격품 편입) ─────────────────────

export type FastenerThreadType = 'external' | 'internal';
export type FastenerMateMaterial = 'steel' | 'castIron' | 'aluminum' | 'brass';

/**
 * A standard ISO metric threaded feature (tapped hole or external thread). The
 * fastener gate resolves the nominal against the ISO 261 coarse-pitch table
 * (annotations/GDTTypes METRIC_COARSE_PITCHES — real standard data), derives the
 * thread geometry from ISO 68-1/724 formulas, and screens thread engagement.
 */
export interface FastenerSpec {
  id: string;
  /** ISO metric nominal major diameter, mm (M-designation: 8 ⇒ M8). */
  nominalDiameterMm: number;
  /** Thread pitch, mm. Omit ⇒ the ISO coarse pitch for this diameter. */
  pitchMm?: number;
  type: FastenerThreadType;
  /** Threaded engagement length, mm (external thread length / tapped depth). */
  engagementMm: number;
  /** Mating material for the engagement screen. Default 'steel'. */
  mateMaterial?: FastenerMateMaterial;
  /** Tolerance class (6g external / 6H internal / …) — passthrough to the callout. */
  fit?: string;
  /** Property class for external fasteners (e.g. '8.8'). */
  grade?: string;
}

export interface PlanPart {
  partId: string;
  name: string;
  /** BOM quantity. Default 1. */
  qty?: number;
  material?: string;
  /** ≥ 1 body. The FIRST body is the primary drawing source (standard
   *  3-view sheet); extra bodies get their own auxiliary viewports. */
  bodies: PlanBody[];
  /** When present, the geometry gate compares measured mesh volume. */
  expectedVolume?: ExpectedVolumeSpec;
  /** Manufacturing process for the DFM gate. Default 'cnc'. */
  process?: DfmProcess;
  /** When present, the flat-pattern gate unfolds this sheet-metal part (WB-2). */
  sheetMetal?: SheetMetalSpec;
  /** When present, the cut-list gate mitres this weldment frame (WB-3). */
  weldment?: WeldmentSpec;
  /** When present, the fastener gate verifies these standard threads (WB-8). */
  fasteners?: FastenerSpec[];
}

// ─── plan: assembly ──────────────────────────────────────────────────────

export interface PlanAssembly {
  /** solveMates input form (src/lib/assembly/api) — reused verbatim. */
  parts: SolvePartSpec[];
  mates: SolveMateSpec[];
  /** Residual tolerance for convergence. Default 1e-6. */
  tolerance?: number;
  engine?: 'gauss-seidel' | 'newton';
}

// ─── plan: drawing requirements ──────────────────────────────────────────

/** Views the measurement engine accepts (standard projections only). */
export type PlanDimensionView = 'front' | 'top' | 'right';

export interface PlanDimensionSpec {
  id: string;
  partId: string;
  bodyId: string;
  view: PlanDimensionView;
  kind: DimensionKind;
  /** Stable topo names (Dimension.refs namespace, e.g. 'f.cap.top'). */
  refs: string[];
  /**
   * Expected nominal from the brief. When present the drawing gate checks
   * |measured − expected| ≤ 1e-6 (absolute, mm/deg).
   */
  expected?: number;
  tolerance?: Tolerance;
}

// ─── WB-5: GD&T IR (additive OPTIONAL — feature/process kinds untouched) ────

/** Geometric characteristics the GD&T gate REAL-verifies from named topology
 *  (form + orientation of planar features). WB-5. */
export type GdtCharacteristicKind =
  | 'flatness'
  | 'perpendicularity'
  | 'parallelism'
  | 'angularity';

/**
 * Optional plan-DECLARED GD&T design tolerance (WB-5). A declared spec is an
 * enforced design REQUIREMENT: the GD&T gate FAILS the plan when the feature /
 * datum can't resolve to real topology OR the real geometry violates the zone
 * — the same force as a declared dimension `expected`. Absent ⇒ the gate only
 * auto-proposes (advisory, verify-or-drop; never fails the plan).
 */
export interface PlanGdtSpec {
  id: string;
  partId: string;
  bodyId: string;
  characteristic: GdtCharacteristicKind;
  /** Controlled feature — a stable topo FACE name (e.g. 'f.side.0', 'f.cap.top'). */
  feature: string;
  /** Datum face name(s); required for orientation characteristics. */
  datums?: string[];
  /** Declared tolerance zone width (mm). */
  toleranceMm: number;
  /** Nominal surface angle vs the primary datum (deg): 90 perpendicular, 0
   *  parallel, else angularity. Ignored for flatness; defaults per kind. */
  nominalAngleDeg?: number;
}

/**
 * A REAL-verified GD&T callout for the package/report (WB-5). Every value is
 * measured off the model topology — never fabricated (the package exists only
 * post-gate, and a callout is emitted only when it verifies within its zone).
 */
export interface GdtCalloutRecord {
  id: string;
  partId: string;
  bodyId: string;
  characteristic: GdtCharacteristicKind;
  feature: string;
  datums: string[];
  /** Declared/proposed tolerance zone width (mm). */
  toleranceMm: number;
  /** REAL-measured zone the feature actually occupies (mm) — ≤ toleranceMm. */
  actualMm: number;
  /** Orientation kinds only: measured angular deviation from nominal (deg). */
  angularDeviationDeg?: number;
  /** true = auto-proposed (advisory); false = plan-declared (enforced). */
  proposed: boolean;
  /** Explicit derivation statement (근사 명시). */
  basis: string;
}

export interface PlanDrawing {
  /** Default 'A3'. */
  paperSize?: PaperSize;
  /** Drawing scale. Default 1. */
  scale?: number;
  dimensions: PlanDimensionSpec[];
  /** WB-5: optional plan-DECLARED GD&T design tolerances (enforced by gdtGate). */
  gdt?: PlanGdtSpec[];
}

// ─── plan ────────────────────────────────────────────────────────────────

export interface DesignPlan {
  planId: string;
  name: string;
  parts: PlanPart[];
  assembly?: PlanAssembly;
  drawing: PlanDrawing;
}

// ─── gate IR ─────────────────────────────────────────────────────────────

export type GateKind = 'geometry' | 'assembly' | 'interference' | 'dfm' | 'drawing' | 'flat-pattern' | 'gdt' | 'weldment' | 'fastener';

export interface GateResult {
  /** `${kind}:${scope}` — e.g. 'geometry:bracket', 'assembly', 'drawing:pin'. */
  id: string;
  kind: GateKind;
  pass: boolean;
  /** Measured numbers backing the verdict (실행하지 않은 판정은 판정이 아니다). */
  metrics: Record<string, number>;
  /** Present iff !pass — the explicit refusal reason. */
  reason?: string;
  /** Explicit approximation / consumption statements (근사 명시). */
  notes: string[];
}

// ─── package IR ──────────────────────────────────────────────────────────

export interface MeasuredDimensionEntry {
  id: string;
  viewportId: string;
  kind: DimensionKind;
  refs: string[];
  /** REAL measured value (never fabricated — package exists only post-gate). */
  value: number;
  unit: 'mm' | 'deg';
  expected?: number;
  /** |value − expected| when expected present. */
  deviation?: number;
}

/** WB-2: flat-pattern deliverable for a sheet-metal part (real-unfolded). */
export interface SheetMetalBendRow {
  index: number;
  /** Bend-line position along the developed length, mm. */
  positionMm: number;
  angleDeg: number;
  radiusMm: number;
  direction: 'up' | 'down';
  /** Bend allowance consumed (BA = π·(R+K·T)·A/180), mm. */
  bendAllowanceMm: number;
  /** Material K-factor used. */
  kFactor: number;
}

export interface SheetMetalFlatPattern {
  /** REAL developed (flat) length from the engine unfold, mm. */
  developedLengthMm: number;
  /** Blank width perpendicular to the bend lines, mm. */
  blankWidthMm: number;
  thicknessMm: number;
  material: string;
  /** Laser-ready flat DXF: CUT outline + BEND fold lines (netDxf segmentsToDxf). */
  dxf: string;
  bendTable: SheetMetalBendRow[];
}

/** WB-3: one cut-list member row (real-measured off the mitered frame). */
export interface WeldmentCutRow {
  memberIndex: number;
  /** Section profile label (e.g. 'RECT-TUBE 40x40x3'). */
  profile: string;
  /** Stock length the saw must cut — longest fibre after miters, mm. */
  cutLengthMm: number;
  /** Axis endpoint distance (pre-miter), mm. */
  axisLengthMm: number;
  startMiterDeg: number;
  endMiterDeg: number;
}

export interface WeldmentCutList {
  members: WeldmentCutRow[];
  /** Σ cut lengths (raw stock before nesting), mm. */
  totalStockMm: number;
  /** Total weldment mass, kg (linear density × length). */
  totalMassKg: number;
  material: string;
  /** Aggregated cut-list line count (grouped by profile+material+length). */
  entryCount: number;
}

/** WB-8: one resolved standard-thread record (ISO 261 pitch + ISO 68-1 dims). */
export interface FastenerRecord {
  id: string;
  /** ISO callout string, e.g. 'M8×1.25-6H' (formatThreadCallout). */
  callout: string;
  type: FastenerThreadType;
  nominalDiameterMm: number;
  pitchMm: number;
  /** Pitch diameter d2 = d − 0.6495·P, mm. */
  pitchDiameterMm: number;
  /** Minor diameter (external d3 = d − 1.2269·P; internal D1 = d − 1.0825·P), mm. */
  minorDiameterMm: number;
  /** Tap drill (internal) ≈ d − P, mm. Present for internal threads. */
  tapDrillMm?: number;
  engagementMm: number;
  /** Recommended minimum engagement for the mate material, mm (screening). */
  minEngagementMm: number;
  /** True when the pitch equals the ISO coarse pitch (false ⇒ declared fine pitch). */
  coarse: boolean;
}

export interface PartPackage {
  partId: string;
  /** Drawing sheet IR (3 views + iso, plus auxiliary body viewports). */
  sheet: Sheet;
  /** DXF R12 text with real-measured dimension labels (sheetToDxf). */
  dxf: string;
  dimensions: MeasuredDimensionEntry[];
  /** Measured mesh volume, mm³ (geometry gate value, restated). */
  volumeMm3: number;
  /** Present iff the part declared a sheetMetal spec (WB-2 flat pattern). */
  sheetMetal?: SheetMetalFlatPattern;
  /** Present iff the part declared a weldment spec (WB-3 cut list). */
  weldment?: WeldmentCutList;
  /** Present iff the part declared fasteners (WB-8 standard-thread schedule). */
  fasteners?: FastenerRecord[];
}

export interface AssemblyPackage {
  converged: true;
  iterations: number;
  finalMaxResidual: number;
  placements: SolvedPartPlacement[];
}

export interface VerificationReport {
  planId: string;
  briefId: string;
  allPassed: boolean;
  gates: GateResult[];
  /** Deduplicated approximation statements collected from all gates. */
  approximations: string[];
  /** Fixed honesty disclosures (계획 문서 §4). */
  limitations: string[];
  /** WB-5: REAL-verified GD&T callouts (auto-proposed + declared). Present iff
   *  the GD&T gate emitted any (additive optional). */
  gdt?: GdtCalloutRecord[];
}

export interface DesignPackage {
  planId: string;
  parts: PartPackage[];
  /** Present iff the plan declared an assembly. */
  bom?: BomItemRow[];
  assembly?: AssemblyPackage;
  report: VerificationReport;
}

// ─── driver result ───────────────────────────────────────────────────────

export interface DriverRefusal {
  /** 'plan' = planner refused / invalid plan; 'verify' = gate(s) failed. */
  stage: 'plan' | 'verify';
  reason: string;
  failedGateIds: string[];
}

export type DriverResult =
  | { ok: true; plan: DesignPlan; gates: GateResult[]; package: DesignPackage }
  | { ok: false; plan?: DesignPlan; gates: GateResult[]; refusal: DriverRefusal };

// ─── shared helpers ──────────────────────────────────────────────────────

/** Drawing sourceId / topology-map key for a plan body. */
export function bodyKey(partId: string, bodyId: string): string {
  return `${partId}:${bodyId}`;
}

/** Absolute measured-vs-expected tolerance for drawing dimensions (mm/deg). */
export const DIMENSION_MATCH_TOL = 1e-6;
