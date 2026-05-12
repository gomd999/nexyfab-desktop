/**
 * Crash-rate budget for NexyFab 3D (Q9).
 *
 * Defines the go/no-go thresholds we hold ourselves to before and after
 * launch. Used by the ops dashboard generator to mark releases red/yellow/
 * green at a glance, and by alerting rules to page on excursions.
 *
 * Numbers reflect industry-typical bands for a CAD/design app, not a
 * mission-critical service. They are intentionally conservative: a paying
 * customer who loses a single design is more painful than a fleet-wide
 * latency blip.
 */

export interface CrashBudget {
  /** Sessions per N events (denominator for crash rate). */
  windowEvents: number;
  /** Max acceptable crash count within the window. */
  green: number;
  /** Yellow band (alert but no rollback). */
  yellow: number;
  /** Red band (auto-rollback recommended). */
  red: number;
  /** What kind of event this budget covers. */
  description: string;
}

export const CRASH_BUDGETS = {
  /**
   * Browser-tab crashes (window error / unhandled rejection / WebGL CONTEXT_LOST
   * that didn't recover). Per session this counts as a fatal user-blocking event.
   */
  fatal_session: {
    windowEvents: 1000,
    green: 5,    // 0.5%
    yellow: 15,  // 1.5%
    red: 30,     // 3.0%
    description: 'Sessions ending with an unrecovered WebGL or runtime crash',
  } satisfies CrashBudget,

  /**
   * Feature pipeline failures (CSG empty, OCCT init fail, mesh non-manifold).
   * Higher tolerance — these surface as in-app error toasts, not crashes.
   */
  pipeline_error: {
    windowEvents: 1000,
    green: 30,    // 3%
    yellow: 80,   // 8%
    red: 150,     // 15%
    description: 'Feature evaluations that errored visibly to the user',
  } satisfies CrashBudget,

  /**
   * STEP/IGES import failures. Customer-blocking when they happen because
   * the user can't get past the load screen. Same band as fatal_session.
   */
  cad_import_error: {
    windowEvents: 100,
    green: 1,     // 1%
    yellow: 3,    // 3%
    red: 5,       // 5%
    description: 'STEP/IGES files that failed to import',
  } satisfies CrashBudget,

  /**
   * Auto-save / cloud sync write failures. Each one is a near-miss for
   * data loss; we want zero in green.
   */
  save_error: {
    windowEvents: 1000,
    green: 2,     // 0.2%
    yellow: 10,   // 1%
    red: 25,      // 2.5%
    description: 'Auto-save or cloud sync writes that failed',
  } satisfies CrashBudget,
} as const;

export type CrashBudgetKey = keyof typeof CRASH_BUDGETS;

export type CrashBudgetStatus = 'green' | 'yellow' | 'red';

/**
 * Classify an observed event count against the budget.
 *
 * The thresholds are inclusive: count ≤ green → green, count ≤ yellow → yellow,
 * else red. This avoids "11 of 1000 → undefined band" edge cases.
 */
export function classifyAgainstBudget(
  key: CrashBudgetKey,
  observedCount: number,
): CrashBudgetStatus {
  const budget = CRASH_BUDGETS[key];
  if (observedCount <= budget.green) return 'green';
  if (observedCount <= budget.yellow) return 'yellow';
  return 'red';
}

/** Returns the rate (0-1) given a count and the budget's denominator. */
export function rateFor(key: CrashBudgetKey, observedCount: number): number {
  const budget = CRASH_BUDGETS[key];
  return observedCount / budget.windowEvents;
}
