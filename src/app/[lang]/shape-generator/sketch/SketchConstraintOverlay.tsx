'use client';

/**
 * SketchConstraintOverlay — Phase 1.B sketch UX (ADR-013, own pro-CAD).
 *
 * Pure SVG <g> overlay that draws the *visual* representation of solver
 * constraints on top of the sketch canvas. Constraints in
 * `SketchSolver` were previously invisible — users could see geometry
 * jump after `addDistance`/`addAngle` but had no on-canvas indication
 * of which dimensions were locked or by how much.
 *
 * Standalone-by-design:
 *   - No dependency on planegcs / SketchSolver. The wrapper is
 *     responsible for mapping solver state → DisplayConstraint[].
 *   - No i18n needed (labels are numeric — mm / degrees).
 *   - Pure SVG (no Three.js, no canvas).
 *
 * Render rules per kind:
 *   distance        — perpendicular-offset dimension line with two
 *                     arrowheads + extension witnesses + numeric label
 *                     (mm). Stroke is dashed grey (#6b7280) unless
 *                     selected. Algorithm:
 *                       1. midpoint M of (p1, p2)
 *                       2. unit perp n̂ to the segment, rotated CCW
 *                       3. dim-line endpoints A = p1 + n̂·OFFSET,
 *                          B = p2 + n̂·OFFSET (default OFFSET=20)
 *                       4. arrowheads point inward along (B-A) at A and
 *                          (A-B) at B
 *                       5. extension witnesses are short line stubs from
 *                          p1→A and p2→B so the dim-line ties back to the
 *                          measured points
 *
 *   angle           — circular arc between two lines centered at their
 *                     intersection (or, if parallel/no-intersection,
 *                     anchored at the average midpoint as a fallback).
 *                     Arc radius is a fixed pixel size so it stays
 *                     legible across zoom levels. Algorithm:
 *                       1. compute line1 dir d1, line2 dir d2
 *                       2. intersect = lineLineIntersection(line1, line2)
 *                       3. arc center = intersect (or midpoint fallback)
 *                       4. start angle = atan2(d1.y, d1.x)
 *                       5. end angle   = atan2(d2.y, d2.x)
 *                       6. SVG arc path via two end points + radius
 *                          (`A r r 0 0 1 endX endY`); label sits at the
 *                          midpoint angle on a slightly larger radius
 *                          for readability
 *
 *   horizontal      — small "H" badge anchored at the segment midpoint
 *                     (one badge per line).
 *   vertical        — same as horizontal with "V".
 *   parallel        — "∥" badge at the midpoint of the first segment.
 *   perpendicular   — "⟂" badge at the midpoint of the first segment.
 *   coincident      — small "●" dot pair badge at the first entity.
 *   tangent         — "T" badge.
 *   equal_length    — "=" badge.
 *   equal_radius    — "=R" badge.
 *   fix             — "🔒" / "F" badge (we use "F" to stay text-only).
 *
 * Selection: when `selectedConstraintId === c.id`, the constraint
 * renders in blue (#2563eb) with a slightly thicker stroke. A small
 * "×" delete affordance appears next to the label so the user can
 * remove the constraint without going through the toolbar.
 *
 * Interaction:
 *   - The entire constraint <g> is clickable → `onSelect(id)`.
 *   - The "×" inside a selected constraint → `onDelete(id)` (does
 *     not re-fire onSelect; click is stopped before propagating).
 *
 * Test surface (data-testids):
 *   solver-constraint-overlay              (root <g>)
 *   solver-constraint-overlay-{id}         (per-constraint <g>)
 *   solver-constraint-overlay-{id}-label   (numeric label, distance/angle only)
 *   solver-constraint-overlay-{id}-delete  (delete affordance — only when selected)
 *   solver-constraint-overlay-{id}-arrow-a (distance arrowhead at p1 side)
 *   solver-constraint-overlay-{id}-arrow-b (distance arrowhead at p2 side)
 *   solver-constraint-overlay-{id}-arc     (angle arc path)
 *   solver-constraint-overlay-{id}-badge   (badge text — h/v/para/perp/etc)
 */

import React from 'react';

// ─── types ────────────────────────────────────────────────────────────────

export interface Pt {
  x: number;
  y: number;
}

export interface DistanceDisplayConstraint {
  kind: 'distance';
  id: string;
  p1: Pt;
  p2: Pt;
  /** Distance value in sketch units (mm). */
  value: number;
}

export interface AngleDisplayConstraint {
  kind: 'angle';
  id: string;
  line1Pts: [Pt, Pt];
  line2Pts: [Pt, Pt];
  /** Angle in radians (matches solver internal). */
  value: number;
}

/**
 * Geometric "badge" constraints (horizontal, vertical, etc.). These
 * have no numeric value; we just need a place to drop the badge near
 * one or more entities.
 *
 * `entities` is a flat list of points used to derive an anchor:
 *   - line constraints (horizontal/vertical/parallel/perpendicular/
 *     equal_length): pass the two endpoints of the (first) line; the
 *     badge centers on the midpoint.
 *   - 2-line constraints (parallel/perpendicular): pass the four
 *     endpoints — first two = line A, second two = line B; we anchor
 *     to line A's midpoint and emit a single badge.
 *   - point constraints (coincident, fix): pass the point(s); the
 *     badge centers on the first.
 *   - circle/arc (equal_radius, tangent): pass the center(s); badge
 *     centers on the first.
 */
export interface GeometricDisplayConstraint {
  kind:
    | 'horizontal'
    | 'vertical'
    | 'parallel'
    | 'perpendicular'
    | 'coincident'
    | 'tangent'
    | 'equal_length'
    | 'equal_radius'
    | 'fix';
  id: string;
  entities: ReadonlyArray<Pt>;
}

export type DisplayConstraint =
  | DistanceDisplayConstraint
  | AngleDisplayConstraint
  | GeometricDisplayConstraint;

export interface SketchConstraintOverlayProps {
  constraints: ReadonlyArray<DisplayConstraint>;
  selectedConstraintId?: string;
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  /**
   * Inline edit hook (Phase 1.B). When provided, double-clicking a
   * distance / angle label swaps the label for an `<input type=number>`
   * with the current value (distance in sketch mm; angle in degrees —
   * to match what the user reads on the label). Enter commits the new
   * value via `onValueChange`; Esc cancels without firing.
   *
   * Geometric constraints (horizontal/vertical/parallel/perpendicular/
   * coincident/tangent/equal_length/equal_radius/fix) have no editable
   * value and ignore the double-click. When `onValueChange` is not
   * provided, double-click is also a no-op (back-compat with the
   * original Phase 1.B overlay).
   *
   * For angle constraints, the input value is interpreted as **degrees**
   * (matching the on-screen label). The caller is responsible for the
   * deg → rad conversion if their solver speaks radians.
   */
  onValueChange?: (id: string, value: number) => void;
  /**
   * Perpendicular offset (sketch units) of the distance dim-line from
   * the measured segment. Default 20 — readable at ~2 px/mm.
   */
  dimensionOffset?: number;
  /**
   * Pixel radius of the angle arc. Stays constant so the arc stays
   * legible regardless of segment length. Default 24.
   */
  angleArcRadius?: number;
}

// ─── colours ──────────────────────────────────────────────────────────────

const COLOR_BASE = '#6b7280';
const COLOR_SELECTED = '#2563eb';
const COLOR_LABEL = '#111827';
const COLOR_LABEL_SELECTED = '#1d4ed8';
const COLOR_BADGE_BG = '#ffffff';
const COLOR_DELETE = '#dc2626';

const STROKE_BASE = 1;
const STROKE_SELECTED = 1.6;
const FONT_SIZE = 11;
const BADGE_RADIUS = 9;
const ARROW_LEN = 6;
const ARROW_HALF = 3;
const EXT_WITNESS_OVERSHOOT = 3;

// ─── geometry helpers ─────────────────────────────────────────────────────

interface Vec {
  x: number;
  y: number;
}

function sub(a: Pt, b: Pt): Vec { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Vec): Pt { return { x: a.x + b.x, y: a.y + b.y }; }
function scale(v: Vec, s: number): Vec { return { x: v.x * s, y: v.y * s }; }
function midpoint(a: Pt, b: Pt): Pt { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function length(v: Vec): number { return Math.hypot(v.x, v.y); }
function normalize(v: Vec): Vec {
  const l = length(v);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}
/** Rotate CCW by 90°: (x,y) → (-y, x). */
function perpCCW(v: Vec): Vec { return { x: -v.y, y: v.x }; }

/**
 * Intersection of two infinite lines defined by (a1→a2) and (b1→b2).
 * Mirrors `lineLineIntersection` from SolverSketchEditor.tsx but
 * returns only the point (we don't need the parameter `t` here).
 * Returns null when the lines are parallel.
 */
function lineLineIntersection(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const dxA = a2.x - a1.x;
  const dyA = a2.y - a1.y;
  const dxB = b2.x - b1.x;
  const dyB = b2.y - b1.y;
  const denom = dxA * dyB - dyA * dxB;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * dyB - (b1.y - a1.y) * dxB) / denom;
  return { x: a1.x + dxA * t, y: a1.y + dyA * t };
}

// ─── label formatters ─────────────────────────────────────────────────────

function formatDistance(mm: number): string {
  // 1 decimal looks tidy; trim trailing ".0".
  const s = mm.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function formatAngleDeg(rad: number): string {
  const deg = (rad * 180) / Math.PI;
  const s = deg.toFixed(1);
  // 90.0° → 90°. 45.5° stays as-is.
  return (s.endsWith('.0') ? s.slice(0, -2) : s) + '°';
}

// ─── badge label per geometric kind ───────────────────────────────────────

function badgeChar(
  kind: GeometricDisplayConstraint['kind'],
): string {
  switch (kind) {
    case 'horizontal':    return 'H';
    case 'vertical':      return 'V';
    case 'parallel':      return '∥'; // ∥
    case 'perpendicular': return '⟂'; // ⟂
    case 'coincident':    return '●'; // ●
    case 'tangent':       return 'T';
    case 'equal_length':  return '=';
    case 'equal_radius':  return '=R';
    case 'fix':           return 'F';
  }
}

// ─── arrowhead polygon string ─────────────────────────────────────────────

/**
 * Triangular arrowhead whose tip is at `tip` and base is centered at
 * `tip - dir·ARROW_LEN`. `dir` MUST be a unit vector pointing from
 * the base toward the tip — i.e. the direction the arrow is "pointing".
 */
function arrowheadPoints(tip: Pt, dir: Vec): string {
  // Perpendicular for the base corners.
  const perp = perpCCW(dir);
  const baseCenter = { x: tip.x - dir.x * ARROW_LEN, y: tip.y - dir.y * ARROW_LEN };
  const left = { x: baseCenter.x + perp.x * ARROW_HALF, y: baseCenter.y + perp.y * ARROW_HALF };
  const right = { x: baseCenter.x - perp.x * ARROW_HALF, y: baseCenter.y - perp.y * ARROW_HALF };
  return `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${left.x.toFixed(2)},${left.y.toFixed(2)} ${right.x.toFixed(2)},${right.y.toFixed(2)}`;
}

// ─── per-kind sub-renderers ───────────────────────────────────────────────

interface RenderCtx {
  selected: boolean;
  stroke: string;
  strokeWidth: number;
  labelFill: string;
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Whether inline value editing is wired (i.e. onValueChange provided). */
  editable: boolean;
  /** True if this constraint is currently being edited (label hidden, input shown). */
  editing: boolean;
  onBeginEdit?: (id: string) => void;
  /**
   * Commit a parsed new value. Callers (DistancePart/AnglePart) handle
   * the unit conversion (angle = degrees on the wire) so this just
   * receives a finite number ready for the solver.
   */
  onCommitValue?: (id: string, value: number) => void;
  onCancelEdit?: () => void;
}

// ─── inline editor ───────────────────────────────────────────────────────

interface InlineEditProps {
  id: string;
  /** Initial value to seed the input (already in the unit shown on screen). */
  initial: number;
  /** Screen-space anchor for the foreignObject wrapper. */
  x: number;
  y: number;
  /** "mm" for distance, "°" for angle — purely cosmetic, prepended as placeholder. */
  unit: string;
  ctx: RenderCtx;
}

/**
 * SVG-foreignObject-hosted <input type=number> for inline label edit.
 *
 * Lifecycle:
 *   - Mounts seeded with `initial`. Auto-focus + select so the user can
 *     type the new value immediately.
 *   - Enter        → parse → ctx.onCommitValue(id, parsed) → editor stops.
 *   - Esc          → ctx.onCancelEdit() (no commit).
 *   - Blur         → soft-cancel (no commit). This matches the typical
 *                    spreadsheet UX where clicking elsewhere abandons the
 *                    edit without applying a partial number.
 *
 * Validation: defers parsing rejection to the caller. We only ensure the
 * value is finite before calling onCommitValue. Distance < 0 / NaN are
 * caught in the solver setter (setConstraintValue throws), which the
 * editor's handler catches and silently no-ops.
 */
function InlineEdit({ id, initial, x, y, unit, ctx }: InlineEditProps): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const raw = inputRef.current?.value ?? '';
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        ctx.onCommitValue?.(id, parsed);
      } else {
        // Non-finite input → drop the edit without firing onValueChange.
        ctx.onCancelEdit?.();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      ctx.onCancelEdit?.();
    }
  };

  // 78 × 22 px input — wide enough for "123.45" + the placeholder unit
  // without clipping. Centered on (x, y).
  const W = 78;
  const H = 22;
  return (
    <foreignObject
      x={x - W / 2}
      y={y - H / 2}
      width={W}
      height={H}
      data-testid={`solver-constraint-overlay-${id}-edit`}
    >
      <input
        ref={inputRef}
        type="number"
        defaultValue={String(initial)}
        placeholder={unit}
        step="any"
        onKeyDown={handleKeyDown}
        onBlur={() => ctx.onCancelEdit?.()}
        onClick={(e) => e.stopPropagation()}
        data-testid={`solver-constraint-overlay-${id}-edit-input`}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          fontSize: 11,
          padding: '2px 4px',
          border: `1px solid ${COLOR_SELECTED}`,
          borderRadius: 3,
          background: COLOR_BADGE_BG,
          color: COLOR_LABEL,
          fontFamily: 'system-ui, sans-serif',
          outline: 'none',
        }}
      />
    </foreignObject>
  );
}

interface DistanceProps {
  c: DistanceDisplayConstraint;
  ctx: RenderCtx;
  offset: number;
}

function DistancePart({ c, ctx, offset }: DistanceProps): React.ReactElement {
  const seg = sub(c.p2, c.p1);
  const segLen = length(seg);
  const handleLabelDouble = (evt: React.MouseEvent<SVGTextElement>): void => {
    if (!ctx.editable) return;
    evt.stopPropagation();
    ctx.onBeginEdit?.(c.id);
  };
  // Degenerate segment (p1 === p2): just render the label at the point.
  if (segLen < 1e-6) {
    if (ctx.editing) {
      return (
        <InlineEdit
          id={c.id}
          initial={c.value}
          x={c.p1.x}
          y={c.p1.y - 6}
          unit="mm"
          ctx={ctx}
        />
      );
    }
    return (
      <text
        x={c.p1.x}
        y={c.p1.y - 6}
        fontSize={FONT_SIZE}
        textAnchor="middle"
        fill={ctx.labelFill}
        stroke="none"
        style={ctx.editable ? { cursor: 'text' } : undefined}
        onDoubleClick={handleLabelDouble}
        data-testid={`solver-constraint-overlay-${c.id}-label`}
      >
        {formatDistance(c.value)}
      </text>
    );
  }
  const dirUnit = normalize(seg);
  const perpUnit = perpCCW(dirUnit);
  const off = scale(perpUnit, offset);
  const A = add(c.p1, off); // dim-line start (near p1)
  const B = add(c.p2, off); // dim-line end (near p2)
  // Extension witnesses: from each measured point past the dim-line by a
  // small overshoot. Draw from p1 → A + overshoot perpendicular (i.e.
  // overshoot in the same perp direction).
  const witnessOver = scale(perpUnit, offset + EXT_WITNESS_OVERSHOOT);
  const wA1 = c.p1;
  const wA2 = add(c.p1, witnessOver);
  const wB1 = c.p2;
  const wB2 = add(c.p2, witnessOver);
  const mid = midpoint(A, B);
  // Label sits just outside the dim-line, on the same side as the offset.
  const labelPos = add(mid, scale(perpUnit, 6));

  return (
    <>
      {/* extension witnesses */}
      <line
        x1={wA1.x} y1={wA1.y} x2={wA2.x} y2={wA2.y}
        stroke={ctx.stroke}
        strokeWidth={ctx.strokeWidth * 0.7}
      />
      <line
        x1={wB1.x} y1={wB1.y} x2={wB2.x} y2={wB2.y}
        stroke={ctx.stroke}
        strokeWidth={ctx.strokeWidth * 0.7}
      />
      {/* dim-line (dashed) */}
      <line
        x1={A.x} y1={A.y} x2={B.x} y2={B.y}
        stroke={ctx.stroke}
        strokeWidth={ctx.strokeWidth}
        strokeDasharray="4 3"
      />
      {/* arrowhead at A pointing toward p1 side (i.e. AWAY from B → -dirUnit) */}
      <polygon
        points={arrowheadPoints(A, scale(dirUnit, -1))}
        fill={ctx.stroke}
        stroke="none"
        data-testid={`solver-constraint-overlay-${c.id}-arrow-a`}
      />
      {/* arrowhead at B pointing toward p2 side (i.e. AWAY from A → +dirUnit) */}
      <polygon
        points={arrowheadPoints(B, dirUnit)}
        fill={ctx.stroke}
        stroke="none"
        data-testid={`solver-constraint-overlay-${c.id}-arrow-b`}
      />
      {/* numeric label or inline input (double-click to edit) */}
      {ctx.editing ? (
        <InlineEdit
          id={c.id}
          initial={c.value}
          x={labelPos.x}
          y={labelPos.y}
          unit="mm"
          ctx={ctx}
        />
      ) : (
        <text
          x={labelPos.x}
          y={labelPos.y}
          fontSize={FONT_SIZE}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={ctx.labelFill}
          stroke="none"
          style={ctx.editable ? { cursor: 'text' } : undefined}
          onDoubleClick={handleLabelDouble}
          data-testid={`solver-constraint-overlay-${c.id}-label`}
        >
          {formatDistance(c.value)}
        </text>
      )}
    </>
  );
}

interface AngleProps {
  c: AngleDisplayConstraint;
  ctx: RenderCtx;
  arcRadius: number;
}

function AnglePart({ c, ctx, arcRadius }: AngleProps): React.ReactElement {
  const [a1, a2] = c.line1Pts;
  const [b1, b2] = c.line2Pts;
  const inter = lineLineIntersection(a1, a2, b1, b2);
  // Choose a "center" anchor: prefer intersection; fall back to mean of
  // all midpoints when parallel (so we still surface a constraint badge).
  const center: Pt = inter ?? midpoint(midpoint(a1, a2), midpoint(b1, b2));
  const handleLabelDouble = (evt: React.MouseEvent<SVGTextElement>): void => {
    if (!ctx.editable) return;
    evt.stopPropagation();
    ctx.onBeginEdit?.(c.id);
  };
  // Angle label is shown in degrees, so the inline editor seeds with
  // degrees too. Callers convert back to radians in their commit handler.
  const angleDeg = (c.value * 180) / Math.PI;

  // Direction unit vectors away from the center along each line. We pick
  // whichever endpoint of each line is farther from the center so the arc
  // sits within the visible part of the sketch.
  const d1Raw = farther(center, a1, a2);
  const d2Raw = farther(center, b1, b2);
  const d1 = normalize(sub(d1Raw, center));
  const d2 = normalize(sub(d2Raw, center));
  // If either direction is degenerate, draw label only.
  if (length(d1) < 1e-9 || length(d2) < 1e-9) {
    if (ctx.editing) {
      return (
        <InlineEdit
          id={c.id}
          initial={angleDeg}
          x={center.x}
          y={center.y - 6}
          unit="°"
          ctx={ctx}
        />
      );
    }
    return (
      <text
        x={center.x}
        y={center.y - 6}
        fontSize={FONT_SIZE}
        textAnchor="middle"
        fill={ctx.labelFill}
        stroke="none"
        style={ctx.editable ? { cursor: 'text' } : undefined}
        onDoubleClick={handleLabelDouble}
        data-testid={`solver-constraint-overlay-${c.id}-label`}
      >
        {formatAngleDeg(c.value)}
      </text>
    );
  }
  const arcStart = { x: center.x + d1.x * arcRadius, y: center.y + d1.y * arcRadius };
  const arcEnd = { x: center.x + d2.x * arcRadius, y: center.y + d2.y * arcRadius };
  // Always emit the SHORTER (interior) arc — sweep flag = 0 vs 1 depends
  // on the signed angle from d1 to d2.
  const cross = d1.x * d2.y - d1.y * d2.x;
  const sweep = cross >= 0 ? 1 : 0;
  // large-arc = 0 (always the short arc; angles between two non-coincident
  // sketch lines are typically < 180° at the visible intersection)
  const arcPath = `M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A ${arcRadius} ${arcRadius} 0 0 ${sweep} ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}`;
  // Label sits at the angular midpoint on a slightly larger radius.
  const labelDir = normalize({ x: d1.x + d2.x, y: d1.y + d2.y });
  // labelDir can be (0,0) if d1 = -d2 (anti-parallel); in that case fall back
  // to the perpendicular of d1 so the label doesn't pile onto the vertex.
  const labelDirSafe = length(labelDir) < 1e-9 ? perpCCW(d1) : labelDir;
  const labelR = arcRadius + 10;
  const labelPos = {
    x: center.x + labelDirSafe.x * labelR,
    y: center.y + labelDirSafe.y * labelR,
  };

  return (
    <>
      <path
        d={arcPath}
        fill="none"
        stroke={ctx.stroke}
        strokeWidth={ctx.strokeWidth}
        strokeDasharray="4 3"
        data-testid={`solver-constraint-overlay-${c.id}-arc`}
      />
      {ctx.editing ? (
        <InlineEdit
          id={c.id}
          initial={angleDeg}
          x={labelPos.x}
          y={labelPos.y}
          unit="°"
          ctx={ctx}
        />
      ) : (
        <text
          x={labelPos.x}
          y={labelPos.y}
          fontSize={FONT_SIZE}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={ctx.labelFill}
          stroke="none"
          style={ctx.editable ? { cursor: 'text' } : undefined}
          onDoubleClick={handleLabelDouble}
          data-testid={`solver-constraint-overlay-${c.id}-label`}
        >
          {formatAngleDeg(c.value)}
        </text>
      )}
    </>
  );
}

/** Return whichever of `a`/`b` is farther from `from`. */
function farther(from: Pt, a: Pt, b: Pt): Pt {
  return length(sub(a, from)) >= length(sub(b, from)) ? a : b;
}

interface BadgeProps {
  c: GeometricDisplayConstraint;
  ctx: RenderCtx;
}

function BadgePart({ c, ctx }: BadgeProps): React.ReactElement {
  // Anchor selection: line-type kinds (horizontal/vertical/equal_length)
  // anchor on the segment midpoint when 2+ points present; everything
  // else anchors on the first point.
  const anchor: Pt = (() => {
    if (c.entities.length === 0) return { x: 0, y: 0 };
    if (
      (c.kind === 'horizontal' ||
        c.kind === 'vertical' ||
        c.kind === 'parallel' ||
        c.kind === 'perpendicular' ||
        c.kind === 'equal_length') &&
      c.entities.length >= 2
    ) {
      return midpoint(c.entities[0]!, c.entities[1]!);
    }
    return c.entities[0]!;
  })();

  const char = badgeChar(c.kind);
  // Multi-char badges (e.g. "=R") need a slightly wider pill.
  const w = Math.max(BADGE_RADIUS * 2, char.length * 7 + 6);
  const h = BADGE_RADIUS * 2;

  return (
    <>
      <rect
        x={anchor.x - w / 2}
        y={anchor.y - h / 2}
        width={w}
        height={h}
        rx={3}
        ry={3}
        fill={COLOR_BADGE_BG}
        stroke={ctx.stroke}
        strokeWidth={ctx.strokeWidth}
      />
      <text
        x={anchor.x}
        y={anchor.y}
        fontSize={FONT_SIZE}
        textAnchor="middle"
        dominantBaseline="central"
        fill={ctx.labelFill}
        stroke="none"
        fontWeight={600}
        data-testid={`solver-constraint-overlay-${c.id}-badge`}
      >
        {char}
      </text>
    </>
  );
}

// ─── single-constraint wrapper ────────────────────────────────────────────

interface RowProps {
  constraint: DisplayConstraint;
  selected: boolean;
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Inline-edit fields — see SketchConstraintOverlayProps.onValueChange. */
  editable: boolean;
  editing: boolean;
  onBeginEdit?: (id: string) => void;
  onCommitValue?: (id: string, value: number) => void;
  onCancelEdit?: () => void;
  dimensionOffset: number;
  angleArcRadius: number;
}

/**
 * Anchor point used for placing the delete affordance — depends on kind:
 *   distance → midpoint of (p1,p2) + perp offset
 *   angle    → intersection (or fallback)
 *   badge    → entity anchor (same logic as BadgePart)
 */
function deleteAnchor(c: DisplayConstraint, dimensionOffset: number): Pt {
  if (c.kind === 'distance') {
    const seg = sub(c.p2, c.p1);
    const segLen = length(seg);
    if (segLen < 1e-6) return c.p1;
    const perpUnit = perpCCW(normalize(seg));
    const mid = midpoint(c.p1, c.p2);
    return add(mid, scale(perpUnit, dimensionOffset + 14));
  }
  if (c.kind === 'angle') {
    const [a1, a2] = c.line1Pts;
    const [b1, b2] = c.line2Pts;
    const inter = lineLineIntersection(a1, a2, b1, b2);
    if (inter) return { x: inter.x + 16, y: inter.y - 16 };
    return midpoint(midpoint(a1, a2), midpoint(b1, b2));
  }
  // badge kinds
  if (c.entities.length === 0) return { x: 0, y: 0 };
  if (
    (c.kind === 'horizontal' ||
      c.kind === 'vertical' ||
      c.kind === 'parallel' ||
      c.kind === 'perpendicular' ||
      c.kind === 'equal_length') &&
    c.entities.length >= 2
  ) {
    const m = midpoint(c.entities[0]!, c.entities[1]!);
    return { x: m.x + 16, y: m.y - 14 };
  }
  return { x: c.entities[0]!.x + 14, y: c.entities[0]!.y - 14 };
}

function ConstraintRow({
  constraint,
  selected,
  onSelect,
  onDelete,
  editable,
  editing,
  onBeginEdit,
  onCommitValue,
  onCancelEdit,
  dimensionOffset,
  angleArcRadius,
}: RowProps): React.ReactElement {
  const stroke = selected ? COLOR_SELECTED : COLOR_BASE;
  const strokeWidth = selected ? STROKE_SELECTED : STROKE_BASE;
  const labelFill = selected ? COLOR_LABEL_SELECTED : COLOR_LABEL;
  const ctx: RenderCtx = {
    selected,
    stroke,
    strokeWidth,
    labelFill,
    onSelect,
    onDelete,
    editable,
    editing,
    onBeginEdit,
    onCommitValue,
    onCancelEdit,
  };

  const handleClick = (evt: React.MouseEvent<SVGGElement>): void => {
    evt.stopPropagation();
    onSelect?.(constraint.id);
  };

  const handleDelete = (evt: React.MouseEvent<SVGGElement>): void => {
    evt.stopPropagation();
    onDelete?.(constraint.id);
  };

  const inner = (() => {
    switch (constraint.kind) {
      case 'distance':
        return <DistancePart c={constraint} ctx={ctx} offset={dimensionOffset} />;
      case 'angle':
        return <AnglePart c={constraint} ctx={ctx} arcRadius={angleArcRadius} />;
      default:
        return <BadgePart c={constraint} ctx={ctx} />;
    }
  })();

  const del = selected && onDelete ? (() => {
    const a = deleteAnchor(constraint, dimensionOffset);
    return (
      <g
        data-testid={`solver-constraint-overlay-${constraint.id}-delete`}
        onClick={handleDelete}
        style={{ cursor: 'pointer' }}
      >
        <circle cx={a.x} cy={a.y} r={7} fill={COLOR_BADGE_BG} stroke={COLOR_DELETE} strokeWidth={1.2} />
        <text
          x={a.x}
          y={a.y}
          fontSize={11}
          textAnchor="middle"
          dominantBaseline="central"
          fill={COLOR_DELETE}
          stroke="none"
          fontWeight={700}
        >
          {'×'}
        </text>
      </g>
    );
  })() : null;

  return (
    <g
      data-testid={`solver-constraint-overlay-${constraint.id}`}
      data-constraint-kind={constraint.kind}
      data-selected={selected}
      onClick={handleClick}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      {inner}
      {del}
    </g>
  );
}

// ─── root overlay ─────────────────────────────────────────────────────────

export default function SketchConstraintOverlay({
  constraints,
  selectedConstraintId,
  onSelect,
  onDelete,
  onValueChange,
  dimensionOffset = 20,
  angleArcRadius = 24,
}: SketchConstraintOverlayProps): React.ReactElement {
  // Local-only edit state. We deliberately don't lift this — the parent
  // doesn't need to know which constraint is being edited, only the final
  // committed value via `onValueChange`. ESC / blur / Enter all converge
  // on the same "clear editing id" path.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const editable = typeof onValueChange === 'function';

  // If the constraint being edited gets removed from the constraints list
  // (e.g. delete fired from elsewhere), drop the editing state so we don't
  // strand an invisible input.
  React.useEffect(() => {
    if (editingId === null) return;
    const stillExists = constraints.some((c) => c.id === editingId);
    if (!stillExists) setEditingId(null);
  }, [constraints, editingId]);

  const handleBeginEdit = React.useCallback(
    (id: string): void => {
      if (!editable) return;
      setEditingId(id);
    },
    [editable],
  );
  const handleCommitValue = React.useCallback(
    (id: string, value: number): void => {
      setEditingId(null);
      // The InlineEdit guarantees finite; the host (and ultimately the
      // solver) is responsible for any further validation (e.g. distance > 0).
      onValueChange?.(id, value);
    },
    [onValueChange],
  );
  const handleCancelEdit = React.useCallback((): void => {
    setEditingId(null);
  }, []);

  return (
    <g data-testid="solver-constraint-overlay" data-count={constraints.length}>
      {constraints.map((c) => (
        <ConstraintRow
          key={c.id}
          constraint={c}
          selected={c.id === selectedConstraintId}
          onSelect={onSelect}
          onDelete={onDelete}
          editable={editable}
          editing={editable && editingId === c.id}
          onBeginEdit={handleBeginEdit}
          onCommitValue={handleCommitValue}
          onCancelEdit={handleCancelEdit}
          dimensionOffset={dimensionOffset}
          angleArcRadius={angleArcRadius}
        />
      ))}
    </g>
  );
}
