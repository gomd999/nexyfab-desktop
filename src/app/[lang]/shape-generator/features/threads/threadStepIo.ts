/**
 * threadStepIo.ts — Wave 2 Phase 2 Track D Week 8 (D8).
 *
 * STEP AP242 round-trip for `ThreadFeature`. STEP itself does not have a
 * first-class thread entity; thread metadata is attached to the
 * `manifold_solid_brep` as a vendor-specific `PROPERTY_DEFINITION`
 * group with the role `"thread"`.
 *
 * D8 ships:
 *  - `threadFeatureToStepMetadata` — serialise a `ThreadFeature` into an
 *    AP242-compatible `StepEntityMetadata` block (one object per thread).
 *  - `parseThreadStepMetadata` — parse the metadata block back into a
 *    `ThreadFeature` (returns `null` on parse failure, never throws).
 *  - Round-trip stability tests via `__tests__/threadStepIo.test.ts`
 *    (golden fixture `tests/fixtures/F-THREAD-STEP-01.json`).
 *
 * Out of scope (D8):
 *  - Wiring this into the actual `exportToStepAsync` pipeline (a
 *    follow-up integrates the metadata block into the STEP text emitter).
 *  - Geometric thread B-Rep export — that needs the W7 sweep + B-Rep
 *    output and is gated to Phase 3.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §16 (open question 5,
 * STEP/IGES export) + §15 W8 (this PR scope).
 */

import type { ThreadFeature } from './threadFeature';
import { makeThreadFeature } from './threadFeature';
import { findThreadRow, type ThreadSeries } from './threadCatalog';

// ─── Metadata schema ────────────────────────────────────────────────────────

/** Schema version — bumped if the metadata block structure changes. */
export const THREAD_STEP_METADATA_VERSION = 1;

/**
 * Metadata block describing a single thread feature in a STEP AP242 file.
 * The block lives as a vendor PROPERTY_DEFINITION attached to the
 * `manifold_solid_brep` representing the host body.
 *
 * Field naming follows the spec's `ThreadFeature` field names so that
 * developers reading the STEP text recognise the structure without
 * needing the source. Numerics survive a round-trip exactly because all
 * floats are JSON-encoded with a `Number` (no truncation).
 */
export interface ThreadStepMetadata {
  /** Schema marker — always `"thread"`. */
  readonly kind: 'thread';
  /** Metadata schema version (see `THREAD_STEP_METADATA_VERSION`). */
  readonly version: number;
  /** Stable feature id — round-trips for cross-app cross-referencing. */
  readonly id: string;
  /** Parent feature id (host hole / boss). Empty string if no parent. */
  readonly parentFeatureId: string;
  /** Internal (default) or external. */
  readonly threadKind: 'internal' | 'external';
  /** Series identifier (ISO_M_COARSE / UNC / NPT / ...). */
  readonly series: ThreadSeries;
  /** Canonical designation (`"M8"`, `"1/4-20 UNC"`, ...). */
  readonly designation: string;
  /** Tolerance class. */
  readonly class: string;
  /** Cosmetic / geometric. */
  readonly mode: 'cosmetic' | 'geometric';
  /** Right- or left-hand. */
  readonly threadDirection: 'right_hand' | 'left_hand';
  /** Length in mm. */
  readonly length: number;
  /** Start offset in mm. */
  readonly startOffset: number;
  /** Optional label override. */
  readonly label?: string;
  /**
   * Optional derived numerics — recomputed on import from the catalog
   * if missing, but written for cross-vendor importers that don't
   * carry the catalog locally.
   */
  readonly derived?: {
    readonly majorDiameterMm: number;
    readonly minorDiameterMm: number;
    readonly pitchMm: number;
    readonly tapDrillMm: number;
  };
}

// ─── Serialisation ──────────────────────────────────────────────────────────

/**
 * Convert a `ThreadFeature` into a STEP metadata block. The output is the
 * pure data structure — the STEP-text emitter wraps this in
 * `PROPERTY_DEFINITION` + `PROPERTY_DEFINITION_REPRESENTATION` entities.
 *
 * Pure function. The same input produces the same output every call.
 */
export function threadFeatureToStepMetadata(feature: ThreadFeature): ThreadStepMetadata {
  const row = findThreadRow(feature.threadRef.series, feature.threadRef.designation);

  const meta: ThreadStepMetadata = {
    kind: 'thread',
    version: THREAD_STEP_METADATA_VERSION,
    id: feature.id,
    parentFeatureId: feature.parentFeatureId ?? '',
    threadKind: feature.threadKind,
    series: feature.threadRef.series,
    designation: feature.threadRef.designation,
    class: feature.class,
    mode: feature.mode,
    threadDirection: feature.threadDirection,
    length: feature.length,
    startOffset: feature.startOffset,
    ...(feature.label !== undefined ? { label: feature.label } : {}),
    ...(row
      ? {
          derived: {
            majorDiameterMm: row.nominalDia,
            minorDiameterMm: row.minorDiameter,
            pitchMm: row.pitch,
            tapDrillMm: row.tapDrill,
          },
        }
      : {}),
  };

  return meta;
}

/**
 * Render the metadata block as the STEP-text fragment that the AP242
 * emitter inlines into the body's `PROPERTY_DEFINITION`. Returns the
 * JSON-encoded payload — STEP allows arbitrary `description` text on
 * `PROPERTY_DEFINITION`, so we encode the metadata as a single JSON
 * literal prefixed with the schema marker.
 *
 * Example STEP fragment:
 *   #42 = PROPERTY_DEFINITION('nexyfab/thread', 'NEXYFAB_THREAD_V1:{"kind":"thread",...}', #41);
 */
export function threadStepMetadataToBlob(meta: ThreadStepMetadata): string {
  return `NEXYFAB_THREAD_V${THREAD_STEP_METADATA_VERSION}:${JSON.stringify(meta)}`;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a STEP-text metadata blob back into a `ThreadStepMetadata`.
 * Returns `null` on **any** parse failure — never throws. The caller
 * decides whether a `null` means "skip the thread" or "raise an
 * importer-level warning".
 *
 * Accepts both the bare JSON form and the prefixed form:
 *   "NEXYFAB_THREAD_V1:{...}"  ← canonical
 *   "{...}"                    ← also accepted (e.g. when reading a
 *                                payload already-stripped by the STEP
 *                                lexer).
 */
export function parseThreadStepBlob(blob: string): ThreadStepMetadata | null {
  if (typeof blob !== 'string') return null;
  const trimmed = blob.trim();

  // Strip prefix if present.
  const PREFIX = /^NEXYFAB_THREAD_V(\d+):/;
  const m = PREFIX.exec(trimmed);
  let json = trimmed;
  let version = THREAD_STEP_METADATA_VERSION;
  if (m) {
    version = parseInt(m[1]!, 10);
    json = trimmed.slice(m[0].length);
    if (!Number.isFinite(version) || version < 1) return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.kind !== 'thread') return null;

  // Defensive coercion — every field must validate.
  if (typeof obj.id !== 'string') return null;
  if (typeof obj.designation !== 'string') return null;
  if (typeof obj.series !== 'string') return null;
  if (typeof obj.class !== 'string') return null;
  if (typeof obj.length !== 'number' || !Number.isFinite(obj.length)) return null;
  if (typeof obj.startOffset !== 'number' || !Number.isFinite(obj.startOffset)) return null;
  if (obj.threadKind !== 'internal' && obj.threadKind !== 'external') return null;
  if (obj.mode !== 'cosmetic' && obj.mode !== 'geometric') return null;
  if (obj.threadDirection !== 'right_hand' && obj.threadDirection !== 'left_hand') return null;
  // Allowed series values — must intersect ThreadSeries.
  const allowedSeries: ThreadSeries[] = [
    'ISO_M_COARSE', 'ISO_M_FINE', 'UNC', 'UNF', 'NPT', 'BSP_PARALLEL', 'BSP_TAPERED',
  ];
  if (!allowedSeries.includes(obj.series as ThreadSeries)) return null;

  const parentFeatureId =
    typeof obj.parentFeatureId === 'string' ? obj.parentFeatureId : '';
  const label = typeof obj.label === 'string' ? obj.label : undefined;

  // Optional derived block — only kept if all four numeric fields validate.
  let derived: ThreadStepMetadata['derived'];
  if (obj.derived && typeof obj.derived === 'object') {
    const d = obj.derived as Record<string, unknown>;
    if (
      typeof d.majorDiameterMm === 'number' && Number.isFinite(d.majorDiameterMm)
      && typeof d.minorDiameterMm === 'number' && Number.isFinite(d.minorDiameterMm)
      && typeof d.pitchMm === 'number' && Number.isFinite(d.pitchMm)
      && typeof d.tapDrillMm === 'number' && Number.isFinite(d.tapDrillMm)
    ) {
      derived = {
        majorDiameterMm: d.majorDiameterMm,
        minorDiameterMm: d.minorDiameterMm,
        pitchMm: d.pitchMm,
        tapDrillMm: d.tapDrillMm,
      };
    }
  }

  return {
    kind: 'thread',
    version,
    id: obj.id,
    parentFeatureId,
    threadKind: obj.threadKind,
    series: obj.series as ThreadSeries,
    designation: obj.designation,
    class: obj.class,
    mode: obj.mode,
    threadDirection: obj.threadDirection,
    length: obj.length,
    startOffset: obj.startOffset,
    ...(label !== undefined ? { label } : {}),
    ...(derived !== undefined ? { derived } : {}),
  };
}

/**
 * Parse a metadata blob and lift it back into a `ThreadFeature`.
 * Returns `null` on parse failure or when the lifted feature would
 * itself fail `makeThreadFeature` validation (e.g. unknown designation).
 *
 * The intent is "from a STEP-import worker, give me back the same
 * `ThreadFeature` that was originally exported", so we re-run the
 * type's own construction guards. Designations not in the catalog
 * → `null`; the caller logs the import warning.
 */
export function parseThreadStepMetadata(blob: string): ThreadFeature | null {
  const meta = parseThreadStepBlob(blob);
  if (!meta) return null;

  try {
    return makeThreadFeature({
      id: meta.id,
      parentFeatureId: meta.parentFeatureId || undefined,
      threadKind: meta.threadKind,
      threadRef: { series: meta.series, designation: meta.designation },
      class: meta.class,
      mode: meta.mode,
      threadDirection: meta.threadDirection,
      length: meta.length,
      startOffset: meta.startOffset,
      label: meta.label,
    });
  } catch {
    return null;
  }
}

// ─── Round-trip helper ──────────────────────────────────────────────────────

/**
 * Convenience round-trip: feature → blob → feature. Returns `null` if
 * the round-trip fails at any step. Used by the round-trip test fixtures.
 */
export function roundTripThreadStep(feature: ThreadFeature): ThreadFeature | null {
  const meta = threadFeatureToStepMetadata(feature);
  const blob = threadStepMetadataToBlob(meta);
  return parseThreadStepMetadata(blob);
}
