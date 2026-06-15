/**
 * stepWriteWithPmiOcctBindings — Phase 5.3.5 OCCT-direct integration
 * orchestrator. The Phase-2 superset of `stepWriteWithPmiBindings`.
 *
 * Composition stack
 * -----------------
 * Where `stepWriteWithPmi` (HH) integrates geometry + PMI body, and
 * `stepWriteWithPmiBindings` (NNN) layers Phase-1 SHAPE_ASPECT side-channel
 * bindings on top, THIS module layers Phase-2 OCCT-direct face anchors on top
 * of either of the above. The four canonical building blocks consumed here:
 *
 *   - stepWrite.ts                  (Agent-EE/FF)  — geometry writers
 *   - pmiExport.ts                  (Agent-II)     — PMI fragment writer
 *   - pmiOcctBinding.ts             (Agent-RRRRRR) — Phase-2 OCCT direct anchor
 *   - pmiShapeBinding.ts            (Agent-UU)     — Phase-1 SHAPE_ASPECT binder
 *
 * And the two existing orchestrators we delegate to:
 *
 *   - stepWriteWithPmi.ts           (Agent-HH)     — geometry + PMI splicer
 *   - stepWriteWithPmiBindings.ts   (Agent-NNN)    — SHAPE_ASPECT splicer
 *
 * Strict orchestrator contract — NONE of the modules above are modified by
 * this file. All composition is via the existing exported APIs (including
 * the documented `__internal` surfaces of HH for splitStepFile re-use).
 *
 * What "OCCT-direct" means (Phase 2 vs Phase 1)
 * ---------------------------------------------
 * Phase 1 (SHAPE_ASPECT) emits a side-channel entity row per PMI ref so a
 * reader walking the AP242 shape representation can follow `ref → SA → name`
 * to recover the binding. The downside: an extra indirection and a name-keyed
 * lookup that OCCT-aware PMI viewers (NIST STEP File Analyzer, KISTERS
 * 3DViewStation, OCCT's own XDE demo) treat as opaque.
 *
 * Phase 2 (this module) patches the PMI source IN-PLACE so the PMI entity
 * itself references `#<ADVANCED_FACE-id>` directly. No new rows. This is the
 * representation OCCT itself round-trips via `XCAFDoc_DimTolTool::AddDimension
 * (face_label, ...)` — PMI shows up anchored to the correct face on the very
 * first import, no SA-name matching required.
 *
 * Hybrid modes — why three settings instead of one
 * ------------------------------------------------
 *   - 'occt'         — Phase 2 only. Smallest file, OCCT-native. Used by
 *                      manufacturing exports where the downstream is known to
 *                      be an OCCT-based viewer / CAM. Default when the caller
 *                      supplies `occtBindings` + `shapeMeta`.
 *   - 'shape_aspect' — Phase 1 only. Side-channel ONLY, no in-place patching.
 *                      Equivalent to calling `writeStepWithPmiBindings`
 *                      directly. Used for AP242 consumers that walk SA name
 *                      maps (Teamcenter, JT2Go).
 *   - 'both'         — Phase 1 SHAPE_ASPECT rows AND Phase 2 OCCT-direct
 *                      anchors. Backwards-compatible superset — produces a
 *                      slightly larger file (the SA rows) but matches whatever
 *                      the downstream toolchain prefers. Used in the
 *                      manufacturing export "max compatibility" preset and as
 *                      the migration default while consumers move from SA to
 *                      direct.
 *
 * Ordering in 'both' mode (matters — the two patchers target the same TODO
 * comments):
 *   1. Run Phase 1 (`bindPmiToShape`) on the ORIGINAL PMI source. This emits
 *      the SHAPE_ASPECT additional rows AND rewrites each TODO comment from
 *      `(Phase 2 OCCT plumbing)` → `bound to #<SA>` (the Phase-1 suffix
 *      convention from `pmiShapeBinding`).
 *   2. Run Phase 2 (`bindPmiToOcctFace`) on the ALREADY-PHASE-1-PATCHED PMI.
 *      Phase 2's TODO regex requires the `(Phase 2 OCCT plumbing)` marker
 *      that Phase 1 just removed, so it won't double-patch the comments —
 *      which is exactly what we want. But Phase 2 ALSO supports the
 *      `__OCCT_REF__<refId>__` magic-token mechanism, which is untouched by
 *      Phase 1; those tokens are rewritten to `#<ADVANCED_FACE-id>` so any
 *      custom entity slots wired by the caller still resolve.
 *   3. Final layout: HEADER + geometry-entities + [phase1-patched PMI] +
 *      [SHAPE_ASPECT additions] + tail. The Phase-2 patching is in-place on
 *      the PMI text (no extra rows), so this assembly order matches NNN's
 *      output structure exactly.
 *
 * faceIdx invariant
 * -----------------
 * `OcctPmiBinding.faceRef.faceIdx` is the ordinal index produced by walking
 * the solid with `TopExp_Explorer(TopAbs_FACE)` — i.e. the same order in
 * which `stepWrite` emits the `ADVANCED_FACE` rows. The caller MUST supply
 * `shapeMeta.faceEntityIds[]` with `length === number of ADVANCED_FACE rows`
 * AND `faceEntityIds[i] === <STEP entity id of i-th face>`. The Phase-2
 * binder throws `out of range` if any binding indexes past the table — this
 * orchestrator forwards that throw verbatim because silently anchoring PMI
 * to nothing is exactly the bug a CI must catch.
 *
 * (When the caller already knows the entity id — e.g. it ran an extraction
 * walk over the geometry source itself — they can set
 * `OcctFaceRef.entityId` directly and pass an empty `faceEntityIds: []`;
 * the binder's per-binding fast path skips the table lookup. See the
 * `pmiOcctBinding` tests for the precedence rules.)
 *
 * Entity-id regions (always strictly increasing — verified in the test suite):
 *   - Geometry      : 1..G          (from stepWrite)
 *   - PMI           : G+1..P        (from writePmiFragment[WithSavedView])
 *   - SHAPE_ASPECT  : P+1..S        (from bindPmiToShape; 'shape_aspect'|'both' only)
 *   - Phase-2 OCCT  : NONE          (Phase 2 emits zero new rows; it only
 *                                    rewrites placeholder slots in the PMI
 *                                    text to reference existing geometry ids)
 *
 * Edge cases handled by short-circuit:
 *   - pmi undefined                 → geometry-only STEP; both bindings warned-out
 *   - pmi.sheet has 0 dim & 0 gdt   → geometry-only STEP; both bindings warned-out
 *   - occtBindings empty + 'occt'   → identical to writeStepWithPmi(pmi) output
 *   - shapeMeta absent + occt path  → throws (no way to resolve faceIdx)
 *   - hybridMode 'shape_aspect'     → occtBindings + shapeMeta are IGNORED
 *                                     with a warning (let the caller catch
 *                                     accidental flag misconfig)
 *   - withSavedView=true            → emits DRAUGHTING_MODEL container around
 *                                     the PMI body BEFORE OCCT patch; the
 *                                     patcher sees the same TODOs in the body
 *                                     so anchoring still works
 */

import {
  writeStepWithPmiBindings,
  __internal as stepWriteWithPmiBindingsInternal,
  type StepWithPmiBindingsOptions,
} from './stepWriteWithPmiBindings';
import {
  writeStepWithPmi,
  __internal as stepWriteWithPmiInternal,
  type StepGeometryInput,
  type WriteStepWithPmiOptions,
} from './stepWriteWithPmi';
import type { StepHeaderOptions } from './stepWrite';
import type { Sheet } from '@/lib/drawing/sheet';
import { validateSheet } from '@/lib/drawing/sheet';
import {
  writePmiFragment,
  writePmiFragmentWithSavedView,
  type WritePmiSavedViewOptions,
} from './pmiExport';
import {
  bindPmiToOcctFace,
  type OcctPmiBinding,
  type OcctShapeMeta,
} from './pmiOcctBinding';
import {
  bindPmiToShape,
  type RefBinding,
} from './pmiShapeBinding';

// ─── public API ───────────────────────────────────────────────────────────

/**
 * Selects which binding strategy / strategies are emitted into the final
 * STEP file. See module-level JSDoc for the trade-off matrix.
 *
 *   - 'occt'         — Phase 2 OCCT-direct only.
 *   - 'shape_aspect' — Phase 1 SHAPE_ASPECT only (NNN behaviour).
 *   - 'both'         — Phase 1 SHAPE_ASPECT rows AND Phase 2 OCCT-direct
 *                      in-place patches. Backwards-compat superset.
 */
export type HybridBindingMode = 'occt' | 'shape_aspect' | 'both';

/** Options accepted by {@link writeStepWithPmiOcctBindings}. */
export interface StepWithPmiOcctOptions {
  /** Geometry source — same discriminated union accepted by writeStepWithPmi. */
  geometry: StepGeometryInput;
  /**
   * Optional PMI payload. When omitted, behaviour collapses to the underlying
   * geometry writer output — both `occtBindings` and `shapeAspectBindings`
   * (if supplied) are ignored and surface as warnings so callers can detect
   * the misuse.
   */
  pmi?: { sheet: Sheet };
  /**
   * Phase-2 OCCT-direct bindings. Each entry maps a Sheet IR ref id (the same
   * id used in `Dimension.refs[]` / `GdtCallout.targetRef`) to an OCCT face
   * via `faceIdx` (looked up in `shapeMeta.faceEntityIds`) OR `entityId`
   * (caller-supplied, wins over the lookup).
   *
   * Consumed when `hybridMode` is `'occt'` or `'both'` (default `'occt'` if
   * any occtBindings supplied). Ignored when `'shape_aspect'` (with warning).
   */
  occtBindings?: ReadonlyArray<OcctPmiBinding>;
  /**
   * Geometry-side metadata used to resolve `OcctPmiBinding.faceRef.faceIdx`.
   * REQUIRED when any `occtBindings` entry omits its `faceRef.entityId`. May
   * be omitted only if every binding supplies `entityId` directly (typical
   * for unit tests).
   */
  shapeMeta?: OcctShapeMeta;
  /**
   * Phase-1 SHAPE_ASPECT bindings — identical shape to NNN's `bindings`
   * option. Consumed when `hybridMode` is `'shape_aspect'` or `'both'`.
   * Ignored when `'occt'` (with warning).
   *
   * Named `shapeAspectBindings` (not `bindings`) so the API surfaces both
   * Phase-1 and Phase-2 binding inputs distinctly — preventing a silent
   * misroute when the caller mixes hybrid modes.
   */
  shapeAspectBindings?: ReadonlyArray<RefBinding>;
  /**
   * Which Phase(s) to emit. Defaults are designed to do the right thing for
   * a caller who supplied exactly one binding kind:
   *   - both kinds supplied         → 'both'
   *   - only occtBindings supplied  → 'occt'
   *   - only SA bindings supplied   → 'shape_aspect'
   *   - neither (PMI only)          → 'occt' (no-op for binding work)
   *   - explicit value              → honoured exactly (binding inputs that
   *                                    don't match the mode are warned-out)
   */
  hybridMode?: HybridBindingMode;
  /**
   * When true, wrap the PMI fragment in an AP242 DRAUGHTING_MODEL saved-view
   * container via `writePmiFragmentWithSavedView`. The wrapper emits even for
   * an empty sheet (per the underlying contract). The Phase-2 patcher sees
   * the body's TODO comments regardless of the wrapper, so OCCT-direct
   * anchoring still works inside a saved view.
   */
  withSavedView?: boolean;
  /**
   * Forwarded to {@link writePmiFragmentWithSavedView} when
   * `withSavedView: true`. Ignored otherwise.
   */
  savedViewOptions?: WritePmiSavedViewOptions;
  /** ISO-10303-21 HEADER overrides (forwarded to the geometry writer). */
  header?: StepHeaderOptions;
  /** Optional product name for single-solid geometry variants. */
  productName?: string;
  /** Forwarded to `writeExtrudePolygonAsStep` when geometry.kind === 'polygon'. */
  onPolygonFallback?: WriteStepWithPmiOptions['onPolygonFallback'];
  /** Forwarded to `writeAssemblyAsStep` when geometry.kind === 'assembly'. */
  onAssemblyPartFallback?: WriteStepWithPmiOptions['onAssemblyPartFallback'];
}

/** Result of {@link writeStepWithPmiOcctBindings}. */
export interface StepWithPmiOcctResult {
  /** Complete ISO-10303-21 STEP source (HEADER + DATA + END-ISO trailer). */
  source: string;
  /**
   * Merged `Sheet ref id → STEP entity id` for every binding that resolved.
   * The id is whichever was successfully anchored:
   *   - Phase 2 'occt'         → the ADVANCED_FACE entity id
   *   - Phase 1 'shape_aspect' → the SHAPE_ASPECT entity id (NNN semantics)
   *   - 'both'                 → the Phase-2 ADVANCED_FACE id wins; the
   *                              Phase-1 SHAPE_ASPECT id is still emitted into
   *                              the file, just not surfaced in the map (read
   *                              the file if you need both).
   * Empty when no PMI fragment was emitted or no binding resolved.
   */
  pmiMapping: Map<string, number>;
  /**
   * Diagnostics surfaced during composition. Aggregates:
   *   - bindings supplied but pmi omitted   ('… ignored: pmi undefined')
   *   - bindings supplied but PMI empty     ('… ignored: empty PMI fragment')
   *   - mode mismatch                       ('… ignored: hybridMode=…')
   *   - per-binding warnings from each binder (verbatim — prefixed with
   *     `'occt:'` / `'sa:'` so the source layer is identifiable)
   */
  warnings: string[];
}

// ─── internal helpers ────────────────────────────────────────────────────

/**
 * Decide the effective hybrid mode when the caller didn't pass one. See the
 * `hybridMode` option JSDoc for the policy. Pulled out for testability.
 */
function resolveHybridMode(opts: StepWithPmiOcctOptions): HybridBindingMode {
  if (opts.hybridMode) return opts.hybridMode;
  const hasOcct = (opts.occtBindings?.length ?? 0) > 0;
  const hasSa = (opts.shapeAspectBindings?.length ?? 0) > 0;
  if (hasOcct && hasSa) return 'both';
  if (hasSa) return 'shape_aspect';
  // hasOcct or neither — both fall through to the OCCT-native default. The
  // "neither" case is a no-op binding-wise, so the default is harmless.
  return 'occt';
}

/**
 * Normalise the geometry-only STEP source to end the DATA-entities block
 * with a single trailing newline so the PMI fragment splices cleanly.
 * Mirrors `stepWriteWithPmiBindings.__internal.ensureTrailingNewline`.
 */
function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

/**
 * Pick the right PMI writer for the requested envelope. Same shape as the
 * helper in NNN, kept LOCAL so this module has no dependency on NNN's
 * `__internal` surface (which is documented as unstable).
 */
function emitPmiFragment(
  sheet: Sheet,
  startEntityId: number,
  withSavedView: boolean,
  savedViewOptions: WritePmiSavedViewOptions | undefined,
) {
  if (withSavedView) {
    return writePmiFragmentWithSavedView(sheet, startEntityId, savedViewOptions ?? {});
  }
  return writePmiFragment(sheet, startEntityId);
}

/** Build a fresh options bag for `writeStepWithPmi` (used by the no-PMI path). */
function geometryOnlyOpts(
  opts: StepWithPmiOcctOptions,
): WriteStepWithPmiOptions {
  return {
    geometry: opts.geometry,
    ...(opts.header ? { header: opts.header } : {}),
    ...(opts.productName !== undefined ? { productName: opts.productName } : {}),
    ...(opts.onPolygonFallback ? { onPolygonFallback: opts.onPolygonFallback } : {}),
    ...(opts.onAssemblyPartFallback
      ? { onAssemblyPartFallback: opts.onAssemblyPartFallback }
      : {}),
  };
}

/**
 * Build a forwarded options bag for `writeStepWithPmiBindings`. Used by the
 * 'shape_aspect' fast path, which delegates entirely to NNN (no Phase-2 work
 * to do, so we don't need to re-implement HH's splice surgery here).
 */
function shapeAspectOnlyOpts(
  opts: StepWithPmiOcctOptions,
  bindings: ReadonlyArray<RefBinding>,
): StepWithPmiBindingsOptions {
  if (!opts.pmi) {
    // Guarded by the caller — this branch only runs when pmi is defined. The
    // assertion keeps the TypeScript narrowing tight.
    throw new Error('stepWriteWithPmiOcctBindings: shapeAspectOnlyOpts requires pmi');
  }
  return {
    geometry: opts.geometry,
    pmi: opts.pmi,
    bindings,
    ...(opts.withSavedView !== undefined ? { withSavedView: opts.withSavedView } : {}),
    ...(opts.savedViewOptions ? { savedViewOptions: opts.savedViewOptions } : {}),
    ...(opts.header ? { header: opts.header } : {}),
    ...(opts.productName !== undefined ? { productName: opts.productName } : {}),
    ...(opts.onPolygonFallback ? { onPolygonFallback: opts.onPolygonFallback } : {}),
    ...(opts.onAssemblyPartFallback
      ? { onAssemblyPartFallback: opts.onAssemblyPartFallback }
      : {}),
  };
}

// ─── public entry point ──────────────────────────────────────────────────

/**
 * Emit a complete ISO-10303-21 STEP file that combines:
 *   - geometry from {@link writeStepWithPmi}'s underlying writers,
 *   - an AP242 PMI fragment from {@link writePmiFragment} (or its saved-view
 *     wrapper),
 *   - Phase-2 OCCT-direct face anchors via {@link bindPmiToOcctFace} (when
 *     `hybridMode` is `'occt'` or `'both'`),
 *   - Phase-1 SHAPE_ASPECT side-channel rows via {@link bindPmiToShape} (when
 *     `hybridMode` is `'shape_aspect'` or `'both'`).
 *
 * See module-level JSDoc for the full algorithm + hybrid-mode trade-offs.
 */
export function writeStepWithPmiOcctBindings(
  opts: StepWithPmiOcctOptions,
): StepWithPmiOcctResult {
  const warnings: string[] = [];
  const mode = resolveHybridMode(opts);
  const occtBindings = opts.occtBindings ?? [];
  const saBindings = opts.shapeAspectBindings ?? [];

  // ── 1. Validate the sheet up-front so bad input fails fast.
  if (opts.pmi) {
    validateSheet(opts.pmi.sheet);
  }

  // ── 2. Surface mode-vs-input mismatches as warnings (per spec — we never
  //       silently ignore data).
  if (mode === 'occt' && saBindings.length > 0) {
    warnings.push(
      'shapeAspectBindings ignored: hybridMode=occt (set hybridMode=both to emit)',
    );
  }
  if (mode === 'shape_aspect' && occtBindings.length > 0) {
    warnings.push(
      'occtBindings ignored: hybridMode=shape_aspect (set hybridMode=both to emit)',
    );
  }

  // ── 3. Fast path: no PMI at all. Delegate to writeStepWithPmi so the
  //       geometry envelope is byte-identical to the canonical reference,
  //       and warn out any binding inputs.
  if (!opts.pmi) {
    const source = writeStepWithPmi(geometryOnlyOpts(opts));
    if (occtBindings.length > 0) {
      warnings.push('occtBindings ignored: pmi undefined');
    }
    if (saBindings.length > 0) {
      warnings.push('shapeAspectBindings ignored: pmi undefined');
    }
    return { source, pmiMapping: new Map<string, number>(), warnings };
  }

  // ── 4. 'shape_aspect' fast path: delegate entirely to NNN. Phase-2 inputs
  //       (if any) are already warned-out above. We surface NNN's warnings
  //       under the `sa:` prefix so a combined caller can route them.
  if (mode === 'shape_aspect') {
    const effectiveBindings = mode === 'shape_aspect' ? saBindings : [];
    const nnnResult = writeStepWithPmiBindings(
      shapeAspectOnlyOpts(opts, effectiveBindings),
    );
    for (const w of nnnResult.warnings) {
      warnings.push(`sa: ${w}`);
    }
    return {
      source: nnnResult.source,
      pmiMapping: new Map(nnnResult.pmiMapping),
      warnings,
    };
  }

  // ── 5. 'occt' or 'both' path. From here on we need direct control over
  //       the PMI text (so the Phase-2 in-place patch can run) — NNN's
  //       integrated splicer doesn't expose the intermediate PMI string,
  //       so we re-do the geometry + split here using HH's tested helper.
  const geometryOnly = writeStepWithPmi(geometryOnlyOpts(opts));
  const split = stepWriteWithPmiInternal.splitStepFile(geometryOnly);

  // ── 6. Emit the PMI fragment (saved-view variant if requested) at
  //       maxGeometryId + 1 so ids never collide.
  const pmiResult = emitPmiFragment(
    opts.pmi.sheet,
    split.maxEntityId + 1,
    opts.withSavedView === true,
    opts.savedViewOptions,
  );

  // ── 7. Empty PMI body (sheet has 0 dim + 0 gdt AND no saved-view wrapper)
  //       → no patching possible. Mirror HH's no-op behaviour and warn any
  //       bindings out so the caller sees the misuse.
  if (pmiResult.source.length === 0) {
    if (occtBindings.length > 0) {
      warnings.push('occtBindings ignored: empty PMI fragment');
    }
    if (saBindings.length > 0 && mode === 'both') {
      warnings.push('shapeAspectBindings ignored: empty PMI fragment');
    }
    return {
      source: geometryOnly,
      pmiMapping: new Map<string, number>(),
      warnings,
    };
  }

  // ── 8. Run Phase 1 (SHAPE_ASPECT) FIRST in 'both' mode. Order matters
  //       because both phases target the same TODO comments — running
  //       Phase 1 first patches `(Phase 2 OCCT plumbing)` → `bound to #<SA>`,
  //       so Phase 2's TODO regex (which requires that exact suffix) will
  //       no-op on the comments. Phase 2's `__OCCT_REF__` magic-token
  //       mechanism is untouched by Phase 1 and still works. The resulting
  //       file carries BOTH the SHAPE_ASPECT side-channel rows (for AP242
  //       consumers that walk SA names) AND OCCT-direct anchors in any
  //       magic-token slots the caller wired (for OCCT-native consumers).
  let workingPmi = pmiResult.source;
  let additionalSource = '';
  const pmiMapping = new Map<string, number>();

  if (mode === 'both' && saBindings.length > 0) {
    const saResult = bindPmiToShape({
      bindings: saBindings,
      pmiFragment: pmiResult,
      startEntityId: pmiResult.lastEntityId + 1,
    });
    workingPmi = saResult.patchedPmi;
    additionalSource = saResult.additionalSource;
    for (const [ref, id] of saResult.mapping) {
      pmiMapping.set(ref, id);
    }
    for (const w of saResult.warnings) {
      warnings.push(`sa: ${w}`);
    }
  }

  // ── 9. Run Phase 2 (OCCT-direct). When mode is 'occt' the workingPmi is
  //       still the original; when 'both' it's the Phase-1-patched version
  //       (Phase 2 will only succeed against magic tokens in that case).
  //       The Phase-2 mapping WINS for any ref present in both layers (the
  //       ADVANCED_FACE entity id is the more useful surface — readers can
  //       always inspect the file directly for the SHAPE_ASPECT id).
  if (occtBindings.length > 0) {
    // shapeMeta is required when any binding lacks `entityId`. Validate up
    // front so a misuse fails before we run the binder (which would
    // otherwise throw inside resolveEntityId with a less obvious message).
    const needsLookup = occtBindings.some(
      (b) => typeof b.faceRef.entityId !== 'number',
    );
    if (needsLookup && !opts.shapeMeta) {
      throw new Error(
        'stepWriteWithPmiOcctBindings: shapeMeta required when any occtBinding ' +
          'omits faceRef.entityId (faceIdx cannot be resolved without faceEntityIds)',
      );
    }
    const effectiveMeta: OcctShapeMeta =
      opts.shapeMeta ?? { faceEntityIds: [] };

    const occtResult = bindPmiToOcctFace(
      workingPmi,
      occtBindings,
      effectiveMeta,
    );
    workingPmi = occtResult.patched;
    // Phase 2 mapping wins on collision (see step 9 rationale above).
    for (const [ref, id] of occtResult.mapping) {
      pmiMapping.set(ref, id);
    }
    for (const w of occtResult.warnings) {
      warnings.push(`occt: ${w}`);
    }
  }

  // ── 10. Re-assemble. Ordering matches NNN's contract so a hybrid file
  //        looks structurally identical to a SA-only file when the Phase-2
  //        patches are in place (Phase 2 is in-place, no new rows). Phase-1
  //        additions come AFTER the PMI body to keep id regions monotonic.
  const geomBlock = ensureTrailingNewline(split.dataEntities);
  const finalSource = `${split.headerBlock}${geomBlock}${workingPmi}${additionalSource}${split.tail}`;

  return { source: finalSource, pmiMapping, warnings };
}

// ─── escape-hatch exports for tests ───────────────────────────────────────

/** Internal API surface — not stable; exposed for unit tests only. */
export const __internal = {
  resolveHybridMode,
  ensureTrailingNewline,
  emitPmiFragment,
  geometryOnlyOpts,
  shapeAspectOnlyOpts,
  // Re-export the NNN + HH internals we depend on so a test can assert the
  // delegation contract without separately importing them.
  splitStepFile: stepWriteWithPmiInternal.splitStepFile,
  nnnEnsureTrailingNewline: stepWriteWithPmiBindingsInternal.ensureTrailingNewline,
};
