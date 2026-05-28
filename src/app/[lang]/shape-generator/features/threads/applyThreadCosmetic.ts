/**
 * applyThreadCosmetic.ts — Wave 2 Phase 2 Track D5 (W5) cosmetic-mode stub.
 *
 * Cosmetic thread mode is metadata-only: the parent geometry is returned
 * **unchanged** (reference equality preserved — no clone) and a metadata
 * payload is produced for downstream consumers (W6 viewport overlay + W8
 * drawing callouts).
 *
 * This file is the **local stand-in** for the worker endpoint
 * `POST /occt/op/thread/cosmetic` from the spec §9.1 — the occt-worker
 * src/ tree is blocked on Wave 1 task #31, so D5 ships a pure-JS function
 * that returns exactly the metadata payload the worker WILL return. When
 * the worker comes online, this implementation moves into the worker and
 * the client side becomes a thin RPC wrapper.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §9.1 + §10.1.
 *
 * Out of scope for D5:
 * - Dashed-line viewport overlay (W6 — UI side draws the magenta dashed
 *   circle using the `metadata.rangeStart` / `rangeEnd` returned here).
 * - Geometric mode (W7 — separate worker endpoint).
 * - BOM aggregation by designation (W8).
 */

import type { BufferGeometry } from 'three';
import { findThreadRow, type ThreadStandardRow, THREAD_CATALOG } from './threadCatalog';
import {
  formatThreadCallout,
  type ThreadFeature,
  type ThreadDirection,
} from './threadFeature';

// ─── Output shape ───────────────────────────────────────────────────────────

/**
 * Output of `applyThreadCosmetic` — the payload the cosmetic worker endpoint
 * will return per spec §9.1.
 *
 * `geometry` is **reference-equal** to the input `parentGeometry` (cosmetic
 * mode never clones the host). Callers can rely on `result.geometry ===
 * parentGeometry` for downstream pointer-equality checks.
 *
 * `metadata.rangeStart` / `rangeEnd` are the two endpoints along the parent's
 * axis where the thread starts/ends — `rangeStart` is at `feature.startOffset`
 * along the parent's reference frame, `rangeEnd` at `startOffset + length`.
 * Without a real axis from the parent we default to the +Z axis (matches
 * the convention used by `features/hole.ts` and `features/helix.ts`).
 */
export interface ApplyThreadCosmeticResult {
  geometry: BufferGeometry;
  metadata: {
    threadRef: ThreadStandardRow;
    class: string;
    direction: ThreadDirection;
    /** Pre-formatted callout string per ISO 6410-1 / §3.1 of the spec. */
    callout: string;
    /** Start point of the thread along the parent's axis, mm (model coords). */
    rangeStart: readonly [number, number, number];
    /** End point of the thread along the parent's axis, mm (model coords). */
    rangeEnd: readonly [number, number, number];
  };
}

// ─── Options ────────────────────────────────────────────────────────────────

/**
 * Optional axis / origin to anchor the cosmetic range against the parent. In
 * the worker-side implementation these come from the parent's resolved
 * cylinder axis (`features/hole.ts` parent face provenance). For pure-JS unit
 * tests the defaults (axis = +Z, origin = 0,0,0) are sufficient.
 */
export interface ApplyThreadCosmeticOptions {
  /** Catalog override — pass a custom map for testing. Defaults to `THREAD_CATALOG`. */
  catalog?: typeof THREAD_CATALOG;
  /** Parent axis direction (unit vector). Default `[0, 0, 1]` (+Z). */
  axis?: readonly [number, number, number];
  /** Parent reference-face origin in model coords. Default `[0, 0, 0]`. */
  origin?: readonly [number, number, number];
}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Apply cosmetic thread feature to a parent geometry.
 *
 * Cosmetic mode does **not** modify geometry. The returned `geometry` is the
 * same reference as the input `parentGeometry` so downstream code can
 * fast-path the "nothing changed" case with a pointer check.
 *
 * @throws if the feature's `(series, designation)` is not in the catalog —
 * this mirrors what the worker endpoint returns as `THREAD_DESIGNATION_UNKNOWN`
 * (spec §9.2 error table).
 */
export function applyThreadCosmetic(
  parentGeometry: BufferGeometry,
  feature: ThreadFeature,
  options: ApplyThreadCosmeticOptions = {},
): ApplyThreadCosmeticResult {
  if (feature.mode !== 'cosmetic') {
    throw new Error(
      `applyThreadCosmetic: feature.mode must be 'cosmetic' (got '${feature.mode}'). ` +
        `Geometric mode is W7 — use applyThreadGeometric when it lands.`,
    );
  }

  const catalog = options.catalog ?? THREAD_CATALOG;
  const table = catalog[feature.threadRef.series];
  const row = table.find((r) => r.designation === feature.threadRef.designation)
    ?? findThreadRow(feature.threadRef.series, feature.threadRef.designation);
  if (!row) {
    throw new Error(
      `applyThreadCosmetic: THREAD_DESIGNATION_UNKNOWN — ` +
        `series=${feature.threadRef.series} designation="${feature.threadRef.designation}"`,
    );
  }

  const axis = options.axis ?? ([0, 0, 1] as const);
  const origin = options.origin ?? ([0, 0, 0] as const);

  // The range start is `startOffset` along the axis from the origin; the
  // range end is `startOffset + length` along the same axis.
  const rangeStart: [number, number, number] = [
    origin[0] + axis[0] * feature.startOffset,
    origin[1] + axis[1] * feature.startOffset,
    origin[2] + axis[2] * feature.startOffset,
  ];
  const endOffset = feature.startOffset + feature.length;
  const rangeEnd: [number, number, number] = [
    origin[0] + axis[0] * endOffset,
    origin[1] + axis[1] * endOffset,
    origin[2] + axis[2] * endOffset,
  ];

  const callout = formatThreadCallout(feature, row);

  return {
    // Reference-equal to the input — no clone, cosmetic mode is metadata-only.
    geometry: parentGeometry,
    metadata: {
      threadRef: row,
      class: feature.class,
      direction: feature.threadDirection,
      callout,
      rangeStart,
      rangeEnd,
    },
  };
}
