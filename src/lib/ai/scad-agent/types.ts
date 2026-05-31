/**
 * SCAD agent — shared types.
 *
 * Provider-agnostic tool-calling protocol. We don't use Anthropic-style
 * `tool_use` blocks because DeepSeek / local LLM / older OpenAI models
 * don't all implement the same shape consistently — instead we ask the
 * model to emit a JSON envelope and parse it ourselves. This costs ~20
 * tokens per round but works across every provider in `src/lib/ai/`.
 *
 * The agent loop is:
 *   1. Compose messages = [system, ...history, user]
 *   2. Ask model
 *   3. Parse response: text + tool_calls[]
 *   4. Execute each tool, append tool_result message
 *   5. If tool_calls.length === 0 → done. Otherwise loop.
 *
 * Wedge detection: if 3 consecutive `render` tool calls return errors
 * the loop aborts with status 'wedged' so a stuck model can't burn
 * budget forever.
 */

import type { IntentInput } from '../../openscad-render/intentToScad';

// ─── Tool definitions ──────────────────────────────────────────────────────

export type ToolName =
  | 'write_scad'
  | 'apply_diff'
  | 'render'
  | 'get_geometry'
  | 'add_feature_intent'
  | 'search_bosl2'
  | 'read_dfm'
  // ─── Stage 1 (assembly composition) ──────────────────────────────────
  | 'plan_design'
  | 'write_module'
  | 'list_modules'
  | 'compose_assembly'
  // ─── Stage 2 (multimodal visual verification) ────────────────────────
  | 'view_render'
  // ─── B2 — checkpoints / revert ──────────────────────────────────────
  | 'list_checkpoints'
  | 'revert_to_checkpoint'
  // ─── A (Stage 3) — OCCT B-rep tools ──────────────────────────────────
  | 'brep_primitive'
  | 'brep_boolean'
  | 'brep_fillet'
  | 'brep_chamfer'
  | 'brep_shell'
  | 'brep_to_mesh'
  | 'brep_export_step'
  | 'list_breps'
  // ─── G (Stage 4) — sweep / loft / draft / helix ──────────────────────
  | 'brep_sweep'
  | 'brep_loft'
  | 'brep_draft'
  | 'brep_helix'
  // ─── H (Stage 4) — 2D constraint sketcher ────────────────────────────
  | 'sketch_create'
  | 'sketch_add_constraint'
  | 'sketch_solve'
  | 'sketch_to_brep_extrude'
  // ─── I (Stage 4) — assembly mate connectors ──────────────────────────
  | 'add_mate'
  | 'list_mates'
  | 'solve_mates'
  | 'list_face_tags'
  // ─── Y1 — Clarification turn ─────────────────────────────────────────
  | 'ask_user'
  // ─── Y3 — Multi-turn user preferences ────────────────────────────────
  | 'set_user_pref'
  | 'get_user_prefs'
  | 'forget_user_pref'
  // ─── Z1 — Parametric feature tree ────────────────────────────────────
  | 'tree_summary'
  | 'tree_set_param'
  | 'tree_remove_node'
  // ─── Z4 — Standards library lookups ──────────────────────────────────
  | 'lookup_metric_fastener'
  | 'lookup_imperial_fastener'
  | 'select_bearing'
  | 'select_key'
  | 'select_retaining_ring'
  | 'select_drill'
  | 'lookup_socket_head_cap'
  | 'lookup_countersunk_screw'
  | 'lookup_dowel_pin'
  | 'select_tapered_bearing'
  // ─── Z5 — PMI (Y14.5 / Y14.41) extensions ────────────────────────────
  | 'add_datum_target'
  | 'add_surface_finish'
  | 'add_annotated_dimension'
  | 'export_pmi_step_ap242'
  // ─── Z6 — Engineering catalog RAG ────────────────────────────────────
  | 'query_engineering_catalog'
  // ─── Σ — Simulation suite (mock adapters; real Docker pluggable) ─────
  | 'sim_cfd'
  | 'sim_mbd'
  | 'sim_cam'
  | 'sim_mold_fill'
  | 'sim_optics'
  | 'sim_thermal'
  // ─── Ω — Generative design ───────────────────────────────────────────
  | 'topology_optimize'
  | 'auto_mesh'
  | 'find_design_patterns'
  // ─── J (Stage 4) — drawing studio v1 ─────────────────────────────────
  | 'brep_to_drawing'
  | 'brep_export_drawing'
  // ─── K (Stage 4) — collab presence + lock ───────────────────────────
  | 'collab_presence'
  | 'collab_lock'
  // ─── N (Stage 4 wired) — sheet metal calculations ────────────────────
  | 'sheet_metal_bend_allowance'
  | 'sheet_metal_box_flat'
  // ─── P (Stage 4) — GD&T frames on drawings ──────────────────────────
  | 'add_gdt_frame'
  | 'list_gdt_frames'
  // ─── Q (Stage 4) — kinematics check tools ───────────────────────────
  | 'check_gear_mesh'
  | 'check_interference'
  // ─── R (Stage 4) — multi-document references ────────────────────────
  | 'import_doc_ref'
  | 'list_doc_refs'
  // ─── T (Stage 4) — FEA (CalculiX-shaped) ─────────────────────────────
  | 'fea_setup'
  | 'fea_solve'
  | 'fea_stress'
  // ─── U (Stage 4) — sheet metal unfold (multi-bend) ───────────────────
  | 'sheet_metal_unfold'
  // ─── X1 — spec verification (intent vs measured bbox) ───────────────
  | 'verify_spec'
  // ─── X1 (B-rep parallel) — spec verification for B-rep flows ────────
  | 'verify_spec_brep'
  // ─── GD&T tolerance suggester (DimXpert / Auto-dim equivalent) ──────
  | 'suggest_gdt_for_intent'
  // ─── Track B — Cost estimation ──────────────────────────────────────
  | 'estimate_cost'
  // ─── Track G — AI process selection ─────────────────────────────────
  | 'suggest_process'
  // ─── Track M — AI material recommendation ───────────────────────────
  | 'suggest_material'
  // ─── Track N — BOM auto-generation ──────────────────────────────────
  | 'generate_bom'
  // ─── Track E — AI mate inference for 2-part pairs ────────────────────
  | 'suggest_mates'
  // ─── Track H — Version diff between checkpoints ──────────────────────
  | 'diff_checkpoints'
  // ─── Image-to-CAD — extract intent from a photo/sketch via vision ────
  | 'intent_from_image'
  // ─── Mesh reverse-engineering — STL → proposed IntentInput via heuristic ─
  | 'reverse_engineer_mesh';

export interface ToolCall {
  /** Unique id for matching tool_result back to tool_call */
  id: string;
  name: ToolName;
  /** JSON-serializable args, schema depends on tool. */
  args: Record<string, unknown>;
}

export interface ToolResultOk {
  ok: true;
  /** Free-form text the model sees as the tool's return value. */
  output: string;
  /** Optional structured data — kept for telemetry, NOT sent back to model. */
  meta?: Record<string, unknown>;
}

export interface ToolResultErr {
  ok: false;
  /** Human-readable error message the model sees. */
  error: string;
  /** Stable error code for budget/wedge logic. */
  code?: string;
}

export type ToolResult = ToolResultOk | ToolResultErr;

// ─── Tool argument shapes ──────────────────────────────────────────────────

export interface WriteScadArgs { code: string; }
export interface ApplyDiffArgs { diff: string; }
/** No tool arguments — render uses `session.scadSource`. */
export type RenderArgs = Record<string, never>;
export type GetGeometryArgs = Record<string, never>;
export interface AddFeatureIntentArgs { intent: IntentInput; }
export interface SearchBosl2Args { query: string; limit?: number; }
export interface ReadDfmArgs { processes?: string[]; }

// ─── Stage 1 (assembly) tool args ───────────────────────────────────────
export interface PlanDesignArgs { goal: string; }
export interface WriteModuleArgs { name: string; code: string; }
export type ListModulesArgs = Record<string, never>;
export interface AssemblyPlacement {
  moduleName: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Repeat count for arrays (defaults to 1). */
  count?: number;
  /** Per-array spacing if count>1. */
  spacing?: [number, number, number];
}
export interface ComposeAssemblyArgs {
  /** SCAD `include <...>` lines to prepend (e.g. BOSL2/std.scad). */
  includes?: string[];
  /** Ordered list of module placements. */
  parts: AssemblyPlacement[];
}

// ─── A (Stage 3 — B-rep) tool args + types ─────────────────────────────

export type BrepPrimitiveShape = 'box' | 'cylinder' | 'sphere';

export interface BrepPrimitiveArgs {
  shape: BrepPrimitiveShape;
  /** Box: width/height/depth. Cylinder: diameter/height. Sphere: radius. */
  params: Record<string, number>;
  /** Optional translation applied at primitive creation. */
  position?: [number, number, number];
}

export interface BrepBooleanArgs {
  op: 'union' | 'subtract' | 'intersect';
  /** Handle of the host (returned from a previous brep_* call). */
  hostHandle: string;
  toolHandle: string;
}

/** O — edge filter for selective fillet / chamfer.
 *  - 'all'  → every edge (default, backward-compat)
 *  - 'top'  → edges on the +Z face
 *  - 'bottom' → edges on the −Z face
 *  - 'vertical' → edges parallel to Z (corner edges of a box)
 *  - 'horizontal' → edges in the XY plane (top + bottom rim edges)
 */
export type EdgeFilter = 'all' | 'top' | 'bottom' | 'vertical' | 'horizontal';

export interface BrepFilletArgs {
  hostHandle: string;
  /** Radius in mm. */
  radius: number;
  /** O — restrict to a subset of edges. Default 'all'. */
  edges?: EdgeFilter;
}

export interface BrepChamferArgs {
  hostHandle: string;
  distance: number;
  /** O — restrict to a subset of edges. Default 'all'. */
  edges?: EdgeFilter;
}

export interface BrepShellArgs {
  hostHandle: string;
  thickness: number;
  /** Which face to leave open: 0=closed (no opening), 1=top, 2=bottom. */
  openFace?: 0 | 1 | 2;
}

export interface BrepToMeshArgs {
  hostHandle: string;
  /** Linear tolerance for tessellation; smaller = finer mesh. Default 0.1mm. */
  tolerance?: number;
}

export interface BrepExportStepArgs {
  hostHandle: string;
}

export type ListBrepsArgs = Record<string, never>;

// ─── G (Stage 4) — sweep / loft / draft / helix ─────────────────────────

/** A 2D point in the XY plane, used for path / profile vertex lists. */
export type Point2D = [number, number];
/** A 3D point (mm) — used for 3D paths. */
export type Point3D = [number, number, number];

export interface BrepSweepArgs {
  /** 2D profile vertices (closed polygon, automatically closed). */
  profile: Point2D[];
  /** 3D path the profile follows. Min 2 points. */
  path: Point3D[];
  /** Optional: rotate-with-path on/off. Default true. */
  twist?: boolean;
}

export interface BrepLoftArgs {
  /** Cross-sections from bottom to top — each is a closed 2D polygon
   *  in the XY plane, then translated to its z height. */
  sections: { z: number; polygon: Point2D[] }[];
  /** Optional: smooth (ruled=false) vs ruled (straight) blending. */
  ruled?: boolean;
}

export interface BrepDraftArgs {
  /** Existing B-rep handle to apply draft to. */
  hostHandle: string;
  /** Pull direction (e.g. mold opening direction). Default +Z. */
  direction?: Point3D;
  /** Draft angle in degrees. Positive = open outward. */
  angleDeg: number;
}

export interface BrepHelixArgs {
  /** Pitch (height per turn) in mm. */
  pitch: number;
  /** Total height in mm. */
  height: number;
  /** Helix radius in mm. */
  radius: number;
  /** Profile diameter (sweep cross-section) — defaults to a small circle. */
  profileDiameter?: number;
  /** Right-hand (default) or left-hand helix. */
  handedness?: 'right' | 'left';
}

// ─── H (Stage 4) — sketch + constraint solver ──────────────────────────

export type SketchEntityKind = 'point' | 'line' | 'circle' | 'arc';

export interface SketchEntity {
  /** Stable id within the sketch. */
  id: string;
  kind: SketchEntityKind;
  /** Initial geometry — solver may move points to satisfy constraints. */
  points: Point2D[];
  /** Radius for circle / arc; ignored for point/line. */
  radius?: number;
}

export type SketchConstraintKind =
  | 'horizontal' | 'vertical'
  | 'parallel' | 'perpendicular'
  | 'coincident' | 'tangent'
  | 'distance' | 'angle'
  | 'equal_length' | 'equal_radius'
  | 'fix_point';

export interface SketchConstraint {
  id: string;
  kind: SketchConstraintKind;
  /** Entities this constraint relates (1 or 2 ids depending on kind). */
  entityIds: string[];
  /** Numeric parameter for distance/angle. */
  value?: number;
}

export interface SketchCreateArgs {
  /** Stable name for this sketch (used for later references). */
  name: string;
  entities: SketchEntity[];
}

export interface SketchAddConstraintArgs {
  sketchName: string;
  constraint: SketchConstraint;
}

export interface SketchSolveArgs {
  sketchName: string;
}

export interface SketchToBrepExtrudeArgs {
  sketchName: string;
  /** Extrusion height in mm. Negative = downward. */
  height: number;
  /** Operation mode. */
  op?: 'new' | 'union' | 'subtract';
  /** When op != 'new', the existing handle to combine with. */
  hostHandle?: string;
}

/** Persisted sketch state for the session. */
export interface SketchState {
  name: string;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  /** True iff the most recent solve_mates succeeded. */
  solved: boolean;
}

// ─── I (Stage 4) — assembly mate connectors ────────────────────────────

export type MateKind = 'concentric' | 'coplanar' | 'distance' | 'tangent' | 'parallel' | 'perpendicular';

export interface AssemblyMate {
  id: string;
  kind: MateKind;
  /** Two B-rep handles being mated. */
  handleA: string;
  handleB: string;
  /**
   * Optional face index. Use only when the geometry is locked (no further
   * boolean/fillet/chamfer ops planned), since indices renumber across
   * topology-changing operations. Prefer `faceTagA` for stability.
   */
  faceA?: number;
  faceB?: number;
  /**
   * A3 — Stable face tag. For primitives the agent uses canonical role
   * tags (cube: 'x+'|'x-'|'y+'|'y-'|'z+'|'z-'; cylinder: 'top'|'bottom'|'side';
   * sphere has no faces, only a single surface 'surf'). After boolean ops
   * the server resolves the tag to a current face index by best-match
   * (centroid + normal proximity); resolution failure falls back to faceIndex.
   * See `list_face_tags` tool.
   */
  faceTagA?: string;
  faceTagB?: string;
  /** Numeric parameter for distance/angle mates. */
  value?: number;
}

export interface AddMateArgs {
  kind: MateKind;
  handleA: string;
  handleB: string;
  faceA?: number;
  faceB?: number;
  /** A3 — Prefer over faceA/faceB for boolean-stable references. */
  faceTagA?: string;
  faceTagB?: string;
  value?: number;
}

export interface ListFaceTagsArgs {
  hostHandle: string;
}

export interface FaceTag {
  /** Stable role-based tag (e.g. 'top', 'side', 'x+'). */
  tag: string;
  /** Current face index this tag resolves to in the live topology. */
  faceIndex: number;
  /** Centroid in world coords — informational. */
  centroid: [number, number, number];
  /** Outward normal — informational. */
  normal: [number, number, number];
}

export type ListMatesArgs = Record<string, never>;
export type SolveMatesArgs = Record<string, never>;

// ─── J (Stage 4) — drawing studio v1 ────────────────────────────────────

export interface BrepToDrawingArgs {
  hostHandle: string;
  /** Sheet size (default A4 landscape). */
  paper?: 'A4' | 'A3' | 'A2';
  /** Standard view layout. */
  views?: ('front' | 'top' | 'right' | 'iso')[];
  /** Show hidden lines (HLR). Default true. */
  showHidden?: boolean;
  /** Auto-place dimensions. Default true. */
  autoDimension?: boolean;
}

export interface BrepExportDrawingArgs {
  hostHandle: string;
  /** Single view to export as SVG. Default 'front'. */
  view?: 'front' | 'top' | 'right' | 'left' | 'back' | 'bottom';
  /** Margin around the projection in mm. Default 10. */
  marginMm?: number;
}

// ─── P (Stage 4) — GD&T tool args + types ──────────────────────────────

/** GD&T characteristic symbols per ASME Y14.5 / ISO 1101. v1 covers the
 *  most-used: position, flatness, perpendicularity, parallelism, circularity,
 *  cylindricity, and surface profile. */
export type GdtSymbol =
  | 'position'
  | 'flatness'
  | 'perpendicularity'
  | 'parallelism'
  | 'circularity'
  | 'cylindricity'
  | 'surface_profile'
  | 'concentricity'
  | 'symmetry'
  | 'angularity';

/** Material condition + state modifiers per ASME Y14.5-2018 / Y14.41.
 *  M = MMC (max material), L = LMC (least material), S = RFS (default),
 *  F = Free state, P = Projected tolerance zone, T = Tangent plane,
 *  ST = Statistical tolerance. */
export type GdtModifier = 'M' | 'L' | 'S' | 'F' | 'P' | 'T' | 'ST' | null;

/** Z5 — Datum target type (point/line/area) per Y14.5 §4.6. */
export type DatumTargetType = 'point' | 'line' | 'area';

export interface DatumTarget {
  /** Datum letter (matches an existing GdtDatumRef letter). */
  letter: string;
  /** Sequence number within the letter (e.g. A1, A2, A3). */
  index: number;
  type: DatumTargetType;
  /** World-coord location. */
  location: [number, number, number];
  /** For 'area' targets — diameter or width of the contact zone (mm). */
  sizeMm?: number;
}

/** Z5 — Surface finish symbol per ISO 1302 / ASME Y14.36. */
export interface SurfaceFinish {
  /** Stable id within the session. */
  id: string;
  featureRef: string;
  /** Roughness Ra (μm). When given as a range: { upper, lower? }. */
  roughnessRaUm: { upper: number; lower?: number };
  /** Lay direction symbol (=, ⊥, X, M, R, C, P). */
  lay?: '=' | 'perp' | 'X' | 'M' | 'R' | 'C' | 'P';
  /** Required machining: any | required | prohibited. */
  machining?: 'any' | 'required' | 'prohibited';
}

/** Z5 — Linear/diametral dimension classification. */
export type DimensionKind = 'standard' | 'basic' | 'reference' | 'auxiliary';

export interface AnnotatedDimension {
  id: string;
  featureRef: string;
  kind: DimensionKind;
  /** Nominal value in mm. */
  valueMm: number;
  /** Plus/minus tolerance, e.g. {plus: 0.1, minus: 0.05}. Omit for basic/reference. */
  tolerance?: { plus: number; minus: number };
}

/** A datum reference frame entry. */
export interface GdtDatumRef {
  /** Datum letter ('A', 'B', ... — must be already defined as a feature datum). */
  letter: string;
  /** Material modifier on the datum. */
  modifier?: GdtModifier;
}

export interface GdtFrame {
  /** Stable id for this frame within the session. */
  id: string;
  /** Which feature this frame applies to (free-form label or B-rep handle). */
  featureRef: string;
  symbol: GdtSymbol;
  /** Tolerance value in mm (e.g. 0.05 for ⌖ Ø0.05). */
  tolerance: number;
  /** True when the symbol takes a diameter prefix (Ø) — e.g. position. */
  diameter?: boolean;
  /** Material modifier on the tolerance (M=MMC, L=LMC). */
  modifier?: GdtModifier;
  /** Datum references in primary→secondary→tertiary order. */
  datums?: GdtDatumRef[];
  /** Free-form note. */
  note?: string;
}

export interface AddGdtFrameArgs {
  featureRef: string;
  symbol: GdtSymbol;
  tolerance: number;
  diameter?: boolean;
  modifier?: GdtModifier;
  datums?: GdtDatumRef[];
  note?: string;
}

export type ListGdtFramesArgs = Record<string, never>;

// ─── R (Stage 4) — multi-document refs ──────────────────────────────────

export interface DocRef {
  /** Stable id for this reference within the session. */
  id: string;
  /** Source URL or local path the artifact was loaded from. */
  source: string;
  /** Format detected at import time. */
  format: 'step' | 'stp' | 'iges' | 'igs' | 'stl' | 'scad';
  /** B-rep handle the agent can use as a brep_* arg (when format produces one). */
  brepHandle?: string;
  /** SCAD source the agent can include via write_module (when format='scad'). */
  scadSource?: string;
  /** Optional human label. */
  label?: string;
  ts: number;
}

export interface ImportDocRefArgs {
  /** http(s):// URL or local relative path. */
  source: string;
  /** Optional explicit format override (otherwise inferred from extension). */
  format?: 'step' | 'iges' | 'stl' | 'scad';
  label?: string;
}

export type ListDocRefsArgs = Record<string, never>;

// ─── T (Stage 4) — FEA tool args + types ───────────────────────────────

export type FeaMaterial = 'steel' | 'aluminum' | 'titanium' | 'brass' | 'pla' | 'abs' | 'nylon';

export interface FeaConstraint {
  /** Which face / region is fixed (free-form id — must match B-rep face). */
  faceId: string;
  /** Constraint type — 'fixed' = clamped (no DOF), 'pinned' = ball joint. */
  type: 'fixed' | 'pinned';
}

export interface FeaLoad {
  /** Face / region the load is applied to. */
  faceId: string;
  /** Force vector in N (or pressure × area, agent decides). */
  forceN: [number, number, number];
}

export interface FeaSetupArgs {
  hostHandle: string;
  material: FeaMaterial;
  /** Boundary conditions. */
  constraints: FeaConstraint[];
  /** Applied loads. */
  loads: FeaLoad[];
  /** Element edge length in mm. Smaller = finer mesh, slower solve.
   *  Default 2mm (good for parts < 200mm). */
  meshSizeMm?: number;
}

export interface FeaSolveArgs {
  /** id returned by fea_setup. */
  studyId: string;
  /** Solver mode. v0 only static linear; modal/nonlinear are post-MVP. */
  mode?: 'static_linear';
}

export interface FeaStressArgs {
  studyId: string;
  /** Which stress measure. von Mises is the typical pass/fail metric. */
  measure?: 'von_mises' | 'max_principal' | 'min_principal' | 'shear_max';
}

// ─── U (Stage 4) — sheet metal unfold (multi-bend) ─────────────────────

export interface SheetMetalBendSpec {
  /** Position of the bend axis (mm from one edge of the strip). */
  positionMm: number;
  /** Bend angle in degrees (90 = right-angle, 180 = U-bend). */
  angleDeg: number;
  /** Inner bend radius, mm. Default = thickness. */
  innerRadiusMm?: number;
}

export interface SheetMetalUnfoldArgs {
  /** Final folded part bounding length along the strip axis (mm). */
  partLengthMm: number;
  /** Strip width (mm). */
  widthMm: number;
  /** Sheet thickness, mm. */
  thicknessMm: number;
  /** Bends in order along the strip. */
  bends: SheetMetalBendSpec[];
  /** K-factor 0–1 (default 0.44). */
  kFactor?: number;
}

// ─── N (Stage 4) — sheet metal tool args ───────────────────────────────

export interface SheetMetalBendAllowanceArgs {
  /** Bend angle in degrees (90 = right-angle bend). */
  angleDeg: number;
  /** Inner bend radius in mm. */
  innerRadiusMm: number;
  /** Sheet thickness in mm. */
  thicknessMm: number;
  /** K-factor 0–1 (default 0.44 for steel; 0.33 brass; 0.5 aluminum). */
  kFactor?: number;
}

export interface SheetMetalBoxFlatArgs {
  /** Outside dimensions of the closed box, mm. */
  width: number;
  depth: number;
  height: number;
  /** Sheet thickness, mm. */
  thicknessMm: number;
  /** Inner bend radius, mm (default 1× thickness). */
  innerRadiusMm?: number;
  /** K-factor 0–1 (default 0.44). */
  kFactor?: number;
}

/** Per-handle metadata stored on the session so the agent can list /
 *  reference its B-rep collection without re-querying the OCCT registry. */
export interface BrepEntry {
  handle: string;
  /** Shape kind for display ("cylinder", "boolean(subtract)", "fillet(r=2)" …). */
  kind: string;
  /** Free-form label the agent can use (e.g. "bracket", "nut1"). */
  label?: string;
  /** ISO timestamp of creation. */
  ts: number;
}

// ─── B2 (checkpoint) tool args + types ─────────────────────────────────
export interface Checkpoint {
  /** 1-indexed sequence number — stable across reverts. */
  index: number;
  /** ISO timestamp when checkpoint was captured. */
  ts: number;
  /** Brief summary surfaced in list_checkpoints output. */
  label: string;
  /** Snapshot of scadSource + modules + composition + designPlan. */
  scadSource: string;
  modules: Record<string, string>;
  composition: string | null;
  designPlan: string | null;
  /**
   * Track H — Optional GeometryStats snapshot captured WITH this
   * checkpoint. Future checkpoint-capture sites (after a successful
   * render + geometry parse) can populate this so `diff_checkpoints`
   * can surface bbox / volume / surface area / genus deltas in addition
   * to the SCAD source delta. Existing checkpoints without stats simply
   * yield null deltas — the diff still works for the scadSource part.
   */
  stats?: GeometryStats;
}

export type ListCheckpointsArgs = Record<string, never>;
export interface RevertToCheckpointArgs { index: number; }

// ─── Stage 2 (multimodal) tool args ─────────────────────────────────────
export interface ViewRenderArgs {
  /** Question to ask the vision model. Defaults to a generic critique prompt. */
  prompt?: string;
  /** Subset of camera angles. Defaults to iso + front + right side. */
  views?: ('iso' | 'front' | 'right' | 'left' | 'top' | 'back')[];
}

/** Args for `intent_from_image`: vision-driven CAD-intent extraction. */
export interface IntentFromImageArgs {
  /** Raw base64 or data URL (data URL preferred). */
  imageBase64: string;
  /** Optional MIME type — inferred from data URL when present. */
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Optional NL hint paired with the image ("the bracket is 50mm wide"). */
  hintText?: string;
}

/** Args for `reverse_engineer_mesh`: heuristic shape classifier over an STL. */
export interface ReverseEngineerMeshArgs {
  /** Raw base64 or data URL (data URL preferred). */
  stlBase64: string;
}

// ─── Session state ──────────────────────────────────────────────────────────

export type AgentStatus =
  | 'idle'             // no run in progress
  | 'running'          // model is thinking / tools executing
  | 'done'             // model returned without tool calls
  | 'awaiting_user'    // Y1 — paused on ask_user, needs user reply to resume
  | 'wedged'           // 3 consecutive render failures
  | 'budget'           // token / turn cap reached
  | 'cancelled'        // user cancelled
  | 'error';           // unrecoverable error

export interface RenderError {
  line?: number;
  message: string;
}

export interface RenderState {
  /** Was the last render successful? null = never rendered. */
  ok: boolean | null;
  /** Render errors from OpenSCAD CLI (parsed). */
  errors: RenderError[];
  /** Bytes of STL produced (0 if render failed). */
  stlBytes?: number;
  /** Triangle count (0 if render failed or non-mesh). */
  triangles?: number;
  /** Timestamp of last render. */
  ts?: number;
}

export interface GeometryStats {
  bbox?: { min: [number, number, number]; max: [number, number, number] };
  volume_mm3?: number;
  surfaceArea_mm2?: number;
  /** True only for a verified clean closed solid (watertight + manifold). When
   *  the STL was parsed and checked this reflects real geometry — not merely
   *  "the render compiled". */
  manifold?: boolean;
  /** Closed (no open boundary edges). Set when real verification ran. */
  watertight?: boolean;
  /** Number of disjoint connected shells (1 = single body). */
  componentCount?: number;
  triangleCount?: number;
  /** Layer-1 verification critique when the geometry has problems (gaps,
   *  inside-out normals, fragments). Undefined/empty when the model is clean. */
  issues?: string;
  /**
   * X2 — Topological genus = number of through-holes for a single-body
   * closed manifold. Null when the mesh isn't a clean closed single body
   * (multi-body, open boundary, non-manifold). verify_spec uses this to
   * count through-holes against the intent's `hole` feature count.
   */
  genus?: number | null;
  /**
   * X6/X7 — axis-aligned cylindrical hole peaks across X/Y/Z. Each peak
   * carries its detection axis so verify_spec can match intent holes
   * along the right axis. (cx, cy) is in the perpendicular plane
   * (Z: world XY, X: world YZ, Y: world XZ).
   */
  detectedHoles?: Array<{
    axis: 'x' | 'y' | 'z';
    cx: number;
    cy: number;
    diameter: number;
    voteCount: number;
  }>;
  /**
   * X11 — Minimum wall thickness sampled across the mesh (mm). null when
   * the shape is a convex solid (no inward hits — sphere, single cube)
   * or the mesh was empty. verify_spec uses this against the declared
   * manufacturing process's minimum to fail "wall too thin to print/mill".
   */
  minWallThicknessMm?: number | null;
  /**
   * X8 — dihedral angle stats for fillet verification. sharpEdgeCount ≈ 0
   * indicates a part where every sharp corner has been replaced with a
   * smooth fillet transition.
   */
  dihedralStats?: {
    totalManifoldEdges: number;
    sharpEdgeCount: number;
    curvedEdgeCount: number;
    flatEdgeCount: number;
    maxDihedralDeg: number;
    meanDihedralDeg: number;
  };
}

export interface BudgetState {
  /** Tokens consumed across all model calls in this session. */
  tokensUsed: number;
  tokensCap: number;
  /** Number of model rounds (request → response pairs). */
  turnsUsed: number;
  turnsCap: number;
  /** Number of tool calls executed. */
  toolCallsUsed: number;
  toolCallsCap: number;
  /** Stage 2 — count of view_render (vision) calls; capped separately
   *  because vision tokens cost 5-20× more than text. */
  visionCallsUsed: number;
  visionCallsCap: number;
  /** Consecutive render failures — wedge trip at 3. */
  consecutiveRenderFails: number;
}

export interface AgentSession {
  id: string;
  /**
   * Top-level OpenSCAD source. Used by `write_scad` / `apply_diff` for the
   * single-file path. When `modules` and/or `composition` are populated
   * the renderer uses those instead (multi-module assembly path).
   */
  scadSource: string;
  /**
   * Stage 1 — named SCAD modules. Key is module name, value is its
   * `module name() { ... }` body. The renderer concatenates these
   * before the composition section.
   */
  modules: Record<string, string>;
  /**
   * Stage 1 — top-level composition (the "main" of the SCAD file).
   * When set, replaces `scadSource` for rendering. Includes the
   * `include <...>` lines + module instantiations with translate/rotate.
   */
  composition: string | null;
  /**
   * Optional design plan stored as agent-visible scratch — populated by
   * `plan_design`. Surfaced in the next model turn so the agent can
   * follow its own breakdown rather than improvising.
   */
  designPlan: string | null;
  /**
   * B2 — Checkpoints captured after every successful render. The
   * `revert_to_checkpoint` tool restores one of these so the agent
   * (or user via UI) can roll back without losing the whole session.
   * Stored ring-buffer-style with a hard cap to bound memory.
   */
  checkpoints: Checkpoint[];
  /**
   * A (Stage 3) — Live OCCT B-rep handles created during this session.
   * Each entry references a shape registered in the underlying OCCT
   * registry (`features/occtEngine.ts`); the metadata here lets the
   * agent enumerate without poking server internals.
   */
  brepEntries: BrepEntry[];
  /**
   * H (Stage 4) — Named 2D sketches with constraint state. Used by the
   * sketch_* tools and consumed by sketch_to_brep_extrude when ready.
   */
  sketches: Record<string, SketchState>;
  /**
   * I (Stage 4) — Assembly mate constraints between B-rep handles.
   * `solve_mates` evaluates the system; results are reflected back into
   * brepEntries' implicit positions.
   */
  mates: AssemblyMate[];
  /**
   * P (Stage 4) — GD&T frames attached to features for the drawing
   * studio to render. The frames are session-scoped so the agent can
   * iterate on tolerance design before exporting the final drawing.
   */
  gdtFrames: GdtFrame[];
  /**
   * R (Stage 4) — External documents (STEP/IGES/STL/SCAD) imported by
   * the agent. Each entry can be referenced as a B-rep handle (geometry
   * formats) or as SCAD source (scad format).
   */
  docRefs: DocRef[];
  /** Z5 — Datum targets (Y14.5 §4.6). */
  datumTargets?: DatumTarget[];
  /** Z5 — Surface finish callouts. */
  surfaceFinishes?: SurfaceFinish[];
  /** Z5 — Annotated dimensions classified as basic/reference/auxiliary. */
  annotatedDimensions?: AnnotatedDimension[];
  /**
   * Y3 — Free-form key/value user preferences that should persist
   * across turns (and ideally across sessions when the client wires
   * localStorage). Examples: "units"=>"mm", "default_process"=>"3d_printing",
   * "preferred_tolerance"=>"±0.1mm". Surfaced verbatim in the system
   * prompt so the model honors them without the user re-stating each turn.
   */
  userPrefs?: Record<string, string>;
  /**
   * Z1 — Parametric feature tree. When present, brep_* tools register
   * themselves as nodes and parameter changes propagate dirty flags so
   * the agent can rebuild only the affected sub-tree instead of throwing
   * the whole design away. Backwards compatible: when absent, agent
   * runs in legacy immediate-mode (current behavior).
   */
  featureTree?: import('./featureTree').FeatureTree;
  /**
   * X1 — Most recent IntentInput passed through add_feature_intent. The
   * verify_spec tool reads this against the latest measured bbox to
   * detect param-level mismatches (e.g. AI emitted width=5 when the user
   * said 50). Cleared when write_scad / apply_diff replace the source.
   */
  lastIntent?: import('../../openscad-render/intentToScad').IntentInput;
  /** Conversation messages, including tool_call / tool_result envelopes. */
  history: AgentMessage[];
  render: RenderState;
  geometry: GeometryStats;
  budget: BudgetState;
  status: AgentStatus;
}

// Agent's own message shape (not directly the provider's). We translate
// to ChatMessage when calling the model, and parse the model's text
// response back into AgentMessage form.
export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool_result'; toolCallId: string; result: ToolResult };

// ─── Public API ────────────────────────────────────────────────────────────

export interface AgentRunOptions {
  /** Initial user message. */
  userPrompt: string;
  /** Existing session (continuation) or null to start fresh. */
  session?: AgentSession | null;
  /** Optional: token budget override (defaults from BudgetDefaults). */
  tokensCap?: number;
  turnsCap?: number;
  toolCallsCap?: number;
  /** Stage 2 — separate cap for view_render (vision) calls; defaults to 3. */
  visionCallsCap?: number;
  /** B1 — disable the deterministic fast-path classifier. Default false
   *  (fast-path enabled). Set true in tests that specifically exercise
   *  the LLM loop, or when the caller wants AI behavior even on simple prompts. */
  fastPath?: boolean;
  /** Provider override for testing — see AiClient. */
  ai?: AiClient;
  /** Tool executor override for testing — defaults to real implementations. */
  tools?: ToolExecutorMap;
  /** Streaming callback fired after each model round / tool call. */
  onEvent?: (ev: AgentEvent) => void;
  /** Abort signal — propagated to the AI client and the tool loop so a
   *  client disconnect (SSE close) stops further provider calls. */
  signal?: AbortSignal;
}

export type AgentEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'model_response'; text: string; toolCalls: ToolCall[]; tokens?: number }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; result: ToolResult; callId: string }
  | { type: 'budget_warn'; remainingPct: number }
  | { type: 'wedge_detected' }
  | { type: 'done'; session: AgentSession }
  /** Y1 — Agent paused waiting for user clarification. */
  | { type: 'awaiting_user'; question: string; options?: string[]; session: AgentSession }
  | { type: 'error'; message: string };

// ─── AI client + tool executor abstractions (mockable) ─────────────────────

export interface AiClient {
  /** Returns model text + an estimate of tokens consumed. The optional
   *  `signal` lets callers (e.g. the SSE route handler) abort the
   *  in-flight provider call when the client disconnects — without this,
   *  the server task keeps running and burning provider quota even though
   *  no one is listening to the response. */
  complete(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    opts?: { signal?: AbortSignal },
  ): Promise<{
    text: string;
    promptTokens?: number;
    completionTokens?: number;
  }>;
}

export type ToolExecutor = (args: Record<string, unknown>, session: AgentSession) => Promise<ToolResult>;
export type ToolExecutorMap = Partial<Record<ToolName, ToolExecutor>>;
