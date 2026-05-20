/**
 * cuttingTime.ts — Estimate machining time from toolpath length + feeds.
 *
 * Inputs: toolpath result (cut length, rapid length, pass count),
 * feeds (mm/min for cut + rapid), per-pass overheads (tool-change,
 * spindle ramp, retract dwell).
 *
 * Output: minutes total + breakdown.
 *
 * The estimate is intentionally conservative — quote engines tend to
 * mark up + 20% beyond this number to cover real-world inefficiency
 * (chip clearing, manual setup, tool wear stops).
 */

export interface FeedRates {
  /** Feed rate while cutting (mm/min). */
  cutFeedMmPerMin: number;
  /** Rapid traverse rate (mm/min). Typical 5000–15000. */
  rapidFeedMmPerMin: number;
  /** Plunge feed rate (mm/min). Usually slower than cut feed. */
  plungeFeedMmPerMin?: number;
}

export interface CycleOverheads {
  /** Per-pass dwell + retract overhead (seconds). */
  perPassSec?: number;
  /** Tool change time (seconds), if a tool change is part of the job. */
  toolChangeSec?: number;
  /** Spindle ramp-up time on job start (seconds). */
  spindleStartSec?: number;
}

export interface TimeEstimate {
  cutMinutes: number;
  rapidMinutes: number;
  plungeMinutes: number;
  overheadMinutes: number;
  totalMinutes: number;
}

export interface ToolpathTotals {
  cutLengthMm: number;
  rapidLengthMm: number;
  plungeLengthMm?: number;
  passCount?: number;
}

/** Compute the time estimate. Plunge length is sub-tracted from cut
 *  length when supplied (so we don't double-count plunges). */
export function estimateTime(
  totals: ToolpathTotals,
  feeds: FeedRates,
  overheads: CycleOverheads = {},
): TimeEstimate {
  const cutFeed = Math.max(1, feeds.cutFeedMmPerMin);
  const rapidFeed = Math.max(1, feeds.rapidFeedMmPerMin);
  const plungeFeed = Math.max(1, feeds.plungeFeedMmPerMin ?? cutFeed * 0.5);

  const plungeMm = totals.plungeLengthMm ?? 0;
  const cutMm = Math.max(0, totals.cutLengthMm - plungeMm);
  const rapidMm = totals.rapidLengthMm;

  const cutMin = cutMm / cutFeed;
  const rapidMin = rapidMm / rapidFeed;
  const plungeMin = plungeMm / plungeFeed;

  const overheadSec =
    (overheads.perPassSec ?? 0) * (totals.passCount ?? 0)
    + (overheads.toolChangeSec ?? 0)
    + (overheads.spindleStartSec ?? 0);
  const overheadMin = overheadSec / 60;

  return {
    cutMinutes: cutMin,
    rapidMinutes: rapidMin,
    plungeMinutes: plungeMin,
    overheadMinutes: overheadMin,
    totalMinutes: cutMin + rapidMin + plungeMin + overheadMin,
  };
}

/** Pretty-format minutes as `Hh MMm` for the cost panel. */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}
