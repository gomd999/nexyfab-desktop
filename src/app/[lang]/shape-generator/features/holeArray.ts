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
import {
  expandLinearPattern,
  expandLinear2DPattern,
  expandCircularPattern,
  expandRectPattern,
} from './patternHelpers';

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
 * Hole sub-type taxonomy (spec §2). Phase 2 W3 extends the data model to
 * carry the kind + sub-type-specific size fields. Worker endpoints for
 * counterbore/countersink remain blocked until Wave 1 task #31 (occt-worker
 * provision); this is the *client-side* type carrier so the wizard can
 * round-trip a complete HoleArrayDefinition through validation + preview.
 *
 * `drilled`        — plain cylindrical bore (default, W2)
 * `counterbore`    — wide flat pocket + drill (W3 UI, W4 worker)
 * `countersink`    — conical funnel + drill (W3 UI, W4 worker)
 * `counterdrill`   — three concentric cylinder steps (W4-W5)
 * `tap`            — cosmetic tap at tap-drill ⌀ + thread metadata (W4-W5)
 * `pipe_tap`       — NPT/BSP tapered tap (W4-W5)
 */
export type HoleKind =
  | 'drilled'
  | 'counterbore'
  | 'countersink'
  | 'counterdrill'
  | 'tap'
  | 'pipe_tap';

/** Positive world drill axis. Y is the legacy/top-face default. */
export type HoleAxis = 0 | 1 | 2;

/**
 * Hole geometry spec — discriminated by `kind`. The `drilled` variant carries
 * just the bore diameter; sub-types add their pocket/funnel/thread params.
 *
 * All diameters and depths are mm. The catalog (holeStandards.ts) supplies
 * the defaults via `holeSpecDefaults(kind, standardRow)`; the wizard's Size
 * tab populates these from the picked row + fit class, and the user can
 * override individual fields in custom mode.
 *
 * Spec §2 ambiguities resolved here:
 *   - `counterbore.headDiameter` ≡ spec `cboreDiameter` (the wide pocket ⌀)
 *   - `counterbore.headDepth`    ≡ spec `cboreDepth`    (pocket depth from top face)
 *   - `countersink.coneDiameter` ≡ spec `csDiameter`    (face ⌀ at top)
 *   - `countersink.coneAngle`    ≡ spec `csAngle`       (included angle, deg)
 *     Default: 90° for ISO (matches ISO 10642 / spec §2.3), 82° for UTS
 *     (matches ASME flat-head, spec §2.3). Caller chooses based on `series`.
 *   - `drillTipAngle`            ≡ spec §2.1 (118 default, 135 hard, 180 flat)
 */
export interface DrilledHoleSpec {
  kind: 'drilled';
  /** Bore diameter (mm). */
  diameter: number;
  /** Drill tip apex angle (deg). 118 = standard, 135 = hard, 180 = flat. */
  drillTipAngle: number;
}

export interface CounterboreHoleSpec {
  kind: 'counterbore';
  /** Drill bore diameter (mm). */
  diameter: number;
  /** Counterbore (head pocket) diameter (mm). */
  headDiameter: number;
  /** Counterbore (head pocket) depth from top face (mm). */
  headDepth: number;
  /** Drill tip apex angle (deg) — applied to the inner drill, not the pocket. */
  drillTipAngle: number;
}

export interface CountersinkHoleSpec {
  kind: 'countersink';
  /** Drill bore diameter (mm). */
  diameter: number;
  /** Countersink face diameter at top (mm). */
  coneDiameter: number;
  /** Countersink included cone angle (deg). 90 default ISO, 82 default UTS. */
  coneAngle: number;
  /** Drill tip apex angle (deg) — applied to the inner drill. */
  drillTipAngle: number;
}

export interface CounterdrillHoleSpec {
  kind: 'counterdrill';
  /** Innermost drill diameter (mm). */
  diameter: number;
  /** Top step (head pocket) diameter (mm). */
  headDiameter: number;
  /** Top step depth from top face (mm). */
  headDepth: number;
  /** Middle (shoulder) diameter (mm). */
  middleDiameter: number;
  /** Middle step depth from top face (mm). */
  middleDepth: number;
  drillTipAngle: number;
}

export interface TapHoleSpec {
  kind: 'tap';
  /** Tap drill diameter (mm) — the boolean-cut diameter. */
  diameter: number;
  /** Thread pitch (mm/thread). */
  pitch: number;
  /** Tap class — '6H'/'6G' for ISO, '2B'/'3B' for UTS. */
  tapClass: '6H' | '6G' | '2B' | '3B';
  /** Usable thread depth (mm). DFM gate enforces tapDepth ≤ drillDepth − 2*pitch. */
  tapDepth: number;
  drillTipAngle: number;
}

export interface PipeTapHoleSpec {
  kind: 'pipe_tap';
  /** Minor (tap) diameter at gauging plane (mm). */
  diameter: number;
  /** Pipe-thread standard (legacy/canonical). */
  pipeStandard: 'NPT' | 'BSPT' | 'BSPP';
  /** Pipe size key, e.g. '1/4-18'. */
  pipeSizeKey: string;
  /** Effective thread engagement depth (mm). */
  engagementDepth: number;
  /**
   * W5 — Optional pipe-tap class. Co-exists with `pipeStandard` for the
   * future cases that want to distinguish parallel (NPSM / BSPP) from
   * tapered (NPT / BSPT) explicitly. Wizards default this from the
   * pipeStandard so existing fixtures stay unchanged.
   */
  pipeTapClass?: 'NPT' | 'NPSM' | 'BSP_taper' | 'BSP_parallel';
  /**
   * W5 — Optional taper half-angle (degrees, half-angle of the cone the
   * SVG renders). Default values per standard:
   *   - NPT / NPSM     → 1.7833 deg (1°47′)
   *   - BSPT / BSPP    → 1.7833 deg (1°47′) for taper; 0 for parallel
   * Pure data — worker uses this for cosmetic taper rendering once the
   * /occt/op/hole/pipe-tap endpoint lands (Wave 1 task #31).
   */
  taperAngle?: number;
}

/** Discriminated union of all six hole-spec variants. */
export type HoleSpec =
  | DrilledHoleSpec
  | CounterboreHoleSpec
  | CountersinkHoleSpec
  | CounterdrillHoleSpec
  | TapHoleSpec
  | PipeTapHoleSpec;

/**
 * Termination of the drilled bore. Mirrors `HoleFeature.terminationMode`
 * from spec §4.1. Phase 2 W3 carries all four kinds in the data model; the
 * actual face-resolution (upToNext / upToFace) is owned by the worker once
 * that endpoint lands. UI for upToNext / upToFace renders a disabled
 * face-picker placeholder.
 */
export type TerminationKind = 'blind' | 'through' | 'upToNext' | 'upToFace';

/**
 * Blind-bottom shape. `flat` = the drill point is suppressed (180° tip);
 * `conical` = the drill tip cone is preserved with the given apex angle.
 * Spec §2.1: default 118°, 135° for hardened material, 60° for special tools.
 */
export type BlindBottomShape = 'flat' | 'conical';

/**
 * Discriminated termination parameter bag. We keep the variants narrow so
 * `validateHoleArray` can reject "blind without depth" / "upToFace without
 * face" at the data layer instead of pushing the check into the worker.
 *
 * W3: blind carries `bottomShape` and the apex angle (when conical) so the
 * Preview tab can sketch the cross-section without having to look at the
 * top-level HoleSpec.drillTipAngle. Defaults: bottomShape='conical', apex=118.
 */
export type TerminationParams =
  | {
      kind: 'blind';
      depth: number;
      /** Bottom shape — flat or conical. Default conical. */
      bottomShape?: BlindBottomShape;
      /** Drill tip apex angle (deg) when bottomShape='conical'. Default 118. */
      drillTipAngle?: number;
    }
  | { kind: 'through' }
  | {
      kind: 'upToNext';
      /**
       * Optional resolved stop-face id, populated once worker face-picker is
       * wired (W4). UI-only path leaves this undefined.
       */
      stopFaceId?: string;
    }
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
 *
 * W5 — optional `partialAngle` (degrees) lets the caller author a partial
 * arc (e.g. 270°) instead of a full circle. When set, the first and last
 * position land on the arc endpoints. `direction` flips the sign of the
 * angular step (default 'ccw' matches the legacy behaviour).
 */
export interface CircularArrayParams {
  centerX: number;
  centerY: number;
  radius: number;
  count: number;
  startAngle: number;
  /** Optional sweep magnitude (degrees). Omit/0/360 → full revolution. */
  partialAngle?: number;
  /** Step sign. Default 'ccw' (right-handed XY). */
  direction?: 'cw' | 'ccw';
}

/**
 * Linear-2D pattern (W5): rows × cols grid driven by two independent step
 * vectors. The (r, c) position is:
 *   x = startX + c * dxCol + r * dxRow
 *   y = startY + c * dyCol + r * dyRow
 *
 * Distinct from `rect`, which is the axis-aligned single-step-per-axis case.
 * Useful when the wizard wants a sheared / rotated grid without baking a
 * rotation into the surrounding feature graph.
 */
export interface Linear2DArrayParams {
  startX: number;
  startY: number;
  dxRow: number;
  dyRow: number;
  dxCol: number;
  dyCol: number;
  rows: number;
  cols: number;
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

/** Discriminator type for the supported kinds. */
export type HoleArrayKind =
  | 'linear'
  | 'linear2D'
  | 'circular'
  | 'rect'
  | 'fromSketch'
  | 'manual';

/**
 * Top-level array definition stored on the (future) `HoleFeature` node.
 * One feature → one array → N positions. Mixed-kind features are explicitly
 * out of scope (see spec §12 Q3 — "one kind per feature").
 *
 * W3: adds `holeSpecDetail` to carry the resolved geometry params (drill ⌀,
 * cbore ⌀, csk angle, etc.). The legacy `holeSpec: HoleStandardRef` stays as
 * the *catalog reference* for round-trip + library-update flows; the wizard
 * derives `holeSpecDetail` from it via `resolveHoleSpec()`.
 *
 * Older callers that omit `holeSpecDetail` default to a 'drilled' kind with
 * `diameter = 5` mm — back-compat for the W2 fixture and the C2 tests, none
 * of which touch the new field.
 */
export interface HoleArrayDefinition {
  id: string;
  kind: HoleArrayKind;
  /** Parameters discriminate by `kind`. Caller-side narrowing required. */
  params:
    | { kind: 'linear'; data: LinearArrayParams }
    | { kind: 'linear2D'; data: Linear2DArrayParams }
    | { kind: 'circular'; data: CircularArrayParams }
    | { kind: 'rect'; data: RectArrayParams }
    | { kind: 'fromSketch'; data: FromSketchArrayParams }
    | { kind: 'manual'; data: ManualArrayParams };
  /** Library reference. Drives the diameter resolution downstream. */
  holeSpec: HoleStandardRef;
  /**
   * Resolved geometry spec discriminated by hole sub-type (drilled / cbore /
   * csk / cdrill / tap / pipe_tap). Optional for back-compat; absent means
   * "default drilled bore from `holeSpec`".
   */
  holeSpecDetail?: HoleSpec;
  /** Termination kind. */
  terminationKind: TerminationKind;
  /** Termination parameters (must agree with terminationKind). */
  terminationParams: TerminationParams;
  /** Optional world drill axis; omitted legacy definitions mean Y. */
  axis?: HoleAxis;
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
  | 'UPTOFACE_FACE_MISSING'
  | 'INVALID_DIAMETER'
  | 'INVALID_CONE_ANGLE'
  | 'CBORE_SMALLER_THAN_BORE'
  | 'CSK_SMALLER_THAN_BORE'
  | 'CDRILL_STEP_ORDER'
  | 'TAP_PITCH_INVALID'
  | 'PIPE_KEY_MISSING';

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
    // Conical apex must lie in (60°, 180]; flat is encoded as bottomShape='flat'
    // *or* drillTipAngle === 180 (we accept either form).
    if (params.bottomShape === 'conical' && params.drillTipAngle !== undefined) {
      if (!isFiniteNumber(params.drillTipAngle) || params.drillTipAngle <= 60 || params.drillTipAngle > 180) {
        errors.push({
          code: 'INVALID_CONE_ANGLE',
          message: `drillTipAngle must be in (60, 180] (got ${params.drillTipAngle})`,
          field: 'terminationParams.drillTipAngle',
        });
      }
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
  // upToNext: no required params; stopFaceId is set by the worker, not user.
}

function validateHoleSpecDetail(
  errors: ValidationError[],
  spec: HoleSpec,
): void {
  // Diameter must be positive + finite for every kind.
  const diameter = spec.diameter;
  if (!isFiniteNumber(diameter) || diameter <= 0) {
    errors.push({
      code: 'INVALID_DIAMETER',
      message: `hole diameter must be > 0 (got ${diameter})`,
      field: 'holeSpecDetail.diameter',
    });
  }

  // Tip-angle sanity (60, 180] — only for kinds that actually carry it.
  if (spec.kind !== 'pipe_tap') {
    const ang = spec.drillTipAngle;
    if (!isFiniteNumber(ang) || ang <= 60 || ang > 180) {
      errors.push({
        code: 'INVALID_CONE_ANGLE',
        message: `drillTipAngle must be in (60, 180] (got ${ang})`,
        field: 'holeSpecDetail.drillTipAngle',
      });
    }
  }

  switch (spec.kind) {
    case 'counterbore': {
      if (!isFiniteNumber(spec.headDiameter) || spec.headDiameter <= 0) {
        errors.push({
          code: 'INVALID_DIAMETER',
          message: `headDiameter must be > 0 (got ${spec.headDiameter})`,
          field: 'holeSpecDetail.headDiameter',
        });
      } else if (isFiniteNumber(diameter) && spec.headDiameter <= diameter) {
        errors.push({
          code: 'CBORE_SMALLER_THAN_BORE',
          message: `headDiameter (${spec.headDiameter}) must exceed drill diameter (${diameter})`,
          field: 'holeSpecDetail.headDiameter',
        });
      }
      if (!isFiniteNumber(spec.headDepth) || spec.headDepth <= 0) {
        errors.push({
          code: 'NEGATIVE_DEPTH',
          message: `headDepth must be > 0 (got ${spec.headDepth})`,
          field: 'holeSpecDetail.headDepth',
        });
      }
      break;
    }
    case 'countersink': {
      if (!isFiniteNumber(spec.coneDiameter) || spec.coneDiameter <= 0) {
        errors.push({
          code: 'INVALID_DIAMETER',
          message: `coneDiameter must be > 0 (got ${spec.coneDiameter})`,
          field: 'holeSpecDetail.coneDiameter',
        });
      } else if (isFiniteNumber(diameter) && spec.coneDiameter <= diameter) {
        errors.push({
          code: 'CSK_SMALLER_THAN_BORE',
          message: `coneDiameter (${spec.coneDiameter}) must exceed drill diameter (${diameter})`,
          field: 'holeSpecDetail.coneDiameter',
        });
      }
      const ang = spec.coneAngle;
      // Spec §2.3 lists {60, 82, 90, 100, 110, 120} — accept any value in
      // (0, 180) so custom mode survives.
      if (!isFiniteNumber(ang) || ang <= 0 || ang >= 180) {
        errors.push({
          code: 'INVALID_CONE_ANGLE',
          message: `coneAngle must be in (0, 180) (got ${ang})`,
          field: 'holeSpecDetail.coneAngle',
        });
      }
      break;
    }
    case 'counterdrill': {
      // Step order: head > middle > drill.
      const hd = spec.headDiameter, md = spec.middleDiameter, dd = spec.diameter;
      if (!isFiniteNumber(hd) || !isFiniteNumber(md) || !isFiniteNumber(dd)) {
        errors.push({
          code: 'NAN_PARAM',
          message: 'counterdrill requires finite head/middle/drill diameters',
          field: 'holeSpecDetail',
        });
      } else if (!(hd > md && md > dd)) {
        errors.push({
          code: 'CDRILL_STEP_ORDER',
          message: `counterdrill requires head > middle > drill (got ${hd} > ${md} > ${dd})`,
          field: 'holeSpecDetail.middleDiameter',
        });
      }
      if (!isFiniteNumber(spec.headDepth) || spec.headDepth <= 0) {
        errors.push({
          code: 'NEGATIVE_DEPTH',
          message: `headDepth must be > 0 (got ${spec.headDepth})`,
          field: 'holeSpecDetail.headDepth',
        });
      }
      if (!isFiniteNumber(spec.middleDepth) || spec.middleDepth <= spec.headDepth) {
        errors.push({
          code: 'CDRILL_STEP_ORDER',
          message: `middleDepth (${spec.middleDepth}) must exceed headDepth (${spec.headDepth})`,
          field: 'holeSpecDetail.middleDepth',
        });
      }
      break;
    }
    case 'tap': {
      if (!isFiniteNumber(spec.pitch) || spec.pitch <= 0) {
        errors.push({
          code: 'TAP_PITCH_INVALID',
          message: `tap pitch must be > 0 (got ${spec.pitch})`,
          field: 'holeSpecDetail.pitch',
        });
      }
      if (!isFiniteNumber(spec.tapDepth) || spec.tapDepth <= 0) {
        errors.push({
          code: 'NEGATIVE_DEPTH',
          message: `tapDepth must be > 0 (got ${spec.tapDepth})`,
          field: 'holeSpecDetail.tapDepth',
        });
      }
      break;
    }
    case 'pipe_tap': {
      if (!spec.pipeSizeKey) {
        errors.push({
          code: 'PIPE_KEY_MISSING',
          message: 'pipe_tap requires a non-empty pipeSizeKey',
          field: 'holeSpecDetail.pipeSizeKey',
        });
      }
      if (!isFiniteNumber(spec.engagementDepth) || spec.engagementDepth <= 0) {
        errors.push({
          code: 'NEGATIVE_DEPTH',
          message: `engagementDepth must be > 0 (got ${spec.engagementDepth})`,
          field: 'holeSpecDetail.engagementDepth',
        });
      }
      break;
    }
    case 'drilled':
    default:
      // diameter + drillTipAngle already checked above.
      break;
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

  if (def.axis !== undefined && def.axis !== 0 && def.axis !== 1 && def.axis !== 2) {
    errors.push({
      code: 'NAN_PARAM',
      message: `axis must be one of 0 (X), 1 (Y), or 2 (Z), got ${String(def.axis)}`,
      field: 'axis',
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
    case 'linear2D': {
      const p = def.params.data;
      assertFinite(errors, p.startX, 'params.startX');
      assertFinite(errors, p.startY, 'params.startY');
      assertFinite(errors, p.dxRow, 'params.dxRow');
      assertFinite(errors, p.dyRow, 'params.dyRow');
      assertFinite(errors, p.dxCol, 'params.dxCol');
      assertFinite(errors, p.dyCol, 'params.dyCol');
      validateCount(errors, p.rows, 'params.rows');
      validateCount(errors, p.cols, 'params.cols');
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
      // Degenerate: multi-position grid with both step vectors at the origin
      // stacks every hole at (startX, startY).
      if (
        p.rows * p.cols > 1 &&
        p.dxRow === 0 &&
        p.dyRow === 0 &&
        p.dxCol === 0 &&
        p.dyCol === 0
      ) {
        errors.push({
          code: 'NEGATIVE_SPACING',
          message: 'linear2D array with multiple positions has zero row and column step',
          field: 'params.dxCol',
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

  if (def.holeSpecDetail) {
    validateHoleSpecDetail(errors, def.holeSpecDetail);
  }

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

// Math-kind expansion delegates to the `patternHelpers/` modules (W5 refactor).
// The thin wrappers here adapt the C2 array-param shapes to the new helper
// param shapes (kind discriminator added) and preserve the legacy id rule so
// existing F-HW-01..F-HW-04 fixtures observe identical position lists.

function expandLinear(
  arrayId: string,
  p: LinearArrayParams,
): HolePosition[] {
  return expandLinearPattern(arrayId, {
    kind: 'linear',
    startX: p.startX,
    startY: p.startY,
    dx: p.dx,
    dy: p.dy,
    count: p.count,
  });
}

function expandLinear2D(
  arrayId: string,
  p: Linear2DArrayParams,
): HolePosition[] {
  return expandLinear2DPattern(arrayId, {
    kind: 'linear2D',
    startX: p.startX,
    startY: p.startY,
    dxRow: p.dxRow,
    dyRow: p.dyRow,
    dxCol: p.dxCol,
    dyCol: p.dyCol,
    rows: p.rows,
    cols: p.cols,
  });
}

function expandCircular(
  arrayId: string,
  p: CircularArrayParams,
): HolePosition[] {
  return expandCircularPattern(arrayId, {
    kind: 'circular',
    centerX: p.centerX,
    centerY: p.centerY,
    radius: p.radius,
    count: p.count,
    startAngle: p.startAngle,
    partialAngle: p.partialAngle,
    direction: p.direction,
  });
}

function expandRect(
  arrayId: string,
  p: RectArrayParams,
): HolePosition[] {
  return expandRectPattern(arrayId, {
    kind: 'rect',
    startX: p.startX,
    startY: p.startY,
    stepX: p.stepX,
    stepY: p.stepY,
    rows: p.rows,
    cols: p.cols,
  });
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
    case 'linear2D':
      positions = expandLinear2D(def.id, def.params.data);
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

/**
 * Default 2D-linear array factory (W5). 2×3 grid with axis-aligned row +
 * column step vectors — the caller can tilt the grid later by giving
 * dxRow / dyCol non-zero values.
 */
export function createLinear2DArrayDefaults(
  id: string,
  holeSpec: HoleStandardRef,
): HoleArrayDefinition {
  return {
    id,
    kind: 'linear2D',
    params: {
      kind: 'linear2D',
      data: {
        startX: 0,
        startY: 0,
        dxRow: 0,
        dyRow: 20,
        dxCol: 20,
        dyCol: 0,
        rows: 2,
        cols: 3,
      },
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

// ─── Hole-spec resolution helpers (W3) ─────────────────────────────────────

/**
 * Per-series default countersink cone angle (deg). Spec §2.3 + §3.2:
 *   - ISO 10642 metric flat-head → 90°
 *   - ASME B18.3 imperial flat-head → 82°
 *
 * Pipe series fall back to 90° as a placeholder — countersink on a pipe-tap
 * is not in the spec but the default keeps the validator happy.
 */
export function defaultCountersinkAngle(series: HoleStandardSeries): number {
  switch (series) {
    case 'ANSI':
      return 82;
    case 'ISO':
    case 'ISO273':
    case 'KSB0201':
    case 'NPT':
    case 'BSP':
    default:
      return 90;
  }
}

/**
 * Default drill tip apex angle (deg). Spec §2.1 enumerates {118, 135, 60, 180};
 * 118° is the workshop standard and is what fastener catalogs assume.
 */
export const DEFAULT_DRILL_TIP_ANGLE = 118;

/**
 * Minimal catalog-row shape we read for HoleSpec resolution. Defined as a
 * structural type so this module stays decoupled from holeStandards.ts (no
 * cyclic import). The wizard's resolver passes in a `findStandardRow` result.
 */
export interface CatalogRowLite {
  name: string;
  nominal: number;
  pitch?: number;
  tpi?: number;
  tapDrill: number;
  clearance: number;
  fits?: { close: number; normal: number; loose: number };
  counterboreDia: number;
  counterboreDepth: number;
  countersinkDia: number;
  countersinkAngle: number;
}

/**
 * Resolve a HoleSpec for a given (HoleKind, HoleStandardRef, catalog row).
 *
 * Returns a fully-populated `HoleSpec` variant matching `kind`. Caller is
 * responsible for the catalog lookup (use `findStandardRow` from
 * holeStandards.ts) — this keeps the helper pure and unit-testable.
 *
 * For `counterdrill`, we derive `middleDiameter = (head + drill) / 2` and
 * `middleDepth = headDepth * 1.5` as sensible starting values; the user
 * tunes from there in custom mode.
 *
 * For `tap`, we use the catalog's `tapDrill` as the bore ⌀ (matches spec
 * §2.5: tap is cosmetic, boolean cut is at the tap drill).
 */
export function resolveHoleSpec(
  kind: HoleKind,
  ref: HoleStandardRef,
  row: CatalogRowLite | undefined,
): HoleSpec {
  // Fallback diameter when no catalog row is found (e.g. custom mode pre-fill).
  const fitClass = ref.fitClass ?? 'normal';
  const clearance = row?.fits?.[fitClass] ?? row?.clearance ?? 5;
  const tapDrill = row?.tapDrill ?? clearance;

  switch (kind) {
    case 'drilled':
      return {
        kind: 'drilled',
        diameter: clearance,
        drillTipAngle: DEFAULT_DRILL_TIP_ANGLE,
      };
    case 'counterbore':
      return {
        kind: 'counterbore',
        diameter: clearance,
        headDiameter: row?.counterboreDia ?? clearance + 4,
        headDepth: row?.counterboreDepth ?? Math.max(2, clearance * 1.1),
        drillTipAngle: DEFAULT_DRILL_TIP_ANGLE,
      };
    case 'countersink': {
      const ang = row?.countersinkAngle ?? defaultCountersinkAngle(ref.series);
      return {
        kind: 'countersink',
        diameter: clearance,
        coneDiameter: row?.countersinkDia ?? row?.counterboreDia ?? clearance + 3,
        coneAngle: ang,
        drillTipAngle: DEFAULT_DRILL_TIP_ANGLE,
      };
    }
    case 'counterdrill': {
      const headD = row?.counterboreDia ?? clearance + 4;
      const headDp = row?.counterboreDepth ?? Math.max(2, clearance * 1.1);
      return {
        kind: 'counterdrill',
        diameter: clearance,
        headDiameter: headD,
        headDepth: headDp,
        middleDiameter: +((headD + clearance) / 2).toFixed(2),
        middleDepth: +(headDp * 1.5).toFixed(2),
        drillTipAngle: DEFAULT_DRILL_TIP_ANGLE,
      };
    }
    case 'tap': {
      const pitch = row?.pitch ?? (row?.tpi ? +(25.4 / row.tpi).toFixed(3) : 1);
      // Spec §2.5: tapDepth ≤ drillDepth − 3*pitch. We default to a small,
      // safe tapDepth that callers can grow as needed.
      return {
        kind: 'tap',
        diameter: tapDrill,
        pitch,
        tapClass: ref.series === 'ANSI' ? '2B' : '6H',
        tapDepth: Math.max(2, Math.round(tapDrill * 2)),
        drillTipAngle: DEFAULT_DRILL_TIP_ANGLE,
      };
    }
    case 'pipe_tap': {
      // W5 — derive a pipeTapClass + taperAngle from the catalog series. The
      // resolver's pipeStandard column is narrower than pipeTapClass (no
      // NPSM there), so the picker UI can override pipeTapClass to the
      // parallel variants without re-routing the pipeStandard field.
      const isBSP = ref.series === 'BSP';
      const pipeStandard: PipeTapHoleSpec['pipeStandard'] = isBSP ? 'BSPP' : 'NPT';
      const pipeTapClass: NonNullable<PipeTapHoleSpec['pipeTapClass']> = isBSP
        ? 'BSP_parallel'
        : 'NPT';
      // NPT is tapered 1°47′; BSPP (parallel) gets 0. UI override via the
      // pipe-tap-class picker may flip this on the fly.
      const taperAngle = pipeTapClass === 'NPT' ? 1.7833 : 0;
      return {
        kind: 'pipe_tap',
        diameter: tapDrill,
        pipeStandard,
        pipeSizeKey: ref.designation || '1/4-18',
        engagementDepth: Math.max(5, tapDrill * 1.5),
        pipeTapClass,
        taperAngle,
      };
    }
  }
}
