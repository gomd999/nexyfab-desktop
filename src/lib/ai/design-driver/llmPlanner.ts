/**
 * design-driver/llmPlanner — WA-D1: the LLM-backed `DesignPlanner`.
 *
 * The LLM's role stays CONFINED to the `DesignPlanner` contract (planner.ts):
 * brief in, `DesignPlan` IR out. This module never lets model text reach the
 * deterministic build path unchecked — it is the security boundary between an
 * unreliable generator and the executable pipeline:
 *
 *   1. call an INJECTED `complete(messages)` (never a live call in tests —
 *      비용·비결정 금지; production wraps `chatCompletion`),
 *   2. extract JSON from the reply (markdown-fence tolerant),
 *   3. **coerce into the DesignPlan schema** — unknown fields dropped, every
 *      required field type-checked; any violation ⇒ `PlannerError` (날조 금지:
 *      a guessed/half-formed plan is refused, not repaired into a lie),
 *   4. **plan preflight** (WA-D1 핵심 — 게이트에 가기 전 명시 거부):
 *        (a) reference validity — every dimension targets a real part/body and
 *            its `refs` are in the extrude topology namespace,
 *        (b) gate measurability — a dimension on a revolve/loft/sweep body is
 *            refused up-front ("measurement not available for revolve bodies
 *            (WB backlog)") because those kinds have no NamedTopology builder,
 *            so the drawing gate could only ever fail on them,
 *        (c) empty plan / unsupported feature kind.
 *      A preflight failure is a `PlannerError` carrying the reason — the driver
 *      turns it into a stage:'plan' refusal (패키지 미산출).
 *
 * The completion function is the ONLY dependency, so tests inject a
 * deterministic mock. `chatCompletionPlanner()` is the production binding.
 *
 * File ownership (WA-D1): this file + its test only. Everything else in
 * design-driver (types/planner/fixturePlanner/designDriver/gates) is CONSUMED,
 * never modified.
 *
 * Honesty / limitations (근사 명시):
 *   - A live LLM is NOT byte-deterministic even at temperature 0; determinism
 *     is a property of the fixture/mock planner, not this one. The schema +
 *     preflight guarantee only that whatever DOES pass is a structurally valid,
 *     gate-eligible plan — correctness is still decided by the real gates.
 *   - `feature` payloads are validated per-kind (exact field shapes for
 *     extrude/revolve/sweep/sweep_path/loft, matching src/lib/cad/*.ts
 *     verbatim) so a malformed feature is a clean `stage:'plan'` PlannerError,
 *     not a raw crash inside `featureToPolyhedron` at the mesh stage.
 */

import { chatCompletion, type ChatMessage } from '@/lib/ai';
import { PlannerError, type DesignPlanner } from './planner';
import type {
  DesignBrief,
  DesignPlan,
  ExpectedVolumeSpec,
  PlanAssembly,
  PlanBody,
  PlanDimensionSpec,
  PlanDrawing,
  PlanPart,
  SheetMetalOp,
  SheetMetalSpec,
  WeldmentSegment,
  WeldmentSpec,
  FastenerSpec,
  PatternSpec,
  CurvedSpec,
  HoleSpec,
  VolumeTerm,
  VolumeDecomposition,
  DimensionDerivation,
} from './types';
import {
  retrieveReferenceParts,
  formatReferencePartsBlock,
} from '@/lib/ai/reference/retrieveReferenceParts';
import { buildExtrudeTopo, type NamedTopology } from '@/lib/cad/topoNaming';
import { viewBasis } from '@/lib/drawing/projectView';
import {
  UNMEASURABLE_EPS, WORLD_AXES, gapAlong, refPoints, viewsShowing,
} from './refGeometry';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── revision context (proposed optional brief extension — hook only) ───────

/**
 * A reviewer's change request, carried into the planner on a re-run. WA-D2
 * wires PDM's `RevisionDirective` to this shape; WA-D1 only provides the
 * injection hook. `comments` accepts bare strings or `{ note, featureId? }`
 * (the PDM `ReviewComment` shape) so the two sides can meet without a type
 * import.
 *
 * NOTE (proposed schema addition, not applied here — types.ts is not owned by
 * this track): `DesignBrief` could gain an optional `revision?: RevisionContext`.
 * Until then this planner reads it off the brief defensively via `LlmDesignBrief`.
 */
export interface RevisionContext {
  briefSummary?: string;
  comments: Array<string | { note: string; featureId?: string }>;
  /** Gate ids that blocked approval on the reviewed run — must re-pass. */
  failedGates?: string[];
}

/** `DesignBrief` plus the (optional) revision hook this planner understands. */
export interface LlmDesignBrief extends DesignBrief {
  revision?: RevisionContext;
}

// ─── deps ────────────────────────────────────────────────────────────────

export interface LlmPlannerDeps {
  /** Injected completion — brief messages in, raw model text out. The ONLY
   *  external dependency, so tests pass a deterministic mock. */
  complete: (messages: ChatMessage[]) => Promise<string>;
  /** Planner identity (WA-E hooks). Default 'llm'. */
  name?: string;
  /** Override the system prompt (default = DEFAULT_SYSTEM_PROMPT). */
  systemPrompt?: string;
}

// ─── schema constants ──────────────────────────────────────────────────────

/** Feature kinds `featureToPolyhedron` can mesh (src/lib/cad/featureMesh). */
const MESHABLE_KINDS = new Set(['extrude', 'revolve', 'sweep', 'sweep_path', 'loft']);
const DIMENSION_KINDS = new Set(['linear', 'aligned', 'radial', 'diametric', 'angular']);
const DIMENSION_VIEWS = new Set(['front', 'top', 'right']);
const DFM_PROCESSES = new Set(['fdm', 'sla', 'cnc', 'injection', 'sheetMetal']);

/**
 * Grammar of a valid extrude-topology stable name (src/lib/cad/topoNaming):
 *   faces: f.cap.top | f.cap.bottom | f.side.{i}
 *   edges: e.vert.{i} | e.top.{i}-{j} | e.bottom.{i}-{j}
 * A dimension `ref` outside this grammar can never resolve → preflight refuses.
 */
const EXTRUDE_TOPO_NAME = /^(f\.cap\.(top|bottom)|f\.side\.\d+|e\.vert\.\d+|e\.(top|bottom)\.\d+-\d+)$/;
/** WB-1 — revolve measure topology: circular cross-section face at off-axis
 *  profile vertex i (buildRevolveMeasureTopo). ⌀/R on the axis-normal view,
 *  axial length between two rims on an axis-parallel view. */
const REVOLVE_TOPO_NAME = /^f\.lat\.\d+$/;

// ─── coercion primitives (violation ⇒ PlannerError) ────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function reqStr(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new PlannerError(`${path}: expected a non-empty string`);
  }
  return v;
}

function reqNum(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new PlannerError(`${path}: expected a finite number`);
  }
  return v;
}

function optNum(v: unknown, path: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  return reqNum(v, path);
}

function reqObj(v: unknown, path: string): Record<string, unknown> {
  if (!isObj(v)) throw new PlannerError(`${path}: expected an object`);
  return v;
}

function reqArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new PlannerError(`${path}: expected an array`);
  return v;
}

// ─── coercion: DesignPlan (drops unknown fields; type-checks required) ──────

const EXTRUDE_DIRECTIONS = new Set(['one_sided', 'two_sided', 'midplane']);
const FEATURE_MODES = new Set(['add', 'cut']);

function coercePoint2D(v: unknown, path: string): { x: number; y: number } {
  const o = reqObj(v, path);
  return { x: reqNum(o.x, `${path}.x`), y: reqNum(o.y, `${path}.y`) };
}

function coercePoint3D(v: unknown, path: string): { x: number; y: number; z: number } {
  const o = reqObj(v, path);
  return { x: reqNum(o.x, `${path}.x`), y: reqNum(o.y, `${path}.y`), z: reqNum(o.z, `${path}.z`) };
}

function coerceLoop2D(v: unknown, path: string): Array<{ x: number; y: number }> {
  const arr = reqArray(v, path);
  if (arr.length < 3) throw new PlannerError(`${path}: expected a closed loop with >= 3 points, got ${arr.length}`);
  return arr.map((p, i) => coercePoint2D(p, `${path}[${i}]`));
}

function coercePath3D(v: unknown, path: string): Array<{ x: number; y: number; z: number }> {
  const arr = reqArray(v, path);
  if (arr.length < 2) throw new PlannerError(`${path}: expected >= 2 points, got ${arr.length}`);
  return arr.map((p, i) => coercePoint3D(p, `${path}[${i}]`));
}

function coerceProfile2D(v: unknown, path: string): { points: Array<{ x: number; y: number }> } {
  const o = reqObj(v, path);
  return { points: coerceLoop2D(o.points, `${path}.points`) };
}

function coerceFeatureMode(v: unknown, path: string): 'add' | 'cut' {
  const mode = v === undefined ? 'add' : reqStr(v, path);
  if (!FEATURE_MODES.has(mode)) throw new PlannerError(`${path}: must be 'add' or 'cut', got '${mode}'`);
  return mode as 'add' | 'cut';
}

/**
 * Kind-specific structural validation for the 5 meshable feature shapes. This
 * closes a real gap (WA-D dogfooding, 260723): the model would emit a
 * plausible-looking-but-wrong shape (e.g. a rectangle/box shorthand instead of
 * an explicit point loop) that passed the old kind-only check and then crashed
 * deep inside `featureToPolyhedron` with a raw, unhelpful error ("loop is not
 * iterable") at the geometry-mesh stage — not the clean, actionable
 * `stage:'plan'` refusal the honesty contract promises. Validating the exact
 * field shapes here (matching src/lib/cad/{extrudeProfile,revolveProfile,
 * sweepLoft,sweepPath}.ts verbatim) turns a malformed feature into a
 * PlannerError with a precise reason, at the earliest possible point.
 */
function coerceFeature(v: unknown, path: string): PlanBody['feature'] {
  const o = reqObj(v, path);
  const kind = reqStr(o.kind, `${path}.kind`);
  if (!MESHABLE_KINDS.has(kind)) {
    throw new PlannerError(
      `${path}.kind='${kind}' is not a meshable feature (supported: ${[...MESHABLE_KINDS].join(', ')})`,
    );
  }
  if (kind === 'extrude') {
    const loop = coerceLoop2D(o.loop, `${path}.loop`);
    const depth = reqNum(o.depth, `${path}.depth`);
    if (depth <= 0) throw new PlannerError(`${path}.depth: must be positive, got ${depth}`);
    const direction = o.direction === undefined ? 'one_sided' : reqStr(o.direction, `${path}.direction`);
    if (!EXTRUDE_DIRECTIONS.has(direction)) {
      throw new PlannerError(`${path}.direction: must be one of ${[...EXTRUDE_DIRECTIONS].join('|')}, got '${direction}'`);
    }
    const mode = coerceFeatureMode(o.mode, `${path}.mode`);
    return { kind: 'extrude', loop, depth, direction, mode } as unknown as PlanBody['feature'];
  }
  if (kind === 'revolve') {
    const loop = coerceLoop2D(o.loop, `${path}.loop`);
    const angleDegrees = reqNum(o.angleDegrees, `${path}.angleDegrees`);
    const mode = coerceFeatureMode(o.mode, `${path}.mode`);
    return { kind: 'revolve', loop, angleDegrees, mode } as unknown as PlanBody['feature'];
  }
  if (kind === 'sweep') {
    const profile = coerceProfile2D(o.profile, `${path}.profile`);
    const sweepPath = coercePath3D(o.path, `${path}.path`);
    const mode = coerceFeatureMode(o.mode, `${path}.mode`);
    return { kind: 'sweep', profile, path: sweepPath, mode } as unknown as PlanBody['feature'];
  }
  if (kind === 'sweep_path') {
    const profile = coerceLoop2D(o.profile, `${path}.profile`);
    const sweepPath = coercePath3D(o.path, `${path}.path`);
    return { kind: 'sweep_path', profile, path: sweepPath } as unknown as PlanBody['feature'];
  }
  // kind === 'loft' (the only remaining MESHABLE_KINDS member)
  const sectionsArr = reqArray(o.sections, `${path}.sections`);
  if (sectionsArr.length < 2) throw new PlannerError(`${path}.sections: loft needs >= 2 sections, got ${sectionsArr.length}`);
  const sections = sectionsArr.map((s, i) => {
    const so = reqObj(s, `${path}.sections[${i}]`);
    return {
      profile: coerceProfile2D(so.profile, `${path}.sections[${i}].profile`),
      z: reqNum(so.z, `${path}.sections[${i}].z`),
    };
  });
  const mode = coerceFeatureMode(o.mode, `${path}.mode`);
  return { kind: 'loft', sections, mode } as unknown as PlanBody['feature'];
}

function coerceTranslate(v: unknown, path: string): PlanBody['translate'] {
  if (v === undefined || v === null) return undefined;
  const o = reqObj(v, path);
  return { x: reqNum(o.x, `${path}.x`), y: reqNum(o.y, `${path}.y`), z: reqNum(o.z, `${path}.z`) };
}

function coerceBody(v: unknown, path: string): PlanBody {
  const o = reqObj(v, path);
  const body: PlanBody = {
    bodyId: reqStr(o.bodyId, `${path}.bodyId`),
    feature: coerceFeature(o.feature, `${path}.feature`),
  };
  const translate = coerceTranslate(o.translate, `${path}.translate`);
  if (translate) body.translate = translate;
  return body;
}

const VOLUME_TERM_SHAPES = new Set(['rect', 'circle', 'triangle']);

function coerceVolumeTerm(v: unknown, path: string): VolumeTerm {
  const o = reqObj(v, path);
  const shape = reqStr(o.shape, `${path}.shape`);
  if (!VOLUME_TERM_SHAPES.has(shape)) {
    throw new PlannerError(`${path}.shape='${shape}' invalid (rect|circle|triangle)`);
  }
  const sign = optNum(o.sign, `${path}.sign`);
  if (sign !== undefined && sign !== 1 && sign !== -1) {
    throw new PlannerError(`${path}.sign=${sign} invalid (1|-1)`);
  }
  const signPart = sign === -1 ? ({ sign: -1 } as const) : ({} as const);
  if (shape === 'rect') {
    return { shape: 'rect', widthMm: reqNum(o.widthMm, `${path}.widthMm`), heightMm: reqNum(o.heightMm, `${path}.heightMm`), ...signPart };
  }
  if (shape === 'circle') {
    return { shape: 'circle', diameterMm: reqNum(o.diameterMm, `${path}.diameterMm`), ...signPart };
  }
  return { shape: 'triangle', baseMm: reqNum(o.baseMm, `${path}.baseMm`), heightMm: reqNum(o.heightMm, `${path}.heightMm`), ...signPart };
}

function coerceVolumeDecomposition(v: unknown, path: string): VolumeDecomposition {
  const o = reqObj(v, path);
  const terms = reqArray(o.terms, `${path}.terms`);
  if (terms.length === 0) throw new PlannerError(`${path}.terms is empty`);
  return {
    terms: terms.map((t, i) => coerceVolumeTerm(t, `${path}.terms[${i}]`)),
    depthMm: reqNum(o.depthMm, `${path}.depthMm`),
  };
}

function coerceExpectedVolume(v: unknown, path: string): ExpectedVolumeSpec {
  const o = reqObj(v, path);
  const spec: ExpectedVolumeSpec = {
    // basis is REQUIRED by the honesty invariant (types.ts): a theoretical
    // volume with no stated derivation is not accepted.
    basis: reqStr(o.basis, `${path}.basis`),
  };
  if (o.decomposition !== undefined && o.decomposition !== null) {
    spec.decomposition = coerceVolumeDecomposition(o.decomposition, `${path}.decomposition`);
  }
  // valueMm3 는 decomposition 이 있을 때만 생략 가능하다 — 근거가 둘 다 없는 이론 부피는
  // 받지 않는다(생성≠검증). 있으면 게이트가 분해와 교차검사해 산술 오류를 따로 보고한다.
  if (o.valueMm3 !== undefined && o.valueMm3 !== null) {
    spec.valueMm3 = reqNum(o.valueMm3, `${path}.valueMm3`);
  } else if (!spec.decomposition) {
    throw new PlannerError(`${path} needs valueMm3 or decomposition`);
  }
  const tolRel = optNum(o.tolRel, `${path}.tolRel`);
  if (tolRel !== undefined) spec.tolRel = tolRel;
  return spec;
}

const SHEET_METAL_OP_KINDS = new Set(['bend', 'flange']);

function coerceSheetMetalOp(v: unknown, path: string): SheetMetalOp {
  const o = reqObj(v, path);
  const kind = reqStr(o.kind, `${path}.kind`);
  if (!SHEET_METAL_OP_KINDS.has(kind)) {
    throw new PlannerError(`${path}.kind='${kind}' invalid (bend|flange)`);
  }
  const op: SheetMetalOp = {
    kind: kind as SheetMetalOp['kind'],
    angle: reqNum(o.angle, `${path}.angle`),
    radius: reqNum(o.radius, `${path}.radius`),
  };
  const position = optNum(o.position, `${path}.position`);
  if (position !== undefined) op.position = position;
  const edgeIndex = optNum(o.edgeIndex, `${path}.edgeIndex`);
  if (edgeIndex !== undefined) op.edgeIndex = edgeIndex;
  const height = optNum(o.height, `${path}.height`);
  if (height !== undefined) op.height = height;
  if (o.direction !== undefined) {
    const dir = reqStr(o.direction, `${path}.direction`);
    if (dir !== 'up' && dir !== 'down') throw new PlannerError(`${path}.direction='${dir}' invalid (up|down)`);
    op.direction = dir;
  }
  return op;
}

function coerceSheetMetal(v: unknown, path: string): SheetMetalSpec {
  const o = reqObj(v, path);
  const opsRaw = reqArray(o.ops, `${path}.ops`);
  const spec: SheetMetalSpec = {
    thicknessMm: reqNum(o.thicknessMm, `${path}.thicknessMm`),
    baseWidthMm: reqNum(o.baseWidthMm, `${path}.baseWidthMm`),
    baseLengthMm: reqNum(o.baseLengthMm, `${path}.baseLengthMm`),
    ops: opsRaw.map((op, i) => coerceSheetMetalOp(op, `${path}.ops[${i}]`)),
  };
  if (o.material !== undefined) spec.material = reqStr(o.material, `${path}.material`);
  const expected = optNum(o.expectedDevelopedLengthMm, `${path}.expectedDevelopedLengthMm`);
  if (expected !== undefined) spec.expectedDevelopedLengthMm = expected;
  const devTol = optNum(o.devTolMm, `${path}.devTolMm`);
  if (devTol !== undefined) spec.devTolMm = devTol;
  return spec;
}

function coerceVec3(v: unknown, path: string): [number, number, number] {
  const arr = reqArray(v, path);
  if (arr.length !== 3) throw new PlannerError(`${path}: expected [x,y,z]`);
  return [reqNum(arr[0], `${path}[0]`), reqNum(arr[1], `${path}[1]`), reqNum(arr[2], `${path}[2]`)];
}

function coerceWeldmentSegment(v: unknown, path: string): WeldmentSegment {
  const o = reqObj(v, path);
  return { start: coerceVec3(o.start, `${path}.start`), end: coerceVec3(o.end, `${path}.end`) };
}

function coerceWeldment(v: unknown, path: string): WeldmentSpec {
  const o = reqObj(v, path);
  const segsRaw = reqArray(o.segments, `${path}.segments`);
  if (segsRaw.length === 0) throw new PlannerError(`${path}.segments: at least one member required`);
  const spec: WeldmentSpec = {
    sectionType: reqNum(o.sectionType, `${path}.sectionType`),
    sizeMm: reqNum(o.sizeMm, `${path}.sizeMm`),
    thicknessMm: reqNum(o.thicknessMm, `${path}.thicknessMm`),
    segments: segsRaw.map((s, i) => coerceWeldmentSegment(s, `${path}.segments[${i}]`)),
  };
  if (o.material !== undefined) spec.material = reqStr(o.material, `${path}.material`);
  if (o.miter !== undefined) {
    if (typeof o.miter !== 'boolean') throw new PlannerError(`${path}.miter: expected a boolean`);
    spec.miter = o.miter;
  }
  const expected = optNum(o.expectedTotalStockMm, `${path}.expectedTotalStockMm`);
  if (expected !== undefined) spec.expectedTotalStockMm = expected;
  const tol = optNum(o.stockTolMm, `${path}.stockTolMm`);
  if (tol !== undefined) spec.stockTolMm = tol;
  return spec;
}

const FASTENER_TYPES = new Set(['external', 'internal']);
const FASTENER_MATE = new Set(['steel', 'castIron', 'aluminum', 'brass']);

function coerceFastener(v: unknown, path: string): FastenerSpec {
  const o = reqObj(v, path);
  const type = reqStr(o.type, `${path}.type`);
  if (!FASTENER_TYPES.has(type)) throw new PlannerError(`${path}.type='${type}' invalid (external|internal)`);
  const spec: FastenerSpec = {
    id: reqStr(o.id, `${path}.id`),
    nominalDiameterMm: reqNum(o.nominalDiameterMm, `${path}.nominalDiameterMm`),
    type: type as FastenerSpec['type'],
    engagementMm: reqNum(o.engagementMm, `${path}.engagementMm`),
  };
  const pitch = optNum(o.pitchMm, `${path}.pitchMm`);
  if (pitch !== undefined) spec.pitchMm = pitch;
  if (o.mateMaterial !== undefined) {
    const mate = reqStr(o.mateMaterial, `${path}.mateMaterial`);
    if (!FASTENER_MATE.has(mate)) throw new PlannerError(`${path}.mateMaterial='${mate}' invalid (${[...FASTENER_MATE].join('|')})`);
    spec.mateMaterial = mate as FastenerSpec['mateMaterial'];
  }
  if (o.fit !== undefined) spec.fit = reqStr(o.fit, `${path}.fit`);
  if (o.grade !== undefined) spec.grade = reqStr(o.grade, `${path}.grade`);
  return spec;
}

const PATTERN_KINDS = new Set(['linear', 'circular']);

function coercePattern(v: unknown, path: string): PatternSpec {
  const o = reqObj(v, path);
  const kind = reqStr(o.kind, `${path}.kind`);
  if (!PATTERN_KINDS.has(kind)) throw new PlannerError(`${path}.kind='${kind}' invalid (linear|circular)`);
  const spec: PatternSpec = {
    id: reqStr(o.id, `${path}.id`),
    kind: kind as PatternSpec['kind'],
    count: reqNum(o.count, `${path}.count`),
  };
  const pitch = optNum(o.pitchMm, `${path}.pitchMm`);
  if (pitch !== undefined) spec.pitchMm = pitch;
  if (o.axis !== undefined) spec.axis = coerceVec3(o.axis, `${path}.axis`);
  const angle = optNum(o.angleDeg, `${path}.angleDeg`);
  if (angle !== undefined) spec.angleDeg = angle;
  const radius = optNum(o.radiusMm, `${path}.radiusMm`);
  if (radius !== undefined) spec.radiusMm = radius;
  const seed = optNum(o.seedSizeMm, `${path}.seedSizeMm`);
  if (seed !== undefined) spec.seedSizeMm = seed;
  if (o.gear !== undefined && o.gear !== null) {
    const g = reqObj(o.gear, `${path}.gear`);
    spec.gear = { moduleMm: reqNum(g.moduleMm, `${path}.gear.moduleMm`), teeth: reqNum(g.teeth, `${path}.gear.teeth`) };
  }
  const expected = optNum(o.expectedInstances, `${path}.expectedInstances`);
  if (expected !== undefined) spec.expectedInstances = expected;
  return spec;
}

const CURVED_KINDS = new Set(['fillet', 'shell']);

function coerceCurved(v: unknown, path: string): CurvedSpec {
  const o = reqObj(v, path);
  const kind = reqStr(o.kind, `${path}.kind`);
  if (!CURVED_KINDS.has(kind)) throw new PlannerError(`${path}.kind='${kind}' invalid (fillet|shell)`);
  const spec: CurvedSpec = { kind: kind as CurvedSpec['kind'] };
  const radius = optNum(o.radiusMm, `${path}.radiusMm`);
  if (radius !== undefined) spec.radiusMm = radius;
  const wall = optNum(o.wallMm, `${path}.wallMm`);
  if (wall !== undefined) spec.wallMm = wall;
  if (o.edges !== undefined) {
    const eRaw = reqArray(o.edges, `${path}.edges`);
    spec.edges = eRaw.map((e, i) => reqStr(e, `${path}.edges[${i}]`));
  }
  const expected = optNum(o.expectedVolumeMm3, `${path}.expectedVolumeMm3`);
  if (expected !== undefined) spec.expectedVolumeMm3 = expected;
  const tol = optNum(o.tolRel, `${path}.tolRel`);
  if (tol !== undefined) spec.tolRel = tol;
  return spec;
}

function coerceHole(v: unknown, path: string): HoleSpec {
  const o = reqObj(v, path);
  const at = reqObj(o.at, `${path}.at`);
  const spec: HoleSpec = {
    id: reqStr(o.id, `${path}.id`),
    at: { x: reqNum(at.x, `${path}.at.x`), y: reqNum(at.y, `${path}.at.y`) },
  };
  const shape = o.shape === undefined ? 'round' : reqStr(o.shape, `${path}.shape`);
  if (shape !== 'round' && shape !== 'rect') {
    throw new PlannerError(`${path}.shape='${shape}' invalid (round|rect)`);
  }
  if (shape === 'rect') {
    spec.shape = 'rect';
    spec.widthMm = reqNum(o.widthMm, `${path}.widthMm`);
    spec.heightMm = reqNum(o.heightMm, `${path}.heightMm`);
  } else {
    spec.diameterMm = reqNum(o.diameterMm, `${path}.diameterMm`);
  }
  if (o.kind !== undefined) {
    const kind = reqStr(o.kind, `${path}.kind`);
    if (kind !== 'through' && kind !== 'blind') {
      throw new PlannerError(`${path}.kind='${kind}' invalid (through|blind)`);
    }
    spec.kind = kind;
  }
  const depth = optNum(o.depthMm, `${path}.depthMm`);
  if (depth !== undefined) spec.depthMm = depth;
  const seg = optNum(o.segments, `${path}.segments`);
  if (seg !== undefined) spec.segments = seg;
  return spec;
}

function coercePart(v: unknown, path: string): PlanPart {
  const o = reqObj(v, path);
  const bodiesRaw = reqArray(o.bodies, `${path}.bodies`);
  if (bodiesRaw.length === 0) throw new PlannerError(`${path}.bodies: at least one body required`);
  const part: PlanPart = {
    partId: reqStr(o.partId, `${path}.partId`),
    name: reqStr(o.name, `${path}.name`),
    bodies: bodiesRaw.map((b, i) => coerceBody(b, `${path}.bodies[${i}]`)),
  };
  const qty = optNum(o.qty, `${path}.qty`);
  if (qty !== undefined) part.qty = qty;
  if (o.material !== undefined) part.material = reqStr(o.material, `${path}.material`);
  if (o.process !== undefined) {
    const proc = reqStr(o.process, `${path}.process`);
    if (!DFM_PROCESSES.has(proc)) {
      throw new PlannerError(`${path}.process='${proc}' unsupported (${[...DFM_PROCESSES].join(', ')})`);
    }
    part.process = proc as PlanPart['process'];
  }
  if (o.expectedVolume !== undefined && o.expectedVolume !== null) {
    part.expectedVolume = coerceExpectedVolume(o.expectedVolume, `${path}.expectedVolume`);
  }
  if (o.sheetMetal !== undefined && o.sheetMetal !== null) {
    part.sheetMetal = coerceSheetMetal(o.sheetMetal, `${path}.sheetMetal`);
  }
  if (o.weldment !== undefined && o.weldment !== null) {
    part.weldment = coerceWeldment(o.weldment, `${path}.weldment`);
  }
  if (o.fasteners !== undefined && o.fasteners !== null) {
    const fRaw = reqArray(o.fasteners, `${path}.fasteners`);
    part.fasteners = fRaw.map((f, i) => coerceFastener(f, `${path}.fasteners[${i}]`));
  }
  if (o.patterns !== undefined && o.patterns !== null) {
    const pRaw = reqArray(o.patterns, `${path}.patterns`);
    part.patterns = pRaw.map((p, i) => coercePattern(p, `${path}.patterns[${i}]`));
  }
  if (o.curved !== undefined && o.curved !== null) {
    part.curved = coerceCurved(o.curved, `${path}.curved`);
  }
  if (o.holes !== undefined && o.holes !== null) {
    const hRaw = reqArray(o.holes, `${path}.holes`);
    part.holes = hRaw.map((h, i) => coerceHole(h, `${path}.holes[${i}]`));
  }
  return part;
}

const DERIVATION_KINDS = new Set(['hypotenuse', 'sum', 'difference']);

/** `expected` 의 파라메트릭 유도 — 산술은 엔진이 한다(260728, §6-1 의 치수 판). */
function coerceDimensionDerivation(v: unknown, path: string): DimensionDerivation {
  const o = reqObj(v, path);
  const kind = reqStr(o.kind, `${path}.kind`);
  if (!DERIVATION_KINDS.has(kind)) {
    throw new PlannerError(`${path}.kind='${kind}' invalid (hypotenuse|sum|difference)`);
  }
  if (kind === 'hypotenuse') {
    return { kind: 'hypotenuse', legAMm: reqNum(o.legAMm, `${path}.legAMm`), legBMm: reqNum(o.legBMm, `${path}.legBMm`) };
  }
  if (kind === 'sum') {
    const terms = reqArray(o.termsMm, `${path}.termsMm`);
    if (terms.length === 0) throw new PlannerError(`${path}.termsMm is empty`);
    return { kind: 'sum', termsMm: terms.map((t, i) => reqNum(t, `${path}.termsMm[${i}]`)) };
  }
  const minus = reqArray(o.minusMm, `${path}.minusMm`);
  if (minus.length === 0) throw new PlannerError(`${path}.minusMm is empty`);
  return { kind: 'difference', fromMm: reqNum(o.fromMm, `${path}.fromMm`), minusMm: minus.map((t, i) => reqNum(t, `${path}.minusMm[${i}]`)) };
}

function coerceDimension(v: unknown, path: string): PlanDimensionSpec {
  const o = reqObj(v, path);
  const view = reqStr(o.view, `${path}.view`);
  if (!DIMENSION_VIEWS.has(view)) {
    throw new PlannerError(`${path}.view='${view}' invalid (front|top|right)`);
  }
  const kind = reqStr(o.kind, `${path}.kind`);
  if (!DIMENSION_KINDS.has(kind)) {
    throw new PlannerError(`${path}.kind='${kind}' invalid (${[...DIMENSION_KINDS].join(', ')})`);
  }
  const refsRaw = reqArray(o.refs, `${path}.refs`);
  if (refsRaw.length === 0) throw new PlannerError(`${path}.refs: at least one ref required`);
  const dim: PlanDimensionSpec = {
    id: reqStr(o.id, `${path}.id`),
    partId: reqStr(o.partId, `${path}.partId`),
    bodyId: reqStr(o.bodyId, `${path}.bodyId`),
    view: view as PlanDimensionSpec['view'],
    kind: kind as PlanDimensionSpec['kind'],
    refs: refsRaw.map((r, i) => reqStr(r, `${path}.refs[${i}]`)),
  };
  if (o.axis !== undefined) {
    const axis = reqStr(o.axis, `${path}.axis`);
    if (axis !== 'x' && axis !== 'y') throw new PlannerError(`${path}.axis='${axis}' invalid (x|y)`);
    if (kind !== 'linear') throw new PlannerError(`${path}.axis is linear-only (kind='${kind}')`);
    dim.axis = axis;
  }
  if (o.expectedFrom !== undefined && o.expectedFrom !== null) {
    dim.expectedFrom = coerceDimensionDerivation(o.expectedFrom, `${path}.expectedFrom`);
  }
  const expected = optNum(o.expected, `${path}.expected`);
  if (expected !== undefined) dim.expected = expected;
  // tolerance is an opaque passthrough (drawing.dimension owns its schema).
  if (isObj(o.tolerance)) dim.tolerance = o.tolerance as PlanDimensionSpec['tolerance'];
  return dim;
}

function coerceDrawing(v: unknown, path: string): PlanDrawing {
  const o = reqObj(v, path);
  const dimsRaw = reqArray(o.dimensions, `${path}.dimensions`);
  const drawing: PlanDrawing = {
    dimensions: dimsRaw.map((d, i) => coerceDimension(d, `${path}.dimensions[${i}]`)),
  };
  if (o.paperSize !== undefined) drawing.paperSize = reqStr(o.paperSize, `${path}.paperSize`) as PlanDrawing['paperSize'];
  const scale = optNum(o.scale, `${path}.scale`);
  if (scale !== undefined) drawing.scale = scale;
  return drawing;
}

function coerceAssembly(v: unknown, path: string): PlanAssembly {
  const o = reqObj(v, path);
  const partsRaw = reqArray(o.parts, `${path}.parts`);
  const matesRaw = reqArray(o.mates, `${path}.mates`);
  // Assembly part/mate specs are consumed verbatim by solveMates, which
  // validates their internals; we require the array-of-objects skeleton and
  // pass through. Convergence is decided by the assembly gate.
  partsRaw.forEach((p, i) => reqObj(p, `${path}.parts[${i}]`));
  matesRaw.forEach((m, i) => reqObj(m, `${path}.mates[${i}]`));
  const asm: PlanAssembly = {
    parts: partsRaw as PlanAssembly['parts'],
    mates: matesRaw as PlanAssembly['mates'],
  };
  const tol = optNum(o.tolerance, `${path}.tolerance`);
  if (tol !== undefined) asm.tolerance = tol;
  if (o.engine !== undefined) {
    const engine = reqStr(o.engine, `${path}.engine`);
    if (engine !== 'gauss-seidel' && engine !== 'newton') {
      throw new PlannerError(`${path}.engine='${engine}' invalid (gauss-seidel|newton)`);
    }
    asm.engine = engine;
  }
  return asm;
}

/** Coerce arbitrary parsed JSON into a DesignPlan, or throw PlannerError. */
export function coerceDesignPlan(v: unknown): DesignPlan {
  const o = reqObj(v, 'plan');
  const partsRaw = reqArray(o.parts, 'plan.parts');
  if (partsRaw.length === 0) throw new PlannerError('plan.parts: at least one part required');
  /**
   * `drawing` 오배치 수리 (260728).
   *
   * 실측: 실 LLM 이 `drawing` 을 plan 형제가 아니라 **parts[i] 안에** 넣는 실수를 반복한다.
   * 벤치 v1(12브리프 × 3회 = 36샘플)에서 **8/36 (22%)** 이 이것 하나로 죽었고, 이제 단일
   * 최대 실패 원인이다(b-10 은 3회 전부). 프롬프트로 고치려 시도했으나 18샘플 A/B 에서
   * **효과가 없었다**(1/18 → 3/18) — 그래서 문구는 되돌렸다.
   *
   * 그래서 구조만 수리한다. 이것이 정당한 이유는 하나다: **어떤 검사도 약해지지 않는다.**
   * 옮겨진 dimensions 는 원래 자리에 있었을 때와 똑같이 drawing 게이트에서 실측되고,
   * 값은 하나도 만들어지거나 바뀌지 않는다. §6-1 에서 배격한 자기참조와 결정적으로 다르다 —
   * 그쪽은 검사 자체를 항등식으로 만들었고, 이쪽은 이미 있는 검사에 도달하게만 한다.
   *
   * 안전장치:
   *  · `plan.drawing` 이 이미 있으면 손대지 않는다(모델의 의도를 덮어쓰지 않는다).
   *  · drawing 을 든 part 가 **둘 이상이면 수리하지 않고 거부한다** — 어느 것이 도면인지
   *    추측하는 순간 이건 날조가 된다.
   *  · 어디에도 없으면 종전대로 거부한다(없는 도면을 만들어주지 않는다).
   *  · 수리 사실은 `plan.repairs` 에 남는다 — 조용히 고치지 않는다.
   */
  const repairs: string[] = [];
  let drawingRaw = o.drawing;
  if (drawingRaw === undefined || drawingRaw === null) {
    const carriers = partsRaw
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => typeof p === 'object' && p !== null && (p as Record<string, unknown>).drawing != null);
    if (carriers.length > 1) {
      throw new PlannerError(
        `plan.drawing is missing and ${carriers.length} parts carry a 'drawing' ` +
          `(indices ${carriers.map((c) => c.i).join(', ')}) — cannot tell which one is the sheet. ` +
          `'drawing' is a SIBLING of 'parts' at the plan root; put exactly one there.`,
      );
    }
    if (carriers.length === 1) {
      const { p, i } = carriers[0]!;
      drawingRaw = (p as Record<string, unknown>).drawing;
      repairs.push(
        `plan.parts[${i}].drawing was moved to plan.drawing — 'drawing' is a sibling of 'parts', ` +
          `not a member of a part. Content unchanged; every dimension is still measured by the drawing gate.`,
      );
    }
  }
  const plan: DesignPlan = {
    planId: reqStr(o.planId, 'plan.planId'),
    name: reqStr(o.name, 'plan.name'),
    parts: partsRaw.map((p, i) => coercePart(p, `plan.parts[${i}]`)),
    drawing: coerceDrawing(drawingRaw, 'plan.drawing'),
    ...(repairs.length ? { repairs } : {}),
  };
  if (o.assembly !== undefined && o.assembly !== null) {
    plan.assembly = coerceAssembly(o.assembly, 'plan.assembly');
  }
  return plan;
}

// ─── plan preflight (게이트 전 명시 거부) ────────────────────────────────────


// ─── (c) 뷰에서 잴 수 없는 치수 — 빌드 전 거부 ──────────────────────────────
//
// 260727 A-4 후속 실측: 계획이 통과한 브리프의 완주를 막는 최대 병목이 도면 치수였고,
// 실패한 계획의 refs를 덤프해 보니 **좌표계 오해가 체계적**이었다 — 모델이 loop의 Y를
// front 뷰에서 재려 하고(front는 Y를 투영으로 날린다), 두께를 두 수직 엣지 사이로 재려
// 한다(두 수직 엣지는 Z 범위가 같아 분리량이 0). 둘 다 "값이 틀린" 게 아니라 **그 뷰에서
// 구조적으로 잴 수 없는** 치수라, 게이트까지 가서 measured 0 mm로 떨어졌다.
//
// 여기서 잡으면 (1) 비싼 빌드/커널 호출 전에 끝나고 (2) 모델이 재시도할 때 "어느 뷰로
// 옮기라"는 실행 가능한 사유를 받는다. 판정은 만들지 않는다 — 측정은 여전히 게이트가
// 하고, 여기서는 "그 뷰에서 두 참조가 겹쳐 분리량이 0"이라는 기하 사실만 본다.
// 앵커는 buildExtrudeTopo(게이트가 쓰는 바로 그 토폴로지)와 viewBasis(도면이 쓰는 바로
// 그 기저)를 재사용한다 — 중복 구현 금지.
// 헬퍼는 refGeometry.ts 로 올렸다 — drawing 게이트가 같은 것을 쓴다(260728 §7-1).

/**
 * Returns a refusal reason when a 2-ref linear dimension has ZERO separation in
 * both visible axes of its view (so no distance exists to measure), else null.
 * Only extrude bodies (the topology builder we can evaluate here).
 */
function unmeasurableLinearReason(dim: PlanDimensionSpec, feature: ExtrudeFeature): string | null {
  if (dim.kind !== 'linear' || dim.refs.length !== 2) return null;
  let topo: NamedTopology;
  try { topo = buildExtrudeTopo(feature); } catch { return null; } // 빌드 불가는 게이트가 판정
  const a = refPoints(topo, dim.refs[0]);
  const b = refPoints(topo, dim.refs[1]);
  if (!a || !b || a.length === 0 || b.length === 0) return null; // 이름 유효성은 (a)에서 이미 봄

  const basis = viewBasis(dim.view as 'front' | 'top' | 'right');
  const scale = Math.max(1, ...topo.poly.vertices.map((p) => Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z)));
  const eps = UNMEASURABLE_EPS * scale;
  if (gapAlong(a, b, basis.right) > eps || gapAlong(a, b, basis.up) > eps) return null; // 잴 수 있음

  // 잴 수 없다 — 그럼 이 둘은 어느 축으로 떨어져 있나, 그 축을 보여주는 뷰는 무엇인가.
  const separated = WORLD_AXES.filter((ax) => gapAlong(a, b, ax.dir) > eps);
  const suggestion = separated.length === 0
    ? `they overlap along every world axis — pick refs that actually bound the distance (thickness/depth along Z is measured between 'f.cap.bottom' and 'f.cap.top', never between two 'e.vert.{i}' which share the same Z range)`
    : `they are separated only along world ${separated.map((s) => s.name).join('+')}; measure this in view ${[...new Set(separated.flatMap((s) => viewsShowing(s.dir)))].map((v) => `'${v}'`).join(' or ')}`;
  return (
    `dimension '${dim.id}' (linear, view '${dim.view}') cannot be measured there: its two refs ` +
    `'${dim.refs[0]}' and '${dim.refs[1]}' coincide in that view — ${suggestion}. ` +
    `View frames: front = world X(horizontal) × Z(vertical, Y projected out) · top = X × Y (Z out) · right = Y × Z (X out).`
  );
}

/** Preflight the plan for gate eligibility. Returns a refusal reason, or null. */
export function preflightPlan(plan: DesignPlan): string | null {
  if (plan.parts.length === 0) return 'empty plan: no parts';
  const partMap = new Map(plan.parts.map((p) => [p.partId, p]));

  for (const dim of plan.drawing.dimensions) {
    // (a) reference validity — the dimension must target a real part/body.
    const part = partMap.get(dim.partId);
    if (!part) return `dimension '${dim.id}' references unknown part '${dim.partId}'`;
    const body = part.bodies.find((b) => b.bodyId === dim.bodyId);
    if (!body) return `dimension '${dim.id}' references unknown body '${dim.partId}:${dim.bodyId}'`;

    // (b) gate measurability — extrude and revolve have NamedTopology builders
    // (buildExtrudeTopo / buildRevolveMeasureTopo, WB-1). loft/sweep still have
    // none, so a dimension on them could only fail — refuse up-front.
    if (body.feature.kind === 'extrude') {
      // (a cont.) every ref must be a valid extrude-topology name.
      for (const ref of dim.refs) {
        if (!EXTRUDE_TOPO_NAME.test(ref)) {
          return (
            `dimension '${dim.id}' ref '${ref}' is not a valid extrude topology name ` +
            `(namespace: f.cap.{top|bottom}, f.side.{i}, e.vert.{i}, e.{top|bottom}.{i}-{j})`
          );
        }
      }
      // (c) 그 뷰에서 구조적으로 잴 수 없는 선형 치수는 빌드 전에 거부한다.
      const unmeasurable = unmeasurableLinearReason(dim, body.feature as ExtrudeFeature);
      if (unmeasurable) return unmeasurable;
    } else if (body.feature.kind === 'revolve') {
      // Revolve dims reference circular rim faces f.lat.{i}. ⌀/R must be on the
      // axis-normal view; the drawing gate's measure refuses oblique views, so
      // an off-axis view is caught there — no ellipse fabrication.
      for (const ref of dim.refs) {
        if (!REVOLVE_TOPO_NAME.test(ref)) {
          return (
            `dimension '${dim.id}' ref '${ref}' is not a valid revolve topology name ` +
            `(namespace: f.lat.{i} — circular section at off-axis profile vertex i)`
          );
        }
      }
    } else {
      return (
        `dimension '${dim.id}' targets a ${body.feature.kind} body — ` +
        `measurement not available for ${body.feature.kind} bodies (WB backlog): ` +
        `loft/sweep have no NamedTopology builder, so the drawing gate could only fail on them`
      );
    }
  }
  return null;
}

// ─── JSON extraction (markdown-fence tolerant) ─────────────────────────────

function extractJson(raw: string): unknown {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new PlannerError('planner returned an empty response');
  }
  // Strip markdown code fences, then take the outermost brace span — mirrors
  // the proven scad-intent-from-nl extraction.
  const stripped = raw.replace(/```json?\s*/gi, '').replace(/```/g, '');
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first === -1 || last <= first) {
    throw new PlannerError('planner response contains no JSON object');
  }
  try {
    return JSON.parse(stripped.slice(first, last + 1).trim());
  } catch {
    throw new PlannerError('planner response is not valid JSON');
  }
}

// ─── message construction ──────────────────────────────────────────────────

function normalizeComment(c: string | { note: string; featureId?: string }): string {
  if (typeof c === 'string') return c;
  return c.featureId ? `[${c.featureId}] ${c.note}` : c.note;
}

function buildMessages(brief: DesignBrief, systemPrompt: string): ChatMessage[] {
  const rev = (brief as LlmDesignBrief).revision;
  let user = (brief.text ?? '').trim();
  if (brief.params && Object.keys(brief.params).length > 0) {
    user += `\n\nStructured parameters (JSON): ${JSON.stringify(brief.params)}`;
  }
  if (rev && rev.comments.length > 0) {
    const lines = rev.comments.map((c, i) => `  ${i + 1}. ${normalizeComment(c)}`).join('\n');
    user +=
      `\n\nThis is a REVISION of a previous plan` +
      (rev.briefSummary ? ` (previous: ${rev.briefSummary})` : '') +
      `. Address EVERY reviewer comment and keep everything not mentioned unchanged:\n${lines}`;
    if (rev.failedGates && rev.failedGates.length > 0) {
      user += `\nGates that failed before and MUST pass now: ${rev.failedGates.join(', ')}`;
    }
  }
  // Lever C — deterministic in-repo grounding: retrieve real reference parts of
  // similar structure/scale and inject them as CITED, NON-AUTHORITATIVE examples.
  // The coerce/preflight gate is unchanged and still decides truth, so no
  // retrieved number can become a fact.
  const refBlock = formatReferencePartsBlock(
    retrieveReferenceParts({ text: brief.text ?? '' }),
  );
  if (refBlock) user += `\n\n${refBlock}`;
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: user.length > 0 ? user : '(empty brief)' },
  ];
}

// ─── system prompt ─────────────────────────────────────────────────────────

export const DEFAULT_SYSTEM_PROMPT = `You are the planning stage of a CAD design driver. Your ONLY output is a DesignPlan as a single JSON object. You never write CAD code, geometry math, or measurements — a deterministic engine executes your plan and REAL-measures every result. Fabricated code or numbers are worthless: only a structurally valid plan that the engine can build and verify is useful.

Return ONLY the JSON object (no prose, no markdown fences). If the request cannot be expressed within the schema below, return {"error":"unsupported","reason":"<why>"} instead of guessing.

Any "Reference parts" listed under the brief are REAL but CITED, NON-AUTHORITATIVE examples of realistic structure and scale — use them only to sanity-check that your plan's proportions are plausible; NEVER copy their dimensions or feature counts into your plan as facts. The engine builds and REAL-measures every result regardless.

DesignPlan schema (unknown fields are dropped; wrong types are rejected):
{
  "planId": string,               // stable id for this plan
  "name": string,
  "parts": [                      // >= 1
    {
      "partId": string,           // unique within the plan
      "name": string,
      "qty": number?,             // BOM quantity, default 1
      "material": string?,
      "process": "cnc"|"fdm"|"sla"|"injection"|"sheetMetal"?,  // default cnc
      "bodies": [                 // >= 1; bodies[0] is the primary drawing source
        {
          "bodyId": string,       // unique within the part
          "feature": <MeshableFeature>,   // kind in: extrude|revolve|sweep|sweep_path|loft — EXACT field names below, no other shape is accepted
          "translate": {"x":number,"y":number,"z":number}?  // placement in PART frame
        }
      ],
      "expectedVolume": {         // optional; when present the geometry gate checks it
        "basis": string,          // REQUIRED: how the theory was derived, incl. any tessellation approximation
        // PREFER "decomposition": state the cross-section in the BRIEF's dimensions and
        // let the engine do the arithmetic. Then omit valueMm3 entirely — you cannot get
        // a multiplication wrong if you never do one. Terms sum with sign (default +1).
        "decomposition": {
          "terms": [ { "shape": "rect", "widthMm": number, "heightMm": number, "sign": 1|-1? }
                   | { "shape": "circle", "diameterMm": number, "sign": 1|-1? }
                   | { "shape": "triangle", "baseMm": number, "heightMm": number, "sign": 1|-1? } ],
          "depthMm": number       // extrude depth — state it, don't copy it from the feature
        }?,
        "valueMm3": number?,      // required ONLY if you give no decomposition
        "tolRel": number?
        // ⚠ GROSS, not net: if this part declares "holes", the decomposition describes the
        //   SOLID BEFORE the holes are cut. The hole gate cuts them with the real kernel and
        //   measures the net volume separately. A 60×60 square tube with a 50×50 rect bore is
        //   decomposition {rect 60×60} — NOT {rect 60×60, rect 50×50 sign:-1}.
        //   Use a sign:-1 term only for a cut you did NOT declare in "holes".
      },
      "sheetMetal": {             // optional; a SHEET-METAL part (process must be "sheetMetal")
        "thicknessMm": number,
        "material": string?,      // mildSteel|stainless304|aluminum5052|aluminum6061|galvanized|brass|copper (default mildSteel)
        "baseWidthMm": number,    // base blank width (along the bend-line axis)
        "baseLengthMm": number,   // base blank length (along the unfold axis)
        "ops": [                  // ordered forming ops on the base panel
          { "kind": "bend"|"flange",
            "angle": number, "radius": number,   // inner bend radius mm
            "position": number?,                  // bend: fraction 0-1 along unfold axis
            "direction": "up"|"down"?,            // bend fold direction
            "edgeIndex": number?,                 // flange: 0=+Z 1=-Z 2=+X 3=-X
            "height": number? }                   // flange: leg height mm
        ],
        "expectedDevelopedLengthMm": number?,     // optional independent hand-calc; gate cross-checks |measured-expected|<=devTol
        "devTolMm": number?
      }
      // When sheetMetal is present, bodies[0] should be the FLAT base-panel blank
      // (an extrude of baseWidthMm × baseLengthMm × thicknessMm) so the geometry/
      // drawing gates dimension it; the flat-pattern gate REAL-unfolds the ops.
      "weldment": {              // optional; a WELDED STRUCTURAL FRAME
        "sectionType": number,  // 0 rect-tube · 1 I-beam · 2 L-angle · 3 round-tube · 4 solid-rod
        "sizeMm": number, "thicknessMm": number,
        "material": string?,    // cut-list material designation (default SS400)
        "segments": [ { "start": [x,y,z], "end": [x,y,z] } ],  // frame member axes (mm)
        "miter": boolean?,      // bisector miters at 2-member corners (default true)
        "expectedTotalStockMm": number?,   // optional hand-calc Σ cut lengths; gate cross-checks
        "stockTolMm": number?
      }
      // When weldment is present, bodies[0] should be a representative-stock prism
      // (extrude sizeMm × sizeMm × a member length) for the geometry/drawing gates;
      // the weldment gate mitres the frame and emits the REAL cut list.
      "fasteners": [            // optional; STANDARD ISO metric threads (tapped holes / bolts)
        { "id": string,
          "nominalDiameterMm": number,  // ISO nominal (8 ⇒ M8); MUST be a standard size
          "pitchMm": number?,           // omit ⇒ ISO coarse pitch for the diameter
          "type": "internal"|"external",
          "engagementMm": number,       // thread engagement / tapped depth
          "mateMaterial": "steel"|"castIron"|"aluminum"|"brass"?,  // engagement screen (default steel)
          "fit": string?, "grade": string? }
      ]
      // Fasteners are verified against the ISO 261 pitch table + ISO 68-1 formulas;
      // a non-standard nominal or under-engaged thread FAILS the gate.
      "patterns": [            // optional; LINEAR/CIRCULAR feature patterns (layout only)
        { "id": string, "kind": "linear"|"circular", "count": number,  // count >= 2
          "pitchMm": number?,           // linear: spacing between instances
          "axis": [x,y,z]?,             // linear: direction (default +X)
          "angleDeg": number?,          // circular: total sweep (default 360)
          "radiusMm": number?,          // circular: pitch-circle radius (XZ about +Y)
          "seedSizeMm": number?,        // instance footprint for the overlap screen
          "gear": { "moduleMm": number, "teeth": number }?,  // spur-gear SIZING (involute profile NOT generated)
          "expectedInstances": number? }
      ]
      // The pattern gate verifies LAYOUT (count/spacing/non-overlap/gear pitch);
      // it does NOT generate involute teeth or a CSG union of instances.
      "curved": {              // optional; a REAL OCCT fillet on bodies[0] (must be an extrude solid)
        "kind": "fillet",      // 'shell' is declared but not yet wired (refused)
        "radiusMm": number,    // fillet inner radius
        "edges": [string]?,    // stable extrude edge names, or ["sel:all"] (default all edges)
        "expectedVolumeMm3": number?,  // optional cross-check on the real kernel volume
        "tolRel": number?
      }
      // The curved gate runs the OCCT kernel (BRepFilletAPI) and REAL-measures the
      // filleted solid volume; a radius too large for an edge FAILS the gate.
      "holes": [               // optional; ROUND THROUGH holes cut into bodies[0] (must be an extrude solid)
        { "id": string,        // unique within the part
          "shape": "round"|"rect"?,      // default "round"
          "diameterMm": number,          // round only (required when shape is round)
          "widthMm": number, "heightMm": number,  // rect only — axis-aligned cutout size (X, Y)
          "at": {"x":number,"y":number},  // centre in the SAME sketch frame as the extrude loop
          "kind": "through"|"blind"?,   // default through; blind needs depthMm
          "depthMm": number?,            // blind only — depth DOWN FROM THE TOP FACE (< thickness)
          "segments": number?  // analytic-circle recognition samples, default 64 (range 16..256)
        }
      ]
      // HOW TO MODEL A HOLE — this is the ONLY way, and getting it wrong is the single
      // most common plan failure:
      //   · A hole is NOT a body. Do NOT add a second body ("hole", "bore", "cutout")
      //     and expect it to be subtracted — bodies are SUMMED, so two overlapping
      //     bodies make the volume undefined and the geometry gate REFUSES the plan
      //     ("positive-volume AABB overlap"). Declare 'holes' on the PART instead.
      //   · bodies[0] stays the SOLID plate/block WITHOUT the holes, and
      //     'expectedVolume' (if you give one) is that solid's volume, holes NOT
      //     subtracted. The hole gate cuts them with the real kernel afterwards and
      //     measures the net volume itself — you do not have to compute it.
      //   · RECTANGULAR cutouts use shape:"rect" with widthMm/heightMm — that is how you model a
      //     SQUARE/RECT TUBE (outer profile as the extrude, the bore as one rect hole) or a window
      //     in a cover plate. The rect tool is EXACT (no tessellation), so the removed volume is
      //     exactly widthMm×heightMm×thickness.
      //     Example — 50×50 square tube, 4 mm wall, 120 long: outer loop 50×50, depth 120, plus
      //       "holes":[{"id":"bore","shape":"rect","widthMm":42,"heightMm":42,"at":{"x":25,"y":25}}]
      //     and expectedVolume = the OUTER prism 50×50×120 (the bore is cut+measured by the gate).
      //   · Slots/keyways with round ends, and any non-axis-aligned cutout, are still NOT
      //     expressible — say so in 'name'/omit rather than faking one with an extra body.
      // Example — a 120×80×10 plate with four ⌀6.5 corner holes on a 100×60 pattern:
      //   "bodies": [ { "bodyId":"b0", "feature": { "kind":"extrude",
      //       "loop":[{"x":0,"y":0},{"x":120,"y":0},{"x":120,"y":80},{"x":0,"y":80}],
      //       "depth":10, "direction":"one_sided", "mode":"add" } } ],
      //   "expectedVolume": { "basis": "brief dims: plate 120×80 × 10 thick; holes cut+measured by the hole gate",
      //                       "decomposition": { "depthMm":10, "terms":[{"shape":"rect","widthMm":120,"heightMm":80}] } },
      //   "holes": [ { "id":"h1", "diameterMm":6.5, "at":{"x":10,"y":10} },
      //              { "id":"h2", "diameterMm":6.5, "at":{"x":110,"y":10} },
      //              { "id":"h3", "diameterMm":6.5, "at":{"x":110,"y":70} },
      //              { "id":"h4", "diameterMm":6.5, "at":{"x":10,"y":70} } ]
      // The hole gate runs BRepAlgoAPI_Cut and REAL-measures the net volume; a hole
      // that removes no material (placed off the part) FAILS the gate. A BLIND hole must
      // remove exactly area×depthMm (a depth >= the thickness is REFUSED — declare through).
      // The package carries a HOLE SCHEDULE (id, size, shape, centre, depth, removed volume)
      // built from these declarations + the kernel's measurements, so the shop gets the hole
      // data as a table even though the sheet does not draw the holes yet.
      // DO NOT dimension the holes. A hole has NO topology name yet (the extrude namespace
      // covers only the outer profile), so there is nothing for a dimension to reference:
      //   · Never add a 'diametric'/'radial' dimension for a hole diameter.
      //   · Never add a 'linear' dimension for hole spacing or hole-to-edge distance.
      // The hole gate already verifies every hole with the real kernel (it cuts them and
      // measures the removed volume), so the hole IS verified — it is just not called out on
      // the sheet yet. Dimension the OUTER envelope only (W/H via e.vert pairs, thickness via
      // the cap pair). Note: 'diametric'/'radial' take EXACTLY ONE ref and are valid only on a
      // round SECTION of the body itself — e.g. a tessellated-circle extrude's 'f.cap.top' —
      // never on two e.vert picked to straddle a hole.
    }
  ],
  "assembly": {                   // optional — only for MULTI-PART designs that need positioned/mated parts
    "parts": [
      { "partId": string,          // matches a parts[].partId above
        "fixed": boolean?,         // >= 1 part MUST be fixed — the solver never moves it
        "position": {"x":number,"y":number,"z":number}?,  // default (0,0,0)
        "refs": {                  // OPTIONAL named local-frame geometry the mates below target;
                                    // every part ALSO has built-ins for free: origin, x_axis, y_axis,
                                    // z_axis, xy_plane, yz_plane, xz_plane — declare a ref only for a
                                    // feature the built-ins don't cover (an off-center hole axis, etc.)
          "<refName>": { "kind":"point", "origin":{"x":number,"y":number,"z":number} }
                     | { "kind":"axis",  "origin":{...}, "direction":{"x":number,"y":number,"z":number} }
                     | { "kind":"plane", "origin":{...}, "normal":{"x":number,"y":number,"z":number} }
        }?
      }
    ],
    "mates": [
      { "id": string, "kind": "coincident"|"concentric"|"distance"|"angle"|"parallel"|"perpendicular"|"tangent"|"hinge"|"slot"|"gear"|"rack_pinion",
        "a": {"partId":string,"refId":string}, "b": {"partId":string,"refId":string},
        "value": number?    // REQUIRED for distance (mm) / angle (deg); ignored by other kinds
      }
    ],
    "tolerance": number?,
    "engine": "gauss-seidel"|"newton"?
  },
  // Example — a pin fixed in a block's bore (concentric axis-to-axis + coincident face-to-face):
  //   "parts": [
  //     { "partId":"block", "fixed":true },
  //     { "partId":"pin",   "position":{"x":0,"y":0,"z":10},
  //       "refs": { "bore_axis": { "kind":"axis", "origin":{"x":0,"y":0,"z":0}, "direction":{"x":0,"y":0,"z":1} } } }
  //   ],
  //   "mates": [
  //     { "id":"m1", "kind":"concentric", "a":{"partId":"block","refId":"bore_axis"}, "b":{"partId":"pin","refId":"z_axis"} },
  //     { "id":"m2", "kind":"coincident",  "a":{"partId":"block","refId":"xy_plane"}, "b":{"partId":"pin","refId":"xy_plane"} }
  //   ]
  // A mate whose refs are geometrically inconsistent (e.g. mismatched axis directions) is NOT silently
  // "solved" — the engine reports a non-zero residual, and the assembly gate refuses the plan on it.
  "drawing": {
    "paperSize": string?,         // default A3
    "scale": number?,             // default 1
    "dimensions": [
      {
        "id": string,
        "partId": string, "bodyId": string,   // MUST reference an existing part/body
        "view": "front"|"top"|"right",
        "kind": "linear"|"aligned"|"radial"|"diametric"|"angular",
        "axis": "x"|"y"?,        // linear only — force the horizontal(x)/vertical(y) COMPONENT
        "refs": [string],         // stable topology names (see rules)
        // PREFER "expectedFrom" when the nominal needs ARITHMETIC — the engine computes it,
        // so you cannot get it wrong. Terms come from the BRIEF, never from the geometry.
        //   { "kind":"hypotenuse", "legAMm":number, "legBMm":number }   √(a²+b²) — a slant's TRUE length
        //   { "kind":"sum",        "termsMm":[number,...] }             a chain of segments
        //   { "kind":"difference", "fromMm":number, "minusMm":[number,...] }  outer minus walls
        // Then omit "expected" entirely. Worked example — a shim 120 long, 40 tall at one end and
        // 15 at the other: the sloping edge's aligned length is NOT 120 and NOT 125; declare
        //   "kind":"aligned", "expectedFrom":{"kind":"hypotenuse","legAMm":120,"legBMm":25}
        // and the engine computes 122.576. (25 = 40 − 15, the rise.)
        "expectedFrom": object?,
        "expected": number?,      // nominal from the brief; gate checks |measured-expected| <= 1e-6
        "tolerance": object?
      }
    ]
  }
}

MESHABLE FEATURE SHAPES — a body's "feature" MUST be exactly one of these five shapes (field names
verbatim; extra fields are dropped, missing/mistyped required fields are REFUSED before any gate runs):
  extrude:    { "kind":"extrude", "loop":[{"x":number,"y":number}, ...>=3 pts, CCW],
                "depth":number>0, "direction":"one_sided"|"two_sided"|"midplane", "mode":"add"|"cut" }
  revolve:    { "kind":"revolve", "loop":[{"x":number,"y":number}, ...>=3 pts, x>=0 half-profile],
                "angleDegrees":number, "mode":"add"|"cut" }
  sweep:      { "kind":"sweep", "profile":{"points":[{"x":number,"y":number}, ...>=3 pts]},
                "path":[{"x":number,"y":number,"z":number}, ...>=2 pts], "mode":"add"|"cut" }
  sweep_path: { "kind":"sweep_path", "profile":[{"x":number,"y":number}, ...>=3 pts],
                "path":[{"x":number,"y":number,"z":number}, ...>=2 pts] }
  loft:       { "kind":"loft",
                "sections":[{"profile":{"points":[{"x":number,"y":number}, ...]}, "z":number}, ...>=2],
                "mode":"add"|"cut" }
There is NO "profile":{"kind":"rectangle",...} shorthand and no implicit box/cylinder primitive — a
rectangle is a 4-point "loop" (or "profile.points"), a circle is a tessellated polygon loop (see below).
Example — "a rectangular aluminum plate 80×50×6mm" is an EXTRUDE of a 4-point loop, NOT a box primitive:
  { "kind":"extrude", "loop":[{"x":0,"y":0},{"x":80,"y":0},{"x":80,"y":50},{"x":0,"y":50}],
    "depth":6, "direction":"one_sided", "mode":"add" }

STABLE TOPOLOGY NAMING (dimension refs) — these are the ONLY measurable names, and ONLY on extrude bodies:
  faces:  f.cap.top, f.cap.bottom, f.side.{i}      (i = profile-edge index, 0-based)
  edges:  e.vert.{i}                               (ONE index — see note below)
          e.top.{i}-{j}, e.bottom.{i}-{j}           (TWO indices — see note below)
IMPORTANT — do not guess the index count, it is NOT interchangeable between these two edge kinds:
  - "e.vert.{i}" takes exactly ONE index. It is the VERTICAL edge that the extrusion sweeps out of a
    single profile vertex i — the segment from bottom-copy-of-vertex-i to top-copy-of-vertex-i. There is
    only one vertex, so only one index. Writing "e.vert.{i}-{j}" (pairing two vertex indices, as if it
    were a horizontal edge) is INVALID and will be refused.
  - "e.top.{i}-{j}" / "e.bottom.{i}-{j}" take exactly TWO indices — the two profile-edge endpoints (i,j)
    of that horizontal cap edge, because a horizontal edge on the top or bottom cap DOES connect two
    distinct profile vertices.
  Example — a 4-point rectangular loop [0,1,2,3] (CCW) extruded to depth d has:
    faces: f.cap.top, f.cap.bottom, f.side.0, f.side.1, f.side.2, f.side.3
    vertical edges: e.vert.0, e.vert.1, e.vert.2, e.vert.3  (one per profile vertex — NOT e.vert.0-1)
    top cap edges: e.top.0-1, e.top.1-2, e.top.2-3, e.top.3-0
  A dimension measuring the plate's overall WIDTH (distance between the two long vertical edges) would be:
    { "id":"d_width", "partId":"plate", "bodyId":"b0", "view":"top", "kind":"linear",
      "refs":["e.vert.0","e.vert.1"], "expected":80 }
VIEW FRAMES — which world axes each view SHOWS. Getting this wrong is the single most common
reason a plan reaches the gates and then fails with "measured 0 mm":
  · An extrude's profile loop lies in the XY plane; 'depth' extrudes it along +Z.
  · view "top"   shows X (horizontal) × Y (vertical)  — Z is projected out.
  · view "front" shows X (horizontal) × Z (vertical)  — **Y is projected out**.
  · view "right" shows Y (horizontal) × Z (vertical)  — X is projected out.
Therefore, for a body whose loop is W (along X) × H (along Y) extruded to thickness T (along Z):
  · W  → view "top" or "front",  refs = two e.vert.{i} that differ in X.
  · H  → view "top" or "right",  refs = two e.vert.{i} that differ in Y.  **NOT "front"** —
         front projects Y out, so those two edges land on top of each other and measure 0.
  · T  → view "front" or "right", refs = ["f.cap.bottom", "f.cap.top"].  **NEVER two e.vert.{i}** —
         every vertical edge spans the SAME Z range, so their separation along Z is 0.
  · The two refs of a "linear" dimension must also be axis-aligned in that view. A DIAGONAL pair
    (a slanted span — gusset hypotenuse, chamfer, opposite corners) is refused as
    "not-axis-aligned". You have three correct options, pick by what you actually mean:
       1. kind:"aligned"        → the slant's TRUE length (the hypotenuse itself).
       2. kind:"linear" + axis:"x" (or "y") → one COMPONENT of the slant (the leg).
       3. pick an axis-parallel ref pair instead.
    Worked example — a right-triangle gusset whose loop is [(0,0),(80,0),(0,80)] (legs along X and
    Y, hypotenuse between vertices 1 and 2), extruded 6 mm thick:
       { "id":"d_leg_x", "view":"top", "kind":"linear", "refs":["e.vert.0","e.vert.1"], "expected":80 }
       { "id":"d_leg_y", "view":"top", "kind":"linear", "refs":["e.vert.0","e.vert.2"], "expected":80 }
       { "id":"d_hyp",  "view":"top", "kind":"aligned", "refs":["e.vert.1","e.vert.2"], "expected":113.137 }
    NOTE e.vert.1→e.vert.2 is the DIAGONAL: as "linear" it is refused; as "aligned" it measures
    80·√2. If you wanted the leg instead, use axis:"x"/"y" on that same pair.
  · WATCH THE NUMBER YOU PROMISE. "aligned" returns the SLANT's true length, so a 45° chamfer
    described as "20 mm" measures 20·√2 = 28.284 as an aligned dimension — set "expected" to
    28.284, or dimension the 20 mm LEG with kind:"linear" + axis. The gate compares your
    "expected" against the real measurement; a right measurement with a wrong promise still fails.
A dimension that cannot be measured in its chosen view is refused BEFORE the gates, with the view
you should have used. Worked example for a 50 × 30 × 25 block (loop 50 along X, 30 along Y, depth 25):
  { "id":"d_width",  "view":"top",   "kind":"linear", "refs":["e.vert.0","e.vert.1"], "expected":50 }
  { "id":"d_height", "view":"top",   "kind":"linear", "refs":["e.vert.1","e.vert.2"], "expected":30 }
  { "id":"d_thick",  "view":"front", "kind":"linear", "refs":["f.cap.bottom","f.cap.top"], "expected":25 }
A dimension whose refs are outside this grammar, or that targets a revolve/sweep/loft body, WILL be refused before any gate — those kinds have no topology namer yet (backlog). For circular sections that must be dimensioned, use a polygon-tessellated EXTRUDE whose cap vertices lie exactly on the true circle, and state the tessellation deviation in expectedVolume.basis.

HONESTY RULES:
- Never fabricate geometry, code, or measured values — you plan, the engine measures.
- expectedVolume.basis is mandatory whenever expectedVolume is present; state any approximation explicitly.
- expectedVolume: PREFER "decomposition" over "valueMm3". Write the cross-section as terms in the
  dimensions the BRIEF gave you, and let the engine multiply. Worked example — a U-channel, web
  100 wide, flange 50 tall, wall 10, depth 200:
    "expectedVolume": { "basis": "brief dims: web 100×10 + two flanges 10×40, × depth 200",
      "decomposition": { "depthMm": 200, "terms": [
        {"shape":"rect","widthMm":100,"heightMm":10},
        {"shape":"rect","widthMm":10,"heightMm":40},
        {"shape":"rect","widthMm":10,"heightMm":40} ] } }
  Do NOT read these numbers off the loop you drew — state what the brief ASKED FOR. The gate
  compares your decomposition against the loop precisely to catch the case where the two differ
  (e.g. the brief says flange 50 but the loop you wrote makes it 45). If you give both a
  decomposition and valueMm3 and they disagree, the gate reports that as an ARITHMETIC error in
  your stated theory — separate from a geometry error — so the fix is unambiguous.
- Same rule for dimension nominals: if the number needs arithmetic (a slant length, a chain, an
  inner width), give "expectedFrom" and omit "expected". A promise you computed by hand is the
  thing that has been wrong — the measurement is usually right. If you give both and they
  disagree, the gate reports that as an ARITHMETIC error in your promise, separately from a
  measurement disagreement.
- Do NOT omit expectedVolume to avoid a mismatch. A mismatch means the loop you drew is not the
  shape you intended; hiding it ships a wrong part. Give a decomposition instead — then there is
  no arithmetic for you to get wrong, and the check still does its job.
- If a shape cannot be expressed with the meshable feature kinds and measurable topology above, REFUSE with {"error":"unsupported","reason":...} rather than emitting an unmeasurable plan.`;

// ─── the planner ─────────────────────────────────────────────────────────

/**
 * Build an LLM-backed DesignPlanner over an injected completion function.
 * The returned planner: prompts → parses → schema-coerces → preflights, and
 * throws `PlannerError` (which the driver converts to a stage:'plan' refusal)
 * for empty/non-JSON responses, an explicit unsupported refusal, a schema
 * violation, or a failed preflight.
 */
export function makeLlmPlanner(deps: LlmPlannerDeps): DesignPlanner {
  const systemPrompt = deps.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const name = deps.name ?? 'llm';
  return {
    name,
    async plan(brief: DesignBrief): Promise<DesignPlan> {
      const messages = buildMessages(brief, systemPrompt);
      const raw = await deps.complete(messages);
      const parsed = extractJson(raw);

      // Explicit model refusal sentinel — surfaced as a plan-stage refusal.
      if (isObj(parsed) && parsed.error === 'unsupported') {
        const reason = typeof parsed.reason === 'string' ? parsed.reason : 'no reason given';
        throw new PlannerError(`planner declined the brief as unsupported: ${reason}`);
      }

      const plan = coerceDesignPlan(parsed);
      const preflight = preflightPlan(plan);
      if (preflight) {
        throw new PlannerError(`plan preflight rejected: ${preflight}`);
      }
      return plan;
    },
  };
}

// ─── production binding ────────────────────────────────────────────────────

export interface ChatCompletionPlannerOptions {
  name?: string;
  /** Force a model (otherwise provider default). */
  model?: string;
  /** Sampling temperature — default 0 (as deterministic as the provider allows). */
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  systemPrompt?: string;
}

/**
 * Production planner: `makeLlmPlanner` wired to the shared `chatCompletion`
 * provider chain (aiMeter/budget/telemetry live inside chatCompletion). Uses
 * temperature 0; note a live LLM is still not byte-deterministic (see file
 * header) — determinism belongs to the fixture planner, not this one.
 */
export function chatCompletionPlanner(opts: ChatCompletionPlannerOptions = {}): DesignPlanner {
  return makeLlmPlanner({
    name: opts.name ?? 'llm',
    ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
    complete: async (messages) => {
      const res = await chatCompletion({
        messages,
        temperature: opts.temperature ?? 0,
        maxTokens: opts.maxTokens ?? 4000,
        timeoutMs: opts.timeoutMs ?? 60_000,
        task: 'design-brief-plan',
        ...(opts.model ? { model: opts.model } : {}),
      });
      return res.text;
    },
  });
}
