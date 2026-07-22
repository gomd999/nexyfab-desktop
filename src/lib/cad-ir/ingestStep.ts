/**
 * ingestStep.ts — FAITHFUL STEP → IR for the reconstruction gate (Pipeline B).
 *
 * THE HONESTY POINT (do not lose this):
 * -------------------------------------
 * nexyfab has TWO STEP readers with very different fidelity:
 *
 *   1. `stepToNexyfabAssembly` (brep-bridge/stepToNexyfabAssembly.ts) — takes each
 *      part's LOCAL AABB, rotates the 8 corners into world space, and emits an
 *      axis-aligned BOX (or, when a CYLINDRICAL_SURFACE radius closes the AABB, a
 *      cylinder). Its own note says "월드 AABB box 근사 · 원기하 아님" (world-AABB box
 *      approximation, NOT true geometry). This is the CANDIDATE reconstruction.
 *
 *   2. `importStep` (brep-bridge/stepImport.ts) — a pure-TS ISO-10303-21 reader that
 *      walks the B-rep entity graph and reconstructs the REAL geometry of every
 *      supported solid: a box becomes an exact rectangular ExtrudeFeature, a
 *      cylinder becomes a RevolveFeature with the TRUE radius/height (volume pi*r^2*h,
 *      not the 4*r^2*h of its bounding box), a polygon prism keeps its actual profile,
 *      etc. It reads actual CARTESIAN_POINTs / radii — no bounding-box flattening.
 *
 * The gate's SOURCE IR MUST be measured from (2), the faithful geometry — never
 * from (1). Measuring the box-approx against itself is a meaningless always-pass and
 * is exactly the dishonesty this module exists to avoid.
 *
 * Consequence, stated plainly:
 *   - A genuinely boxy part -> importStep box == AABB box -> the gate PASSES (correct).
 *   - A cylinder / curved / complex part -> importStep gives the true solid while the
 *     candidate is a box (render-preview tessellates an imported cylinder as its
 *     AABB). The gate then FAILS on volume/bbox — and that failure is the TRUE,
 *     useful signal that our STEP reconstruction pipeline is still coarse. We surface
 *     it; we do not tune it away.
 *   - A part whose solids importStep cannot classify (BSPLINE / cone / sphere / torus
 *     / non-axis revolves) -> NO faithful measurement is possible -> `ok:false` with a
 *     reason, which the route reports as gate status 'unavailable' (never a fake pass).
 *
 * Pipeline: STEP text --importStep--> FeatureTree --featureToPolyhedron--> polyhedra
 *           --triangulate--> soup --analyzeTriangles--> measurement --> IR (bbox /
 *           volume / watertight / genus). Units come from the STEP header
 *           (detectStepUnits), so — unlike STL — units are set, not null.
 *
 * All pure TS: no OCCT worker, no WASM, no native deps. Runs in-process and in vitest.
 */

import { createHash } from 'node:crypto';
import type { Ir, IrExtent, IrReconstruct, Vec3 } from './schema';
import { analyzeTriangles, type TriangleSoup, type MeshMeasurement } from './meshAnalysis';
import { importStep, StepImportError } from '@/lib/brep-bridge/stepImport';
import { detectStepUnits, type StepUnit } from '@/lib/brep-bridge/stepRead';
import { featureToPolyhedron, type Polyhedron } from '@/lib/cad/featureMesh';

export interface StepToIrMeta {
  /** Solids importStep recognised as classifiable (feature-tree nodes). */
  solids: number;
  /** Nodes that actually meshed into geometry (should equal `solids`). */
  meshed: number;
  /** Per-solid skips (curved / unsupported surfaces) — honest fidelity boundary. */
  unsupported: string[];
  /** Non-fatal parse/heal advisories. */
  warnings: string[];
  /** Detected STEP length unit and how sure we are. */
  unit: StepUnit;
  unitConfidence: 'high' | 'medium' | 'low';
}

export interface StepToIrResult {
  /** true -> `ir` is a faithful measurement. false -> `reason` explains why none exists. */
  ok: boolean;
  ir: Ir | null;
  /** Set when ok=false. The route turns this into gate status 'unavailable'. */
  reason: string | null;
  meta: StepToIrMeta;
}

/** Fan a possibly-ngon/quad polyhedron face set into a triangle soup (fan triangulation). */
function polyhedronToTriangles(poly: Polyhedron, out: TriangleSoup): void {
  const V = poly.vertices;
  for (const f of poly.faces) {
    const vs = f.vertices;
    if (vs.length < 3) continue;
    const a = V[vs[0]!]!;
    for (let i = 1; i + 1 < vs.length; i++) {
      const b = V[vs[i]!]!;
      const c = V[vs[i + 1]!]!;
      out.push([
        [a.x, a.y, a.z],
        [b.x, b.y, b.z],
        [c.x, c.y, c.z],
      ]);
    }
  }
}

/** Map the STEP reader's unit token onto the IR's declared-unit vocabulary. */
function toIrUnit(u: StepUnit): IrExtent['units'] {
  switch (u) {
    case 'mm':
      return 'mm';
    case 'm':
      return 'm';
    case 'inch':
      return 'in';
    default:
      return null; // 'unknown'
  }
}

/**
 * Grade an OCCT (replicad in-process) faithful mesh. Unlike the pure-TS reader this path
 * meshes the REAL analytic B-rep (cylinder / cone / sphere / torus / BSPLINE / fillet all
 * faithful), so a clean watertight single measurement is genuinely a grade-A reconstruction.
 */
function gradeOcct(m: MeshMeasurement, bodies: number): IrReconstruct {
  const blockers: string[] = [];
  if (!m.watertight) blockers.push('measured mesh not watertight');
  const grade: IrReconstruct['grade'] = !m.ok ? 'F' : m.watertight ? 'A' : 'D';
  return {
    grade,
    score: grade === 'A' ? 0.9 : grade === 'D' ? 0.4 : 0,
    strategy: 'mesh_import',
    rationale:
      `replicad / OCCT in-process mesher measured ${bodies} body(ies) from the real B-rep ` +
      `(curved / BSPLINE / cone / sphere / torus faithful — no bounding-box flattening).`,
    est_tokens: null,
    blockers,
  };
}

/**
 * Shared tail: turn a triangle-mesh measurement + detected units into a fully-formed IR.
 * Both the pure-TS reader (stepToIr) and the OCCT mesher (meshSoupToStepIr) funnel through
 * here so the extent / mesh / honesty rules live in exactly one place.
 */
function finalizeStepIr(
  m: MeshMeasurement,
  unitDet: ReturnType<typeof detectStepUnits>,
  ctx: {
    text: string;
    bytesLen: number;
    sha256: string;
    opts: { path: string; name: string; source_hint?: string | null };
    warnings: string[];
    parser: string;
    parseStatus: 'ok' | 'partial';
    topologySolids: number;
    reconstruct: IrReconstruct;
    t0: number;
  },
): Ir {
  const size: Vec3 | null = m.extents;
  const centroid: Vec3 | null =
    m.bboxMin && m.bboxMax
      ? [(m.bboxMin[0] + m.bboxMax[0]) / 2, (m.bboxMin[1] + m.bboxMax[1]) / 2, (m.bboxMin[2] + m.bboxMax[2]) / 2]
      : null;

  let aspect: IrExtent['aspect'] = null;
  if (size) {
    const s = [...size].sort((a, b) => b - a);
    const r = s[0] / (s[2] || 1e-9);
    aspect = r > 8 ? 'rod' : s[2] / (s[0] || 1) < 0.15 ? 'plate' : 'block';
  }

  const irUnit = toIrUnit(unitDet.unit);
  // Honesty rule 1: only claim 'declared' when the STEP file explicitly declared the
  // unit (high confidence). A low-confidence mm default is an inference, not a claim.
  const unitsSource: IrExtent['units_source'] =
    irUnit === null ? 'unknown' : unitDet.confidence === 'high' ? 'declared' : 'inferred';
  const unitIsMm = irUnit === 'mm';

  return {
    ir_version: '1',
    identity: {
      path: ctx.opts.path,
      name: ctx.opts.name,
      format: 'STEP',
      bytes: ctx.bytesLen,
      sha256: ctx.sha256,
      source_hint: ctx.opts.source_hint ?? null,
    },
    parse: {
      status: ctx.parseStatus,
      parser: ctx.parser,
      elapsed_ms: Date.now() - ctx.t0,
      truncated: false,
      sampled_ratio: 1.0,
      warnings: ctx.warnings,
      error: null,
    },
    extent: {
      units: irUnit,
      units_source: unitsSource,
      bbox_min: m.bboxMin,
      bbox_max: m.bboxMax,
      size,
      centroid,
      aspect,
      is_2d: !!size && size[2] < 1e-6,
    },
    topology: {
      solids: ctx.topologySolids,
      shells: null,
      faces: null,
      edges: null,
      vertices: null,
      surface_types: null,
      curve_types: null,
      analytic_ratio: null,
      closed: m.watertight,
    },
    features: null,
    symmetry: null,
    assembly: null,
    mesh: {
      triangles: m.triangles,
      vertices: m.vertices,
      watertight: m.watertight,
      // Volume is measured in the STEP's native unit^3. When that unit is mm it IS mm^3;
      // otherwise it is native-unit^3 and flagged. The gate compares source vs candidate
      // (both native units), so the comparison stays consistent either way.
      volume_mm3: m.volume,
      volume_mm3_unit_warning: unitIsMm
        ? null
        : `STEP unit is ${unitDet.unit} (${unitDet.confidence}) — volume is native-unit^3, not mm^3`,
      area_mm2: m.area,
      components: m.bodyCount,
      planar_clusters: null,
      normal_histogram_peaks: null,
      curvature_bins: null,
      primitive_fit: null,
      degenerate_faces: null,
    },
    semantics: null,
    reconstruct: ctx.reconstruct,
  };
}

function gradeStep(meshed: number, unsupported: number, m: MeshMeasurement): IrReconstruct {
  const blockers: string[] = [];
  if (unsupported > 0) blockers.push(`${unsupported} solid(s) unsupported by pure-TS reader`);
  if (!m.watertight) blockers.push('measured mesh not watertight');
  // The faithful reader recovers real B-rep primitives, so a clean single-body part
  // is genuinely parametric (grade A/B). Mixed/unsupported geometry degrades it.
  const grade: IrReconstruct['grade'] = !m.ok
    ? 'F'
    : unsupported > 0
      ? 'C'
      : m.watertight
        ? 'B'
        : 'D';
  return {
    grade,
    score: grade === 'B' ? 0.8 : grade === 'C' ? 0.55 : grade === 'D' ? 0.4 : 0,
    strategy: meshed > 0 ? 'primitive_csg' : 'none',
    rationale:
      `Pure-TS STEP B-rep reader recovered ${meshed} solid(s) as real primitives` +
      (unsupported > 0 ? `; ${unsupported} solid(s) required OCCT (curved/unsupported).` : '.'),
    est_tokens: null,
    blockers,
  };
}

/**
 * Read a STEP source (text or bytes) and MEASURE its real geometry into an IR.
 * Returns `{ ok:false, reason }` — never a fabricated IR — when the file cannot be
 * faithfully measured (unparseable, or every solid is an unsupported surface class).
 */
export function stepToIr(
  source: string | Uint8Array,
  opts: { path: string; name: string; source_hint?: string | null },
): StepToIrResult {
  const t0 = Date.now();
  const text = typeof source === 'string' ? source : new TextDecoder('latin1').decode(source);
  const bytesLen = typeof source === 'string' ? Buffer.byteLength(source, 'latin1') : source.length;
  const sha256 = createHash('sha256').update(text, 'latin1').digest('hex');

  const unitDet = detectStepUnits(text);
  const meta: StepToIrMeta = {
    solids: 0,
    meshed: 0,
    unsupported: [],
    warnings: [],
    unit: unitDet.unit,
    unitConfidence: unitDet.confidence,
  };

  // 1) Faithful B-rep read. Throws only on an unparseable file.
  let parsed;
  try {
    parsed = importStep(text);
  } catch (e) {
    const msg = e instanceof StepImportError ? e.message : (e as Error)?.message ?? String(e);
    return { ok: false, ir: null, reason: `step_parse_failed: ${msg.slice(0, 160)}`, meta };
  }
  meta.warnings = parsed.warnings;
  meta.unsupported = parsed.unsupported;
  meta.solids = parsed.tree.nodes.length;

  // 2) No classifiable solid -> we CANNOT measure real geometry. Honest 'unavailable'.
  if (parsed.tree.nodes.length === 0) {
    const why =
      parsed.unsupported.length > 0
        ? `all solids unsupported by pure-TS reader (${parsed.unsupported.slice(0, 3).join(' | ')}${parsed.unsupported.length > 3 ? ' ...' : ''})`
        : `no MANIFOLD_SOLID_BREP / revolve / sweep found (${parsed.warnings.slice(0, 3).join(' | ') || 'empty'})`;
    return { ok: false, ir: null, reason: `no_faithful_geometry: ${why}`, meta };
  }

  // 3) Tessellate every recovered solid into one triangle soup. NOTE: importStep lands
  //    each solid at world origin (it does not yet apply the assembly transform chain),
  //    so multi-solid parts stack at the origin — recorded as a warning; the gate's own
  //    watertight/evidence checks keep such a measurement from silently passing.
  const soup: TriangleSoup = [];
  let meshed = 0;
  for (const node of parsed.tree.nodes) {
    const payload = node.payload as { kind: string };
    let poly: Polyhedron | null = null;
    try {
      poly = featureToPolyhedron(payload);
    } catch (e) {
      meta.warnings.push(`mesh_failed:${node.id}:${(e as Error)?.message?.slice(0, 60) ?? 'err'}`);
      poly = null;
    }
    if (poly) {
      polyhedronToTriangles(poly, soup);
      meshed += 1;
    }
  }
  meta.meshed = meshed;
  if (meshed > 1) {
    meta.warnings.push(
      `multi_body_at_origin: ${meshed} solids meshed; importStep does not apply placement transforms — measurement is approximate for multi-body parts`,
    );
  }

  if (soup.length === 0) {
    return { ok: false, ir: null, reason: 'no_faithful_geometry: recovered solids produced no triangles', meta };
  }

  // 4) Measure.
  const m = analyzeTriangles(soup);
  if (!m.ok || !m.extents) {
    return { ok: false, ir: null, reason: `measurement_failed: ${m.error ?? 'no extents'}`, meta };
  }

  const ir = finalizeStepIr(m, unitDet, {
    text,
    bytesLen,
    sha256,
    opts,
    warnings: meta.warnings,
    parser: 'step_brep_pure_ts_v1',
    parseStatus: meta.unsupported.length > 0 ? 'partial' : 'ok',
    topologySolids: meshed,
    reconstruct: gradeStep(meshed, meta.unsupported.length, m),
    t0,
  });

  return { ok: true, ir, reason: null, meta };
}

/**
 * OCCT sibling of stepToIr — MEASURE a curved / complex STEP from a triangle soup produced by
 * the in-process replicad OCCT mesher (scripts/drawing-to-3d/to-step.mjs::stepTextToMesh, i.e.
 * importSTEP(Blob).mesh(...)). The pure-TS reader flattens cone / sphere / torus / BSPLINE to
 * 'unsupported'; this path meshes the REAL analytic B-rep, so volume / bbox / genus /
 * watertight are faithful. Units still come from the STEP header (detectStepUnits) — never
 * fabricated. Returns { ok:false, reason } (route -> 'unavailable') when the soup is empty or
 * unmeasurable; the CALLER catches importSTEP failure (opencascade RetError) and reports
 * 'unavailable' too. No bounding-box approximation, ever.
 *
 * `soup` MUST already be the gate's TriangleSoup form (one [[x,y,z],[x,y,z],[x,y,z]] per
 * triangle). The replicad Shape is meshed once and the SAME soup is reused as the passthrough
 * gate candidate by the route, so source and candidate are the identical real geometry
 * (round-trip identity -> PASS).
 */
export function meshSoupToStepIr(
  soup: TriangleSoup,
  stepText: string,
  opts: { path: string; name: string; source_hint?: string | null; bytesLen?: number },
): StepToIrResult {
  const t0 = Date.now();
  const bytesLen = opts.bytesLen ?? Buffer.byteLength(stepText, 'latin1');
  const sha256 = createHash('sha256').update(stepText, 'latin1').digest('hex');
  const unitDet = detectStepUnits(stepText);
  const meta: StepToIrMeta = {
    solids: 0,
    meshed: 0,
    unsupported: [],
    warnings: [],
    unit: unitDet.unit,
    unitConfidence: unitDet.confidence,
  };

  if (!Array.isArray(soup) || soup.length === 0) {
    return { ok: false, ir: null, reason: 'no_faithful_geometry: OCCT mesh produced no triangles', meta };
  }

  const m = analyzeTriangles(soup);
  if (!m.ok || !m.extents) {
    return { ok: false, ir: null, reason: `measurement_failed: ${m.error ?? 'no extents'}`, meta };
  }

  meta.solids = m.bodyCount;
  meta.meshed = m.bodyCount;
  meta.warnings.push(
    'occt_mesh: measured from replicad / OCCT in-process B-rep mesher (faithful for curved / BSPLINE / cone / sphere / torus)',
  );

  const ir = finalizeStepIr(m, unitDet, {
    text: stepText,
    bytesLen,
    sha256,
    opts,
    warnings: meta.warnings,
    parser: 'step_occt_replicad_v1',
    parseStatus: 'ok',
    topologySolids: m.bodyCount,
    reconstruct: gradeOcct(m, m.bodyCount),
    t0,
  });

  return { ok: true, ir, reason: null, meta };
}
