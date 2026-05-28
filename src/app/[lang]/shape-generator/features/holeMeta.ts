/**
 * Hole-meta projection — flat structured summary of a HoleSpec + array def.
 *
 * Phase 2 Week 6 Track C6 deliverable. Spec ref:
 * `wave-2-phase-2-hole-wizard-spec.md` §8 (test fixture set surfaces this
 * via fixture metadata) and §10.1 (drawing-side hand-off — Phase 3 reads
 * `holeMeta` directly to render callouts + hole-tables).
 *
 * The projection is **pure** and **derived** — it never owns state. Given
 * any (`HoleSpec`, `HoleArrayDefinition`) pair, `extractHoleMeta()` emits
 * the same `HoleMeta` deterministically. The intent is to give downstream
 * consumers a stable schema that won't churn when the source data model
 * evolves (e.g. when W5 added `partialAngle` to `CircularArrayParams`,
 * the projection didn't need a new field — the position count covers it).
 *
 * Three consumers in Phase 2 onward:
 *   - **BOM aggregator** — `aggregateHoleMeta(metas)` groups by
 *     `(kind, designation, callout)` and counts.
 *   - **DFM gate** — the `dfmFlags` array carries TAP_BOTTOM_RISK (C4)
 *     plus the new C6 flags below.
 *   - **Drawing callout** — the `callout` field is a single-line, glyph-
 *     based string ready for drawing-side rendering (`4 × M3 THRU`).
 *
 * No React / Three.js / DOM dependency — pure data + math only.
 */

import type {
  HoleArrayDefinition,
  HoleKind,
  HoleSpec,
  TerminationKind,
  TerminationParams,
} from './holeArray';

// ─── Public types ──────────────────────────────────────────────────────────

/**
 * Sub-projection — the worker / drawing side typically wants a single
 * resolved diameter + the catalog name. We surface both because the
 * BOM groups by (kind, designation) but the drawing callout uses the
 * resolved Ø for the THRU/⌴ glyph.
 */
export interface HoleMetaCallout {
  /** Pre-rendered glyph string, e.g. `4 × M6 ▼ 12, TAP ▼ 10`. */
  text: string;
  /** Drill diameter used to render the bore (`Ø` glyph). */
  drillDiameter: number;
  /** Counterbore / countersink / counterdrill ⌀ when applicable. */
  headDiameter?: number;
  /** Pitch (mm) when the kind carries a thread. */
  pitch?: number;
  /** Number of positions multiplied into the callout. */
  count: number;
}

/**
 * DFM flag codes — stable strings; the UI maps them to localized chips.
 * Phase 2 W4 introduced `TAP_BOTTOM_RISK`; W6 adds the structural ones
 * below. New flags must be append-only so downstream consumers don't
 * break on enum exhaustion.
 */
export type DfmFlagCode =
  /** From C4 — tap depth too close to drilled depth (`pitch * 2` safety). */
  | 'TAP_BOTTOM_RISK'
  /** Drill ⌀ < 1.5 mm with depth > 10 × ⌀ — likely tool snap risk. */
  | 'SMALL_DRILL_AT_LARGE_DEPTH'
  /** Two positions are < 1.5 × drill ⌀ apart — bore walls overlap. */
  | 'CLOSE_HOLE_SPACING'
  /** Tap with no thread engagement (tapDepth ≤ 1 × pitch). */
  | 'TAP_SHALLOW_ENGAGEMENT'
  /** Pipe-tap with `pipeTapClass` parallel + non-zero taper. Likely mis-config. */
  | 'PIPE_TAP_CLASS_TAPER_MISMATCH'
  /** Counterbore depth exceeds blind hole depth — pocket cuts past the bore. */
  | 'CBORE_DEEPER_THAN_HOLE';

export interface DfmFlag {
  code: DfmFlagCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

/**
 * Termination summary — kept narrow so consumers don't have to import
 * the discriminated `TerminationParams` types just to read meta. Pre-
 * rendered glyph fragment ready for callout rendering.
 */
export interface TerminationSummary {
  kind: TerminationKind;
  /** Pre-rendered glyph fragment, e.g. `THRU` or `▼ 12 mm`. */
  glyph: string;
  /** Effective depth in mm when known (blind only). undefined for through. */
  depthMm?: number;
}

/**
 * The flat hole-meta projection. **Stable schema** — the field order
 * here is the canonical one; downstream consumers (BOM aggregator, Phase
 * 3 drawing module, telemetry) read by key, never by position. Adding a
 * field is safe as long as it's optional and `extractHoleMeta` defaults
 * it sensibly when absent.
 */
export interface HoleMeta {
  /** Source array id — lets BOM rows link back to the feature tree. */
  arrayId: string;
  kind: HoleKind;
  /** Catalog designation, e.g. `M6`, `1/4-20`, `1/4-18 NPT`. */
  designation: string;
  /** Catalog series — `ISO`, `UTS`, `NPT`, `BSP`, etc. */
  series: string;
  /** Fit class when meaningful (clearance kinds). */
  fitClass?: 'close' | 'normal' | 'loose';
  /** Pre-rendered drawing callout. See HoleMetaCallout. */
  callout: HoleMetaCallout;
  /** Threading reference — set for tap + pipe_tap. */
  threadRef?: {
    /** Thread family — `metric`, `unc`, `unf`, `npt`, `bsp`. */
    family: 'metric' | 'unc' | 'unf' | 'npt' | 'bsp';
    /** Tap class — `6H`, `2B`, or pipe class `NPT`/`NPSM`/etc. */
    classCode: string;
    /** Engagement depth (mm) — `tapDepth` or `engagementDepth`. */
    engagementDepthMm: number;
    /** Pitch (mm) when known. */
    pitchMm?: number;
  };
  /** Termination summary. */
  terminationSummary: TerminationSummary;
  /** Number of positions in this array. */
  count: number;
  /** True for `pipe_tap` kind. */
  isPipe: boolean;
  /** True for any pipe-tap with non-zero taper angle. */
  isTapered: boolean;
  /** DFM concerns surfaced by `evaluateDfm()`. */
  dfmFlags: DfmFlag[];
}

/**
 * Aggregated rollup — BOM-grouped by (kind, designation, callout). The
 * `key` field is the stable string used as the grouping key so callers
 * can do `.map` / `.find` on it directly without re-deriving.
 */
export interface AggregatedHoleMetaRow {
  key: string;
  kind: HoleKind;
  designation: string;
  callout: string;
  /** Sum of `count` across all matching metas. */
  totalCount: number;
  /** Number of distinct arrays contributing. */
  arrayCount: number;
  /** Distinct arrayIds contributing — useful for jump-to-feature links. */
  arrayIds: string[];
}

export interface AggregatedHoleMeta {
  rows: AggregatedHoleMetaRow[];
  /** Sum of `count` across all rows (= total hole instances). */
  grandTotal: number;
}

// ─── Inputs for DFM evaluation ─────────────────────────────────────────────

/**
 * Optional context for the DFM pass. When provided, additional rules
 * fire (e.g. `CLOSE_HOLE_SPACING` needs the resolved position list).
 */
export interface HoleMetaContext {
  /**
   * Resolved positions for this hole array, in world XY. When omitted,
   * spacing-dependent DFM rules are skipped (the meta is still emitted —
   * just without the spacing check).
   */
  positions?: Array<{ id: string; x: number; y: number }>;
  /**
   * Effective drilled depth in mm — only meaningful for blind holes. For
   * through-all we use a sentinel large value so the depth-ratio checks
   * don't trip. Pulled from `TerminationParams.depth` for blind kinds.
   */
  blindDepthMm?: number;
}

// ─── Glyph helpers ─────────────────────────────────────────────────────────

const GLYPH_DIA = 'Ø';
const GLYPH_CBORE = '⌴'; // ⌴
const GLYPH_CSK = '⌵';   // ⌵
const GLYPH_DEPTH = '▼'; // ▼
const GLYPH_THRU = 'THRU';
const GLYPH_TIMES = '×';

function fmtNum(n: number): string {
  // Trim trailing zeros so 5.0 → '5' but keep 5.5 → '5.5'.
  if (!Number.isFinite(n)) return '?';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function renderTerminationGlyph(term: TerminationParams): TerminationSummary {
  switch (term.kind) {
    case 'through':
      return { kind: 'through', glyph: GLYPH_THRU };
    case 'blind':
      return {
        kind: 'blind',
        glyph: `${GLYPH_DEPTH} ${fmtNum(term.depth)}`,
        depthMm: term.depth,
      };
    case 'upToNext':
      return { kind: 'upToNext', glyph: 'UP TO NEXT' };
    case 'upToFace':
      return { kind: 'upToFace', glyph: 'UP TO FACE' };
  }
}

function renderCallout(
  spec: HoleSpec,
  term: TerminationParams,
  designation: string,
  count: number,
): HoleMetaCallout {
  const termGlyph = renderTerminationGlyph(term).glyph;
  const prefix = count > 1 ? `${count} ${GLYPH_TIMES} ` : '';
  let text: string;
  let headDiameter: number | undefined;
  let pitch: number | undefined;

  switch (spec.kind) {
    case 'drilled': {
      text = `${prefix}${GLYPH_DIA}${fmtNum(spec.diameter)} ${termGlyph}`;
      break;
    }
    case 'counterbore': {
      headDiameter = spec.headDiameter;
      text =
        `${prefix}${GLYPH_DIA}${fmtNum(spec.diameter)} ${termGlyph}, ` +
        `${GLYPH_DIA}${fmtNum(spec.headDiameter)} ${GLYPH_CBORE} ${fmtNum(spec.headDepth)}`;
      break;
    }
    case 'countersink': {
      headDiameter = spec.coneDiameter;
      text =
        `${prefix}${GLYPH_DIA}${fmtNum(spec.diameter)} ${termGlyph}, ` +
        `${GLYPH_DIA}${fmtNum(spec.coneDiameter)} ${GLYPH_CSK} ${fmtNum(spec.coneAngle)}°`;
      break;
    }
    case 'counterdrill': {
      headDiameter = spec.headDiameter;
      text =
        `${prefix}${GLYPH_DIA}${fmtNum(spec.headDiameter)} ${GLYPH_CBORE} ${fmtNum(spec.headDepth)}, ` +
        `${GLYPH_DIA}${fmtNum(spec.middleDiameter)} ${GLYPH_CBORE} ${fmtNum(spec.middleDepth)}, ` +
        `${GLYPH_DIA}${fmtNum(spec.diameter)} ${termGlyph}`;
      break;
    }
    case 'tap': {
      pitch = spec.pitch;
      text =
        `${prefix}${designation}${GLYPH_TIMES}${fmtNum(spec.pitch)} ${termGlyph}, ` +
        `TAP ${GLYPH_DEPTH} ${fmtNum(spec.tapDepth)}`;
      break;
    }
    case 'pipe_tap': {
      text = `${prefix}${designation} ${spec.pipeStandard} ${GLYPH_DEPTH} ${fmtNum(spec.engagementDepth)}`;
      break;
    }
  }
  return {
    text,
    drillDiameter: spec.diameter,
    headDiameter,
    pitch,
    count,
  };
}

// ─── DFM evaluation ────────────────────────────────────────────────────────

const SMALL_DRILL_THRESHOLD_MM = 1.5;
const SMALL_DRILL_DEPTH_RATIO = 10; // drillDepth / drillDia ratio above which we flag
const CLOSE_SPACING_RATIO = 1.5;     // hole-center spacing / drill ⌀ minimum

function squareDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function evaluateDfm(
  spec: HoleSpec,
  term: TerminationParams,
  ctx?: HoleMetaContext,
): DfmFlag[] {
  const flags: DfmFlag[] = [];

  // ── Tap-bottom risk (mirror of C4 evaluator). For blind+tap, leave at
  //    least 2 × pitch between tapDepth and the bore bottom.
  if (
    spec.kind === 'tap' &&
    term.kind === 'blind' &&
    Number.isFinite(spec.tapDepth) &&
    Number.isFinite(spec.pitch) &&
    Number.isFinite(term.depth)
  ) {
    const margin = term.depth - spec.tapDepth;
    const recommendedMargin = 2 * spec.pitch;
    if (margin < 0) {
      flags.push({
        code: 'TAP_BOTTOM_RISK',
        severity: 'error',
        message: `Tap depth ${fmtNum(spec.tapDepth)} mm exceeds drill depth ${fmtNum(term.depth)} mm.`,
      });
    } else if (margin < recommendedMargin) {
      flags.push({
        code: 'TAP_BOTTOM_RISK',
        severity: 'warning',
        message: `Tap leaves only ${fmtNum(margin)} mm to bore bottom (recommend ≥ ${fmtNum(recommendedMargin)} mm).`,
      });
    }

    // Tap with effectively no engagement (≤ 1 × pitch).
    if (spec.tapDepth <= spec.pitch) {
      flags.push({
        code: 'TAP_SHALLOW_ENGAGEMENT',
        severity: 'warning',
        message: `Tap depth ${fmtNum(spec.tapDepth)} mm ≤ 1 × pitch (${fmtNum(spec.pitch)} mm) — minimal thread engagement.`,
      });
    }
  }

  // ── Small drill / large depth.
  const drillDepth = term.kind === 'blind' ? term.depth : ctx?.blindDepthMm;
  if (
    Number.isFinite(spec.diameter) &&
    spec.diameter > 0 &&
    spec.diameter < SMALL_DRILL_THRESHOLD_MM &&
    drillDepth !== undefined &&
    Number.isFinite(drillDepth) &&
    drillDepth / spec.diameter > SMALL_DRILL_DEPTH_RATIO
  ) {
    flags.push({
      code: 'SMALL_DRILL_AT_LARGE_DEPTH',
      severity: 'warning',
      message: `Drill ⌀${fmtNum(spec.diameter)} mm × depth ${fmtNum(drillDepth)} mm — depth/⌀ ratio > ${SMALL_DRILL_DEPTH_RATIO} (snap risk).`,
    });
  }

  // ── Close hole spacing — needs resolved positions.
  if (ctx?.positions && ctx.positions.length >= 2 && spec.diameter > 0) {
    const minDistance = spec.diameter * CLOSE_SPACING_RATIO;
    const minDistSq = minDistance * minDistance;
    let tripped = false;
    let trippedPair: [string, string] | null = null;
    let trippedDist = Infinity;
    outer: for (let i = 0; i < ctx.positions.length; i++) {
      for (let j = i + 1; j < ctx.positions.length; j++) {
        const dSq = squareDistance(ctx.positions[i], ctx.positions[j]);
        if (dSq < minDistSq) {
          tripped = true;
          trippedPair = [ctx.positions[i].id, ctx.positions[j].id];
          trippedDist = Math.sqrt(dSq);
          break outer;
        }
      }
    }
    if (tripped && trippedPair) {
      flags.push({
        code: 'CLOSE_HOLE_SPACING',
        severity: 'warning',
        message: `Holes ${trippedPair[0]} ↔ ${trippedPair[1]} are ${fmtNum(trippedDist)} mm apart (< 1.5 × ⌀${fmtNum(spec.diameter)}).`,
      });
    }
  }

  // ── Pipe-tap class / taper-angle mismatch (W6).
  if (spec.kind === 'pipe_tap') {
    const taper = spec.taperAngle ?? 0;
    const cls = spec.pipeTapClass;
    if (cls === 'NPSM' || cls === 'BSP_parallel') {
      if (taper > 0) {
        flags.push({
          code: 'PIPE_TAP_CLASS_TAPER_MISMATCH',
          severity: 'warning',
          message: `Pipe-tap class ${cls} is parallel but taperAngle = ${fmtNum(taper)}° — set to 0 for parallel threads.`,
        });
      }
    }
  }

  // ── Counterbore deeper than blind hole.
  if (
    (spec.kind === 'counterbore' || spec.kind === 'counterdrill') &&
    term.kind === 'blind' &&
    Number.isFinite(spec.headDepth) &&
    Number.isFinite(term.depth) &&
    spec.headDepth >= term.depth
  ) {
    flags.push({
      code: 'CBORE_DEEPER_THAN_HOLE',
      severity: 'warning',
      message: `Counterbore depth ${fmtNum(spec.headDepth)} mm ≥ blind hole depth ${fmtNum(term.depth)} mm.`,
    });
  }

  return flags;
}

// ─── Thread ref derivation ─────────────────────────────────────────────────

function deriveThreadRef(
  spec: HoleSpec,
  designation: string,
  series: string,
): HoleMeta['threadRef'] {
  if (spec.kind === 'tap') {
    // ISO + KSB + ISO273 → metric thread; ANSI → UNC/UNF heuristic (designation
    // starts with `#` or contains '-UNF'). This is good-enough for projection.
    let family: NonNullable<HoleMeta['threadRef']>['family'] = 'metric';
    if (series === 'ANSI') {
      family = designation.toUpperCase().includes('UNF') ? 'unf' : 'unc';
    }
    return {
      family,
      classCode: spec.tapClass,
      engagementDepthMm: spec.tapDepth,
      pitchMm: spec.pitch,
    };
  }
  if (spec.kind === 'pipe_tap') {
    const family: NonNullable<HoleMeta['threadRef']>['family'] =
      spec.pipeStandard === 'NPT' ? 'npt' : 'bsp';
    return {
      family,
      classCode: spec.pipeTapClass ?? spec.pipeStandard,
      engagementDepthMm: spec.engagementDepth,
    };
  }
  return undefined;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Build the flat `HoleMeta` projection from a (spec, def) pair. Pure
 * function — no side effects, no async.
 *
 * The `ctx` argument is optional: when provided, additional DFM rules
 * fire (notably `CLOSE_HOLE_SPACING`). For BOM-only consumers passing
 * `undefined` is fine — the projection still carries `count`, `callout`,
 * and the thread-ref fields needed for aggregation.
 */
export function extractHoleMeta(
  spec: HoleSpec,
  def: HoleArrayDefinition,
  ctx?: HoleMetaContext,
): HoleMeta {
  const designation = def.holeSpec.designation;
  const series = String(def.holeSpec.series);
  const fitClass = def.holeSpec.fitClass;

  // Position count — math kinds use the count fields directly; manual /
  // fromSketch use the resolved length when ctx.positions is supplied,
  // else fall back to the array data.
  const count = resolvePositionCount(def, ctx);
  const callout = renderCallout(spec, def.terminationParams, designation, count);
  const terminationSummary = renderTerminationGlyph(def.terminationParams);
  const threadRef = deriveThreadRef(spec, designation, series);
  const dfmFlags = evaluateDfm(spec, def.terminationParams, ctx);

  const isPipe = spec.kind === 'pipe_tap';
  const isTapered = isPipe && spec.kind === 'pipe_tap' && (spec.taperAngle ?? 0) > 0;

  const meta: HoleMeta = {
    arrayId: def.id,
    kind: spec.kind,
    designation,
    series,
    callout,
    terminationSummary,
    count,
    isPipe,
    isTapered,
    dfmFlags,
  };
  if (fitClass) meta.fitClass = fitClass;
  if (threadRef) meta.threadRef = threadRef;
  return meta;
}

/**
 * Resolve the position count for an array def.
 *
 *  - `manual` / `fromSketch` — use ctx.positions length when provided,
 *    else fall back to the array data length (manual) or zero (fromSketch
 *    has no inline list).
 *  - Math kinds (linear / linear2D / circular / rect) — read the count
 *    directly from params; honors `partialAngle` only insofar as the
 *    pattern itself does (the count field is unchanged).
 */
function resolvePositionCount(
  def: HoleArrayDefinition,
  ctx: HoleMetaContext | undefined,
): number {
  if (ctx?.positions !== undefined) {
    return ctx.positions.length;
  }
  switch (def.params.kind) {
    case 'linear':
      return Math.max(0, Math.floor(def.params.data.count));
    case 'linear2D':
      return Math.max(0, Math.floor(def.params.data.rows) * Math.floor(def.params.data.cols));
    case 'circular':
      return Math.max(0, Math.floor(def.params.data.count));
    case 'rect':
      return Math.max(0, Math.floor(def.params.data.rows) * Math.floor(def.params.data.cols));
    case 'manual':
      return Array.isArray(def.params.data.points) ? def.params.data.points.length : 0;
    case 'fromSketch':
      // Without ctx.positions we can't know — fall back to 0. Callers
      // that need accurate counts for sketch-driven holes must pass
      // `ctx.positions` from `expandHoleArray()`.
      return 0;
  }
}

/**
 * Strip the "N × " count prefix from a callout so two arrays of the
 * same shape but different counts hash to the same BOM key. The
 * grouping intent is "what is this hole?" not "how many in this
 * specific array?" — the count is summed across the group separately.
 */
function callouotKeyText(c: HoleMetaCallout): string {
  return c.text.replace(/^\d+\s*×\s*/u, '');
}

/**
 * Aggregate a list of HoleMeta into BOM-grouped rows. Groups by the
 * tuple `(kind, designation, callout-shape)` — the callout shape is
 * the post-prefix-stripped string, so two arrays with the same kind +
 * designation + termination collapse even if their counts differ. Two
 * with different termination (e.g. one blind, one through) stay
 * separate.
 *
 * Returns rows sorted by `(kind, designation)` ascending for stable
 * downstream rendering.
 */
export function aggregateHoleMeta(metas: HoleMeta[]): AggregatedHoleMeta {
  const byKey = new Map<string, AggregatedHoleMetaRow>();
  let grandTotal = 0;

  for (const m of metas) {
    const shape = callouotKeyText(m.callout);
    const key = `${m.kind}::${m.designation}::${shape}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        kind: m.kind,
        designation: m.designation,
        callout: shape,
        totalCount: 0,
        arrayCount: 0,
        arrayIds: [],
      };
      byKey.set(key, row);
    }
    row.totalCount += m.count;
    if (!row.arrayIds.includes(m.arrayId)) {
      row.arrayIds.push(m.arrayId);
      row.arrayCount += 1;
    }
    grandTotal += m.count;
  }

  const rows = Array.from(byKey.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.designation.localeCompare(b.designation);
  });

  return { rows, grandTotal };
}

/**
 * Convenience — extract + aggregate in one pass. Useful for tests and
 * for the burn-in fixture where we don't separately need the per-array
 * meta list.
 */
export function projectAndAggregate(
  pairs: Array<{
    spec: HoleSpec;
    def: HoleArrayDefinition;
    ctx?: HoleMetaContext;
  }>,
): { metas: HoleMeta[]; aggregate: AggregatedHoleMeta } {
  const metas = pairs.map((p) => extractHoleMeta(p.spec, p.def, p.ctx));
  return { metas, aggregate: aggregateHoleMeta(metas) };
}
