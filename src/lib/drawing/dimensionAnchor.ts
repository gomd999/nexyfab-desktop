/**
 * dimensionAnchor — Phase 4.2 follow-up of NexyFab Pro own-CAD (ADR-013).
 *
 * Linear / aligned dimension geometry. Given two points projected into a 2D
 * view plane (sheet space, in mm) this computes the full set of line work a
 * renderer needs to attach a dimension to real geometry:
 *
 *   - two extension (witness) lines, one per measured point, that step off
 *     the part by a small gap and run out past the dimension line by a small
 *     overrun;
 *   - the dimension line itself, offset perpendicular to the measured span;
 *   - a text anchor + rotation so the value reads along the dimension line.
 *
 * This is the projected-geometry counterpart to the datum-relative
 * {@link ./ordinateDimension} chain: ordinate dimensions reference a single
 * origin, whereas a linear/aligned dimension measures the span between two
 * concrete points. The renderer (Phase 4.4) consumes the returned
 * {@link LinearDimGeom} to lay out primitives and translates the value to its
 * STEP AP242 `linear_dimension` / `aligned_dimension` representation on
 * export.
 *
 * Pure logic only (no React/DOM/Three). Fully deterministic — no clock, no
 * randomness. Adds a NEW abstraction next to {@link ./ordinateDimension}
 * without touching it.
 *
 * Scope:
 *   - Three measurement modes: 'x' (horizontal span), 'y' (vertical span),
 *     and 'aligned' (true distance along the p1→p2 direction).
 *   - Extension-line gap + overrun, configurable.
 *   - Configurable precision + unit (mm / in) on the formatted string, with
 *     negative-zero normalization so identical magnitudes look identical.
 *   - Input validation (finite coords, distinct points).
 *
 * Out of scope:
 *   - Drawing primitive emission (Phase 4.4).
 *   - Tolerance / fit class on the value (Phase 4.2.2).
 *   - Arc/angular/radial dimensions (separate builders).
 */

// ─── types ───────────────────────────────────────────────────────────────

/** A 2D point in the view plane, in millimetres of sheet space. */
export interface Pt {
  x: number;
  y: number;
}

export type LinearDimAxis = 'x' | 'y' | 'aligned';

export interface LinearDimGeom {
  /** Witness line from near p1 out to (and past) the dimension line. */
  extension1: [Pt, Pt];
  /** Witness line from near p2 out to (and past) the dimension line. */
  extension2: [Pt, Pt];
  /** The dimension line, parallel to the measured span at `offset`. */
  dimensionLine: [Pt, Pt];
  /** Where the value text attaches (dimension-line midpoint). */
  textAnchor: Pt;
  /** Text rotation in radians: 0 for 'x', π/2 for 'y', line angle for
   *  'aligned'. */
  textAngle: number;
  /** The measured magnitude in input units (always non-negative). */
  value: number;
  /** Pre-formatted display string (precision + unit applied). */
  formatted: string;
}

export interface LinearDimensionOptions {
  /** Perpendicular distance of the dimension line from the measured points.
   *  The sign selects which side of the span the dimension line sits on. */
  offset: number;
  /** Measurement mode. Defaults to 'aligned'. */
  axis?: LinearDimAxis;
  /** Decimal places for the formatted string. Defaults to 2. */
  precision?: number;
  /** Unit suffix appended to the formatted string. Defaults to 'mm'. */
  unit?: 'mm' | 'in';
  /** Blank space between the measured point and the start of its extension
   *  line. Defaults to {@link DEFAULT_EXTENSION_GAP}. */
  extensionGap?: number;
  /** How far the extension line runs past the dimension line. Defaults to
   *  {@link DEFAULT_EXTENSION_OVERRUN}. */
  extensionOverrun?: number;
}

// ─── errors ──────────────────────────────────────────────────────────────

export class LinearDimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinearDimensionError';
  }
}

// ─── constants ───────────────────────────────────────────────────────────

/** ISO drafting leaves a small visible gap between the part outline and the
 *  start of the witness line. Drawing units (mm). */
export const DEFAULT_EXTENSION_GAP = 1;

/** ISO drafting runs the witness line slightly past the dimension line.
 *  Drawing units (mm). */
export const DEFAULT_EXTENSION_OVERRUN = 2;

/** Spans shorter than this (along the measured axis) are treated as
 *  coincident for aligned direction purposes. */
const DIRECTION_EPSILON = 1e-12;

// ─── validation ──────────────────────────────────────────────────────────

export interface LinearDimensionValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateLinearDimensionInput(
  p1: Pt,
  p2: Pt,
): LinearDimensionValidationResult {
  const errors: string[] = [];

  if (!isFinitePoint(p1)) errors.push('p1 must have finite x and y');
  if (!isFinitePoint(p2)) errors.push('p2 must have finite x and y');

  // Only meaningful once both points are finite; comparing NaN would be
  // misleading.
  if (isFinitePoint(p1) && isFinitePoint(p2)) {
    if (p1.x === p2.x && p1.y === p2.y) {
      errors.push('p1 and p2 must be distinct (coincident points)');
    }
  }

  return { ok: errors.length === 0, errors };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isFinitePoint(p: Pt | undefined | null): p is Pt {
  return !!p && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

// ─── builder ─────────────────────────────────────────────────────────────

/**
 * Build the 2D dimension geometry between two projected points.
 *
 * The three modes differ only in the direction of the measured span and the
 * direction along which `offset` pushes the dimension line:
 *
 *   - 'x'       — span is horizontal, value = |Δx|, dimension line offset in
 *                 ±Y, witness lines vertical, text reads horizontally.
 *   - 'y'       — span is vertical, value = |Δy|, dimension line offset in
 *                 ±X, witness lines horizontal, text reads vertically.
 *   - 'aligned' — span follows the p1→p2 direction, value = true distance,
 *                 dimension line parallel to the span and offset along its
 *                 perpendicular, text reads along the line.
 *
 * @throws {LinearDimensionError} when the input fails
 *   {@link validateLinearDimensionInput}, or when an 'aligned' dimension is
 *   asked for between points with no resolvable direction.
 */
export function buildLinearDimension(
  p1: Pt,
  p2: Pt,
  opts: LinearDimensionOptions,
): LinearDimGeom {
  const v = validateLinearDimensionInput(p1, p2);
  if (!v.ok) {
    throw new LinearDimensionError(
      `invalid linear dimension input: ${v.errors.join('; ')}`,
    );
  }
  if (!isFiniteNumber(opts.offset)) {
    throw new LinearDimensionError('offset must be a finite number');
  }
  const axis: LinearDimAxis = opts.axis ?? 'aligned';
  const precision = opts.precision ?? 2;
  if (!Number.isInteger(precision) || precision < 0 || precision > 12) {
    throw new LinearDimensionError('precision must be an integer in [0, 12]');
  }
  const unit = opts.unit ?? 'mm';
  if (unit !== 'mm' && unit !== 'in') {
    throw new LinearDimensionError("unit must be 'mm' or 'in'");
  }
  const gap = opts.extensionGap ?? DEFAULT_EXTENSION_GAP;
  const overrun = opts.extensionOverrun ?? DEFAULT_EXTENSION_OVERRUN;
  if (!isFiniteNumber(gap) || gap < 0) {
    throw new LinearDimensionError('extensionGap must be a finite, non-negative number');
  }
  if (!isFiniteNumber(overrun) || overrun < 0) {
    throw new LinearDimensionError('extensionOverrun must be a finite, non-negative number');
  }

  // Resolve the measurement direction `dir` (unit vector along the span) and
  // the perpendicular `perp` (unit vector the offset pushes the dim line
  // along). `value` is the projected length of the span onto `dir`.
  let dir: Pt;
  let perp: Pt;
  let value: number;
  let textAngle: number;

  if (axis === 'x') {
    dir = { x: 1, y: 0 };
    perp = { x: 0, y: 1 };
    value = Math.abs(p2.x - p1.x);
    textAngle = 0;
  } else if (axis === 'y') {
    dir = { x: 0, y: 1 };
    perp = { x: 1, y: 0 };
    value = Math.abs(p2.y - p1.y);
    textAngle = Math.PI / 2;
  } else {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < DIRECTION_EPSILON) {
      // Should be unreachable given the distinctness check, but guards
      // against denormal inputs that pass `!==` yet hypot to ~0.
      throw new LinearDimensionError(
        'aligned dimension has no resolvable direction (points too close)',
      );
    }
    dir = { x: dx / len, y: dy / len };
    // Left-hand normal of `dir`; +offset sits on this side.
    perp = { x: -dir.y, y: dir.x };
    value = len;
    textAngle = Math.atan2(dy, dx);
  }

  // Project each measured point onto the dimension line.
  const dimP1 = add(p1, scale(perp, opts.offset));
  const dimP2 = add(p2, scale(perp, opts.offset));

  // Witness lines run from `gap` away from the point, along `perp`, out to
  // the dimension line plus `overrun` on the far side.
  const sign = opts.offset >= 0 ? 1 : -1;
  const span = Math.abs(opts.offset);
  const ext1Start = add(p1, scale(perp, sign * gap));
  const ext1End = add(p1, scale(perp, sign * (span + overrun)));
  const ext2Start = add(p2, scale(perp, sign * gap));
  const ext2End = add(p2, scale(perp, sign * (span + overrun)));

  const textAnchor: Pt = {
    x: (dimP1.x + dimP2.x) / 2,
    y: (dimP1.y + dimP2.y) / 2,
  };

  return {
    extension1: [ext1Start, ext1End],
    extension2: [ext2Start, ext2End],
    dimensionLine: [dimP1, dimP2],
    textAnchor,
    textAngle,
    value,
    formatted: formatValue(value, precision, unit),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(p: Pt, k: number): Pt {
  return { x: p.x * k, y: p.y * k };
}

function formatValue(value: number, precision: number, unit: string): string {
  // toFixed can emit "-0.00" for a tiny negative magnitude; normalize so two
  // independent dimensions with identical magnitudes look identical.
  const normalized = Object.is(value, -0) ? 0 : value;
  const fixed = normalized.toFixed(precision);
  // Guard against "-0.00" surviving (e.g. value === -0 after toFixed on a
  // small negative input that rounds to zero).
  const cleaned = /^-0(?:\.0+)?$/.test(fixed) ? fixed.slice(1) : fixed;
  return `${cleaned} ${unit}`;
}
