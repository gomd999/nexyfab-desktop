/**
 * threadFeatureUpdate.ts — Wave 2 Phase 2 Track D6 (W6) pure update helper.
 *
 * The standalone "Edit thread" modal calls `updateThreadFeature(existing, patch)`
 * to apply user edits to an existing `ThreadFeature`. Validation mirrors
 * `makeThreadFeature` from D5 so the two construction paths can't drift:
 *
 *  - `length` must be a non-negative finite number (`0` = annotation-only).
 *  - `startOffset` must be a non-negative finite number.
 *  - `threadRef` (if patched) must resolve in the catalog.
 *  - `class` (if patched) must be in the catalog row's `classCandidates`.
 *  - `mode` cannot promote to `'geometric'` in W6 — that mode is W7 and the
 *    helper rejects it explicitly so the UI can show a localised hint.
 *
 * The function is **pure** — no I/O, no `crypto.randomUUID`, no mutation of
 * the input. Callers get back a fresh object and may pointer-compare to know
 * whether anything changed (an empty patch returns the same `existing` ref).
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §10.3 (edit-in-place).
 */

import {
  findThreadRow,
  defaultThreadClass,
  type ThreadStandardRow,
} from './threadCatalog';
import type {
  ThreadFeature,
  ThreadCatalogRef,
  ThreadDirection,
  ThreadKind,
  ThreadMode,
} from './threadFeature';

// ─── Patch shape ────────────────────────────────────────────────────────────

/**
 * Partial edit applied to an existing thread. Every field is optional; any
 * field omitted from the patch is preserved from `existing`. To explicitly
 * clear `label`, pass `label: undefined` (still typed `string | undefined`
 * on the patch).
 *
 * `threadRef` is patched as a whole — partial-`threadRef` patches are
 * rejected to avoid the "designation valid for old series but not new"
 * silent-corruption mode.
 */
export interface ThreadFeaturePatch {
  threadRef?: ThreadCatalogRef;
  threadKind?: ThreadKind;
  class?: string;
  mode?: ThreadMode;
  threadDirection?: ThreadDirection;
  length?: number;
  startOffset?: number;
  label?: string;
  parentFeatureId?: string;
}

/**
 * Validation outcome. We return an enum-shaped union (vs throwing) so the
 * modal can surface localised errors via `dict.errorLengthRange` etc.
 */
export type ThreadFeatureUpdateResult =
  | { ok: true; feature: ThreadFeature }
  | { ok: false; code: ThreadFeatureUpdateErrorCode; message: string };

export type ThreadFeatureUpdateErrorCode =
  | 'unknown_designation'
  | 'invalid_class'
  | 'length_range'
  | 'startoffset_negative'
  | 'geometric_unavailable';

// ─── Helpers ────────────────────────────────────────────────────────────────

function patchIsEmpty(patch: ThreadFeaturePatch): boolean {
  for (const k of Object.keys(patch) as (keyof ThreadFeaturePatch)[]) {
    if (patch[k] !== undefined) return false;
  }
  return true;
}

function isNonNegativeFinite(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Apply a partial patch to an existing `ThreadFeature`. Returns a discriminated
 * union `{ ok: true, feature }` on success or `{ ok: false, code, message }`
 * on validation failure.
 *
 * Reference-equality contract: if `patch` is empty (every field undefined) the
 * function returns `existing` byref. Otherwise it returns a fresh feature.
 */
export function updateThreadFeature(
  existing: ThreadFeature,
  patch: ThreadFeaturePatch,
): ThreadFeatureUpdateResult {
  if (patchIsEmpty(patch)) {
    return { ok: true, feature: existing };
  }

  // Resolve the effective threadRef (existing or patched).
  const nextThreadRef: ThreadCatalogRef =
    patch.threadRef !== undefined ? { ...patch.threadRef } : existing.threadRef;

  // Catalog must resolve.
  const row: ThreadStandardRow | null = findThreadRow(
    nextThreadRef.series,
    nextThreadRef.designation,
  );
  if (!row) {
    return {
      ok: false,
      code: 'unknown_designation',
      message:
        `Thread designation "${nextThreadRef.designation}" is not in series ${nextThreadRef.series}.`,
    };
  }

  // Class — must be in candidates for the (possibly new) series. If the
  // series changed and the existing class no longer fits, fall back to the
  // series default unless the patch supplies an explicit class.
  let nextClass: string;
  if (patch.class !== undefined) {
    if (!row.classCandidates.includes(patch.class)) {
      return {
        ok: false,
        code: 'invalid_class',
        message:
          `Class "${patch.class}" is not valid for series ${nextThreadRef.series}. ` +
          `Allowed: ${row.classCandidates.join(', ')}.`,
      };
    }
    nextClass = patch.class;
  } else if (
    patch.threadRef !== undefined &&
    !row.classCandidates.includes(existing.class)
  ) {
    // Series changed and old class no longer applies — snap to the series default.
    nextClass = defaultThreadClass(nextThreadRef.series);
  } else {
    nextClass = existing.class;
  }

  // Length.
  const nextLength = patch.length !== undefined ? patch.length : existing.length;
  if (!isNonNegativeFinite(nextLength)) {
    return {
      ok: false,
      code: 'length_range',
      message: `Length must be a non-negative finite number (got ${nextLength}).`,
    };
  }

  // Start offset.
  const nextStartOffset =
    patch.startOffset !== undefined ? patch.startOffset : existing.startOffset;
  if (!isNonNegativeFinite(nextStartOffset)) {
    return {
      ok: false,
      code: 'startoffset_negative',
      message: `Start offset must be a non-negative finite number (got ${nextStartOffset}).`,
    };
  }

  // Mode — cosmetic only in W6 (geometric is W7).
  const nextMode: ThreadMode = patch.mode !== undefined ? patch.mode : existing.mode;
  if (nextMode === 'geometric') {
    return {
      ok: false,
      code: 'geometric_unavailable',
      message: 'Geometric mode is not yet wired (Phase 2 W7). Use cosmetic for now.',
    };
  }

  return {
    ok: true,
    feature: {
      id: existing.id,
      featureType: 'thread',
      parentFeatureId:
        patch.parentFeatureId !== undefined ? patch.parentFeatureId : existing.parentFeatureId,
      threadKind: patch.threadKind !== undefined ? patch.threadKind : existing.threadKind,
      threadRef: nextThreadRef,
      class: nextClass,
      mode: nextMode,
      threadDirection:
        patch.threadDirection !== undefined ? patch.threadDirection : existing.threadDirection,
      length: nextLength,
      startOffset: nextStartOffset,
      label: 'label' in patch ? patch.label : existing.label,
    },
  };
}

/**
 * Convenience: throw-on-error variant for call sites that have already
 * validated their input and want a `ThreadFeature` back directly. Mirrors
 * the relationship between `makeThreadFeature` (throw) and a future
 * `tryMakeThreadFeature` (Result-style).
 */
export function updateThreadFeatureOrThrow(
  existing: ThreadFeature,
  patch: ThreadFeaturePatch,
): ThreadFeature {
  const r = updateThreadFeature(existing, patch);
  if (!r.ok) {
    throw new Error(`updateThreadFeatureOrThrow: ${r.code} — ${r.message}`);
  }
  return r.feature;
}
