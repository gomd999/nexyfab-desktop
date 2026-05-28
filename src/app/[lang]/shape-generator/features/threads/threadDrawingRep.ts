/**
 * threadDrawingRep.ts — Wave 2 Phase 2 Track D Week 8 (D8).
 *
 * ISO 6410-1 simplified-thread representation for 2D drawing views. Pure
 * geometry builder — no rendering, no DOM, no Three.js. Returns a
 * `DrawingLineSet` (solid + dashed + extension lines) in **paper-space mm**
 * that the Phase 3 drawing module consumes to lay down lines onto the
 * sheet.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §13.2 (dashed-line
 * representation in section views) and §12 (drawing-callout pipeline);
 * §15 W8 (this PR scope: builder + flag gate, no integration).
 *
 * Convention recap (ISO 6410-1):
 *   - **External thread** (boss): solid line at major Ø, dashed at minor Ø
 *     (`0.75 × major` for crest-line — conservative; ISO basic minor is
 *     ~0.83 × major for typical M-series). We emit the actual minor from
 *     the catalog.
 *   - **Internal thread** (hole): dashed line at major Ø, solid at minor Ø.
 *   - **Extension lines**: short ticks from the threaded region's axial
 *     endpoints, used by the drawing module to anchor the callout leader.
 *   - **End-line** at the thread terminus: solid 360°-arc with a 30°
 *     thread runout (left for Phase 3 drawing module to add — D8 ships
 *     only the cylindrical-projection lines).
 *
 * This file is **flag-gated** by `PHASE_3_DRAWING_REP_ENABLED`. When the
 * flag is `false` (current default), `buildThreadDrawingRep` still
 * computes the geometry — the flag exists so callers can decide whether
 * to push it into the drawing pipeline. Returning the geometry from a
 * disabled flag is safe (no DOM side effects, just numbers).
 */

import type { ThreadFeature } from './threadFeature';
import { findThreadRow, type ThreadStandardRow } from './threadCatalog';

// ─── Phase 3 integration flag ───────────────────────────────────────────────

/**
 * Phase 3 drawing-module integration flag. Default `false`; flipped to
 * `true` only when the Phase 3 drawing module ships and the section-view
 * pipeline is ready to consume the line set.
 *
 * The builder is callable regardless of this flag — the flag only gates
 * the **integration point** (Phase 3 drawing-module call site). Callers
 * that do their own gating (e.g. tests, BOM exporter) can ignore the
 * flag and use the builder directly.
 */
export const PHASE_3_DRAWING_REP_ENABLED = false;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Single 2D line segment in paper-space mm. */
export interface Line2D {
  /** Start point. */
  readonly start: readonly [number, number];
  /** End point. */
  readonly end: readonly [number, number];
}

/**
 * Output of the builder. Three line categories per ISO 6410-1:
 *
 * - `solid`: continuous-line geometry (object-line weight, typically
 *   0.5-0.7 mm in the drawing module).
 *
 * - `dashed`: short-dash lines (thin, typically 0.25-0.35 mm). Phase 3's
 *   drawing module turns these into stroked path segments with the
 *   ISO 128-22 dashed pattern.
 *
 * - `extensionLines`: tick marks from the thread end-points used as
 *   leader anchor points by the callout label.
 */
export interface DrawingLineSet {
  readonly solid: readonly Line2D[];
  readonly dashed: readonly Line2D[];
  readonly extensionLines: readonly Line2D[];
}

/**
 * View-projection input to the builder. The drawing module computes this
 * from the section-view camera; for D8 we accept just the parameters the
 * builder needs (orientation of the thread axis in paper space).
 */
export interface ViewProjection {
  /**
   * Side / front / top — projection name. Determines whether the thread
   * shows as a longitudinal section (rectangle with dashed lines on the
   * inside) or as an end view (concentric circles).
   *
   * For D8 we focus on `'longitudinal'` because the spec §13.2 dashed-line
   * convention is the section view; `'endView'` is the simple concentric-
   * circles representation, also produced.
   */
  readonly kind: 'longitudinal' | 'endView';
  /**
   * Paper-space position of the thread axis (center for `endView`, axial
   * origin for `longitudinal`). Default `(0, 0)`.
   */
  readonly origin?: readonly [number, number];
  /**
   * For `longitudinal` views — the axial direction in paper-space (unit
   * vector). Default `(1, 0)` (axis points right). The builder lays the
   * thread lines along this direction and the radial lines perpendicular.
   */
  readonly axisDirection?: readonly [number, number];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normalise a 2D vector (returns `[1, 0]` for zero-length input). */
function normalize(v: readonly [number, number]): [number, number] {
  const m = Math.hypot(v[0], v[1]);
  if (m === 0) return [1, 0];
  return [v[0] / m, v[1] / m];
}

/** Perpendicular of a 2D vector — rotates +90° CCW. */
function perp(v: readonly [number, number]): [number, number] {
  return [-v[1], v[0]];
}

function add(
  p: readonly [number, number],
  v: readonly [number, number],
  scale = 1,
): [number, number] {
  return [p[0] + v[0] * scale, p[1] + v[1] * scale];
}

/**
 * Resolve the major / minor diameters for the feature in mm. Falls back
 * to a conservative `0.75 × major` for the minor when the catalog is
 * missing (defensive — should never trigger in practice).
 */
function diametersMm(
  feature: ThreadFeature,
  row: ThreadStandardRow | null,
): { major: number; minor: number } {
  if (row) {
    return { major: row.nominalDia, minor: row.minorDiameter };
  }
  // Fallback — the designation is unknown to the catalog. Use a 75%
  // minor (ISO 6410-1 simplified default).
  const major = 0;
  return { major, minor: major * 0.75 };
}

// ─── Builders per view kind ─────────────────────────────────────────────────

/**
 * Longitudinal section view — the thread is sectioned along its axis.
 * Output:
 *  - Two long lines (top & bottom of the threaded cylinder).
 *  - For internal threads: dashed at `±major/2`, solid at `±minor/2`.
 *  - For external threads: solid at `±major/2`, dashed at `±minor/2`.
 *  - Two extension lines at the thread endpoints (perpendicular to axis,
 *    length = 1.5 mm by drawing convention).
 *
 * Coordinates are in paper-space mm, **already projected** — the drawing
 * module hands us the projection.
 */
function buildLongitudinalLines(
  feature: ThreadFeature,
  row: ThreadStandardRow | null,
  projection: ViewProjection,
): DrawingLineSet {
  const { major, minor } = diametersMm(feature, row);
  const length = feature.length;
  const origin = projection.origin ?? [0, 0];
  const axis = normalize(projection.axisDirection ?? [1, 0]);
  const radial = perp(axis);

  const startAxial = feature.startOffset;
  const endAxial = startAxial + length;
  const halfMajor = major / 2;
  const halfMinor = minor / 2;

  // Endpoints of the four lines (top/bottom × major/minor).
  const p0Major = add(add(origin, axis, startAxial), radial, halfMajor);
  const p1Major = add(add(origin, axis, endAxial), radial, halfMajor);
  const p0MajorN = add(add(origin, axis, startAxial), radial, -halfMajor);
  const p1MajorN = add(add(origin, axis, endAxial), radial, -halfMajor);
  const p0Minor = add(add(origin, axis, startAxial), radial, halfMinor);
  const p1Minor = add(add(origin, axis, endAxial), radial, halfMinor);
  const p0MinorN = add(add(origin, axis, startAxial), radial, -halfMinor);
  const p1MinorN = add(add(origin, axis, endAxial), radial, -halfMinor);

  const major1: Line2D = { start: p0Major, end: p1Major };
  const major2: Line2D = { start: p0MajorN, end: p1MajorN };
  const minor1: Line2D = { start: p0Minor, end: p1Minor };
  const minor2: Line2D = { start: p0MinorN, end: p1MinorN };

  // Solid / dashed swap per thread kind (ISO 6410-1):
  //   external: solid at major, dashed at minor
  //   internal: dashed at major, solid at minor
  const isInternal = feature.threadKind === 'internal';

  const solid: Line2D[] = isInternal ? [minor1, minor2] : [major1, major2];
  const dashed: Line2D[] = isInternal ? [major1, major2] : [minor1, minor2];

  // Extension lines at thread ends — 1.5 mm tick perpendicular to axis,
  // 0.5 mm gap from the major diameter.
  const TICK = 1.5;
  const GAP = 0.5;
  const extOuter = halfMajor + GAP + TICK;
  const extInner = halfMajor + GAP;

  const e1Start = add(add(origin, axis, startAxial), radial, extInner);
  const e1End = add(add(origin, axis, startAxial), radial, extOuter);
  const e2Start = add(add(origin, axis, endAxial), radial, extInner);
  const e2End = add(add(origin, axis, endAxial), radial, extOuter);

  const extensionLines: Line2D[] = [
    { start: e1Start, end: e1End },
    { start: e2Start, end: e2End },
  ];

  return { solid, dashed, extensionLines };
}

/**
 * End-view (axis pointing out of the page). Two concentric circles —
 * but we approximate each circle as N segments so the line-set output
 * is segment-based and the drawing module can render either segments
 * **or** convert to true arcs.
 *
 * For ISO 6410-1 end-view:
 *  - External thread: solid outer (major), dashed inner three-quarter
 *    arc at the minor (the dashed circle is intentionally an open
 *    3/4-arc to distinguish a thread from a feature line).
 *  - Internal thread: dashed outer (major) 3/4-arc, solid inner (minor)
 *    circle.
 */
function buildEndViewLines(
  feature: ThreadFeature,
  row: ThreadStandardRow | null,
  projection: ViewProjection,
): DrawingLineSet {
  const { major, minor } = diametersMm(feature, row);
  const center = projection.origin ?? [0, 0];

  // Approximation: 32 segments per full circle, 24 for 3/4-arc.
  const FULL_SEGMENTS = 32;
  const THREE_Q_SEGMENTS = 24;

  function circleSegments(radius: number, segments: number, arcFraction: number): Line2D[] {
    const lines: Line2D[] = [];
    const totalAngle = Math.PI * 2 * arcFraction;
    // Start the 3/4-arc at 90° so the gap sits at the top of the circle
    // (matches the conventional drawing orientation).
    const startAngle = arcFraction < 1 ? Math.PI * 0.5 : 0;
    for (let i = 0; i < segments; i++) {
      const a0 = startAngle + (totalAngle * i) / segments;
      const a1 = startAngle + (totalAngle * (i + 1)) / segments;
      const s: [number, number] = [
        center[0] + radius * Math.cos(a0),
        center[1] + radius * Math.sin(a0),
      ];
      const e: [number, number] = [
        center[0] + radius * Math.cos(a1),
        center[1] + radius * Math.sin(a1),
      ];
      lines.push({ start: s, end: e });
    }
    return lines;
  }

  const isInternal = feature.threadKind === 'internal';
  const solid: Line2D[] = [];
  const dashed: Line2D[] = [];

  if (isInternal) {
    // Internal: solid minor circle (the tap-drill hole edge), dashed
    // 3/4-arc at major (the crest of the internal thread).
    solid.push(...circleSegments(minor / 2, FULL_SEGMENTS, 1));
    dashed.push(...circleSegments(major / 2, THREE_Q_SEGMENTS, 0.75));
  } else {
    // External: solid major circle (the visible OD of the boss),
    // dashed 3/4-arc at minor (root of the V-thread).
    solid.push(...circleSegments(major / 2, FULL_SEGMENTS, 1));
    dashed.push(...circleSegments(minor / 2, THREE_Q_SEGMENTS, 0.75));
  }

  // No extension lines on end view; the callout leader uses the major
  // circle as anchor.
  return { solid, dashed, extensionLines: [] };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the ISO 6410-1 dashed-line drawing representation for the given
 * thread feature.
 *
 * Pure function. Does not consult the Phase-3 flag — the caller is
 * responsible for gating the **integration** call (e.g. passing the
 * resulting line-set into the drawing module). The builder is exposed
 * regardless so D8 unit tests + the BOM tap-drill column can use the
 * computed diameters freely.
 *
 * Returns an empty line-set when:
 *  - `feature.length` is non-positive (annotation-only), AND
 *  - `projection.kind === 'longitudinal'`.
 * The end-view representation always emits geometry (the thread exists
 * even if it has zero axial depth).
 *
 * @example
 *   buildThreadDrawingRep(featureM8, { kind: 'longitudinal' })
 *   // → { solid: [2 lines at minor], dashed: [2 at major], extensionLines: [2] }
 */
export function buildThreadDrawingRep(
  feature: ThreadFeature,
  projection: ViewProjection,
): DrawingLineSet {
  const row = findThreadRow(feature.threadRef.series, feature.threadRef.designation);

  if (projection.kind === 'longitudinal') {
    if (feature.length <= 0) {
      // Annotation-only thread on a non-existent cylinder — emit nothing.
      return { solid: [], dashed: [], extensionLines: [] };
    }
    return buildLongitudinalLines(feature, row, projection);
  }
  return buildEndViewLines(feature, row, projection);
}

/**
 * Convenience predicate for the Phase-3 wire-up — returns the flag's
 * current value plus the empty-result short-circuit logic, so the
 * call site doesn't need to know the rule.
 */
export function shouldEmitDrawingRep(feature: ThreadFeature): boolean {
  if (!PHASE_3_DRAWING_REP_ENABLED) return false;
  if (feature.length <= 0) return false;
  return true;
}
