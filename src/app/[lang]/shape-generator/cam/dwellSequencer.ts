/**
 * dwellSequencer.ts — Generate dwell (G04) instructions for CAM
 * sequences requiring controlled pauses.
 *
 * Dwell uses cases:
 *
 *   - Chip-break in drilling: dwell at bottom to break chip.
 *   - Spot facing: dwell after plunge to clear chip-pack.
 *   - Tapping rigid stop: dwell at depth before retract.
 *   - Probe touch: dwell after probe touchdown for steady reading.
 *
 * Module:
 *   - For each event in a CAM sequence, determines if a dwell is
 *     needed and how long.
 *   - Emits G04 Pxxx (ms) commands.
 *   - Reports total dwell time per sequence.
 */

export type DwellTrigger = 'drill-bottom' | 'spot-finish' | 'tap-bottom' | 'probe-touch' | 'pre-retract' | 'custom';

export interface DwellEvent {
  id: string;
  trigger: DwellTrigger;
  /** Optional explicit duration (ms). */
  durationMs?: number;
  /** Operation type context (informational). */
  operationKind?: string;
}

export interface DwellPolicies {
  drillBottomMs: number;
  spotFinishMs: number;
  tapBottomMs: number;
  probeTouchMs: number;
  preRetractMs: number;
  defaultMs: number;
}

export const DEFAULT_POLICIES: DwellPolicies = {
  drillBottomMs: 200,
  spotFinishMs: 300,
  tapBottomMs: 50,
  probeTouchMs: 500,
  preRetractMs: 100,
  defaultMs: 100,
};

export interface DwellResult {
  events: { id: string; durationMs: number; gcode: string }[];
  totalDwellMs: number;
  longest: { id: string; durationMs: number } | null;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateDwells(events: DwellEvent[], policies: Partial<DwellPolicies> = {}): DwellResult {
  const pol = { ...DEFAULT_POLICIES, ...policies };
  const out: { id: string; durationMs: number; gcode: string }[] = [];
  let total = 0;
  let longest: { id: string; durationMs: number } | null = null;
  for (const e of events) {
    const dur = e.durationMs ?? defaultDuration(e.trigger, pol);
    if (dur <= 0) continue;
    out.push({ id: e.id, durationMs: dur, gcode: `G04 P${Math.round(dur)}` });
    total += dur;
    if (!longest || dur > longest.durationMs) longest = { id: e.id, durationMs: dur };
  }
  return { events: out, totalDwellMs: total, longest };
}

function defaultDuration(trigger: DwellTrigger, pol: DwellPolicies): number {
  switch (trigger) {
    case 'drill-bottom': return pol.drillBottomMs;
    case 'spot-finish': return pol.spotFinishMs;
    case 'tap-bottom': return pol.tapBottomMs;
    case 'probe-touch': return pol.probeTouchMs;
    case 'pre-retract': return pol.preRetractMs;
    case 'custom': return pol.defaultMs;
  }
}

// ── Insert dwell into existing g-code stream ────────────────

export function insertDwells(gcodeLines: string[], dwellMap: Map<number, DwellEvent>, policies: Partial<DwellPolicies> = {}): string[] {
  const pol = { ...DEFAULT_POLICIES, ...policies };
  const out: string[] = [];
  for (let i = 0; i < gcodeLines.length; i++) {
    out.push(gcodeLines[i]!);
    const event = dwellMap.get(i);
    if (event) {
      const dur = event.durationMs ?? defaultDuration(event.trigger, pol);
      if (dur > 0) out.push(`G04 P${Math.round(dur)}`);
    }
  }
  return out;
}

// ── Time impact analysis ─────────────────────────────────────

export interface ImpactReport {
  baseTimeSec: number;
  dwellTimeSec: number;
  /** Percent of total time spent dwelling. */
  dwellFraction: number;
}

export function timeImpact(result: DwellResult, baseCycleTimeSec: number): ImpactReport {
  const dwellSec = result.totalDwellMs / 1000;
  const fraction = baseCycleTimeSec === 0 ? 0 : dwellSec / (baseCycleTimeSec + dwellSec);
  return {
    baseTimeSec: baseCycleTimeSec,
    dwellTimeSec: dwellSec,
    dwellFraction: fraction,
  };
}

// ── Reduce wasteful dwells ───────────────────────────────────

export interface ReductionSuggestion {
  eventId: string;
  oldDurationMs: number;
  newDurationMs: number;
  reason: string;
}

export function suggestReductions(result: DwellResult, threshold: number = 500): ReductionSuggestion[] {
  const out: ReductionSuggestion[] = [];
  for (const e of result.events) {
    if (e.durationMs > threshold) {
      out.push({
        eventId: e.id,
        oldDurationMs: e.durationMs,
        newDurationMs: threshold,
        reason: `Long dwell ${e.durationMs} ms exceeds ${threshold} ms threshold.`,
      });
    }
  }
  return out;
}

// ── Summary ────────────────────────────────────────────────────

export interface DwellSummary {
  eventCount: number;
  totalDwellMs: number;
  longestDwellMs: number;
}

export function summarize(result: DwellResult): DwellSummary {
  return {
    eventCount: result.events.length,
    totalDwellMs: result.totalDwellMs,
    longestDwellMs: result.longest ? result.longest.durationMs : 0,
  };
}
