/**
 * Sketch ↔ Hole propagation — pure logic (Phase 2 W4 Track C4).
 *
 * Spec ref: `wave-2-phase-2-hole-wizard-spec.md` §7 (sketch input + edit-after-add
 * semantics) and §10 (subsequent-edit semantics).
 *
 * Scope (W4, UI-only path):
 *   - **sketch → hole** : when sketch points move / are added / deleted, find all
 *     `fromSketch` hole arrays that reference that sketch and re-derive their
 *     expanded position list, preserving stable per-position id mapping so the
 *     downstream `positions[i].depthOverride` / `suppressed` tombstones (spec §7.3)
 *     survive the rebuild.
 *   - **hole → sketch** : documented as future work (see `HOLE_TO_SKETCH_POLICY`).
 *     Reason: the hole-wizard's `fromSketch` mode is *consumer-only* by design;
 *     when the user drags a hole position in `manual` mode, the sketch becomes
 *     authoritative again automatically because no `fromSketchSpec` is attached.
 *     A bidirectional sync would require deciding which side wins on a free-edit
 *     conflict — that decision is deferred until we have hole drag-handles in
 *     the 3D viewport (post-W4).
 *
 * **Why a separate module?**
 *   - Pure functions, no React / Yjs / DOM imports → unit-testable in node.
 *   - Reused by both the feature-tree update hook and the modal preview.
 *   - Keeps `holeArray.ts` free of cross-feature dependency lookups.
 *
 * Data flow:
 *   feature-tree (changes to sketch points)
 *      → `findHoleFeaturesReferencingSketch(features, sketchId)`
 *      → for each match: `expandHoleArray(def, ctx)` re-derives positions
 *      → `applySketchUpdateToHoleFeature(def, oldPoints, newPoints)`
 *         merges per-position overrides (depthOverride / suppressed) onto the
 *         fresh position list using the sketch's stable point ids
 *      → returns the patched HoleArrayDefinition (caller marks feature dirty +
 *         re-runs the pipeline solver).
 *
 * The propagation is **deliberately limited to UI-driven sketch edits** — the
 * worker re-fuse + re-cut is downstream and lives in occt-worker once Wave 1
 * task #31 unblocks. The pure-logic layer here is what lets us land the
 * data-model + override-tombstone semantics now without depending on the
 * worker.
 */

import {
  expandHoleArray,
  type BoundingBoxCtx,
  type FromSketchArrayParams,
  type HoleArrayDefinition,
  type HolePosition,
} from './holeArray';

// ─── Public types ──────────────────────────────────────────────────────────

/**
 * Minimal sketch-point shape the propagation consumes. Each point carries a
 * stable id (spec §7.1 — "Hole Wizard references these points by id, not by
 * index"). The id source depends on the sketch storage layer (JSON-path vs.
 * CRDT-path); both produce a stable string id, so the propagator stays
 * agnostic.
 */
export interface SketchPointSnapshot {
  id: string;
  x: number;
  y: number;
}

/**
 * Per-position overrides preserved across sketch edits. Spec §6.4 + §7.3:
 *   - `depthOverride` — explicit depth set on a single hole, takes precedence
 *      over the feature-level termination's depth at solve time.
 *   - `suppressed`    — user toggled this hole off in the position table.
 *   - `tombstone`     — the underlying sketch point was deleted, but the user
 *      had an override; we keep the row visible for one undo cycle so they
 *      don't lose the override (cleared on next persist; see GC pass below).
 *
 * Keyed by the sketch-point id (= position id for `fromSketch` arrays).
 */
export interface PositionOverride {
  depthOverride?: number | null;
  suppressed?: boolean;
  /**
   * When `true`, the sketch point no longer exists but the override is
   * preserved. Surfaced as a yellow "(orphan)" row in the wizard's
   * position table until the user explicitly clears it.
   */
  tombstone?: boolean;
}

export type PositionOverrideMap = Record<string, PositionOverride>;

/**
 * The full "fromSketch state" for a hole feature — what we store alongside
 * `params.data` so we can replay the override / tombstone semantics across
 * rebuilds. Spec §7.3 keeps these on `positions[i]`; we lift them into a
 * sibling map to keep the `params.data` shape narrow (the sketch's point
 * list is the source of truth for which ids are live).
 */
export interface FromSketchState {
  /** Per-position overrides keyed by sketch-point id. */
  overrides: PositionOverrideMap;
  /**
   * Last-known point ids — used to detect adds vs. deletes when applying a
   * sketch update. Persisted on the feature so a reload can still tell
   * tombstones from genuinely new points.
   */
  knownPointIds: string[];
}

/** Default empty state for a freshly-attached `fromSketch` hole feature. */
export function emptyFromSketchState(): FromSketchState {
  return { overrides: {}, knownPointIds: [] };
}

/** Result of a sketch update — what changed, plus the resolved positions. */
export interface SketchUpdateResult {
  /** Positions after propagation (the new value the feature's solver sees). */
  positions: HolePosition[];
  /** Updated override map with tombstones for removed-but-overridden points. */
  state: FromSketchState;
  /**
   * Stable change-summary for downstream consumers (pipeline dirty-flagging,
   * undo grouping, ops alerts). Empty arrays when nothing changed.
   */
  changes: {
    added: string[];     // new point ids
    removed: string[];   // ids no longer present in the sketch
    moved: string[];     // ids whose (x,y) shifted
    tombstoned: string[]; // removed ids whose override was preserved
  };
}

// ─── Sketch → Hole : the core propagation step ─────────────────────────────

/**
 * Apply a sketch update to a single hole feature's `fromSketchState`.
 *
 * Inputs:
 *   - `previousPoints` — the point list the hole feature last saw. Pass `[]`
 *     on first-attach (everything is "added").
 *   - `currentPoints`  — the live sketch point list (post-solver).
 *   - `prevState`      — the feature's existing override map + known ids.
 *
 * Outputs:
 *   - `positions` projected from `currentPoints` (mapped via `pointFilter`),
 *     with `suppressed` overrides honored.
 *   - `state` carrying the merged override map (tombstones for removed-but-
 *     overridden ids).
 *   - `changes` summarising what shifted (for dirty-flagging + tests).
 *
 * Pure function: no side effects. Caller owns persistence + dirty-flagging.
 */
export function applySketchUpdateToHoleFeature(
  arrayId: string,
  params: FromSketchArrayParams,
  previousPoints: SketchPointSnapshot[],
  currentPoints: SketchPointSnapshot[],
  prevState: FromSketchState = emptyFromSketchState(),
): SketchUpdateResult {
  // Filter the current point list to the user-selected subset (spec §7.1).
  const filter = params.pointFilter;
  const filtered = filter && filter.length > 0
    ? currentPoints.filter((p) => filter.includes(p.id))
    : currentPoints;

  const prevById = new Map(previousPoints.map((p) => [p.id, p]));
  const currById = new Map(filtered.map((p) => [p.id, p]));

  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const tombstoned: string[] = [];

  // Detect adds + moves.
  for (const p of filtered) {
    if (!prevById.has(p.id)) {
      added.push(p.id);
    } else {
      const prev = prevById.get(p.id)!;
      if (prev.x !== p.x || prev.y !== p.y) moved.push(p.id);
    }
  }

  // Detect removes (relative to the previously-known ids; ids removed by the
  // user-side `pointFilter` are NOT considered removed — the underlying
  // sketch point still exists).
  for (const id of prevState.knownPointIds) {
    if (!currById.has(id) && !(filter && filter.length > 0 && !filter.includes(id))) {
      removed.push(id);
    }
  }

  // Build the new override map: keep overrides for live points; tombstone the
  // removed ones whose override is non-empty; drop removed ones with no
  // override (saves memory + keeps the map small).
  const overrides: PositionOverrideMap = {};
  for (const [id, ov] of Object.entries(prevState.overrides)) {
    if (currById.has(id)) {
      // Live point — copy the override forward, dropping any stale tombstone tag.
      const next: PositionOverride = { ...ov };
      delete next.tombstone;
      overrides[id] = next;
    } else if (removed.includes(id) && hasMeaningfulOverride(ov)) {
      // Tombstone (one cycle).
      overrides[id] = { ...ov, tombstone: true };
      tombstoned.push(id);
    }
    // else: removed with no meaningful override → garbage-collect.
  }

  // Project the live points to HolePosition entries, honoring `suppressed`.
  const positions: HolePosition[] = filtered.map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
    source: 'fromSketch' as const,
  })).filter((pos) => !overrides[pos.id]?.suppressed);

  // Refresh the known-ids snapshot to the live set so the next update can
  // diff against it.
  const knownPointIds = filtered.map((p) => p.id);

  return {
    positions,
    state: { overrides, knownPointIds },
    changes: { added, removed, moved, tombstoned },
  };
}

/**
 * Convenience entry: build a `BoundingBoxCtx.resolveSketchPoints` provider
 * from a static `sketchId → points` registry. Used by the wizard's preview
 * panel + tests where we don't have a live sketch store.
 */
export function makeSketchPointProvider(
  registry: Record<string, SketchPointSnapshot[]>,
): NonNullable<BoundingBoxCtx['resolveSketchPoints']> {
  return (sketchId: string) => registry[sketchId];
}

// ─── Multi-feature update — invoked by the sketch-edit hook ────────────────

/**
 * Locate every hole array in a feature list that references the given sketch.
 *
 * The caller passes a flat list of (id, definition) pairs — the feature-tree
 * traversal lives in `useFeatureStack` and we'd rather not import it here.
 * The structural type below matches what the tree's `getOrderedNodes` returns
 * for the C4 path; future feature kinds can be added without touching this
 * function as long as they expose a `holeArray?: HoleArrayDefinition` field.
 */
export interface HoleFeatureRef {
  featureId: string;
  holeArray: HoleArrayDefinition;
  /** Optional state blob (overrides + known ids). */
  fromSketchState?: FromSketchState;
}

export function findHoleFeaturesReferencingSketch(
  features: ReadonlyArray<HoleFeatureRef>,
  sketchId: string,
): HoleFeatureRef[] {
  return features.filter((f) => {
    const p = f.holeArray.params;
    return p.kind === 'fromSketch' && p.data.sketchFeatureId === sketchId;
  });
}

/**
 * Bulk propagation: apply a sketch update to every dependent hole feature.
 *
 * Returns an array of `{ featureId, result }` so the caller can mark each
 * feature dirty + persist the new state in one transaction.
 */
export function propagateSketchUpdate(
  features: ReadonlyArray<HoleFeatureRef>,
  sketchId: string,
  previousPoints: SketchPointSnapshot[],
  currentPoints: SketchPointSnapshot[],
): Array<{ featureId: string; result: SketchUpdateResult; updated: HoleArrayDefinition }> {
  const deps = findHoleFeaturesReferencingSketch(features, sketchId);
  return deps.map((dep) => {
    const params = dep.holeArray.params;
    if (params.kind !== 'fromSketch') {
      // Should not happen — findHoleFeaturesReferencingSketch already filtered.
      return {
        featureId: dep.featureId,
        result: {
          positions: [],
          state: dep.fromSketchState ?? emptyFromSketchState(),
          changes: { added: [], removed: [], moved: [], tombstoned: [] },
        },
        updated: dep.holeArray,
      };
    }
    const result = applySketchUpdateToHoleFeature(
      dep.holeArray.id,
      params.data,
      previousPoints,
      currentPoints,
      dep.fromSketchState,
    );
    // The HoleArrayDefinition itself doesn't change (still fromSketch with same
    // sketch ref) — only the resolved positions + sibling state do. Caller
    // stores the state on the feature node and re-expands via expandHoleArray
    // at pipeline time using the live sketch.
    return { featureId: dep.featureId, result, updated: dep.holeArray };
  });
}

// ─── Hole → Sketch policy (documentation + tiny detector) ──────────────────

/**
 * Documented propagation policy from the hole-feature side back to the sketch.
 *
 * Decision (W4): **MVP ships sketch → hole only.** Reasons:
 *   1. The hole wizard exposes drag-to-edit only in `manual` position mode.
 *      When the user moves a hole in `manual` mode there is no
 *      `fromSketchSpec` to propagate back to.
 *   2. When the wizard's mode is `fromSketch`, the position rows are read-only
 *      in the UI (spec §7.3 wording "edit the sketch directly"). There is no
 *      drag-handle on a `fromSketch` hole today, so there is no point to
 *      propagate.
 *   3. 3D-viewport drag-handles are a Wave-2 W6+ topic; the propagation hook
 *      slots in there cleanly when those handles land.
 *
 * `detectHoleToSketchEditAttempt` is the small runtime helper that protects
 * us from accidentally introducing the reverse direction: if a future code
 * path tries to mutate the sketch from a hole-wizard interaction without
 * the W6 plumbing in place, this function returns `true` and the caller
 * should bail out with an ops alert.
 */
export const HOLE_TO_SKETCH_POLICY = {
  direction: 'sketch-to-hole-only' as const,
  rationale:
    'Sketch is authoritative for fromSketch arrays. Hole-driven moves require ' +
    '3D drag-handles (Wave-2 W6+) before reverse propagation makes sense.',
  futureWork: 'Reverse propagation arrives with viewport hole drag-handles (W6+).',
};

/**
 * Returns `true` if the supplied edit attempts to mutate the sketch from a
 * hole-feature context — used as an assertion in the wizard's onChange path.
 * Pure predicate; no side effects.
 */
export function detectHoleToSketchEditAttempt(
  arrayDef: HoleArrayDefinition,
  proposedMutationTarget: 'sketch' | 'hole-array',
): boolean {
  return (
    arrayDef.params.kind === 'fromSketch' &&
    proposedMutationTarget === 'sketch'
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function hasMeaningfulOverride(ov: PositionOverride): boolean {
  return (
    (ov.depthOverride !== undefined && ov.depthOverride !== null) ||
    ov.suppressed === true
  );
}

// ─── Preview helpers used by the modal Position tab ────────────────────────

/**
 * Compute a bounding-box hint for a sketch's filtered point list. The Position
 * tab uses this to show the user "you picked 8 points spanning 100×40 mm" so
 * they can sanity-check the sketch picker before applying.
 *
 * Returns `null` when the list is empty (no points = no box).
 */
export function pointListBoundingBox(
  points: ReadonlyArray<SketchPointSnapshot>,
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Quick adapter: turn a sketch-point provider into the `expandHoleArray`
 * `BoundingBoxCtx` shape so the wizard can re-use the same context for both
 * the position-table preview and the pipeline rebuild.
 */
export function buildExpansionContext(
  provider: NonNullable<BoundingBoxCtx['resolveSketchPoints']>,
): BoundingBoxCtx {
  return { resolveSketchPoints: provider };
}

/**
 * Helper to feed `expandHoleArray` from a static map, used by the modal's
 * preview-row count and the test suite. Exported for the tests.
 */
export function expandWithSketchRegistry(
  def: HoleArrayDefinition,
  registry: Record<string, SketchPointSnapshot[]>,
): HolePosition[] {
  return expandHoleArray(def, {
    resolveSketchPoints: (id) => registry[id],
  });
}

// ─── DFM: TAP_BOTTOM_RISK rule (spec §2.5 + §11) ───────────────────────────

/**
 * `TAP_BOTTOM_RISK` rule — emitted by the DFM gate when a tap hole's usable
 * thread depth runs too close to the blind bottom. Spec §2.5:
 *   - hard rule: `tapDepth ≤ drillDepth − 3 × pitch` (rule of thumb)
 *   - warning  : `tapDepth > drillDepth − 2 × pitch`  (DFM-gate trip)
 *
 * Surfaced here (alongside the propagation logic) instead of in a dedicated
 * dfmGate file because the C4 task scope keeps `dfmGate.ts` untouched until
 * we have at least one DFM rule that consumes worker geometry. This pure
 * helper is the one the wizard's Termination tab calls to render a yellow
 * "(at risk)" pill.
 *
 * Returns:
 *   - `null` if the rule doesn't apply (non-tap kind, non-blind termination,
 *     no pitch / depth data).
 *   - a `TapBottomRiskFinding` when the rule trips, with the offending
 *     numbers so the UI can render an explanatory tooltip.
 *
 * Pure function: no side effects, deterministic.
 */
export interface TapBottomRiskFinding {
  code: 'TAP_BOTTOM_RISK';
  severity: 'warning' | 'error';
  /** Resolved drill depth (mm). For blind termination this is the blindDepth. */
  drillDepth: number;
  /** Resolved tap depth (mm). */
  tapDepth: number;
  /** Thread pitch (mm/thread). */
  pitch: number;
  /** Margin: `drillDepth − tapDepth`. Negative when tap exceeds drill. */
  margin: number;
  /** Recommended safety margin: `2 × pitch` (warning trip line). */
  recommendedMargin: number;
  /** Human-friendly summary string, lang-neutral. */
  message: string;
}

export interface TapBottomRiskInputs {
  /** Hole sub-type — only `'tap'` triggers the rule. */
  kind: string;
  /** Tap depth (mm). */
  tapDepth?: number;
  /** Pitch (mm/thread). */
  pitch?: number;
  /** Termination kind. Only `'blind'` triggers the rule. */
  terminationKind: string;
  /** Blind depth (mm), required when terminationKind === 'blind'. */
  blindDepth?: number;
}

export function evaluateTapBottomRisk(
  inputs: TapBottomRiskInputs,
): TapBottomRiskFinding | null {
  if (inputs.kind !== 'tap') return null;
  if (inputs.terminationKind !== 'blind') return null;
  if (
    inputs.tapDepth === undefined ||
    inputs.pitch === undefined ||
    inputs.blindDepth === undefined
  ) {
    return null;
  }
  if (!Number.isFinite(inputs.tapDepth) || !Number.isFinite(inputs.pitch) || !Number.isFinite(inputs.blindDepth)) {
    return null;
  }
  if (inputs.pitch <= 0) return null;

  const margin = inputs.blindDepth - inputs.tapDepth;
  const recommendedMargin = 2 * inputs.pitch;
  // Hard error: tap depth exceeds the bore itself (impossible to cut).
  if (margin < 0) {
    return {
      code: 'TAP_BOTTOM_RISK',
      severity: 'error',
      drillDepth: inputs.blindDepth,
      tapDepth: inputs.tapDepth,
      pitch: inputs.pitch,
      margin,
      recommendedMargin,
      message: `Tap depth ${inputs.tapDepth} mm exceeds drill depth ${inputs.blindDepth} mm — impossible cut.`,
    };
  }
  // Warning: within the 2-pitch buffer.
  if (margin < recommendedMargin) {
    return {
      code: 'TAP_BOTTOM_RISK',
      severity: 'warning',
      drillDepth: inputs.blindDepth,
      tapDepth: inputs.tapDepth,
      pitch: inputs.pitch,
      margin,
      recommendedMargin,
      message:
        `Tap depth ${inputs.tapDepth} mm leaves only ${margin.toFixed(2)} mm to the bore bottom ` +
        `(recommend ≥ ${recommendedMargin.toFixed(2)} mm = 2 × pitch).`,
    };
  }
  return null;
}
