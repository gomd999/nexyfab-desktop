/**
 * bodyCapWarnings.ts — Wave 2 Phase 3 Track E3.
 *
 * Soft "cap" warnings for body-level direct edits. These are surfaced
 * BEFORE the applier runs — they don't refuse the op (the validator
 * does that), but they warn the user that a parameter looks
 * suspicious (likely typo / unit confusion).
 *
 * Why separate from `validateMoveBody` / `validateRotateBody`:
 *   - Validators are hard refusals — they prevent geometry corruption.
 *   - Cap warnings are soft heuristics — they advise but allow the
 *     user to override. The toolbar shows the warning text but the
 *     Apply button is still enabled (unless `BODY_REQUIRED` fires).
 *
 * Mirrors the `cap warnings` idiom from features/threads — each
 * warning is identified by a constant string that callers can use as
 * a switch discriminant.
 */

import type { DirectEditOp } from './directEditTypes';

/** Translation magnitude exceeds this multiple of the body's bounding
 *  box diagonal → suspicious (likely typo). */
const MOVE_TRANSLATION_DIAGONAL_RATIO_THRESHOLD = 10;

/** Outside this range, the angle is almost certainly degrees-vs-
 *  radians confusion. (-2π .. 2π is the validator's hard limit;
 *  -π .. π is the soft "no extreme spins" limit.) */
const ROTATE_SOFT_LIMIT_RAD = Math.PI;

/** Strings the toolbar uses to render the warning. The enum is
 *  deliberately string-typed so a `switch (code) { case 'X': ... }`
 *  stays exhaustive when a future warning is added. */
export type BodyCapWarningCode =
  | 'MOVE_TRANSLATION_TOO_LARGE'
  | 'ROTATE_ANGLE_OUT_OF_RANGE'
  | 'BODY_REQUIRED';

export interface BodyCapWarning {
  code: BodyCapWarningCode;
  /** Human-readable English message — i18n is a UI concern handled
   *  separately by `directEditI18n.ts`. */
  message: string;
  /** True when the warning should block the Apply button. Only
   *  `BODY_REQUIRED` is blocking. */
  blocking: boolean;
}

export interface MoveCapContext {
  /** Bounding box diagonal of the body being moved (mm). Used to
   *  scale the "too large" threshold. */
  bodyBboxDiagonalMm: number;
}

/** Check a `moveBody` op against soft caps. Returns an empty array
 *  when everything looks reasonable. */
export function checkMoveBodyCaps(
  op: Extract<DirectEditOp, { kind: 'moveBody' }>,
  ctx: MoveCapContext,
): BodyCapWarning[] {
  const warnings: BodyCapWarning[] = [];
  if (!op.bodyId) {
    warnings.push({
      code: 'BODY_REQUIRED',
      message: 'No body picked — click a body in the viewport first.',
      blocking: true,
    });
    return warnings;
  }
  const mag = Math.hypot(
    op.translation[0],
    op.translation[1],
    op.translation[2],
  );
  if (
    ctx.bodyBboxDiagonalMm > 0 &&
    mag > ctx.bodyBboxDiagonalMm * MOVE_TRANSLATION_DIAGONAL_RATIO_THRESHOLD
  ) {
    warnings.push({
      code: 'MOVE_TRANSLATION_TOO_LARGE',
      message: `Translation magnitude (${mag.toFixed(2)}mm) is more than 10× the body's bounding box diagonal — possible typo.`,
      blocking: false,
    });
  }
  return warnings;
}

/** Check a `rotateBody` op against soft caps. */
export function checkRotateBodyCaps(
  op: Extract<DirectEditOp, { kind: 'rotateBody' }>,
): BodyCapWarning[] {
  const warnings: BodyCapWarning[] = [];
  if (!op.bodyId) {
    warnings.push({
      code: 'BODY_REQUIRED',
      message: 'No body picked — click a body in the viewport first.',
      blocking: true,
    });
    return warnings;
  }
  const angle = op.rotation.angleRad;
  if (Math.abs(angle) > ROTATE_SOFT_LIMIT_RAD) {
    warnings.push({
      code: 'ROTATE_ANGLE_OUT_OF_RANGE',
      message: `Rotation angle (${angle.toFixed(3)} rad ≈ ${((angle * 180) / Math.PI).toFixed(1)}°) exceeds ±π — did you mean degrees?`,
      blocking: false,
    });
  }
  return warnings;
}

/** Pre-pick check — used by the toolbar to gate Apply on "no body
 *  selected yet". Returns the `BODY_REQUIRED` warning when bodyId is
 *  empty / undefined, otherwise an empty array. */
export function checkBodyRequired(bodyId: string | null | undefined): BodyCapWarning[] {
  if (!bodyId) {
    return [{
      code: 'BODY_REQUIRED',
      message: 'No body picked — click a body in the viewport first.',
      blocking: true,
    }];
  }
  return [];
}
