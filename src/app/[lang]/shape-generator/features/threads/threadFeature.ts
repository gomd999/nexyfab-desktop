/**
 * threadFeature.ts — Wave 2 Phase 2 Track D5 (W5) ThreadFeature type.
 *
 * `ThreadFeature` is the feature-tree node representing a thread on a parent
 * hole or boss. W5 ships the **type + cosmetic-mode** lifecycle only; the
 * geometric-mode path (helix sweep + V-profile boolean) is W7.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §3 (data model), §10 (cosmetic
 * vs geometric), §15 W5 (this PR scope).
 *
 * Out of scope for D5:
 * - UI (hole-wizard threads section + Standalone Add Thread) — W6
 * - Geometric V-cut + sweep + boolean — W7
 * - Drawing-callout pipeline + BOM aggregation — W8
 */

import {
  THREAD_CATALOG,
  findThreadRow,
  defaultThreadClass,
  type ThreadSeries,
  type ThreadStandardRow,
} from './threadCatalog';

// ─── Type model ─────────────────────────────────────────────────────────────

/** Cosmetic = metadata-only render hint. Geometric = real helical V-cut (W7). */
export type ThreadMode = 'cosmetic' | 'geometric';

/** Right-hand (the standard) vs left-hand thread (`L` suffix on the callout). */
export type ThreadDirection = 'right_hand' | 'left_hand';

/** Whether the thread is on an internal feature (hole) or external (boss). */
export type ThreadKind = 'internal' | 'external';

/**
 * Reference back to the catalog row. The pair `(series, designation)` is the
 * stable identity — `derived` numerics are recomputed on every rebuild from
 * this pair, never edited directly.
 */
export interface ThreadCatalogRef {
  series: ThreadSeries;
  designation: string;
}

/**
 * Feature-tree node for a thread. Mirrors the spec's `ThreadFeature` shape
 * §3.1, simplified for W5 (no `derived` cache yet — callers re-lookup via
 * `findThreadRow`; the cache lands when geometric rebuild is wired W7).
 *
 * `parentFeatureId` is optional because the W5 cosmetic stub can be exercised
 * directly via `applyThreadCosmetic` without a parent in the tree (used by
 * unit tests). In real wizard wiring (W6) the parent is required.
 */
export interface ThreadFeature {
  /** Stable feature-tree id. Format e.g. `feat_thread_<short-uuid>`. */
  id: string;
  /** Discriminator — keep narrow so the feature-graph walker can tag it. */
  featureType: 'thread';
  /** Parent (hole / boss) feature id. */
  parentFeatureId?: string;
  /** Internal (default — most common case: tapped hole) vs external boss. */
  threadKind: ThreadKind;
  /** Catalog reference — `(series, designation)`. */
  threadRef: ThreadCatalogRef;
  /** Resolved tolerance class. Falls back to `defaultThreadClass(series)` at apply time. */
  class: string;
  /** W5 ships cosmetic only; geometric is W7. */
  mode: ThreadMode;
  /** Right-hand (default) or left-hand. */
  threadDirection: ThreadDirection;
  /** Threaded length in mm along the parent's axis. `0` is an explicit "annotation only" marker. */
  length: number;
  /** Offset from the parent's reference face (top of hole / face of boss), mm. */
  startOffset: number;
  /** Optional human label override — defaults to the formatted callout. */
  label?: string;
}

// ─── Construction ───────────────────────────────────────────────────────────

/**
 * Allocate-and-validate constructor. Throws if `(series, designation)` does
 * not resolve in the catalog — better to fail fast at the construction site
 * than at first render. Falls back to `defaultThreadClass(series)` if no
 * explicit class is supplied.
 *
 * @example
 *   const t = makeThreadFeature({
 *     id: 'feat_thread_1', threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
 *     length: 20, startOffset: 0,
 *   });
 *   // → { mode: 'cosmetic', class: '6H', threadDirection: 'right_hand', ... }
 */
export interface MakeThreadFeatureInput {
  id: string;
  threadRef: ThreadCatalogRef;
  parentFeatureId?: string;
  threadKind?: ThreadKind;
  mode?: ThreadMode;
  threadDirection?: ThreadDirection;
  length: number;
  startOffset?: number;
  class?: string;
  label?: string;
}

export function makeThreadFeature(input: MakeThreadFeatureInput): ThreadFeature {
  const row = findThreadRow(input.threadRef.series, input.threadRef.designation);
  if (!row) {
    throw new Error(
      `makeThreadFeature: unknown thread (${input.threadRef.series}, "${input.threadRef.designation}"). ` +
        `Pass a designation that exists in THREAD_CATALOG.`,
    );
  }
  if (input.class && !row.classCandidates.includes(input.class)) {
    throw new Error(
      `makeThreadFeature: class "${input.class}" is not valid for series ${input.threadRef.series}. ` +
        `Allowed: ${row.classCandidates.join(', ')}.`,
    );
  }
  if (!Number.isFinite(input.length) || input.length < 0) {
    throw new Error(`makeThreadFeature: length must be a non-negative finite number (got ${input.length}).`);
  }
  return {
    id: input.id,
    featureType: 'thread',
    parentFeatureId: input.parentFeatureId,
    threadKind: input.threadKind ?? 'internal',
    threadRef: { ...input.threadRef },
    class: input.class ?? defaultThreadClass(input.threadRef.series),
    mode: input.mode ?? 'cosmetic',
    threadDirection: input.threadDirection ?? 'right_hand',
    length: input.length,
    startOffset: input.startOffset ?? 0,
    label: input.label,
  };
}

// ─── Callout formatting (per ISO 6410-1 / ASME Y14.6) ───────────────────────

/**
 * Format a thread callout string per series convention:
 *   ISO_M_COARSE   "M8-6H"             (coarse pitch suppressed)
 *   ISO_M_FINE     "M10×1.25-6H"       (pitch always present)
 *   UNC            "1/4-20 UNC-2B"
 *   UNF            "1/4-28 UNF-2B"
 *   NPT            "NPT 1/2-A"         (the only class is "A"; we still emit it for parity)
 *   BSP_PARALLEL   "G 1/4-B"
 *   BSP_TAPERED    "Rc 1/4"            (no class suffix — taper does the sealing)
 *
 * Left-hand threads append "LH" before the depth marker.
 *
 * Depth suffix (` ↧ N`) is appended iff `length` > 0 — annotation-only callouts
 * (depth = 0) omit it.
 *
 * Spec ambiguity resolution:
 * - For ISO M coarse the pitch is **suppressed** when it matches the standard
 *   coarse pitch (ISO 6410-1). For ISO M fine the pitch is **always** printed.
 *   We pick by series: `ISO_M_COARSE` suppresses, `ISO_M_FINE` prints.
 * - NPT historically omits the tolerance class (the taper is the seal). We
 *   keep the "-A" suffix opt-in via `includeClassForNpt` so the cosmetic-stub
 *   default callout is a clean "NPT 1/2".
 */
export interface FormatCalloutOptions {
  /** Include "-A" on NPT callouts. Default false. */
  includeClassForNpt?: boolean;
  /** Include "-Rc" on BSP_TAPERED callouts. Default false (the `Rc` prefix is the class marker). */
  includeClassForBspTapered?: boolean;
}

export function formatThreadCallout(
  feature: Pick<ThreadFeature, 'threadRef' | 'class' | 'threadDirection' | 'length'>,
  row: ThreadStandardRow | null = null,
  options: FormatCalloutOptions = {},
): string {
  const r = row ?? findThreadRow(feature.threadRef.series, feature.threadRef.designation);
  if (!r) {
    // Best-effort fallback — bare designation, no class, no depth.
    return feature.threadRef.designation;
  }

  const lh = feature.threadDirection === 'left_hand' ? ' LH' : '';
  const depth = feature.length > 0 ? ` ↧ ${feature.length}` : '';

  switch (r.series) {
    case 'ISO_M_COARSE': {
      // Coarse pitch is suppressed per ISO 6410-1 — "M8" not "M8×1.25".
      return `M${r.nominalDia}-${feature.class}${lh}${depth}`;
    }
    case 'ISO_M_FINE': {
      // Fine pitch always prints — designation already contains the "×P".
      return `${r.designation}-${feature.class}${lh}${depth}`;
    }
    case 'UNC':
    case 'UNF': {
      // Designation already carries the " UNC" / " UNF" suffix.
      return `${r.designation}-${feature.class}${lh}${depth}`;
    }
    case 'NPT': {
      const cls = options.includeClassForNpt ? `-${feature.class}` : '';
      return `${r.designation}${cls}${lh}${depth}`;
    }
    case 'BSP_PARALLEL': {
      return `${r.designation}-${feature.class}${lh}${depth}`;
    }
    case 'BSP_TAPERED': {
      const cls = options.includeClassForBspTapered ? `-${feature.class}` : '';
      return `${r.designation}${cls}${lh}${depth}`;
    }
    default: {
      // Exhaustiveness — never hit at runtime given the type discriminator above.
      const _exhaustive: never = r.series;
      return _exhaustive;
    }
  }
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export { THREAD_CATALOG, findThreadRow, defaultThreadClass };
export type { ThreadSeries, ThreadStandardRow };
