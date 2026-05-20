/**
 * clearancePlaneCalculator.ts — Auto-determine CAM clearance plane heights.
 *
 * A CAM job has several Z heights:
 *
 *   - **Top of stock**: the top surface of the raw stock.
 *   - **Top of part**: the top surface of the finished part (where
 *     cutting begins).
 *   - **Feed plane / rapid retract**: where the tool moves at feed
 *     rate between cuts (just above top of stock).
 *   - **Clearance plane**: where the tool rapids at G0 between
 *     operations (well above any clamps / fixtures).
 *
 * Wrong choices waste time (clearance too high → wasted air moves)
 * or crash the spindle (clearance too low → hits a clamp). This
 * module computes safe, snappy defaults from:
 *
 *   - The part bbox along the tool axis.
 *   - Fixture heights (user-provided list).
 *   - A safety margin per category.
 *
 * Output: every Z height + warnings (e.g., "clearance plane below
 * highest clamp height").
 */

export interface FixtureBBox {
  /** Fixture id (e.g. "clamp-1"). */
  id: string;
  /** Top Z of the fixture (highest point along tool axis). */
  topZ: number;
}

export interface ClearanceInput {
  /** Part top Z (highest geometry). */
  partTopZ: number;
  /** Part bottom Z (lowest geometry). */
  partBottomZ: number;
  /** Stock top Z. */
  stockTopZ: number;
  /** Stock bottom Z. */
  stockBottomZ: number;
  /** Fixtures (clamps, vises) and their top Z. */
  fixtures: FixtureBBox[];
  /** Tool axis direction (default +Z = [0,0,1]). */
  toolAxisDirZ?: number;
}

export interface ClearanceOptions {
  /** Feed-plane offset above top of stock, mm. */
  feedPlaneMm: number;
  /** Clearance-plane offset above the worst obstruction, mm. */
  clearancePlaneMm: number;
  /** Top of cut offset below part top, mm (start cutting this far below). */
  cutStartOffsetMm: number;
  /** Bottom of cut offset above part bottom, mm (don't go below this). */
  cutEndOffsetMm: number;
}

export const DEFAULT_OPTIONS: ClearanceOptions = {
  feedPlaneMm: 2.0,
  clearancePlaneMm: 10.0,
  cutStartOffsetMm: 0.5,
  cutEndOffsetMm: 0.5,
};

export interface ClearanceResult {
  /** Z where rapid G0 between operations. */
  clearancePlaneZ: number;
  /** Z where the tool transitions from rapid to feed. */
  feedPlaneZ: number;
  /** Z where cutting begins (just below part top). */
  cutStartZ: number;
  /** Z where cutting must stop. */
  cutEndZ: number;
  /** Highest fixture (if any). */
  worstFixtureZ: number | null;
  /** Warnings (empty if all good). */
  warnings: string[];
  /** Stock allowance available for cutting depth. */
  cuttingDepthMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function computeClearance(input: ClearanceInput, options: Partial<ClearanceOptions> = {}): ClearanceResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dir = input.toolAxisDirZ ?? 1; // +1 means tool descends along +Z down to part

  const warnings: string[] = [];

  // Worst fixture Z is the highest among fixtures.
  let worstFixtureZ: number | null = null;
  for (const f of input.fixtures) {
    if (worstFixtureZ === null || f.topZ > worstFixtureZ) worstFixtureZ = f.topZ;
  }

  const feedPlaneZ = input.stockTopZ + opts.feedPlaneMm * dir;
  const obstructionZ = Math.max(input.stockTopZ, worstFixtureZ ?? -Infinity);
  const clearancePlaneZ = obstructionZ + opts.clearancePlaneMm * dir;
  const cutStartZ = input.partTopZ - opts.cutStartOffsetMm * dir;
  const cutEndZ = input.partBottomZ + opts.cutEndOffsetMm * dir;
  const cuttingDepth = Math.abs(cutStartZ - cutEndZ);

  // Validations.
  if (worstFixtureZ !== null && opts.clearancePlaneMm <= 5) {
    warnings.push(`fixture at Z=${worstFixtureZ.toFixed(2)} — clearance offset ${opts.clearancePlaneMm}mm may be too low.`);
  }
  if (feedPlaneZ <= input.partTopZ) {
    warnings.push('Feed plane is at/below part top — increase feed-plane offset.');
  }
  if (input.stockBottomZ > input.partBottomZ) {
    warnings.push('Stock bottom is above part bottom — stock too thin to machine.');
  }
  if (clearancePlaneZ <= feedPlaneZ) {
    warnings.push('Clearance plane not above feed plane.');
  }
  if (cutStartZ <= cutEndZ) {
    warnings.push('Cut start ≤ cut end; nothing to cut.');
  }

  return {
    clearancePlaneZ,
    feedPlaneZ,
    cutStartZ,
    cutEndZ,
    worstFixtureZ,
    warnings,
    cuttingDepthMm: cuttingDepth,
  };
}

// ── Tool length sanity check ──────────────────────────────────

export interface ToolLengthCheck {
  /** Tool length, mm. */
  toolLengthMm: number;
  /** Tool holder length (used after the cutting flutes), mm. */
  holderLengthMm: number;
}

export interface ToolReachResult {
  /** Z that the tool tip can reach. */
  tipReachableZ: number;
  /** Z that the tool holder shoulder reaches. */
  holderReachZ: number;
  /** Will the tool reach the deepest cut? */
  reachesAllCuts: boolean;
  /** Will the holder hit the stock when reaching the bottom? */
  holderCrashRisk: boolean;
}

export function checkToolReach(
  result: ClearanceResult,
  tool: ToolLengthCheck,
  spindleNoseZ: number,
): ToolReachResult {
  // Tip = spindle nose - tool length.
  const tipReachableZ = spindleNoseZ - tool.toolLengthMm;
  const holderReachZ = spindleNoseZ - tool.holderLengthMm;
  return {
    tipReachableZ,
    holderReachZ,
    reachesAllCuts: tipReachableZ <= result.cutEndZ,
    holderCrashRisk: holderReachZ <= result.cutEndZ + 1, // 1mm allowance
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ClearanceSummary {
  cuttingDepthMm: number;
  totalAirSpaceMm: number;
  warningCount: number;
  hasFixtureWarning: boolean;
}

export function summarize(result: ClearanceResult): ClearanceSummary {
  const air = result.clearancePlaneZ - result.feedPlaneZ;
  const hasFixture = result.warnings.some(w => w.includes('fixture'));
  return {
    cuttingDepthMm: result.cuttingDepthMm,
    totalAirSpaceMm: air,
    warningCount: result.warnings.length,
    hasFixtureWarning: hasFixture,
  };
}
