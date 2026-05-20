/**
 * turningToolpath.ts — Generate ID/OD turning toolpath for a lathe
 * or turn-mill operation.
 *
 * Inputs:
 *   - Profile: 2D polyline (Z, X) representing the part profile
 *     in axial cross-section.
 *   - Stock dimensions.
 *   - Cutting parameters (feed, depth of cut, finish allowance).
 *
 * Outputs:
 *   - Roughing passes (constant DOC).
 *   - Finish pass (one continuous pass along the profile).
 *   - Estimated cycle time and chip volume.
 */

export interface TurnPoint {
  /** Axial position (Z, mm). */
  z: number;
  /** Radial position (X = diameter / 2, mm). */
  x: number;
}

export type TurnSide = 'OD' | 'ID';

export interface TurningOptions {
  /** Stock OD or ID radius (mm). */
  stockRadiusMm: number;
  /** Axial DOC per roughing pass (mm). */
  axialDocMm: number;
  /** Radial DOC per roughing pass (mm). */
  radialDocMm: number;
  /** Finish allowance left on profile (mm). */
  finishAllowanceMm: number;
  /** Roughing feed (mm/rev). */
  roughFeedMmRev: number;
  /** Finish feed (mm/rev). */
  finishFeedMmRev: number;
  /** Spindle RPM. */
  spindleRpm: number;
  side: TurnSide;
}

export const DEFAULT_OPTIONS: TurningOptions = {
  stockRadiusMm: 25,
  axialDocMm: 2,
  radialDocMm: 1,
  finishAllowanceMm: 0.3,
  roughFeedMmRev: 0.2,
  finishFeedMmRev: 0.08,
  spindleRpm: 2000,
  side: 'OD',
};

export interface TurnPass {
  kind: 'rough' | 'finish';
  points: TurnPoint[];
  feedMmRev: number;
}

export interface TurningResult {
  passes: TurnPass[];
  totalLengthMm: number;
  estimatedTimeSec: number;
  removedVolumeMm3: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateTurning(profile: TurnPoint[], options: Partial<TurningOptions> = {}): TurningResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  if (profile.length < 2) {
    warnings.push('Profile needs ≥ 2 points.');
    return { passes: [], totalLengthMm: 0, estimatedTimeSec: 0, removedVolumeMm3: 0, warnings };
  }

  // Find profile X range.
  let minX = Infinity, maxX = -Infinity;
  for (const p of profile) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }

  const passes: TurnPass[] = [];
  if (opts.side === 'OD') {
    // Rough from stock OD inward.
    let currentR = opts.stockRadiusMm;
    while (currentR > maxX + opts.finishAllowanceMm) {
      currentR -= opts.radialDocMm;
      if (currentR < maxX + opts.finishAllowanceMm) currentR = maxX + opts.finishAllowanceMm;
      const passPoints = profile.map(p => ({ z: p.z, x: Math.max(currentR, p.x) }));
      passes.push({ kind: 'rough', points: passPoints, feedMmRev: opts.roughFeedMmRev });
      if (currentR <= maxX + opts.finishAllowanceMm) break;
    }
  } else {
    // ID: rough from stock ID outward.
    let currentR = opts.stockRadiusMm;
    while (currentR < minX - opts.finishAllowanceMm) {
      currentR += opts.radialDocMm;
      if (currentR > minX - opts.finishAllowanceMm) currentR = minX - opts.finishAllowanceMm;
      const passPoints = profile.map(p => ({ z: p.z, x: Math.min(currentR, p.x) }));
      passes.push({ kind: 'rough', points: passPoints, feedMmRev: opts.roughFeedMmRev });
      if (currentR >= minX - opts.finishAllowanceMm) break;
    }
  }

  // Final finish pass.
  passes.push({ kind: 'finish', points: profile.slice(), feedMmRev: opts.finishFeedMmRev });

  // Total length + time.
  let totalLength = 0;
  let totalTimeMin = 0;
  for (const pass of passes) {
    const len = passLength(pass.points);
    totalLength += len;
    const feedMmMin = pass.feedMmRev * opts.spindleRpm;
    totalTimeMin += len / Math.max(0.001, feedMmMin);
  }

  // Removed volume estimate: cross-section area × revolution circumference.
  const profileArea = approximateArea(profile, opts);
  const stockArea = stockCrossSection(opts);
  const removedArea = stockArea - profileArea;
  const meanCircumference = 2 * Math.PI * ((opts.stockRadiusMm + minX) / 2);
  const removedVolume = removedArea * meanCircumference;

  return {
    passes,
    totalLengthMm: totalLength,
    estimatedTimeSec: totalTimeMin * 60,
    removedVolumeMm3: removedVolume,
    warnings,
  };
}

function passLength(points: TurnPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.z - a.z, b.x - a.x);
  }
  return total;
}

function approximateArea(profile: TurnPoint[], opts: TurningOptions): number {
  let area = 0;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    area += (a.x + b.x) / 2 * Math.abs(b.z - a.z);
  }
  return area + 0 * opts.stockRadiusMm;
}

function stockCrossSection(opts: TurningOptions): number {
  // Area of stock cross-section above axis (or below for ID).
  return opts.stockRadiusMm * 100; // Simplified: assume profile length ~100 mm
}

// ── Estimate per pass ────────────────────────────────────────

export function passStats(result: TurningResult): { passCount: number; roughCount: number; finishCount: number } {
  let rough = 0, finish = 0;
  for (const p of result.passes) {
    if (p.kind === 'rough') rough++;
    else finish++;
  }
  return { passCount: result.passes.length, roughCount: rough, finishCount: finish };
}

// ── G-code emit (Fanuc-style turning) ────────────────────────

export function emitGcode(result: TurningResult): string[] {
  const lines: string[] = [];
  for (const pass of result.passes) {
    lines.push(`(${pass.kind.toUpperCase()} PASS)`);
    for (let i = 0; i < pass.points.length; i++) {
      const p = pass.points[i]!;
      const cmd = i === 0 ? 'G0' : 'G1';
      const f = i === 0 ? '' : ` F${pass.feedMmRev.toFixed(3)}`;
      lines.push(`${cmd} Z${p.z.toFixed(3)} X${(p.x * 2).toFixed(3)}${f}`);
    }
  }
  return lines;
}

// ── Summary ────────────────────────────────────────────────────

export interface TurningSummary {
  passCount: number;
  estimatedTimeSec: number;
  removedVolumeMm3: number;
  warningCount: number;
}

export function summarize(result: TurningResult): TurningSummary {
  return {
    passCount: result.passes.length,
    estimatedTimeSec: result.estimatedTimeSec,
    removedVolumeMm3: result.removedVolumeMm3,
    warningCount: result.warnings.length,
  };
}
