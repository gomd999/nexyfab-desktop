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

/**
 * One additive/subtractive term of the cross-section, declared with the
 * dimensions the BRIEF asked for — never read off the drawn loop.
 * The engine does the arithmetic; the planner only states the shape.
 */
export type VolumeTerm =
  | { shape: 'rect'; widthMm: number; heightMm: number; sign?: 1 | -1 }
  | { shape: 'circle'; diameterMm: number; sign?: 1 | -1 }
  | { shape: 'triangle'; baseMm: number; heightMm: number; sign?: 1 | -1 };

/**
 * Parametric derivation of the expected volume: cross-section terms × depth.
 *
 * WHY this exists (260728, §6-1): the top remaining failure mode was the model
 * mis-computing its own theoretical volume (a4-02 wrote a different number on
 * every run — it was guessing). The obvious fix — have the engine compute the
 * volume FROM THE LOOP and let the model cite it — is unsafe: expected and
 * measured would then share one source and the gate becomes an identity, so a
 * part whose loop is wrong (a4-11: flange drawn 45 where the brief said 50)
 * PASSES. That is measured, not argued — see
 * `__tests__/expectedVolumeIndependence.test.ts`.
 *
 * A decomposition keeps the two sources independent — it is a SECOND statement
 * of the intended shape, in brief dimensions — while taking the arithmetic away
 * from the model, which is the part it actually gets wrong.
 */
export interface VolumeDecomposition {
  terms: VolumeTerm[];
  /** Extrude depth, mm — declared, not read from the feature. */
  depthMm: number;
}

export interface ExpectedVolumeSpec {
  /**
   * Theoretical volume of the AS-MESHED geometry, mm³. Optional ONLY when
   * `decomposition` is present (then the engine computes it). When both are
   * given the geometry gate cross-checks them and reports an arithmetic
   * disagreement separately from a geometry one.
   */
  valueMm3?: number;
  /** Relative tolerance for the gate. Default 1e-9. */
  tolRel?: number;
  /**
   * REQUIRED: how the theory was derived, including any tessellation
   * approximation (e.g. "24-gon prism formula (N/2)·r²·sin(2π/N)·h;
   * analytic cylinder πr²h = X, tessellation deviation −1.14%").
   */
  basis: string;
  /** Parametric derivation — the engine computes the number from this. */
  decomposition?: VolumeDecomposition;
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
  /** When present, the pattern gate verifies these feature patterns (WB-7). */
  patterns?: PatternSpec[];
  /** When present, the curved gate applies a real OCCT fillet/shell (WB-6). */
  curved?: CurvedSpec;
  /** When present, the hole gate cuts these holes with the real OCCT kernel (WB-9). */
  holes?: HoleSpec[];
}

// ─── plan: curved features / OCCT (WB-6 곡면 쉘·필렛 편입) ────────────────────

export type CurvedKind = 'fillet' | 'shell';

/**
 * A real B-rep curved operation applied to `bodies[0]` (which MUST be an extrude
 * solid). The curved gate runs the OCCT kernel (nodeOcctBridge): builds the
 * extrude, applies the op, and REAL-measures the resulting solid volume — so a
 * rounded/hollowed housing is verified by executed geometry, not approximated.
 *
 *   - 'fillet': round `edges` (stable topo names, or ['sel:all']) at `radiusMm`.
 *   - 'shell':  hollow the solid to wall `wallMm` (BRepOffsetAPI thicken).
 */
export interface CurvedSpec {
  kind: CurvedKind;
  /** fillet: inner blend radius, mm. */
  radiusMm?: number;
  /** fillet: edge selection — stable extrude edge names, or ['sel:all']. Default ['sel:all']. */
  edges?: string[];
  /** shell: wall thickness, mm. */
  wallMm?: number;
  /**
   * Optional INDEPENDENT expected result volume, mm³. When present the gate
   * checks |measured − expected| ≤ tolRel·expected (a cross-check on the real
   * kernel volume). Omit to only assert the op succeeded + material direction.
   */
  expectedVolumeMm3?: number;
  /** Relative tolerance for the volume cross-check. Default 1e-6. */
  tolRel?: number;
}

// ─── plan: holes (WB-9 — 구멍 편입) ─────────────────────────────────────────

/**
 * A round THROUGH hole cut into `bodies[0]` (which MUST be an extrude solid),
 * axis parallel to the extrusion (Z), centred at `at` in the body's sketch frame.
 *
 * 왜 별도 스펙인가: 이 스키마엔 구멍을 표현할 방법이 **없었다**. `ExtrudeFeature`는
 * 외곽 루프 하나뿐이라(내부 루프 없음) LLM은 구멍을 별도 body로 만들 수밖에 없었고,
 * geometry 게이트는 그걸 "AABB 겹침 — 부피 합 정의 불가"로 정확히 거부했다. 260723
 * A-4 실측(n=12 실 LLM): 계획이 통과한 브리프의 **5/12가 이 하나로 막혔다** —
 * 구멍 없는 실무 부품이 드물기 때문. 여기서 해결한다.
 *
 * 구현은 커널 소비다(재발명 금지): OCCT `boolean.subtract`가 실제로 깎고
 * `BRepGProp`이 결과 부피를 실측한다 — 메시 근사가 아니다(WB-6 curvedGate와 동일 경로).
 *
 * 한계(명시):
 *   · 관통과 블라인드 둘 다 지원(블라인드는 브리지의 buildPrismAt로 윗면 기준 배치).
 *     깊이가 두께 이상이면 관통으로 둔갑시키지 않고 거부한다.
 *   · 원형 공구는 샘플 루프로 전달되지만 OCCT 분석형 원통으로 승격됐다는 커널 확인이
 *     없으면 거부한다. 기대 부피도 정확한 πr² 기준이며 다각형 절삭은 허용하지 않는다.
 */
export interface HoleSpec {
  /** Stable id within the part (naming/보고용). */
  id: string;
  /**
   * 'through'(default) cuts the full thickness; 'blind' cuts `depthMm` down from
   * the TOP face (needs the bridge's explicit-z0 prism — refused when absent).
   * A blind depth ≥ the material thickness is REFUSED, not silently promoted to
   * a through hole.
   */
  kind?: 'through' | 'blind';
  /**
   * Tool cross-section. 'round'(default) uses `diameterMm`; 'rect' uses
   * `widthMm`×`heightMm` (axis-aligned, centred on `at`) — square/rect tube
   * bores and window cutouts. A rect tool is EXACT (no tessellation at all),
   * so its expected volume carries no approximation.
   */
  shape?: 'round' | 'rect';
  /** round only — required when shape is 'round' (the default). */
  diameterMm?: number;
  /** rect only — cutout size along X, mm. */
  widthMm?: number;
  /** rect only — cutout size along Y, mm. */
  heightMm?: number;
  /** Centre in the body's sketch frame (same XY frame as the extrude loop), mm. */
  at: { x: number; y: number };
  /** blind only: depth from the TOP face, mm. Must be > 0 and < the thickness. */
  depthMm?: number;
  /**
   * Circular-loop recognition sample count. Default 64, clamped to [16, 256].
   * This is transport encoding only: accepted round tools are exact analytic
   * OCCT cylinders. Mixed values in one part are refused for determinism.
   */
  segments?: number;
}

// ─── plan: feature patterns / gear sizing (WB-7 패턴 편입) ───────────────────

export type PatternKind = 'linear' | 'circular';

/** Optional spur-gear SIZING carried on a circular pattern. Verifies module /
 *  teeth / pitch-diameter consistency — the involute tooth PROFILE is NOT
 *  generated (explicit ⑥ '부분' boundary; stated, not faked). */
export interface PatternGearSpec {
  moduleMm: number;
  teeth: number;
}

/**
 * A linear or circular instance pattern of a seed feature. The pattern gate
 * computes the REAL instance transforms and screens layout validity (count,
 * non-overlap, gear pitch consistency) — it verifies the LAYOUT, not a CSG-
 * meshed union of instances (근사 명시).
 */
export interface PatternSpec {
  id: string;
  kind: PatternKind;
  /** Total instance count including the seed (≥ 2). */
  count: number;
  /** linear: spacing between adjacent instances, mm. */
  pitchMm?: number;
  /** linear: unit axis direction. Default [1,0,0]. */
  axis?: [number, number, number];
  /** circular: total sweep angle, deg. Default 360 (angular pitch = angle/count). */
  angleDeg?: number;
  /** circular: pitch-circle radius the instances sit on (XZ plane, about +Y), mm. */
  radiusMm?: number;
  /** Seed footprint size for the non-overlap screen, mm. */
  seedSizeMm?: number;
  /** Optional spur-gear sizing (circular patterns only). */
  gear?: PatternGearSpec;
  /** Optional independent instance-count cross-check. */
  expectedInstances?: number;
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
   * linear only — force the measurement onto one projection axis ('x' =
   * horizontal, 'y' = vertical in that view). Default 'auto', which requires the
   * span to BE axis-aligned and refuses a diagonal ('not-axis-aligned'). Use
   * this when you want one component of a slanted span (e.g. a gusset's leg
   * along X); use `kind:'aligned'` when you want the slant's true length.
   */
  axis?: 'x' | 'y';
  /**
   * Expected nominal from the brief. When present the drawing gate checks
   * |measured − expected| ≤ 1e-6 (absolute, mm/deg).
   */
  expected?: number;
  /**
   * Parametric derivation of `expected` — the engine does the arithmetic
   * (260728). Same principle as `ExpectedVolumeSpec.decomposition`: the model
   * states the shape in BRIEF dimensions, the engine multiplies.
   *
   * WHY: bench v1 measured b-11 (tapered shim) failing **3/3** on
   * `aligned` slant length — the real length is √(120²+25²) = 122.576 and the
   * model promised 125 / 120.208 / 122.066 (a different wrong number each run —
   * it was guessing). The measurement was right and the promise was wrong, which
   * 260727 §5-4 already named as its own failure axis.
   *
   * ⚠ Independence is preserved exactly as in §6-1: the terms come from the
   * BRIEF, never from the measured geometry. The gate still compares an
   * engine-computed intent against a real measurement — two separate sources.
   * Deriving `expected` FROM the measurement would make the check an identity.
   */
  expectedFrom?: DimensionDerivation;
  tolerance?: Tolerance;
}

/**
 * How `PlanDimensionSpec.expected` is derived from brief dimensions.
 * Deliberately small — only forms the measurements showed a need for.
 */
export type DimensionDerivation =
  /** √(legA² + legB²) — a slant's true length (kind:'aligned'). */
  | { kind: 'hypotenuse'; legAMm: number; legBMm: number }
  /** Σ terms — a chain of segments. */
  | { kind: 'sum'; termsMm: number[] }
  /** fromMm − minusMm — e.g. an inner width from outer minus two walls. */
  | { kind: 'difference'; fromMm: number; minusMm: number[] };

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
  /**
   * 코어싱이 적용한 **구조적 수리** 목록 (260728). 비어 있으면 원본 그대로다.
   *
   * ⚠ 여기에 들어갈 수 있는 것은 엄격히 제한된다: **모델이 이미 제공한 데이터의 위치를
   * 옮기는 것**뿐이다. 값을 채우거나 바꾸거나 추측하는 것은 절대 들어가지 않는다
   * (`plan.drawing` 이 통째로 없으면 여전히 거부한다 — 없는 도면을 만들어주지 않는다).
   * 판정은 하나도 약해지지 않는다: 옮겨진 dimensions 는 원래 자리에 있었을 때와 **똑같이**
   * drawing 게이트에서 실측된다. 이 점이 §6-1 에서 배격한 자기참조와 결정적으로 다르다 —
   * 그쪽은 검사 자체를 없앴고, 이쪽은 검사에 도달하게만 한다.
   * 수리했다는 사실은 숨기지 않는다(이 필드가 그래서 있다).
   */
  repairs?: string[];
}

// ─── gate IR ─────────────────────────────────────────────────────────────

export type GateKind = 'geometry' | 'exact-cad' | 'exact-drawing' | 'manufacturing-drawing' | 'assembly' | 'interference' | 'dfm' | 'drawing' | 'flat-pattern' | 'gdt' | 'weldment' | 'fastener' | 'pattern' | 'curved' | 'hole';

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
  /** Mandatory exact OCCT B-rep bodies and STEP round-trip evidence. */
  exactCad: {
    exactVolumeMm3: number;
    bodies: Array<{
      bodyId: string;
      source: 'direct-extrude' | 'direct-revolve' | 'hole-step' | 'curved-step';
      volumeMm3: number;
      faceCount: number;
      edgeCount: number;
      degeneratedEdgeCount: number;
      boundaryEdgeCount: number;
      nonManifoldEdgeCount: number;
      analyticCylinder: boolean;
      roundTripVolumeRelError: number;
      roundTripDegeneratedEdgeCount: number;
      roundTripBoundaryEdgeCount: number;
      roundTripNonManifoldEdgeCount: number;
      step: string;
    }>;
  };
  /** Exact front/top/right OCCT HLR projections derived from packaged STEP. */
  exactDrawing: {
    views: Array<{
      bodyId: string;
      view: 'front' | 'top' | 'right';
      method: 'replicad-hlr' | 'analytic-sphere-fallback';
      visiblePathCount: number;
      hiddenPathCount: number;
      analyticCurveEvidence: boolean;
      sourceStepSha256: string;
      svgSha256: string;
      svg: string;
      curveRecordSha256: string;
      curveCount: number;
      curveTypes: number[];
      exactDxfSha256: string;
      exactDxf: string;
    }>;
  };
  /** Exact-HLR engineering drawing work packet. Human approval is mandatory. */
  manufacturingDrawing: {
    releaseEligible: false;
    releaseBlockers: string[];
    plannedDimensionCount: number;
    includedDimensionCount: number;
    sheets: Array<{
      schema: 'nexyfab.manufacturing-drawing-sheet.v1';
      partId: string;
      bodyId: string;
      role: 'geometry-and-dimensions' | 'dimension-continuation';
      sheetNumber: number;
      sheetCount: number;
      paperSize: PaperSize;
      widthMm: number;
      heightMm: number;
      sourceStepSha256: string;
      exactViewCount: number;
      dimensionCount: number;
      releaseStatus: 'engineering-review-required';
      svgSha256: string;
      svg: string;
    }>;
  };
  /** Present iff the part declared a sheetMetal spec (WB-2 flat pattern). */
  sheetMetal?: SheetMetalFlatPattern;
  /** Present iff the part declared a weldment spec (WB-3 cut list). */
  weldment?: WeldmentCutList;
  /** Present iff the part declared fasteners (WB-8 standard-thread schedule). */
  fasteners?: FastenerRecord[];
  /** Present iff the part declared patterns (WB-7 instance layout). */
  patterns?: PatternRecord[];
  /** Present iff the part declared a curved op (WB-6 OCCT fillet/shell). */
  curved?: CurvedResult;
  /** Present iff the part declared holes (WB-9 OCCT boolean cut). */
  holes?: HoleResult;
}

// ─── WB-9: hole (OCCT boolean cut) result ───────────────────────────────────

export interface HoleResult {
  count: number;
  /** Circular-loop recognition samples used to request an analytic cylinder. */
  segments: number;
  /** REAL kernel volume of the base extrude solid, mm³. */
  baseVolumeMm3: number;
  /** REAL kernel volume after every cut, mm³ — this part's NET volume. */
  netVolumeMm3: number;
  /**
   * 구멍 일람표 — 도면에 구멍을 그리지 못하는 동안 shop이 실제로 필요로 하는 표.
   * 지름/형상/깊이는 커널 부피로 검증된 값이고, **중심 좌표(atX/atY)는 선언값**이다:
   * 부피 검사는 "각 구멍이 소재 안에 완전히 들어있고 서로 겹치지 않는다"까지만 보증한다
   * (같은 크기 구멍이 재료 안에서 다른 자리에 있어도 제거 부피는 같다).
   */
  schedule: Array<{
    id: string; label: string; shape: 'round' | 'rect';
    atX: number; atY: number; depthMm: number | null; removedMm3: number;
  }>;
  /** Backward-compatible approximation metric; 0 for exact analytic tools. */
  tessellationAreaRelDev: number;
  /** STEP of the cut solid (best-effort). */
  step?: string;
}

// ─── WB-6: curved (OCCT) result ─────────────────────────────────────────────

export interface CurvedResult {
  kind: CurvedKind;
  /** REAL kernel volume of the base extrude solid, mm³. */
  baseVolumeMm3: number;
  /** REAL kernel volume after the curved op, mm³. */
  resultVolumeMm3: number;
  /** Signed volume change (result − base), mm³. */
  deltaVolumeMm3: number;
  /** fillet: radius / shell: wall, mm. */
  sizeMm: number;
  /** STEP (ISO-10303-21) of the curved solid — real B-rep deliverable. */
  step?: string;
}

// ─── WB-7: pattern layout record (real instance transforms) ─────────────────

export interface PatternInstance {
  index: number;
  position: [number, number, number];
  /** circular only: instance angle about +Y, deg. */
  angleDeg?: number;
}

export interface PatternGearRecord {
  moduleMm: number;
  teeth: number;
  /** Pitch diameter = module × teeth, mm. */
  pitchDiameterMm: number;
  /** Circular pitch = π × module, mm. */
  circularPitchMm: number;
}

export interface PatternRecord {
  id: string;
  kind: PatternKind;
  count: number;
  instances: PatternInstance[];
  /** linear: total span = pitch × (count − 1), mm. */
  linearSpanMm?: number;
  /** circular: angular pitch = angle / count, deg. */
  angularPitchDeg?: number;
  /** circular: arc spacing at the pitch radius, mm. */
  arcSpacingMm?: number;
  gear?: PatternGearRecord;
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
