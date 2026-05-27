/**
 * peckDrillSchedule.ts — Compute peck-drill schedule for deep holes.
 *
 * In deep-hole drilling (L/D > 3), chips clog the flute and bind
 * the drill. Peck cycles retract the tool periodically to evacuate
 * chips. Two main schemes:
 *
 *   - Full retract (G83): retract to the R-plane each peck. Clears
 *     chips fully; slower.
 *   - Chip-break (G73): retract a small amount (≈ 0.5-1 mm). Breaks
 *     the chip; faster but doesn't clear deep chips.
 *
 * Recommendation rules:
 *
 *   - L/D 3..5: G73 chip-break, peck = 2·D each.
 *   - L/D 5..10: G83 full-retract, peck = 1·D, then 0.7·D, then 0.5·D
 *     (decremental peck).
 *   - L/D > 10: peck = 0.5·D throughout, drill larger pilot first.
 *
 * Module emits the peck depths + retract strategy + estimated time.
 */

export type PeckScheme = 'chip-break' | 'full-retract' | 'decremental';

export interface DrillSpec {
  diameterMm: number;
  fluteLengthMm: number;
  /** Pilot hole diameter (0 if none). */
  pilotDiameterMm: number;
}

export interface HoleSpec {
  depthMm: number;
  /** Optional final-finish allowance (mm). */
  finishAllowanceMm?: number;
}

export interface MaterialSpec {
  /** Specific cutting force kc1.1 (N/mm²). */
  kc11Mpa: number;
  /** Chip-removal factor: aluminum = 1.5, steel = 1.0, stainless = 0.7. */
  evacuationFactor: number;
}

export interface ScheduleOptions {
  feedMmMin: number;
  /** Whether decremental scheme is allowed. */
  allowDecremental: boolean;
  /** Chip-break retract distance (mm). */
  chipBreakRetractMm: number;
  /** Full retract clearance plane height (mm above stock top). */
  fullRetractClearanceMm: number;
}

export const DEFAULT_OPTIONS: ScheduleOptions = {
  feedMmMin: 150,
  allowDecremental: true,
  chipBreakRetractMm: 0.5,
  fullRetractClearanceMm: 2,
};

export interface PeckStep {
  index: number;
  depthAtStartMm: number;
  depthAtEndMm: number;
  peckIncrementMm: number;
  /** True = full retract, false = chip break. */
  fullRetract: boolean;
}

export interface DrillSchedule {
  scheme: PeckScheme;
  peckSteps: PeckStep[];
  lengthDiameterRatio: number;
  estimatedTimeSec: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateSchedule(
  hole: HoleSpec,
  drill: DrillSpec,
  material: MaterialSpec,
  options: Partial<ScheduleOptions> = {},
): DrillSchedule {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  if (drill.diameterMm <= 0) {
    warnings.push('Drill diameter must be positive.');
    return { scheme: 'chip-break', peckSteps: [], lengthDiameterRatio: 0, estimatedTimeSec: 0, warnings };
  }

  const effDepth = Math.max(0, hole.depthMm - (hole.finishAllowanceMm ?? 0));
  const lD = effDepth / drill.diameterMm;
  let scheme: PeckScheme;
  if (lD <= 3) scheme = 'chip-break';
  else if (lD <= 5) scheme = 'chip-break';
  else if (lD <= 10) scheme = opts.allowDecremental ? 'decremental' : 'full-retract';
  else scheme = 'decremental';

  const peckSteps: PeckStep[] = [];
  let cur = 0;
  let stepIdx = 0;
  // Decremental factor application.
  while (cur < effDepth) {
    let inc: number;
    if (scheme === 'chip-break') {
      inc = drill.diameterMm * 2 * material.evacuationFactor;
    } else if (scheme === 'full-retract') {
      inc = drill.diameterMm * material.evacuationFactor;
    } else {
      // Decremental: starts at 1·D, then 0.7·D, then 0.5·D
      const factor = stepIdx === 0 ? 1.0 : stepIdx === 1 ? 0.7 : 0.5;
      inc = drill.diameterMm * factor * material.evacuationFactor;
    }
    if (inc <= 0) {
      warnings.push('Peck increment computed as zero — check evacuationFactor.');
      break;
    }
    const next = Math.min(effDepth, cur + inc);
    peckSteps.push({
      index: stepIdx++,
      depthAtStartMm: cur,
      depthAtEndMm: next,
      peckIncrementMm: next - cur,
      fullRetract: scheme !== 'chip-break',
    });
    cur = next;
  }

  // Time estimate: feed time + retract overhead.
  const totalFeedDist = peckSteps.reduce((s, p) => s + p.peckIncrementMm, 0);
  const feedTimeMin = totalFeedDist / Math.max(0.001, opts.feedMmMin);
  const retractOverheadSec = peckSteps.reduce((s, p) => {
    if (!p.fullRetract) return s + 0.2; // chip-break ≈ 200 ms
    // Full retract: 2× clearance + depth at rapid feed (assume 5 m/min rapid).
    const dist = p.depthAtEndMm + opts.fullRetractClearanceMm;
    return s + (dist / 5000) * 60;
  }, 0);
  const time = feedTimeMin * 60 + retractOverheadSec;

  if (lD > 12 && drill.pilotDiameterMm <= 0) {
    warnings.push(`L/D ${lD.toFixed(1)} > 12 with no pilot — drill flex risk.`);
  }
  if (peckSteps.length > 50) {
    warnings.push(`Schedule has ${peckSteps.length} pecks — review evacuationFactor.`);
  }

  return {
    scheme,
    peckSteps,
    lengthDiameterRatio: lD,
    estimatedTimeSec: time,
    warnings,
  };
}

// ── G-code emission ───────────────────────────────────────────

export function emitGcode(schedule: DrillSchedule, retractPlaneZ: number, finalZ: number, feed: number): string[] {
  const lines: string[] = [];
  if (schedule.peckSteps.length === 0) return lines;
  if (schedule.scheme === 'chip-break') {
    lines.push(`G73 Z${finalZ.toFixed(3)} R${retractPlaneZ.toFixed(3)} Q${schedule.peckSteps[0]!.peckIncrementMm.toFixed(3)} F${feed.toFixed(1)}`);
  } else {
    lines.push(`G83 Z${finalZ.toFixed(3)} R${retractPlaneZ.toFixed(3)} Q${schedule.peckSteps[0]!.peckIncrementMm.toFixed(3)} F${feed.toFixed(1)}`);
  }
  lines.push('G80');
  return lines;
}

// ── Summary ────────────────────────────────────────────────────

export interface ScheduleSummary {
  scheme: PeckScheme;
  peckCount: number;
  lengthDiameterRatio: number;
  estimatedTimeSec: number;
  warningCount: number;
}

export function summarize(schedule: DrillSchedule): ScheduleSummary {
  return {
    scheme: schedule.scheme,
    peckCount: schedule.peckSteps.length,
    lengthDiameterRatio: schedule.lengthDiameterRatio,
    estimatedTimeSec: schedule.estimatedTimeSec,
    warningCount: schedule.warnings.length,
  };
}
