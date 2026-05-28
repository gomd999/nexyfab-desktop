/**
 * selectThreadRenderMode.ts — Wave 2 Phase 2 Track D7 (W7) live-drag demotion.
 *
 * Pure helper that decides, frame-by-frame, whether a thread feature should
 * render as geometric (full V-cut mesh) or cosmetic (metadata + magenta
 * indicator). The rule chain from spec §8.1 + §11.2:
 *
 *  1. If the user is actively dragging a parameter (`isDragging`), demote
 *     to cosmetic regardless of the feature's stored mode.
 *  2. If the feature is stored as `cosmetic`, render cosmetic (no demotion
 *     needed; never promotes).
 *  3. If the feature is stored as `geometric`:
 *     a. If a recent geometric frame took >50ms (slow), stay cosmetic for
 *        500ms after drag end (hysteresis).
 *     b. Otherwise render geometric.
 *
 * The function is **pure** — all clocks come in as arguments. Callers wire
 * `Date.now()` or `performance.now()` from the render loop.
 *
 * Hysteresis threshold rationale (spec ambiguity resolved):
 *   - Geometric build budget is 30-80 ms per spec §11. A frame >50 ms means
 *     we're at the slow end; user-perceived stutter starts ~30 ms.
 *   - 500 ms cooldown matches the "feel" of Onshape's same-pattern demotion
 *     and gives enough time for one or two cosmetic frames to confirm
 *     stability before resuming geometric.
 *
 * Spec: §8.1 (perf guardrail), §11.2 (live drag).
 *
 * Out of scope:
 * - Owning the drag state (the wizard / viewport state machine does that).
 * - Triggering rebuilds — this is a pure render-mode selector.
 */

import type { ThreadFeature, ThreadMode } from './threadFeature';

// ─── Constants (spec §11.2 + §8.1) ─────────────────────────────────────────

/** A "slow" geometric frame at or above this threshold triggers cooldown. */
export const SLOW_FRAME_THRESHOLD_MS = 50;

/** After a slow frame + drag-end, stay cosmetic for this long. */
export const HYSTERESIS_COOLDOWN_MS = 500;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ThreadDragState {
  /** True iff the user is actively manipulating a slider / drag handle. */
  isDragging: boolean;
  /**
   * Timestamp of the most recent drag-end (ms epoch — pass
   * `performance.now()` or `Date.now()` consistently with `now`).
   * Undefined = drag has never happened in this session.
   */
  lastDragEndMs?: number;
}

export interface ThreadFrameStats {
  /**
   * Duration of the most recent geometric build (ms). Undefined = no
   * geometric frame yet recorded (first geometric render → always allow).
   */
  lastGeometricFrameMs?: number;
}

export interface SelectThreadRenderModeInput {
  feature: Pick<ThreadFeature, 'mode'>;
  dragState: ThreadDragState;
  frameStats: ThreadFrameStats;
  /** Current time (ms). Pass `performance.now()` or `Date.now()`. */
  now: number;
}

// ─── Decision function ─────────────────────────────────────────────────────

/**
 * Decide render mode for the current frame.
 *
 * @returns `'cosmetic'` when demoted or when the feature is stored as
 * cosmetic; `'geometric'` when the feature is stored as geometric AND no
 * demotion condition applies.
 */
export function selectThreadRenderMode(
  input: SelectThreadRenderModeInput,
): ThreadMode {
  const { feature, dragState, frameStats, now } = input;

  // (1) Active drag → always cosmetic.
  if (dragState.isDragging) return 'cosmetic';

  // (2) Stored cosmetic → cosmetic (never promote here).
  if (feature.mode === 'cosmetic') return 'cosmetic';

  // (3) Stored geometric — check hysteresis cooldown.
  const wasSlow =
    typeof frameStats.lastGeometricFrameMs === 'number' &&
    frameStats.lastGeometricFrameMs > SLOW_FRAME_THRESHOLD_MS;
  const dragEndedRecently =
    typeof dragState.lastDragEndMs === 'number' &&
    now - dragState.lastDragEndMs < HYSTERESIS_COOLDOWN_MS;
  if (wasSlow && dragEndedRecently) return 'cosmetic';

  return 'geometric';
}

// ─── Drag-state lifecycle helpers ──────────────────────────────────────────

/**
 * Convenience: produce a new drag-state object marking the start of a drag.
 * Carries the previous `lastDragEndMs` forward so the cooldown clock isn't
 * reset.
 */
export function dragStateStart(prev: ThreadDragState): ThreadDragState {
  return { isDragging: true, lastDragEndMs: prev.lastDragEndMs };
}

/**
 * Convenience: produce a new drag-state object marking the end of a drag.
 * Stamps `lastDragEndMs` to the current clock so hysteresis cooldown begins.
 */
export function dragStateEnd(now: number): ThreadDragState {
  return { isDragging: false, lastDragEndMs: now };
}

/**
 * Convenience: combine a previous `ThreadFrameStats` with a freshly-measured
 * geometric frame duration. Identity-stable when the duration is unchanged
 * (so React `useMemo` chains don't re-render unnecessarily).
 */
export function recordGeometricFrame(
  prev: ThreadFrameStats,
  durationMs: number,
): ThreadFrameStats {
  if (prev.lastGeometricFrameMs === durationMs) return prev;
  return { lastGeometricFrameMs: durationMs };
}

/**
 * Initial state — fresh drag + frame stats with no history.
 */
export const INITIAL_DRAG_STATE: ThreadDragState = Object.freeze({ isDragging: false });
export const INITIAL_FRAME_STATS: ThreadFrameStats = Object.freeze({});
