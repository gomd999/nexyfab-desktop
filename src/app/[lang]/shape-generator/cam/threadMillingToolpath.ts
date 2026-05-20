/**
 * threadMillingToolpath.ts — Generate a thread-milling toolpath for
 * internal or external threads using a single-point or multi-tooth
 * thread mill.
 *
 * Thread milling: tool circles around a hole while descending one
 * pitch per full revolution. Same tool can make multiple thread
 * sizes (unlike tapping). Works for both internal and external
 * threads.
 *
 * Toolpath shape:
 *
 *   - Approach: tangential arc into the thread radius.
 *   - Helical thread: one or more full revolutions matching pitch.
 *   - Retract: tangential arc back out.
 *
 * Module computes:
 *   - Thread mill radius = (thread_pitch_diameter - tool_diameter) / 2.
 *   - Multiple passes (rough + finish) based on minor/major diameter.
 *   - Approach/retract arc geometry.
 *   - Total path length and time.
 */

export type ThreadHand = 'right-hand' | 'left-hand';
export type ThreadDirection = 'internal' | 'external';

export interface ThreadSpec {
  /** Nominal diameter (e.g., 12 for M12). */
  nominalDiameterMm: number;
  /** Thread pitch (mm). */
  pitchMm: number;
  /** Length of thread engagement (mm). */
  lengthMm: number;
  direction: ThreadDirection;
  hand: ThreadHand;
}

export interface ThreadMillTool {
  /** Effective cutting diameter of the thread mill. */
  diameterMm: number;
  /** Number of cutting flutes / teeth. */
  flutes: number;
  /** Whether the tool is multi-tooth (cuts entire length per rev). */
  multiTooth: boolean;
}

export interface MillingOptions {
  /** Total stock removed in radial direction (rough + finish). */
  passes: number;
  /** Climb vs conventional. */
  climb: boolean;
  /** Feed rate (mm/min). */
  feedMmMin: number;
  /** Approach arc angle (deg). */
  approachAngleDeg: number;
}

export const DEFAULT_OPTIONS: MillingOptions = {
  passes: 2,
  climb: true,
  feedMmMin: 200,
  approachAngleDeg: 90,
};

export interface PathPoint {
  x: number;
  y: number;
  z: number;
  /** 'rapid' | 'feed' (linear) | 'arc-cw' | 'arc-ccw'. */
  motion: 'rapid' | 'feed' | 'arc-cw' | 'arc-ccw';
}

export interface ToolpathResult {
  threadRadiusMm: number;
  revolutions: number;
  passes: number;
  pathPoints: PathPoint[];
  totalLengthMm: number;
  estimatedTimeSec: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateThreadMillPath(
  thread: ThreadSpec,
  tool: ThreadMillTool,
  startZ: number,
  options: Partial<MillingOptions> = {},
): ToolpathResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  // For internal: tool inside hole. radius = (D_pitch - tool) / 2.
  // For external: tool outside boss. radius = (D_pitch + tool) / 2.
  const pitchDia = thread.nominalDiameterMm - 0.6495 * thread.pitchMm; // ISO 68-1 pitch diameter
  let radius: number;
  if (thread.direction === 'internal') {
    radius = (pitchDia - tool.diameterMm) / 2;
    if (radius <= 0) {
      warnings.push(`Tool ${tool.diameterMm} too large for internal Ø${pitchDia.toFixed(2)} thread.`);
      return { threadRadiusMm: 0, revolutions: 0, passes: 0, pathPoints: [], totalLengthMm: 0, estimatedTimeSec: 0, warnings };
    }
  } else {
    radius = (pitchDia + tool.diameterMm) / 2;
  }

  // Revolutions = length / pitch (when multi-tooth, just one helical pass per length).
  const revolutions = tool.multiTooth
    ? Math.max(1, Math.ceil(thread.lengthMm / (thread.pitchMm * tool.flutes)))
    : thread.lengthMm / thread.pitchMm;

  // Approach + helical + retract — multi pass.
  const points: PathPoint[] = [];
  let totalLen = 0;
  for (let p = 0; p < opts.passes; p++) {
    // Approach: enter tangentially.
    const approachStartZ = startZ + thread.pitchMm * 0.25;
    points.push({ x: 0, y: 0, z: approachStartZ, motion: 'rapid' });
    points.push({ x: radius, y: 0, z: approachStartZ, motion: 'feed' });
    totalLen += radius;

    // Helical: revolutions full turns descending by pitch per revolution.
    const helicalLength = thread.lengthMm;
    const circumPerRev = 2 * Math.PI * radius;
    const slantPerRev = Math.hypot(circumPerRev, thread.pitchMm);
    const segments = Math.max(16, Math.ceil(revolutions * 16));
    const motion = opts.climb === (thread.direction === 'internal' && thread.hand === 'right-hand') ? 'arc-ccw' : 'arc-cw';
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const angle = t * revolutions * 2 * Math.PI * (thread.hand === 'right-hand' ? 1 : -1);
      const z = approachStartZ - t * helicalLength;
      points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), z, motion });
    }
    totalLen += revolutions * slantPerRev;

    // Retract: tangential exit.
    points.push({ x: 0, y: 0, z: approachStartZ - helicalLength, motion: 'feed' });
    totalLen += radius;
  }

  const timeSec = (totalLen / Math.max(0.001, opts.feedMmMin)) * 60;

  if (revolutions > 50) warnings.push(`High revolution count (${revolutions.toFixed(0)}); long thread — consider tapping.`);
  if (opts.passes > 4) warnings.push(`Many passes (${opts.passes}); consider single-pass finish only.`);
  if (tool.flutes < 2) warnings.push('Single-flute thread mill — slow material removal.');

  return {
    threadRadiusMm: radius,
    revolutions,
    passes: opts.passes,
    pathPoints: points,
    totalLengthMm: totalLen,
    estimatedTimeSec: timeSec,
    warnings,
  };
}

// ── Helper: pitch diameter for common metric threads ──────────

export function pitchDiameter(nominalMm: number, pitchMm: number): number {
  return nominalMm - 0.6495 * pitchMm;
}

// ── Minor diameter for internal thread ────────────────────────

export function minorDiameter(nominalMm: number, pitchMm: number): number {
  return nominalMm - 1.2269 * pitchMm;
}

// ── Summary ────────────────────────────────────────────────────

export interface ToolpathSummary {
  threadRadiusMm: number;
  revolutions: number;
  pathPointCount: number;
  estimatedTimeSec: number;
  warningCount: number;
}

export function summarize(result: ToolpathResult): ToolpathSummary {
  return {
    threadRadiusMm: result.threadRadiusMm,
    revolutions: result.revolutions,
    pathPointCount: result.pathPoints.length,
    estimatedTimeSec: result.estimatedTimeSec,
    warningCount: result.warnings.length,
  };
}
