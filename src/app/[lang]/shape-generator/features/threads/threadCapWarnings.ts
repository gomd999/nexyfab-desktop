/**
 * threadCapWarnings.ts — Wave 2 Phase 2 Track D7 (W7) cap warnings.
 *
 * Geometric thread mode introduces several "the thread is physically wrong"
 * conditions the user should know about. These are NOT errors — the mesh
 * still builds — but the wizard should surface them as inline warnings.
 *
 * Warning codes (spec §8.1):
 *   - `THREAD_BLOWS_PAST_BODY`  — thread length exceeds the parent body
 *     length (the thread mesh extends past the part).
 *   - `THREAD_TOO_CLOSE_TO_END` — thread starts within 1·pitch of the parent
 *     end face (no room for the entry chamfer / runout).
 *   - `THREAD_LENGTH_NOT_INTEGER_PITCH` — thread length doesn't divide evenly
 *     by pitch (cosmetic warning — the last partial pitch is mathematically
 *     fine but visually some users find it confusing).
 *   - `THREAD_PROFILE_INVALID` — V-profile cross-section self-intersects.
 *     Defensive: only triggered if a caller supplies a wildly malformed
 *     override.
 *
 * Severities:
 *   - `error`   — block the geometric build (warnings are still returned so
 *     the UI can show them).
 *   - `warning` — let the build proceed but surface the issue.
 *
 * Spec: `docs/wave-2-phase-2-threads-spec.md` §8.1 (perf guardrail),
 * §11.3 (rebuild warnings).
 *
 * Out of scope:
 * - Whole-part envelope cap (≥ 8 / ≥ 32 geometric-threads per part) — that
 *   lives in the host wizard, not per-feature here.
 * - Tap-drill-diameter mismatch — that's in `threadFeatureUpdate.ts` (D5/D6).
 */

import type { ThreadFeature } from './threadFeature';
import { findThreadRow, type ThreadStandardRow } from './threadCatalog';
import {
  buildThreadProfile,
  profileSelfIntersects,
  type Vec2,
} from './threadProfile';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ThreadCapWarningCode =
  | 'THREAD_BLOWS_PAST_BODY'
  | 'THREAD_TOO_CLOSE_TO_END'
  | 'THREAD_LENGTH_NOT_INTEGER_PITCH'
  | 'THREAD_PROFILE_INVALID';

export type ThreadCapWarningSeverity = 'error' | 'warning';

export interface ThreadCapWarning {
  code: ThreadCapWarningCode;
  severity: ThreadCapWarningSeverity;
  /** Stable i18n message id — UI looks this up in `threads/i18n.ts`. */
  i18nMessageId: string;
  /** English fallback message for diagnostics. */
  message: string;
  /** Optional numeric details for the UI (e.g. "expected 20, got 23"). */
  detail?: Record<string, number | string>;
}

export interface ThreadCapWarningsInput {
  feature: ThreadFeature;
  /**
   * Parent body length along its axis (mm). When unknown, pass `undefined`
   * and the `THREAD_BLOWS_PAST_BODY` + `THREAD_TOO_CLOSE_TO_END` checks
   * are skipped.
   */
  parentBodyLengthMm?: number;
  /**
   * Optional V-profile override for `THREAD_PROFILE_INVALID`. When omitted
   * the canonical 60° V from the catalog is built and checked.
   */
  profile?: Vec2[];
}

// ─── Tolerances ─────────────────────────────────────────────────────────────

/**
 * "Doesn't divide evenly" threshold — 5% of one pitch. Below this the
 * fractional remainder is small enough that the visual artefact is invisible
 * (the partial-turn cross-section shrinks below 1 px at typical zoom).
 */
const INTEGER_PITCH_TOLERANCE_FRACTION = 0.05;

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Evaluate every cap-warning rule against a thread feature.
 *
 * Returns the full list (possibly empty). Severities are mixed; callers can
 * filter by severity:
 *
 *   const errors = warnings.filter(w => w.severity === 'error');
 *   const onlyWarn = warnings.filter(w => w.severity === 'warning');
 *
 * @param input feature + optional parent body context
 * @returns array of warnings (never undefined)
 */
export function evaluateThreadCapWarnings(
  input: ThreadCapWarningsInput,
): ThreadCapWarning[] {
  const out: ThreadCapWarning[] = [];
  const { feature, parentBodyLengthMm } = input;

  const row = findThreadRow(feature.threadRef.series, feature.threadRef.designation);
  if (!row) {
    // The feature itself is malformed; the cosmetic-mode path already throws
    // on this. We return an empty list — the higher-level validation surface
    // catches it.
    return out;
  }

  // 1. THREAD_BLOWS_PAST_BODY
  if (
    typeof parentBodyLengthMm === 'number' &&
    Number.isFinite(parentBodyLengthMm) &&
    parentBodyLengthMm > 0
  ) {
    const threadEnd = feature.startOffset + feature.length;
    if (threadEnd > parentBodyLengthMm) {
      out.push({
        code: 'THREAD_BLOWS_PAST_BODY',
        severity: 'error',
        i18nMessageId: 'capWarnBlowsPastBody',
        message:
          `Thread extends past the parent body: threadEnd=${threadEnd.toFixed(2)} mm > ` +
          `body length=${parentBodyLengthMm.toFixed(2)} mm`,
        detail: {
          threadEnd,
          parentBodyLengthMm,
          excess: threadEnd - parentBodyLengthMm,
        },
      });
    }
  }

  // 2. THREAD_TOO_CLOSE_TO_END — top of thread closer than 1·pitch to body end.
  if (
    typeof parentBodyLengthMm === 'number' &&
    Number.isFinite(parentBodyLengthMm) &&
    parentBodyLengthMm > 0
  ) {
    const threadEnd = feature.startOffset + feature.length;
    const clearance = parentBodyLengthMm - threadEnd;
    if (clearance >= 0 && clearance < row.pitch) {
      out.push({
        code: 'THREAD_TOO_CLOSE_TO_END',
        severity: 'warning',
        i18nMessageId: 'capWarnTooCloseToEnd',
        message:
          `Thread ends within one pitch of the parent end face ` +
          `(clearance=${clearance.toFixed(3)} mm, pitch=${row.pitch} mm). ` +
          `Add a runout or shorten the thread.`,
        detail: {
          clearance,
          pitch: row.pitch,
          parentBodyLengthMm,
          threadEnd,
        },
      });
    }
  }

  // 3. THREAD_LENGTH_NOT_INTEGER_PITCH
  const pitch = row.pitch;
  if (pitch > 0 && feature.length > 0) {
    const remainder = feature.length - Math.floor(feature.length / pitch) * pitch;
    // Treat both "small remainder" and "almost a full pitch" as integer
    // (e.g. 19.999 mm at 1.25 mm pitch is fine).
    const tol = pitch * INTEGER_PITCH_TOLERANCE_FRACTION;
    const wraps =
      remainder < tol || remainder > pitch - tol; // close to 0 OR close to pitch
    if (!wraps) {
      out.push({
        code: 'THREAD_LENGTH_NOT_INTEGER_PITCH',
        severity: 'warning',
        i18nMessageId: 'capWarnLengthNotIntegerPitch',
        message:
          `Thread length ${feature.length} mm is not an integer multiple of ` +
          `pitch ${pitch} mm (remainder=${remainder.toFixed(3)} mm).`,
        detail: { length: feature.length, pitch, remainder },
      });
    }
  }

  // 4. THREAD_PROFILE_INVALID — defensive check.
  const profile =
    input.profile ??
    buildThreadProfile({ pitch: row.pitch, threadHeight: row.threadHeight });
  if (profileSelfIntersects(profile)) {
    out.push({
      code: 'THREAD_PROFILE_INVALID',
      severity: 'error',
      i18nMessageId: 'capWarnProfileInvalid',
      message:
        `Thread V-profile cross-section self-intersects — refuse to build geometric mesh.`,
      detail: { pointCount: profile.length },
    });
  }

  return out;
}

/** Convenience: returns true iff any warning has severity `error`. */
export function hasBlockingWarnings(warnings: readonly ThreadCapWarning[]): boolean {
  return warnings.some((w) => w.severity === 'error');
}

/** Convenience: filter by code. */
export function warningsOfCode(
  warnings: readonly ThreadCapWarning[],
  code: ThreadCapWarningCode,
): ThreadCapWarning[] {
  return warnings.filter((w) => w.code === code);
}

// ─── Static helpers for tests ──────────────────────────────────────────────

/**
 * Look up the row for a feature without re-walking the catalog twice in
 * tests. Returns the row or null.
 */
export function rowForFeature(feature: ThreadFeature): ThreadStandardRow | null {
  return findThreadRow(feature.threadRef.series, feature.threadRef.designation);
}
