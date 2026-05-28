/**
 * Hole-array multi-position data model + pure expansion logic.
 *
 * Phase 2 Week 2 Track C2 deliverable. This is the *client-side* expansion
 * layer that turns a wizard's high-level kind + parameters (e.g. "linear of
 * 5 holes, spaced 10mm in X") into a flat `HolePosition[]` list of world-
 * space points. The worker-side fuse + cut endpoint (`/occt/op/hole/drilled`)
 * is blocked until occt-worker `src/` lands (Wave 1 task #31) — this file
 * stays pure so it can be unit-tested in isolation now and wired to the
 * worker later.
 *
 * Five array kinds per `wave-2-phase-2-hole-wizard-spec.md` §4 + §7.4:
 *   - `linear`     : N positions along a single direction (dx, dy step)
 *   - `circular`   : N positions evenly spaced on a circle
 *   - `rect`       : rows × cols grid with independent step in X / Y
 *   - `fromSketch` : positions sourced from a SketchFeature point list
 *   - `manual`     : explicit per-position table (no math)
 *
 * Sketch resolution requires reading the live sketch — we accept a
 * `BoundingBoxCtx` with an optional point provider. When the context omits
 * the provider (the common test path), `fromSketch` expands to an empty
 * position list and `validateHoleArray` flags it as `MISSING_SKETCH_POINTS`.
 *
 * No three.js or DOM dependency — pure data + math only.
 */

import type { HoleStandardSeries } from './holeStandards';

// ─── Reference shapes ──────────────────────────────────────────────────────

/**
 * Reference into the standard-hole catalog. Mirrors the wizard's two-step
 * pick: pick a series, then pick a designation within that series. `fitClass`
 * applies only to clearance kinds; tap / pipe rows ignore it.
 */
export interface HoleStandardRef {
  series: HoleStandardSeries;
  designation: string;
  fitClass?: 'close' | 'normal' | 'loose';
}

/**
 * Termination of the drilled bore. Mirrors `HoleFeature.terminationMode`
 * from spec §4.1. Phase 2 W2 only the data shape — actual face-resolution
 * (upToNext / upToFace) is owned by the worker once that endpoint lands.
 */
export type TerminationKind = 'blind' | 'through' | 'upToNext' | 'upToFace';

/**
 * Discriminated termination parameter bag. We keep the variants narrow so
 * `validateHoleArray` can reject "blind without depth" / "upToFace without
 * face" at the data layer instead of pushing the check into the worker.
 */
export type TerminationParams =
  | { kind: 'blind'; depth: number }
  | { kind: 'through' }
  | { kind: 'upToNext' }
  | { kind: 'upToFace'; faceId: string };

// ─── Array-kind parameter bags ─────────────────────────────────────────────

/** Linear pattern: count holes spaced dx/dy apart, starting at (startX, startY). */
export interface LinearArrayParams {
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  count: number;
}

/**
 * Circular pattern: count holes on a circle of `radius` around (centerX,
 * centerY). `startAngle` is the angle (radians) of position 0; subsequent
 * positions step by `2π / count` counterclockwise (right-handed XY).
 */
export interface CircularArrayParams {
  centerX: number;
  centerY: number;
  radius: number;
  count: number;
  startAngle: number;
}

/**
 * Rectangular grid: rows × cols. Starts at (startX, startY) and steps
 * `stepX` per column and `stepY` per row. Total count = rows × cols.
 */
export interface RectArrayParams {
  startX: number;
  startY: number;
  stepX: number;
  stepY: number;
  rows: number;
  cols: number;
}

/** From-sketch: identifies the sketch + optional point-id filter. */
export interface FromSketchArrayParams {
  sketchFeatureId: string;
  /** When `undefined` or empty, use all sketch points. */
  pointFilter?: string[];
}

/** Manual: explicit positions as authored by the user (e.g. CSV paste). */
export interface ManualArrayParams {
  points: Array<{ id?: string; x: number; y: number }>;
}

/** Discriminator type for the five supported kinds. */
export type HoleArrayKind =
  | 'linear'
  | 'circular'
  | 'rect'
  | 'fromSketch'
  | 'manual';

/**
 * Top-level array definition stored on the (future) `HoleFeature` node.
 * One feature → one array → N positions. Mixed-kind features are explicitly
 * out of scope (see spec §12 Q3 — "one kind per feature").
 */
export interface HoleArrayDefinition {
  id: string;
  kind: HoleArrayKind;
  /** Parameters discriminate by `kind`. Caller-side narrowing required. */
  params:
    | { kind: 'linear'; data: LinearArrayParams }
    | { kind: 'circular'; data: CircularArrayParams }
    | { kind: 'rect'; data: RectArrayParams }
    | { kind: 'fromSketch'; data: FromSketchArrayParams }
    | { kind: 'manual'; data: ManualArrayParams };
  /** Library reference. Drives the diameter resolution downstream. */
  holeSpec: HoleStandardRef;
  /** Termination kind. */
  terminationKind: TerminationKind;
  /** Termination parameters (must agree with terminationKind). */
  terminationParams: TerminationParams;
}

// ─── Expansion output ──────────────────────────────────────────────────────

/**
 * One resolved hole position in world XY. `id` is stable across edits:
 * for `fromSketch` it is the sketch-point id; for manual it is the user-
 * authored id or a generated one; for math kinds it is a deterministic
 * suffix on the array id (so re-expansion produces the same ids).
 */
export interface HolePosition {
  id: string;
  x: number;
  y: number;
  /** Source — useful for the wizard's row-edit table. */
  source: HoleArrayKind;
}

/**
 * Context object passed into `expandHoleArray`. Holds optional providers
 * for sketch-point lookup and bounding-box clamping. Pass an empty object
 * for pure unit tests of math kinds.
 */
export interface BoundingBoxCtx {
  /**
   * When defined and the array kind is `fromSketch`, called with the
   * referenced sketch feature id. Returns the live point list. Returning
   * `undefined` (sketch not found) makes the array expand to `[]`, which
   * `validateHoleArray` flags as a soft error.
   */
  resolveSketchPoints?: (sketchFeatureId: string) =>
    | Array<{ id: string; x: number; y: number }>
    | undefined;
  /** Optional clamp box. Positions outside the box are dropped (with a tag). */
  clampBox?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * Validation-error tag set. Stable strings so they can be mapped to the
 * UI's per-tab validation chip (spec §6.2) and to i18n error messages.
 */
export type HoleArrayErrorCode =
  | 'ZERO_COUNT'
  | 'NEGATIVE_COUNT'
  | 'NON_INTEGER_COUNT'
  | 'EXCESSIVE_COUNT'
  | 'NAN_PARAM'
  | 'NEGATIVE_SPACING'
  | 'ZERO_RADIUS'
  | 'NEGATIVE_RADIUS'
  | 'MISSING_SKETCH_POINTS'
  | 'EMPTY_MANUAL_POINTS'
  | 'TERMINATION_MISMATCH'
  | 'NEGATIVE_DEPTH'
  | 'BLIND_DEPTH_MISSING'
  | 'UPTOFACE_FACE_MISSING';

export interface ValidationError {
  code: HoleArrayErrorCode;
  message: string;
  /** Optional field name (e.g. `params.count`) for inline UI hint. */
  field?: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

/**
 * Soft cap on positions per feature. Anything above this almost certainly
 * means a math mistake (millimetre step on a metre-scale part, etc.). The
 * worker fuse step will accept up to ~100 cylinders per call; beyond that
 * we fall back to per-position cut anyway (see spec §11 R1 mitigation).
 * Burn-in target N ∈ {1, 4, 8, 16, 32} keeps us well inside.
 */
export const HOLE_ARRAY_MAX_COUNT = 1024;

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function assertFinite(
  errors: ValidationError[],
  value: unknown,
  field: string,
): void {
  if (!isFiniteNumber(value)) {
    errors.push({
      code: 'NAN_PARAM',
      message: `${field} must be a finite number`,
      field,
    });
  }
}

function validateCount(
  errors: ValidationError[],
  count: number,
  field: string,
): void {
  if (!isFiniteNumber(count)) {
    errors.push({ code: 'NAN_PARAM', message: `${field} is not a number`, field });
    return;
  }
  if (count === 0) {
    errors.push({ code: 'ZERO_COUNT', message: `${field} must be > 0`, field });
  } else if (count < 0) {
    errors.push({
      code: 'NEGATIVE_COUNT',
      message: `${field} must be positive (got ${count})`,
      field,
    });
  } else if (!Number.isInteger(count)) {
    errors.push({
      code: 'NON_INTEGER_COUNT',
      message: `${field} must be an integer (got ${count})`,
      field,
    });
  } else if (count > HOLE_ARRAY_MAX_COUNT) {
    errors.push({
      code: 'EXCESSIVE_COUNT',
      message: `${field}=${count} exceeds soft cap ${HOLE_ARRAY_MAX_COUNT}`,
      field,
    });
  }
}

function validateTermination(
  errors: ValidationError[],
  kind: TerminationKind,
  params: TerminationParams,
): void {
  if (kind !== params.kind) {
    errors.push({
      code: 'TERMINATION_MISMATCH',
      message: `terminationKind=${kind} but terminationParams.kind=${params.kind}`,
      field: 'terminationParams.kind',
    });
    return;
  }
  if (params.kind === 'blind') {
    if (!isFiniteNumber(params.depth)) {
      errors.push({
        code: 'BLIND_DEPTH_MISSING',
        message: 'blind termination requires a finite depth',
        field: 'terminationParams.depth',
      });
    } else if (params.depth <= 0) {
      errors.push({
        code: 'NEGATIVE_DEPTH',
        message: `blind depth must be > 0 (got ${params.depth})`,
        field: 'terminationParams.depth',
      });
    }
  } else if (params.kind === 'upToFace') {
    if (!params.faceId) {
      errors.push({
        code: 'UPTOFACE_FACE_MISSING',
        message: 'upToFace termination requires a non-empty faceId',
        field: 'terminationParams.faceId',
      });
    }
  }
}

/**
 * Validate an array definition. Returns `{ ok: true }` if all parameters
 * are sensible; otherwise returns the full list of errors so the wizard
 * can light up every offending field at once (better UX than report-one-
 * fix-one-cycle).
 *
 * Pure function — no side effects, no async, deterministic.
 */
export function validateHoleArray(
  def: HoleArrayDefinition,
): ValidationResult {
  const errors: ValidationError[] = [];

  // Kind agreement: the discriminator on `params` must match `kind` itself.
  if (def.kind !== def.params.kind) {
    errors.push({
      code: 'TERMINATION_MISMATCH',
      message: `kind=${def.kind} but params.kind=${def.params.kind}`,
      field: 'params.kind',
    });
  }

  switch (def.params.kind) {
    case 'linear': {
      const p = def.params.data;
      assertFinite(errors, p.startX, 'params.startX');
      assertFinite(errors, p.startY, 'params.startY');
      assertFinite(errors, p.dx, 'params.dx');
      assertFinite(errors, p.dy, 'params.dy');
      validateCount(errors, p.count, 'params.count');
      // For linear with count > 1, both dx and dy of zero collapses every
      // hole to the same point — almost certainly a mistake. Flag but
      // don't outright reject (count===1 + zero step is a valid single-hole).
      if (p.count > 1 && p.dx === 0 && p.dy === 0) {
        errors.push({
          code: 'NEGATIVE_SPACING',
          message: 'linear array with count > 1 has zero step in both axes',
          field: 'params.dx',
        });
      }
      break;
    }
    case 'circular': {
      const p = def.params.data;
      assertFinite(errors, p.centerX, 'params.centerX');
      assertFinite(errors, p.centerY, 'params.centerY');
      assertFinite(errors, p.startAngle, 'params.startAngle');
      validateCount(errors, p.count, 'params.count');
      if (!isFiniteNumber(p.radius)) {
        errors.push({ code: 'NAN_PARAM', message: 'params.radius is not a number', field: 'params.radius' });
      } else if (p.radius === 0) {
        errors.push({
          code: 'ZERO_RADIUS',
          message: 'circular array radius must be > 0',
          field: 'params.radius',
        });
      } else if (p.radius < 0) {
        errors.push({
          code: 'NEGATIVE_RADIUS',
          message: `circular array radius must be positive (got ${p.radius})`,
          field: 'params.radius',
        });
      }
      break;
    }
    case 'rect': {
      const p = def.params.data;
      assertFinite(errors, p.startX, 'params.startX');
      assertFinite(errors, p.startY, 'params.startY');
      assertFinite(errors, p.stepX, 'params.stepX');
      assertFinite(errors, p.stepY, 'params.stepY');
      validateCount(errors, p.rows, 'params.rows');
      validateCount(errors, p.cols, 'params.cols');
      // Soft cap on rows*cols as well — caught by validateCount on each axis.
      if (
        Number.isInteger(p.rows) &&
        Number.isInteger(p.cols) &&
        p.rows > 0 &&
        p.cols > 0 &&
        p.rows * p.cols > HOLE_ARRAY_MAX_COUNT
      ) {
        errors.push({
          code: 'EXCESSIVE_COUNT',
          message: `rows×cols = ${p.rows * p.cols} exceeds soft cap ${HOLE_ARRAY_MAX_COUNT}`,
          field: 'params.rows',
        });
      }
      // Spacing checks: same rule as linear — zero in both axes with multi-
      // count means stacked positions.
      if (p.rows * p.cols > 1 && p.stepX === 0 && p.stepY === 0) {
        errors.push({
          code: 'NEGATIVE_SPACING',
          message: 'rect array with multiple positions has zero step in both axes',
          field: 'params.stepX',
        });
      }
      break;
    }
    case 'fromSketch': {
      const p = def.params.data;
      if (!p.sketchFeatureId) {
        errors.push({
          code: 'MISSING_SKETCH_POINTS',
          message: 'fromSketch requires a sketchFeatureId',
          field: 'params.sketchFeatureId',
        });
      }
      break;
    }
    case 'manual': {
      const p = def.params.data;
      if (!Array.isArray(p.points) || p.points.length === 0) {
        errors.push({
          code: 'EMPTY_MANUAL_POINTS',
          message: 'manual array requires at least one point',
          field: 'params.points',
        });
      } else {
        if (p.points.length > HOLE_ARRAY_MAX_COUNT) {
          errors.push({
            code: 'EXCESSIVE_COUNT',
            message: `manual points ${p.points.length} exceeds soft cap ${HOLE_ARRAY_MAX_COUNT}`,
            field: 'params.points',
          });
        }
        p.points.forEach((pt, i) => {
          if (!isFiniteNumber(pt.x)) {
            errors.push({ code: 'NAN_PARAM', message: `params.points[${i}].x is not a number`, field: `params.points[${i}].x` });
          }
          if (!isFiniteNumber(pt.y)) {
            errors.push({ code: 'NAN_PARAM', message: `params.points[${i}].y is not a number`, field: `params.points[${i}].y` });
          }
        });
      }
      break;
    }
  }

  validateTermination(errors, def.terminationKind, def.terminationParams);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ─── Expansion ─────────────────────────────────────────────────────────────

function clamp(
  positions: HolePosition[],
  box: NonNullable<BoundingBoxCtx['clampBox']>,
): HolePosition[] {
  return positions.filter(
    (p) =>
      p.x >= box.minX &&
      p.x <= box.maxX &&
      p.y >= box.minY &&
      p.y <= box.maxY,
  );
}

function expandLinear(
  arrayId: string,
  p: LinearArrayParams,
): HolePosition[] {
  const out: HolePosition[] = [];
  // Defensive: if any param is bad the array short-circuits to empty. The
  // validator catches this case separately; expansion stays pure.
  if (!Number.isInteger(p.count) || p.count <= 0) return out;
  for (let i = 0; i < p.count; i++) {
    out.push({
      id: `${arrayId}#lin-${i}`,
      x: p.startX + i * p.dx,
      y: p.startY + i * p.dy,
      source: 'linear',
    });
  }
  return out;
}

function expandCircular(
  arrayId: string,
  p: CircularArrayParams,
): HolePosition[] {
  const out: HolePosition[] = [];
  if (!Number.isInteger(p.count) || p.count <= 0) return out;
  // Step is full revolution / count — gives evenly spaced positions.
  const step = (2 * Math.PI) / p.count;
  for (let i = 0; i < p.count; i++) {
    const theta = p.startAngle + i * step;
    out.push({
      id: `${arrayId}#circ-${i}`,
      x: p.centerX + p.radius * Math.cos(theta),
      y: p.centerY + p.radius * Math.sin(theta),
      source: 'circular',
    });
  }
  return out;
}

function expandRect(
  arrayId: string,
  p: RectArrayParams,
): HolePosition[] {
  const out: HolePosition[] = [];
  if (
    !Number.isInteger(p.rows) ||
    !Number.isInteger(p.cols) ||
    p.rows <= 0 ||
    p.cols <= 0
  ) {
    return out;
  }
  // Row-major: outer = row (Y), inner = col (X). Id suffix `r{row}c{col}`.
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      out.push({
        id: `${arrayId}#rect-r${r}c${c}`,
        x: p.startX + c * p.stepX,
        y: p.startY + r * p.stepY,
        source: 'rect',
      });
    }
  }
  return out;
}

function expandFromSketch(
  arrayId: string,
  p: FromSketchArrayParams,
  ctx?: BoundingBoxCtx,
): HolePosition[] {
  if (!ctx?.resolveSketchPoints) return [];
  const points = ctx.resolveSketchPoints(p.sketchFeatureId);
  if (!points) return [];
  const filter = p.pointFilter;
  const filtered = filter && filter.length > 0
    ? points.filter((pt) => filter.includes(pt.id))
    : points;
  return filtered.map((pt) => ({
    id: pt.id,
    x: pt.x,
    y: pt.y,
    source: 'fromSketch' as const,
  }));
}

function expandManual(
  arrayId: string,
  p: ManualArrayParams,
): HolePosition[] {
  if (!Array.isArray(p.points)) return [];
  return p.points.map((pt, i) => ({
    id: pt.id ?? `${arrayId}#man-${i}`,
    x: pt.x,
    y: pt.y,
    source: 'manual' as const,
  }));
}

/**
 * Expand an array definition into a flat list of world-space positions.
 *
 * Pure function (modulo `ctx.resolveSketchPoints` for `fromSketch`). Never
 * throws — invalid definitions short-circuit to `[]` so the wizard can
 * still render the position table with a validation warning rather than
 * crashing. Use `validateHoleArray` to gate the apply button on quality.
 *
 * Stable id rule: math kinds use `${array.id}#<kind>-<index>` so re-expanding
 * the same definition produces identical ids (lets `positions[].depthOverride`
 * tombstones persist across rebuilds — see spec §7.3).
 */
export function expandHoleArray(
  def: HoleArrayDefinition,
  ctx?: BoundingBoxCtx,
): HolePosition[] {
  let positions: HolePosition[];
  switch (def.params.kind) {
    case 'linear':
      positions = expandLinear(def.id, def.params.data);
      break;
    case 'circular':
      positions = expandCircular(def.id, def.params.data);
      break;
    case 'rect':
      positions = expandRect(def.id, def.params.data);
      break;
    case 'fromSketch':
      positions = expandFromSketch(def.id, def.params.data, ctx);
      break;
    case 'manual':
      positions = expandManual(def.id, def.params.data);
      break;
    default: {
      // Exhaustive — TypeScript will flag if a new kind is added without
      // an arm above. The runtime fallback is empty positions.
      const _exhaustive: never = def.params;
      void _exhaustive;
      positions = [];
    }
  }
  if (ctx?.clampBox) {
    positions = clamp(positions, ctx.clampBox);
  }
  return positions;
}

// ─── Factories ─────────────────────────────────────────────────────────────

/**
 * Default linear-array factory — used by the wizard's "Linear pattern..."
 * helper to seed a fresh definition with reasonable values. Caller fills in
 * `holeSpec` and `terminationKind/Params` from the Size + Termination tabs.
 */
export function createLinearArrayDefaults(
  id: string,
  holeSpec: HoleStandardRef,
): HoleArrayDefinition {
  return {
    id,
    kind: 'linear',
    params: {
      kind: 'linear',
      data: { startX: 0, startY: 0, dx: 10, dy: 0, count: 4 },
    },
    holeSpec,
    terminationKind: 'through',
    terminationParams: { kind: 'through' },
  };
}

/** Default circular-array factory. Hexagonal bolt circle by default. */
export function createCircularArrayDefaults(
  id: string,
  holeSpec: HoleStandardRef,
): HoleArrayDefinition {
  return {
    id,
    kind: 'circular',
    params: {
      kind: 'circular',
      data: { centerX: 0, centerY: 0, radius: 20, count: 6, startAngle: 0 },
    },
    holeSpec,
    terminationKind: 'through',
    terminationParams: { kind: 'through' },
  };
}

/** Default rect-array factory. 2×2 grid spaced 20 mm in both axes. */
export function createRectArrayDefaults(
  id: string,
  holeSpec: HoleStandardRef,
): HoleArrayDefinition {
  return {
    id,
    kind: 'rect',
    params: {
      kind: 'rect',
      data: { startX: 0, startY: 0, stepX: 20, stepY: 20, rows: 2, cols: 2 },
    },
    holeSpec,
    terminationKind: 'through',
    terminationParams: { kind: 'through' },
  };
}

/** Single-position manual factory — entry point for "absolute, one hole". */
export function createManualArrayDefaults(
  id: string,
  holeSpec: HoleStandardRef,
): HoleArrayDefinition {
  return {
    id,
    kind: 'manual',
    params: {
      kind: 'manual',
      data: { points: [{ id: `${id}#man-0`, x: 0, y: 0 }] },
    },
    holeSpec,
    terminationKind: 'through',
    terminationParams: { kind: 'through' },
  };
}

/** From-sketch factory — used by the "Hole Wizard from sketch" palette cmd. */
export function createFromSketchArrayDefaults(
  id: string,
  sketchFeatureId: string,
  holeSpec: HoleStandardRef,
): HoleArrayDefinition {
  return {
    id,
    kind: 'fromSketch',
    params: {
      kind: 'fromSketch',
      data: { sketchFeatureId, pointFilter: undefined },
    },
    holeSpec,
    terminationKind: 'through',
    terminationParams: { kind: 'through' },
  };
}
