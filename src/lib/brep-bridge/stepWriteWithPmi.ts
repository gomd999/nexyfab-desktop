/**
 * stepWriteWithPmi — Phase 5.3 STEP + PMI integration orchestrator.
 *
 * Composes `stepWrite` (geometry) and `pmiExport` (AP242 PMI fragment) into
 * a single valid ISO-10303-21 STEP file. This module is a STRICT orchestrator:
 *   - It NEVER modifies stepWrite.ts / pmiExport.ts / sheet.ts / extrudeProfile.ts
 *   - It performs only the minimum string surgery required to splice the PMI
 *     fragment into the geometry DATA section (no deep STEP parsing).
 *
 * Algorithm:
 *   1. Dispatch on `opts.geometry.kind` to one of `stepWrite`'s three public
 *      writers (extrude / polygon / assembly). All three already return a
 *      complete `ISO-10303-21; ... END-ISO-10303-21;\n` file.
 *   2. Validate header sanity: FILE_DESCRIPTION + FILE_NAME + FILE_SCHEMA
 *      records must all be present in the HEADER block.
 *   3. If `opts.pmi` is undefined → return the stepWrite output unchanged.
 *   4. Otherwise split the file at the `DATA;` / `ENDSEC;` markers, scan the
 *      DATA block for the maximum `#N` id, then call `writePmiFragment(
 *      sheet, maxId + 1)` to allocate non-colliding ids.
 *   5. If the PMI fragment is empty (sheet has no dimensions and no GD&T)
 *      → return the original stepWrite output unchanged.
 *   6. Else splice the fragment in just before the DATA-section `ENDSEC;`
 *      and re-assemble: HEADER + DATA(geometry + PMI) + ENDSEC + END-ISO.
 *
 * Why string surgery instead of a full STEP parser:
 *   - The stepWrite emitters guarantee a fixed envelope shape (single DATA
 *     section, `ENDSEC;` on its own line, trailing `END-ISO-10303-21;`).
 *   - All we need is the FIRST `DATA;` marker (start of geometry block) +
 *     the LAST `ENDSEC;` BEFORE `END-ISO-10303-21;` (geometry block close).
 *   - Entity-id extraction is line-based: `/^#(\d+)\s*=/`. No nested-bracket
 *     awareness required — the writers never emit `#N=` inside a string.
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { Sheet } from '@/lib/drawing/sheet';
import { validateSheet } from '@/lib/drawing/sheet';
import {
  writeExtrudeAsStep,
  writeExtrudePolygonAsStep,
  writeAssemblyAsStep,
  type StepHeaderOptions,
  type AssemblyPart,
  type AssemblyStepOptions,
  type PolygonExtrudeOptions,
  type ExtrudeToStepOptions,
} from './stepWrite';
import { writePmiFragment } from './pmiExport';

// ─── public API types ─────────────────────────────────────────────────────

/**
 * Geometry source — discriminated by `kind`. Each variant maps 1:1 to a
 * `stepWrite` public writer:
 *   - 'extrude'  → `writeExtrudeAsStep`              (bbox approximation)
 *   - 'polygon'  → `writeExtrudePolygonAsStep`       (true convex profile)
 *   - 'assembly' → `writeAssemblyAsStep`             (multi-part)
 */
export type StepGeometryInput =
  | { kind: 'extrude'; feature: ExtrudeFeature }
  | { kind: 'polygon'; feature: ExtrudeFeature }
  | {
      kind: 'assembly';
      /** Human-readable root assembly name embedded in the root PRODUCT. */
      assemblyName?: string;
      parts: ReadonlyArray<AssemblyPart>;
    };

/** Options passed to `writeStepWithPmi`. */
export interface WriteStepWithPmiOptions {
  geometry: StepGeometryInput;
  /**
   * Optional PMI payload. When omitted, behaviour is identical to calling
   * the underlying `stepWrite` writer directly.
   */
  pmi?: { sheet: Sheet };
  /** ISO-10303-21 HEADER overrides (author / org / description / etc.). */
  header?: StepHeaderOptions;
  /**
   * Forwarded to `writeExtrudePolygonAsStep` / `writeAssemblyAsStep` when the
   * geometry kind supports a polygon-→-bbox fallback. Optional in all paths.
   */
  onPolygonFallback?: PolygonExtrudeOptions['onFallback'];
  onAssemblyPartFallback?: AssemblyStepOptions['onFallback'];
  /** Optional product name for single-solid geometry variants. */
  productName?: string;
}

// ─── header validation ────────────────────────────────────────────────────

/** Required HEADER records per ISO 10303-21 §6.4. */
const REQUIRED_HEADER_RECORDS: ReadonlyArray<string> = [
  'FILE_DESCRIPTION(',
  'FILE_NAME(',
  'FILE_SCHEMA(',
];

/**
 * Cheap structural check that the HEADER block is well-formed. We do NOT
 * full-parse Part 21 — we only ensure the three mandatory records appear
 * between `HEADER;` and the matching `ENDSEC;`. Anything fancier (escaping
 * rules, list cardinalities) is the stepWrite writer's responsibility and
 * is covered by its own test suite.
 */
function assertValidHeader(headerBlock: string): void {
  if (!headerBlock.startsWith('ISO-10303-21;')) {
    throw new Error('stepWriteWithPmi: missing ISO-10303-21; start marker');
  }
  if (!headerBlock.includes('HEADER;')) {
    throw new Error('stepWriteWithPmi: missing HEADER; section opener');
  }
  for (const record of REQUIRED_HEADER_RECORDS) {
    if (!headerBlock.includes(record)) {
      throw new Error(`stepWriteWithPmi: HEADER missing required record ${record}...)`);
    }
  }
}

// ─── geometry dispatch ────────────────────────────────────────────────────

/**
 * Call the appropriate `stepWrite` writer for the given geometry input.
 * Returns a complete STEP file (with HEADER + DATA + END-ISO marker).
 */
function emitGeometry(
  geometry: StepGeometryInput,
  header: StepHeaderOptions | undefined,
  productName: string | undefined,
  polygonFallback: PolygonExtrudeOptions['onFallback'] | undefined,
  assemblyFallback: AssemblyStepOptions['onFallback'] | undefined,
): string {
  switch (geometry.kind) {
    case 'extrude': {
      const opts: ExtrudeToStepOptions = {
        ...(header ?? {}),
        ...(productName !== undefined ? { productName } : {}),
      };
      return writeExtrudeAsStep(geometry.feature, opts);
    }
    case 'polygon': {
      const opts: PolygonExtrudeOptions = {
        ...(header ?? {}),
        ...(productName !== undefined ? { productName } : {}),
        ...(polygonFallback ? { onFallback: polygonFallback } : {}),
      };
      return writeExtrudePolygonAsStep(geometry.feature, opts);
    }
    case 'assembly': {
      const opts: AssemblyStepOptions = {
        ...(header ?? {}),
        ...(assemblyFallback ? { onFallback: assemblyFallback } : {}),
      };
      return writeAssemblyAsStep(
        {
          assemblyName: geometry.assemblyName ?? 'assembly',
          parts: geometry.parts,
        },
        opts,
      );
    }
    default: {
      // Exhaustiveness check — surfaces any new StepGeometryInput variant.
      const _exhaustive: never = geometry;
      throw new Error(`stepWriteWithPmi: unknown geometry kind ${String(_exhaustive)}`);
    }
  }
}

// ─── DATA-section surgery ────────────────────────────────────────────────

/** Parsed split of a complete STEP file into its three logical regions. */
interface StepSplit {
  /** Everything from `ISO-10303-21;` up to and including the HEADER's `ENDSEC;`
   *  AND the blank line that follows (matches `writeStepHeader` output). */
  headerBlock: string;
  /** DATA section opener through the LAST `#N=...;` line (no `ENDSEC;`). */
  dataEntities: string;
  /** Trailing `ENDSEC;` + `END-ISO-10303-21;` (and any whitespace between). */
  tail: string;
  /** Maximum entity id observed in `dataEntities`. 0 when none found. */
  maxEntityId: number;
}

/**
 * Split a stepWrite output into HEADER, DATA-entities, and tail. The split
 * targets the LAST `ENDSEC;` before `END-ISO-10303-21;` so the PMI fragment
 * can be inserted just before that closer.
 *
 * Rationale for the marker-based approach (vs regex / full parse):
 *   - stepWrite always emits `DATA;` and `ENDSEC;` on their own lines.
 *   - It always closes with `END-ISO-10303-21;\n`.
 *   - Entity lines always match `/^#\d+=/`.
 *   - No comments or strings in the writers contain those exact markers at
 *     line start, so substring search is safe.
 */
function splitStepFile(step: string): StepSplit {
  // 1. Locate the END-ISO marker — the file's terminator.
  const endIsoMarker = 'END-ISO-10303-21;';
  const endIsoIdx = step.lastIndexOf(endIsoMarker);
  if (endIsoIdx === -1) {
    throw new Error('stepWriteWithPmi: input STEP missing END-ISO-10303-21; trailer');
  }

  // 2. Locate the DATA opener.
  const dataMarker = 'DATA;';
  const dataIdx = step.indexOf(dataMarker);
  if (dataIdx === -1 || dataIdx >= endIsoIdx) {
    throw new Error('stepWriteWithPmi: input STEP missing DATA; opener');
  }

  // 3. The geometry DATA's closing ENDSEC; is the LAST ENDSEC; that appears
  //    between `DATA;` and `END-ISO-10303-21;`. (The HEADER also has its
  //    own ENDSEC; — we ignore it by searching only the DATA region.)
  const endsecRegion = step.slice(dataIdx, endIsoIdx);
  const endsecMarker = 'ENDSEC;';
  const endsecRelIdx = endsecRegion.lastIndexOf(endsecMarker);
  if (endsecRelIdx === -1) {
    throw new Error('stepWriteWithPmi: DATA section missing closing ENDSEC;');
  }
  const endsecAbsIdx = dataIdx + endsecRelIdx;

  // 4. Carve out the three regions.
  //    headerBlock  = [0, dataIdx)
  //    dataEntities = [dataIdx, endsecAbsIdx)
  //    tail         = [endsecAbsIdx, end)
  const headerBlock = step.slice(0, dataIdx);
  const dataEntities = step.slice(dataIdx, endsecAbsIdx);
  const tail = step.slice(endsecAbsIdx);

  // 5. Scan dataEntities for the max #N. Use a line-anchored regex so
  //    references like `#42` *inside* an entity body don't inflate the id.
  const maxEntityId = scanMaxEntityId(dataEntities);

  return { headerBlock, dataEntities, tail, maxEntityId };
}

/**
 * Return the largest entity id N for which a line of the form `#N=...`
 * appears in the input. Returns 0 when no entity line is found.
 *
 * The regex anchors to start-of-line so the scan ignores references like
 * `,#42,` that appear inside an entity's argument list. Allows optional
 * whitespace between the id and the `=` to match any minor variation in
 * the writer's formatting (the current writer emits `#42=...` with no
 * whitespace, but we accept either form to stay defensive).
 */
function scanMaxEntityId(dataEntities: string): number {
  const entityLine = /^#(\d+)\s*=/gm;
  let max = 0;
  let match: RegExpExecArray | null;
  while ((match = entityLine.exec(dataEntities)) !== null) {
    const id = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max;
}

// ─── orchestrator entry point ─────────────────────────────────────────────

/**
 * Emit a complete ISO-10303-21 STEP file that combines geometry from the
 * `stepWrite` writers with an optional AP242 PMI fragment derived from a
 * drawing `Sheet`.
 *
 * Returns the full STEP source string (HEADER + DATA + END-ISO trailer).
 *
 * Behaviour matrix:
 *   - pmi undefined                 → identical to the underlying stepWrite call
 *   - pmi.sheet with 0 dim & 0 gdt  → identical to the underlying stepWrite call
 *                                      (writePmiFragment returns empty string)
 *   - pmi.sheet with annotations    → fragment spliced into DATA before ENDSEC;
 *                                      with ids starting at maxGeometryId + 1
 *
 * The function validates `pmi.sheet` via `validateSheet` BEFORE running the
 * stepWrite writer so invalid sheets fail fast with a clear error.
 */
export function writeStepWithPmi(opts: WriteStepWithPmiOptions): string {
  // ── 1. Validate the sheet up-front so bad input fails BEFORE we spend time
  //       emitting the (potentially large) geometry block.
  if (opts.pmi) {
    // validateSheet throws SheetValidationError on bad input.
    validateSheet(opts.pmi.sheet);
  }

  // ── 2. Dispatch to the appropriate stepWrite writer.
  const stepSource = emitGeometry(
    opts.geometry,
    opts.header,
    opts.productName,
    opts.onPolygonFallback,
    opts.onAssemblyPartFallback,
  );

  // ── 3. Header structural validation. We validate AFTER the writer call
  //       to assert the writer's contract (rather than re-implement it).
  const headerEnd = stepSource.indexOf('DATA;');
  if (headerEnd === -1) {
    throw new Error('stepWriteWithPmi: writer output missing DATA; section');
  }
  assertValidHeader(stepSource.slice(0, headerEnd));

  // ── 4. Fast path: no PMI requested → return the writer output as-is.
  if (!opts.pmi) return stepSource;

  // ── 5. Split the STEP into HEADER / DATA-entities / tail, then ask the
  //       PMI writer for a fragment with non-colliding ids.
  const split = splitStepFile(stepSource);
  const pmiResult = writePmiFragment(opts.pmi.sheet, split.maxEntityId + 1);

  // ── 6. Empty fragment (no dimensions and no GD&T) → return unchanged.
  if (pmiResult.source.length === 0) {
    return stepSource;
  }

  // ── 7. Splice: dataEntities is the geometry block (DATA; + #N=... lines)
  //       and ENDS WITHOUT a trailing newline guarantee. Normalise to a
  //       single trailing newline before appending the PMI fragment so the
  //       boundary is always `<last-geom-line>\n<pmi-fragment><tail>`.
  const geomBlock = split.dataEntities.endsWith('\n')
    ? split.dataEntities
    : `${split.dataEntities}\n`;

  // pmiResult.source is also already newline-terminated (per writePmiFragment
  // contract), so we can concatenate directly.
  return `${split.headerBlock}${geomBlock}${pmiResult.source}${split.tail}`;
}

// ─── escape-hatch exports for tests ───────────────────────────────────────

/** Internal API — exposed for unit tests only. Not stable. */
export const __internal = {
  splitStepFile,
  scanMaxEntityId,
  assertValidHeader,
  REQUIRED_HEADER_RECORDS,
};
