/**
 * stepWriteFilletChamfer — Phase 5.1.3 STEP writer for FilletFeature /
 * ChamferFeature. STRICT orchestrator on top of `stepWrite.writeExtrudeAsStep`.
 *
 * Phase 1 limitation (THIS file):
 * --------------------------------
 * Real OCCT BRepFilletAPI_MakeFillet / BRepFilletAPI_MakeChamfer geometry is
 * out of reach until the OCCT WASM worker (see occt-worker/PHASE_5_INTEGRATION.md)
 * is wired. Until that lands, this writer falls back to APPROXIMATED
 * representation:
 *
 *   1. The child `ExtrudeFeature` is emitted via `writeExtrudeAsStep` —
 *      byte-identical to calling that function directly. So the underlying
 *      solid in the STEP file is the bounding-box of the sketch profile
 *      (same Phase 1 box-only approximation that ExtrudeFeature already
 *      uses for STEP export).
 *
 *   2. Just before the DATA section's closing `ENDSEC;`, we splice in a
 *      small annotation block:
 *        - 1× SHAPE_ASPECT('FILLET' | 'CHAMFER', '<descriptor>', $, .T.)
 *        - 1× SHAPE_DEFINITION_REPRESENTATION linking the SHAPE_ASPECT to
 *          the existing solid (MANIFOLD_SOLID_BREP) entity id discovered in
 *          the geometry block.
 *      Plus a leading `/* ... *​/` traceability comment.
 *
 * This is the same approach `pmiShapeBinding.ts` uses for PMI: a
 * SHAPE_ASPECT side-channel that downstream readers (OCCT-aware CAM,
 * supplier audit) can pick up, while the visible geometry stays as the
 * existing approximation. The annotation carries:
 *   - feature kind ('FILLET' | 'CHAMFER')
 *   - radius (fillet) / distance (chamfer) — formatted with the SAME REAL
 *     literal rules as stepWrite.fmt (1. for integers, no trailing dot for
 *     genuine fractions) so a downstream reader can parse it deterministically
 *   - edgeSelection enum (all / top / bottom / vertical)
 *   - the underlying MANIFOLD_SOLID_BREP entity id it applies to
 *
 * Phase 2 wishlist (when the OCCT worker activates):
 * --------------------------------------------------
 *   - Replace the bbox child with the REAL profile extrude (already partly
 *     available via writeExtrudePolygonAsStep — but we deliberately keep
 *     this orchestrator on the same emitter as writeExtrudeAsStep to keep
 *     the "child extrude is byte-identical" contract verifiable).
 *   - Call BRepFilletAPI_MakeFillet / BRepFilletAPI_MakeChamfer in the worker
 *     and replace the SHAPE_ASPECT annotation block with REAL toroidal/conical
 *     surfaces emitted via TOROIDAL_SURFACE / CONICAL_SURFACE entities
 *     wrapped by ADVANCED_FACE → CLOSED_SHELL → MANIFOLD_SOLID_BREP.
 *   - Per-edge radius / per-edge distance — today the annotation only
 *     records the uniform value (or, when vertexRadii / vertexDistances are
 *     present, embeds them as a packed list in the description string).
 *
 * CONSTRAINTS (verified by this file's tests):
 *   - DO NOT modify stepWrite.ts / pmiExport.ts / pmiShapeBinding.ts /
 *     filletProfile.ts / chamferProfile.ts.
 *   - The CHILD EXTRUDE portion of the output (everything between
 *     `ISO-10303-21;` and the inserted annotation) is byte-identical to
 *     calling `writeExtrudeAsStep(<resolved child>, opts)` directly, where
 *     the child is the live upstream extrude when the feature names one by
 *     `childId`, else the embedded `childExtrude` snapshot (W2-0).
 *   - Entity ids in the annotation are strictly greater than the maximum
 *     id in the child geometry block (monotonic, non-colliding).
 *
 * Spec reference:
 *   - ISO 10303-21 §6.4 (Part 21 clear-text encoding)
 *   - ISO 10303-242 §6.4.7 (SHAPE_ASPECT / SHAPE_DEFINITION_REPRESENTATION)
 */

import type { FilletFeature } from '@/lib/cad/filletProfile';
import type { ChamferFeature } from '@/lib/cad/chamferProfile';
import type { EmitContext } from '@/lib/cad/featureTree';
import { resolveChildExtrude } from '@/lib/cad/upstreamResolve';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { writeExtrudeAsStep, type ExtrudeToStepOptions } from './stepWrite';

// ─── public option types ──────────────────────────────────────────────────

/**
 * Options for {@link writeFilletAsStep} / {@link writeChamferAsStep}.
 * Extends ExtrudeToStepOptions (which itself extends StepHeaderOptions) so
 * the caller can override header / productName the same way as for a plain
 * extrude.
 */
export interface FilletChamferStepOptions extends ExtrudeToStepOptions {
  /**
   * Optional stable id for the SHAPE_ASPECT entity's name slot. Defaults
   * to a kind-prefixed counter (e.g. 'FILLET_1', 'CHAMFER_1'). When the
   * caller emits multiple fillets/chamfers into the same downstream archive
   * a unique id avoids name collisions in PDM round-trip.
   */
  featureId?: string;
  /**
   * W2-0 upstream resolution context.
   *
   * When the feature names its body by `childId` (ref mode), the child
   * extrude is read LIVE from this context so an upstream depth/profile
   * edit reaches the STEP output. Build one with
   * `emitContextForTree(tree)`.
   *
   * Omitting it is only valid for legacy features that carry no `childId`.
   * A ref-mode feature emitted without a context THROWS rather than fall
   * back to the stale `childExtrude` snapshot — writing silently-wrong
   * B-rep is the defect W2-0 exists to remove (design note §3).
   */
  emitContext?: EmitContext;
}

/** Result mapping from feature → SHAPE_ASPECT entity id. */
export interface FeatureAnnotationMap {
  /** The feature id (as used in the SHAPE_ASPECT name slot). */
  featureId: string;
  /** The numeric `#N` entity id allocated for the SHAPE_ASPECT row. */
  shapeAspectEntityId: number;
}

// ─── id-scanner helpers ───────────────────────────────────────────────────

/**
 * Return the maximum entity id N for which a line of the form `#N=...`
 * appears in `dataBlock`. Returns 0 if no entity line is present.
 *
 * Anchored to start-of-line so references like `,#42,` inside an entity body
 * do not inflate the count. Matches the regex used in stepWriteWithPmi —
 * kept LOCAL so we do not import a private helper across modules.
 */
function scanMaxEntityId(dataBlock: string): number {
  const re = /^#(\d+)\s*=/gm;
  let max = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dataBlock)) !== null) {
    const id = Number.parseInt(m[1]!, 10);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max;
}

/**
 * Find the LAST `#N=MANIFOLD_SOLID_BREP(...)` entity id in the geometry data
 * block. This is the entity the SHAPE_ASPECT will reference as the bound
 * shape. Returns -1 if not found (writer contract is that
 * writeExtrudeAsStep always emits exactly one — Phase 1 box-only).
 */
function findManifoldSolidBrepId(dataBlock: string): number {
  // Match the line-anchored entity form: `#N=MANIFOLD_SOLID_BREP(...)`.
  // The writer never wraps entity bodies across multiple lines so a
  // single-line regex is sufficient.
  const re = /^#(\d+)\s*=\s*MANIFOLD_SOLID_BREP\(/gm;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dataBlock)) !== null) {
    const id = Number.parseInt(m[1]!, 10);
    if (Number.isFinite(id)) last = id;
  }
  return last;
}

// ─── REAL literal formatter (matches stepWrite.fmt for matching inputs) ───
//
// We deliberately keep this LOCAL — importing `fmt` from stepWrite would
// require either exposing it on the public surface (we don't want to grow
// stepWrite's API for an orchestrator) or pulling from `__internal` (which
// is documented as not-stable). Re-implementing the same contract here is
// cheap, and the test suite verifies byte-equality against known values.
//
// Contract reduced from stepWrite.fmt:
//   - Integers → `N.` (REAL marker).
//   - Fractions → trimmed decimal (no trailing dot).
//   - Zero → `'0.'`.
//   - Sub-resolution / huge magnitudes → STEP exponential form.
//   - Non-finite → throws.
function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`stepWriteFilletChamfer: non-finite number ${n}`);
  }
  if (n === 0) return '0.';
  const abs = Math.abs(n);
  if (abs < 5e-7 || abs >= 1e15) {
    return toStepExponential(n);
  }
  const fixed = n.toFixed(6);
  if (!fixed.includes('.')) return `${fixed}.`;
  const trimmed = fixed.replace(/0+$/, '');
  return trimmed;
}

function toStepExponential(n: number): string {
  const e = n.toExponential();
  const [mantRaw, expRaw] = e.split('e');
  const exp = Number.parseInt(expRaw!, 10);
  let mant = mantRaw!;
  if (!mant.includes('.')) {
    mant = `${mant}.`;
  } else {
    mant = mant.replace(/0+$/, '');
  }
  return `${mant}E${exp >= 0 ? '+' : ''}${exp}`;
}

/**
 * Mirror of stepWrite.esc — STEP Part 21 string escaping (double single
 * quotes, strip control chars). Kept LOCAL so we don't pull from
 * stepWrite's `__internal`.
 */
function esc(s: string): string {
  return s.replace(/'/g, "''").replace(/[\x00-\x1f]/g, ' ');
}

// ─── annotation builder ──────────────────────────────────────────────────

/**
 * Format a per-vertex radius / distance array as a compact comma-separated
 * list using the same REAL literal rules as the scalar value. Used when the
 * feature has `vertexRadii` / `vertexDistances` set so the annotation
 * carries enough information for downstream OCCT-aware reconstruction.
 */
function formatVertexList(values: ReadonlyArray<number>): string {
  return values.map(fmt).join(',');
}

/**
 * Build the SHAPE_ASPECT description string. Format:
 *   '<KIND>(radius=<val>, edges=<sel>, solid=#<id>)'              uniform
 *   '<KIND>(vertexRadii=[<v0>,<v1>,...], edges=<sel>, solid=#<id>)'  variable
 *
 * The description carries every load-bearing parameter so a Phase 2 OCCT
 * pass can reconstruct the feature without re-reading the source IR.
 */
function buildFilletDescriptor(
  feature: FilletFeature,
  solidId: number,
): string {
  const sel = feature.edgeSelection;
  if (feature.vertexRadii !== undefined) {
    return `FILLET(vertexRadii=[${formatVertexList(feature.vertexRadii)}], edges=${sel}, solid=#${solidId})`;
  }
  return `FILLET(radius=${fmt(feature.radius)}, edges=${sel}, solid=#${solidId})`;
}

function buildChamferDescriptor(
  feature: ChamferFeature,
  solidId: number,
): string {
  const sel = feature.edgeSelection;
  if (feature.vertexDistances !== undefined) {
    return `CHAMFER(vertexDistances=[${formatVertexList(feature.vertexDistances)}], edges=${sel}, solid=#${solidId})`;
  }
  return `CHAMFER(distance=${fmt(feature.distance)}, edges=${sel}, solid=#${solidId})`;
}

/**
 * Splice an annotation block (SHAPE_ASPECT + SHAPE_DEFINITION_REPRESENTATION
 * + leading comment) into the geometry STEP source just before the DATA
 * section's closing `ENDSEC;`. Returns the patched STEP string plus the
 * mapping from feature id → SHAPE_ASPECT entity id.
 *
 * Algorithm:
 *   1. Locate `ISO-10303-21;` and `END-ISO-10303-21;` markers (sanity).
 *   2. Find LAST `ENDSEC;` BEFORE `END-ISO-10303-21;` — that's the
 *      geometry DATA's closing.
 *   3. Scan the geometry block for max `#N=` id and the
 *      `#N=MANIFOLD_SOLID_BREP(...)` id.
 *   4. Allocate SHAPE_ASPECT id = maxId + 1 and
 *      SHAPE_DEFINITION_REPRESENTATION id = maxId + 2.
 *   5. Insert `/* comment *​/` + entity lines just before `ENDSEC;`.
 */
function spliceAnnotation(
  stepSource: string,
  kind: 'FILLET' | 'CHAMFER',
  featureId: string,
  descriptor: string,
): { patched: string; shapeAspectEntityId: number } {
  // 1. Locate the terminator + opener.
  const endIsoMarker = 'END-ISO-10303-21;';
  const endIsoIdx = stepSource.lastIndexOf(endIsoMarker);
  if (endIsoIdx === -1) {
    throw new Error(
      'stepWriteFilletChamfer: child STEP missing END-ISO-10303-21; trailer',
    );
  }
  const dataMarker = 'DATA;';
  const dataIdx = stepSource.indexOf(dataMarker);
  if (dataIdx === -1 || dataIdx >= endIsoIdx) {
    throw new Error('stepWriteFilletChamfer: child STEP missing DATA; opener');
  }

  // 2. Locate the geometry block's closing ENDSEC; (last one before END-ISO).
  const endsecRegion = stepSource.slice(dataIdx, endIsoIdx);
  const endsecMarker = 'ENDSEC;';
  const endsecRelIdx = endsecRegion.lastIndexOf(endsecMarker);
  if (endsecRelIdx === -1) {
    throw new Error(
      'stepWriteFilletChamfer: child STEP DATA section missing closing ENDSEC;',
    );
  }
  const endsecAbsIdx = dataIdx + endsecRelIdx;

  // 3. Scan the geometry block for id bookkeeping.
  const dataBlock = stepSource.slice(dataIdx, endsecAbsIdx);
  const maxId = scanMaxEntityId(dataBlock);
  const solidId = findManifoldSolidBrepId(dataBlock);
  if (solidId === -1) {
    throw new Error(
      'stepWriteFilletChamfer: child STEP missing MANIFOLD_SOLID_BREP entity',
    );
  }

  // 4. Allocate annotation ids (monotonic — strictly greater than any
  //    id already present in the geometry block).
  const shapeAspectId = maxId + 1;
  const sdrId = maxId + 2;

  // 5. Build annotation lines. `descriptor` is recomputed here with the
  //    real solidId — caller passes a placeholder that we substitute.
  const finalDescriptor = descriptor.replace('#__SOLID_ID__', `#${solidId}`);
  const annotationLines = [
    `/* ${kind} annotation (Phase 1 approximated — real OCCT in Phase 2): ${featureId} */`,
    `#${shapeAspectId}=SHAPE_ASPECT('${esc(featureId)}','${esc(finalDescriptor)}',$,.T.);`,
    `#${sdrId}=SHAPE_DEFINITION_REPRESENTATION(#${shapeAspectId},#${solidId});`,
  ];
  // Match stepWrite's serialise convention: lines end with `\n`. The
  // dataBlock already terminates with `\n` (writer contract), so we
  // append a fresh trailing newline-joined block right before ENDSEC;.
  const annotationBlock = annotationLines.join('\n') + '\n';

  const before = stepSource.slice(0, endsecAbsIdx);
  const after = stepSource.slice(endsecAbsIdx);
  // Ensure we don't accidentally introduce a blank line — the geometry
  // block always ends with `\n`, so concatenation is straightforward.
  const patched = `${before}${annotationBlock}${after}`;

  return { patched, shapeAspectEntityId: shapeAspectId };
}

// ─── upstream body resolution (W2-0) ─────────────────────────────────────

/**
 * The extrude whose B-rep this fillet/chamfer annotates.
 *
 * Ref mode (`childId` present) reads the live upstream payload out of
 * `opts.emitContext`; without a context this THROWS instead of quietly
 * writing the stale snapshot's geometry into a STEP file that a customer
 * will machine from.
 *
 * Legacy mode (no `childId`) reads the embedded snapshot, byte-identical
 * to the pre-W2 output.
 */
function resolveStepChild(
  feature: FilletFeature | ChamferFeature,
  opts: FilletChamferStepOptions,
  selfLabel: string,
): ExtrudeFeature {
  const resolved = resolveChildExtrude(
    feature,
    opts.featureId ?? selfLabel,
    opts.emitContext,
  );
  if (!resolved) {
    throw new Error(
      `${selfLabel}: feature has no child body (neither childId nor childExtrude)`,
    );
  }
  return resolved.child;
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Emit a complete STEP file for a FilletFeature. The CHILD EXTRUDE portion
 * of the output is byte-identical to calling
 * `writeExtrudeAsStep(<resolved child>, opts)` directly — Phase 1
 * approximation is bounded by the child's bounding box (see stepWrite
 * module JSDoc for the full list of dropped properties).
 *
 * The fillet itself is recorded as a SHAPE_ASPECT annotation spliced into
 * the DATA section, NOT as real toroidal surfaces. Phase 2 (OCCT worker)
 * will replace the annotation with real geometry.
 *
 * @param feature  FilletFeature built via filletProfile.buildFilletFeature.
 * @param opts     Standard stepWrite header overrides + optional featureId
 *                 used as the SHAPE_ASPECT name slot.
 * @returns        A complete ISO-10303-21 STEP source string.
 *
 * Throws:
 *   - `feature.kind !== 'fillet'`
 *   - `feature.radius` is non-positive / non-finite (uniform path)
 *   - `feature.vertexRadii` contains non-positive / non-finite entries
 *   - The child extrude is invalid (re-thrown from writeExtrudeAsStep)
 */
export function writeFilletAsStep(
  feature: FilletFeature,
  opts: FilletChamferStepOptions = {},
): string {
  if (feature.kind !== 'fillet') {
    throw new Error(
      `writeFilletAsStep: expected kind='fillet', got '${(feature as { kind: string }).kind}'`,
    );
  }
  validateFilletParams(feature);

  // 1. Emit child extrude byte-identical to a direct writeExtrudeAsStep call.
  const childStep = writeExtrudeAsStep(resolveStepChild(feature, opts, 'writeFilletAsStep'), opts);

  // 2. Build descriptor with placeholder for the solid id; spliceAnnotation
  //    rewrites it after scanning the actual geometry block.
  const descriptor = buildFilletDescriptor(feature, 0)
    // Sentinel substitution — `0` becomes the placeholder so the formatter
    // produces `solid=#0` and we replace `#0` with the real ref. Using a
    // dedicated sentinel string avoids any chance of clobbering an actual
    // numeric value inside the descriptor.
    .replace('solid=#0', 'solid=#__SOLID_ID__');

  const featureId = opts.featureId ?? 'FILLET_1';

  // 3. Splice the annotation just before the closing ENDSEC;.
  const { patched } = spliceAnnotation(childStep, 'FILLET', featureId, descriptor);
  return patched;
}

/**
 * Emit a complete STEP file for a ChamferFeature. Same Phase 1 / Phase 2
 * contract as {@link writeFilletAsStep} — child extrude is byte-identical to
 * `writeExtrudeAsStep(<resolved child>, opts)`, chamfer is a
 * SHAPE_ASPECT annotation.
 */
export function writeChamferAsStep(
  feature: ChamferFeature,
  opts: FilletChamferStepOptions = {},
): string {
  if (feature.kind !== 'chamfer') {
    throw new Error(
      `writeChamferAsStep: expected kind='chamfer', got '${(feature as { kind: string }).kind}'`,
    );
  }
  validateChamferParams(feature);

  const childStep = writeExtrudeAsStep(
    resolveStepChild(feature, opts, 'writeChamferAsStep'),
    opts,
  );

  const descriptor = buildChamferDescriptor(feature, 0).replace(
    'solid=#0',
    'solid=#__SOLID_ID__',
  );

  const featureId = opts.featureId ?? 'CHAMFER_1';

  const { patched } = spliceAnnotation(
    childStep,
    'CHAMFER',
    featureId,
    descriptor,
  );
  return patched;
}

/**
 * Build the {@link FeatureAnnotationMap} entry for a FilletFeature without
 * actually emitting the STEP file. Useful when a caller already has the
 * STEP string in hand (e.g. emitted upstream by a different orchestrator)
 * and just needs to know what ids the annotation WOULD allocate. Mirrors
 * the contract of {@link writeFilletAsStep} — same validation,
 * deterministic id allocation.
 */
export function previewFilletAnnotationMap(
  feature: FilletFeature,
  opts: FilletChamferStepOptions = {},
): FeatureAnnotationMap {
  if (feature.kind !== 'fillet') {
    throw new Error(
      `previewFilletAnnotationMap: expected kind='fillet', got '${(feature as { kind: string }).kind}'`,
    );
  }
  validateFilletParams(feature);
  const childStep = writeExtrudeAsStep(
    resolveStepChild(feature, opts, 'previewFilletAnnotationMap'),
    opts,
  );
  const descriptor = buildFilletDescriptor(feature, 0).replace(
    'solid=#0',
    'solid=#__SOLID_ID__',
  );
  const featureId = opts.featureId ?? 'FILLET_1';
  const { shapeAspectEntityId } = spliceAnnotation(
    childStep,
    'FILLET',
    featureId,
    descriptor,
  );
  return { featureId, shapeAspectEntityId };
}

/** Mirror of {@link previewFilletAnnotationMap} for ChamferFeature. */
export function previewChamferAnnotationMap(
  feature: ChamferFeature,
  opts: FilletChamferStepOptions = {},
): FeatureAnnotationMap {
  if (feature.kind !== 'chamfer') {
    throw new Error(
      `previewChamferAnnotationMap: expected kind='chamfer', got '${(feature as { kind: string }).kind}'`,
    );
  }
  validateChamferParams(feature);
  const childStep = writeExtrudeAsStep(
    resolveStepChild(feature, opts, 'previewChamferAnnotationMap'),
    opts,
  );
  const descriptor = buildChamferDescriptor(feature, 0).replace(
    'solid=#0',
    'solid=#__SOLID_ID__',
  );
  const featureId = opts.featureId ?? 'CHAMFER_1';
  const { shapeAspectEntityId } = spliceAnnotation(
    childStep,
    'CHAMFER',
    featureId,
    descriptor,
  );
  return { featureId, shapeAspectEntityId };
}

// ─── validation ──────────────────────────────────────────────────────────

/**
 * Lightweight re-validation of FilletFeature scalar fields. The full
 * geometry validation already runs in filletProfile.buildFilletFeature —
 * we only re-check the bits that could be mutated by a caller writing the
 * feature object directly (TypeScript can't prevent that). This catches
 * obvious mistakes (negative radius, non-finite) BEFORE we spend time on
 * the child STEP emission.
 */
function validateFilletParams(feature: FilletFeature): void {
  if (feature.vertexRadii !== undefined) {
    if (feature.vertexRadii.length === 0) {
      throw new Error('writeFilletAsStep: vertexRadii must be non-empty');
    }
    for (let i = 0; i < feature.vertexRadii.length; i++) {
      const r = feature.vertexRadii[i]!;
      if (!Number.isFinite(r) || r <= 0) {
        throw new Error(
          `writeFilletAsStep: vertexRadii[${i}] must be a positive finite number, got: ${r}`,
        );
      }
    }
    return;
  }
  if (!Number.isFinite(feature.radius) || feature.radius <= 0) {
    throw new Error(
      `writeFilletAsStep: radius must be a positive finite number, got: ${feature.radius}`,
    );
  }
}

function validateChamferParams(feature: ChamferFeature): void {
  if (feature.vertexDistances !== undefined) {
    if (feature.vertexDistances.length === 0) {
      throw new Error('writeChamferAsStep: vertexDistances must be non-empty');
    }
    for (let i = 0; i < feature.vertexDistances.length; i++) {
      const d = feature.vertexDistances[i]!;
      if (!Number.isFinite(d) || d <= 0) {
        throw new Error(
          `writeChamferAsStep: vertexDistances[${i}] must be a positive finite number, got: ${d}`,
        );
      }
    }
    return;
  }
  if (!Number.isFinite(feature.distance) || feature.distance <= 0) {
    throw new Error(
      `writeChamferAsStep: distance must be a positive finite number, got: ${feature.distance}`,
    );
  }
}

// ─── escape-hatch exports for tests ───────────────────────────────────────

/** Internal API — exposed for unit tests only. Not stable. */
export const __internal = {
  scanMaxEntityId,
  findManifoldSolidBrepId,
  fmt,
  esc,
  buildFilletDescriptor,
  buildChamferDescriptor,
  spliceAnnotation,
};
