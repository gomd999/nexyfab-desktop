/**
 * stepWriteWithPmiBindings — Phase 5.3 full integration orchestrator.
 *
 * Thin composer that wires four existing modules into a single STEP file with
 * geometry + PMI + shape bindings:
 *
 *   - stepWrite.ts                   (Agent-EE/FF — geometry writers)
 *   - pmiExport.ts                   (Agent-II — PMI fragment writer)
 *   - pmiShapeBinding.ts             (Agent-UU — SHAPE_ASPECT binder)
 *   - stepWriteWithPmi.ts            (Agent-HH — geometry+PMI splicer; reused
 *                                    here for its `splitStepFile` helper and
 *                                    the canonical no-PMI fast path)
 *
 * This module is a STRICT orchestrator. It NEVER modifies any of those four
 * source files. All it does is:
 *
 *   1. Ask `writeStepWithPmi` for the geometry-only STEP source (no PMI) so
 *      the geometry envelope and HEADER stay byte-identical to the existing
 *      writers.
 *   2. Split that source with the existing `splitStepFile` helper exposed via
 *      `stepWriteWithPmi.__internal` to recover (a) the HEADER block, (b) the
 *      geometry DATA-entity lines, (c) the tail (ENDSEC; + END-ISO marker),
 *      and (d) the max entity id observed in the geometry block.
 *   3. If a PMI sheet was supplied, call `writePmiFragment` (or
 *      `writePmiFragmentWithSavedView` when `withSavedView: true`) with
 *      `geometryMax + 1` so PMI ids never collide with geometry ids.
 *   4. If bindings were supplied AND the PMI fragment is non-empty, call
 *      `bindPmiToShape` with `pmiLastEntityId + 1` so SHAPE_ASPECT ids start
 *      strictly above PMI ids.
 *   5. Re-assemble: HEADER + geometry-entities + patched-PMI + SHAPE_ASPECT
 *      additions + tail.
 *
 * Why two layers of orchestration (HH + this module):
 *   - HH (`stepWriteWithPmi`) is the canonical geometry+PMI integration. Most
 *     callers want PMI without binding to specific geometry entities; they
 *     should continue to use HH directly. This module is the OPT-IN superset
 *     for callers that have a `bindings` list ready (e.g. manufacturing
 *     drawings with explicit face → ADVANCED_FACE links from an OCCT walk).
 *   - Stacking on top of HH guarantees that the geometry envelope, HEADER
 *     validation, and DATA-section surgery all stay in lock-step with the
 *     reference implementation. If HH grows a new geometry kind, we inherit
 *     it for free.
 *
 * Entity-id regions (always strictly increasing — verified in the test suite):
 *   - Geometry      : 1..G          (from stepWrite)
 *   - PMI           : G+1..P        (from writePmiFragment[WithSavedView])
 *   - SHAPE_ASPECT  : P+1..S        (from bindPmiToShape)
 *
 * Edge cases handled by short-circuit:
 *   - pmi undefined                 → geometry-only STEP; bindings warned-out
 *   - pmi.sheet has 0 dim & 0 gdt   → geometry-only STEP; bindings warned-out
 *   - bindings undefined / empty    → identical to writeStepWithPmi output
 *   - withSavedView=true + empty sheet → still emits DRAUGHTING_MODEL container
 *     (per the writePmiFragmentWithSavedView contract); bindings warned-out
 *     because nothing in the saved-view body contains a TODO ref to match
 *   - binding ref absent from PMI   → skipped + warning surfaced (from
 *                                     bindPmiToShape directly)
 */

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
  type WritePmiFragmentResult,
  type WritePmiSavedViewResult,
  type WritePmiSavedViewOptions,
} from './pmiExport';
import {
  bindPmiToShape,
  type RefBinding,
} from './pmiShapeBinding';

// ─── public API ───────────────────────────────────────────────────────────

/** Options accepted by {@link writeStepWithPmiBindings}. */
export interface StepWithPmiBindingsOptions {
  /** Geometry source — same discriminated union accepted by writeStepWithPmi. */
  geometry: StepGeometryInput;
  /**
   * Optional PMI payload. When omitted, behaviour collapses to the underlying
   * geometry writer output — `bindings` (if supplied) are ignored and surface
   * as a warning so callers can detect the misuse.
   */
  pmi?: { sheet: Sheet };
  /**
   * Optional bindings linking Sheet IR ref ids → STEP entity ids. Each
   * binding is consumed by `bindPmiToShape`, which emits one SHAPE_ASPECT
   * + one SHAPE_DEFINITION_REPRESENTATION per unique resolved ref. Empty
   * array is equivalent to omitting the field.
   */
  bindings?: ReadonlyArray<RefBinding>;
  /**
   * When true, wrap the PMI fragment in an AP242 DRAUGHTING_MODEL saved-view
   * container via `writePmiFragmentWithSavedView`. The wrapper emits even for
   * an empty sheet (per the underlying contract), so toggling this on with
   * an empty sheet still adds the saved-view scaffold — but `bindings` will
   * still be ignored because no TODO comments exist to match.
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

/** Result of {@link writeStepWithPmiBindings}. */
export interface StepWithPmiBindingsResult {
  /** Complete ISO-10303-21 STEP source (HEADER + DATA + END-ISO trailer). */
  source: string;
  /**
   * `Sheet ref id → SHAPE_ASPECT entity id`. Only resolved bindings appear
   * (refs absent from the PMI source are skipped — see `warnings`). Empty
   * when no PMI fragment was emitted or no binding resolved.
   */
  pmiMapping: Map<string, number>;
  /**
   * Diagnostics surfaced during composition. Includes:
   *   - bindings supplied but pmi was omitted   ('bindings ignored: pmi undefined')
   *   - bindings supplied but PMI was empty     ('bindings ignored: empty PMI fragment')
   *   - bindings whose ref was not referenced   (forwarded from bindPmiToShape)
   */
  warnings: string[];
}

// ─── internal helpers ────────────────────────────────────────────────────

/**
 * Normalise the geometry-only STEP source to end the DATA-entities block
 * with a single trailing newline so the PMI fragment splices cleanly without
 * producing a stray blank line at the boundary. Mirrors the same convention
 * used inside `stepWriteWithPmi.writeStepWithPmi`.
 */
function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

/**
 * Pick the right PMI writer for the requested envelope. Returns the result
 * verbatim so the caller can read `source` + `lastEntityId` uniformly.
 */
function emitPmiFragment(
  sheet: Sheet,
  startEntityId: number,
  withSavedView: boolean,
  savedViewOptions: WritePmiSavedViewOptions | undefined,
): WritePmiFragmentResult | WritePmiSavedViewResult {
  if (withSavedView) {
    return writePmiFragmentWithSavedView(sheet, startEntityId, savedViewOptions ?? {});
  }
  return writePmiFragment(sheet, startEntityId);
}

// ─── public entry point ──────────────────────────────────────────────────

/**
 * Emit a complete ISO-10303-21 STEP file that combines:
 *   - geometry from {@link writeStepWithPmi}'s underlying writers,
 *   - an AP242 PMI fragment from {@link writePmiFragment} (or its saved-view
 *     wrapper),
 *   - SHAPE_ASPECT + SHAPE_DEFINITION_REPRESENTATION entities linking PMI
 *     refs to actual geometry entity ids via {@link bindPmiToShape}.
 *
 * See module-level JSDoc for the full algorithm + edge-case matrix.
 */
export function writeStepWithPmiBindings(
  opts: StepWithPmiBindingsOptions,
): StepWithPmiBindingsResult {
  const warnings: string[] = [];

  // ── 1. validate the sheet up-front (mirrors writeStepWithPmi) ───────────
  if (opts.pmi) {
    validateSheet(opts.pmi.sheet);
  }

  // ── 2. fast path: no PMI → no binding work needed. We DON'T need to ask
  //    HH for splicing because there's nothing to splice. We DO still call
  //    HH (without pmi) so the geometry envelope is byte-identical to the
  //    reference implementation rather than re-derived here.
  if (!opts.pmi) {
    const source = writeStepWithPmi({
      geometry: opts.geometry,
      ...(opts.header ? { header: opts.header } : {}),
      ...(opts.productName !== undefined ? { productName: opts.productName } : {}),
      ...(opts.onPolygonFallback ? { onPolygonFallback: opts.onPolygonFallback } : {}),
      ...(opts.onAssemblyPartFallback
        ? { onAssemblyPartFallback: opts.onAssemblyPartFallback }
        : {}),
    });
    if (opts.bindings && opts.bindings.length > 0) {
      warnings.push('bindings ignored: pmi undefined');
    }
    return { source, pmiMapping: new Map<string, number>(), warnings };
  }

  // ── 3. emit geometry alone (HH handles the writer dispatch + HEADER
  //    validation) so we can recover the max geometry entity id.
  const geometryOnly = writeStepWithPmi({
    geometry: opts.geometry,
    ...(opts.header ? { header: opts.header } : {}),
    ...(opts.productName !== undefined ? { productName: opts.productName } : {}),
    ...(opts.onPolygonFallback ? { onPolygonFallback: opts.onPolygonFallback } : {}),
    ...(opts.onAssemblyPartFallback
      ? { onAssemblyPartFallback: opts.onAssemblyPartFallback }
      : {}),
  });

  // Split into header / data-entities / tail. Reuses HH's tested helper so
  // we don't duplicate the marker-search logic.
  const split = stepWriteWithPmiInternal.splitStepFile(geometryOnly);

  // ── 4. PMI fragment with ids starting strictly above the geometry max.
  const pmiResult = emitPmiFragment(
    opts.pmi.sheet,
    split.maxEntityId + 1,
    opts.withSavedView === true,
    opts.savedViewOptions,
  );

  // ── 5. Empty PMI (sheet has 0 dim + 0 gdt AND no saved-view wrapper) →
  //    nothing to splice. Mirror writeStepWithPmi's no-op behaviour and warn
  //    if bindings were supplied.
  if (pmiResult.source.length === 0) {
    if (opts.bindings && opts.bindings.length > 0) {
      warnings.push('bindings ignored: empty PMI fragment');
    }
    return {
      source: geometryOnly,
      pmiMapping: new Map<string, number>(),
      warnings,
    };
  }

  // ── 6. If bindings present, run the binder; otherwise the patched PMI is
  //    the original PMI and there's no additional SHAPE_ASPECT block.
  let patchedPmi = pmiResult.source;
  let additionalSource = '';
  const pmiMapping = new Map<string, number>();

  if (opts.bindings && opts.bindings.length > 0) {
    const bindResult = bindPmiToShape({
      bindings: opts.bindings,
      pmiFragment: pmiResult,
      startEntityId: pmiResult.lastEntityId + 1,
    });
    patchedPmi = bindResult.patchedPmi;
    additionalSource = bindResult.additionalSource;
    for (const [ref, id] of bindResult.mapping) {
      pmiMapping.set(ref, id);
    }
    for (const w of bindResult.warnings) {
      warnings.push(w);
    }
  }

  // ── 7. Re-assemble. Ordering: HEADER + geometry-entities + PMI + SHAPE_ASPECT + tail.
  //    All three middle pieces are newline-terminated per their respective
  //    writer contracts; we still normalise the geometry block to guard
  //    against any future writer that drops the trailing newline.
  const geomBlock = ensureTrailingNewline(split.dataEntities);
  const finalSource = `${split.headerBlock}${geomBlock}${patchedPmi}${additionalSource}${split.tail}`;

  return { source: finalSource, pmiMapping, warnings };
}

// ─── escape-hatch exports for tests ───────────────────────────────────────

/** Internal API surface — not stable; exposed for unit tests only. */
export const __internal = {
  ensureTrailingNewline,
  emitPmiFragment,
};
