/**
 * millTurnToolpath.ts — Mill-turn (lathe + live mill) toolpath.
 *
 * Mill-turn centers combine a turning spindle (workpiece rotates) +
 * driven milling tools (C-axis indexing + X/Y/Z motion). Common for
 * shafts with cross-drilled holes, hex flats, slots, knurls — parts
 * that would otherwise need separate lathe + mill setups.
 *
 * Stage 1 CAM has separate `pocketStrategy` (mill) and turning
 * primitives (`drillingCycle` etc). This module orchestrates the
 * combined sequence:
 *
 *   - **Turning passes** — roughing (radial step), finishing (single
 *     pass along profile), grooving (plunge + side cuts), threading
 *     (multi-pass V-thread synchronized to spindle rotation).
 *   - **Live tool ops** — C-axis indexing for cross holes, flats,
 *     keyways. The lathe spindle locks via C-axis brake while the
 *     driven tool cuts.
 *   - **Synchronized sub-spindle pickoff** — when the part transfers
 *     from main to sub-spindle for back-side machining.
 *
 * Output is an ordered op list with phase ('turn' vs 'mill') so the
 * post-processor can emit the right machine state (G98/G99, M19, etc).
 */

export type TurnOp = 'rough-turn' | 'finish-turn' | 'face' | 'groove' | 'thread' | 'cutoff';
export type LiveMillOp = 'cross-drill' | 'cross-tap' | 'flat-mill' | 'keyway-mill' | 'slot-mill' | 'engrave';
export type MillTurnPhase = 'turn' | 'mill' | 'transfer';

export interface TurnPass {
  kind: TurnOp;
  /** Spindle speed (rpm). */
  spindleRpm: number;
  /** Feed (mm/rev for turning). */
  feedMmPerRev: number;
  /** Depth of cut per pass (mm radial). */
  depthOfCutMm: number;
  /** Start + end Z along the axis (mm). */
  startZ: number;
  endZ: number;
  /** Final radius (mm). */
  finalRadiusMm: number;
}

export interface LiveMillPass {
  kind: LiveMillOp;
  /** C-axis angle (deg, 0..360). */
  cAngleDeg: number;
  /** Spindle speed (rpm). */
  driveSpindleRpm: number;
  /** Feed (mm/min). */
  feedMmPerMin: number;
  /** Tool diameter (mm). */
  toolDiameterMm: number;
  /** Plunge depth (mm). */
  depthMm: number;
  /** Per-pass entry point (XY plane, mm). */
  entryPoint: [number, number];
}

export interface TransferOp {
  /** Main spindle releases, sub-spindle clamps + draws back. */
  drawbackMm: number;
  /** Spindle phase sync required? (true for threaded transfers). */
  phaseSync: boolean;
}

export type MillTurnStep =
  | { phase: 'turn'; op: TurnPass }
  | { phase: 'mill'; op: LiveMillPass }
  | { phase: 'transfer'; op: TransferOp };

export interface MillTurnProgram {
  steps: MillTurnStep[];
  /** Estimated total cycle time (sec). */
  totalCycleTimeSec: number;
  /** Phase change count — every change incurs ~3 sec overhead. */
  phaseTransitions: number;
}

// ── Cycle-time estimation ─────────────────────────────────────────

function turnPassTime(pass: TurnPass): number {
  const passLen = Math.abs(pass.endZ - pass.startZ);
  const feedMmPerMin = pass.feedMmPerRev * pass.spindleRpm;
  return (passLen / feedMmPerMin) * 60;
}

function liveMillTime(pass: LiveMillPass): number {
  // Approximate: plunge time + dwell.
  return (pass.depthMm / pass.feedMmPerMin) * 60 + 1;
}

function transferTime(t: TransferOp): number {
  return t.phaseSync ? 6 : 3;
}

const PHASE_TRANSITION_OVERHEAD_SEC = 3;

export function buildMillTurnProgram(steps: MillTurnStep[]): MillTurnProgram {
  let total = 0;
  let prevPhase: MillTurnPhase | null = null;
  let transitions = 0;
  for (const s of steps) {
    if (prevPhase != null && prevPhase !== s.phase) {
      total += PHASE_TRANSITION_OVERHEAD_SEC;
      transitions++;
    }
    if (s.phase === 'turn') total += turnPassTime(s.op);
    else if (s.phase === 'mill') total += liveMillTime(s.op);
    else total += transferTime(s.op);
    prevPhase = s.phase;
  }
  return { steps, totalCycleTimeSec: total, phaseTransitions: transitions };
}

// ── Thread cycle (G76 equivalent) ────────────────────────────────

export interface ThreadCycle {
  /** Thread pitch (mm). */
  pitchMm: number;
  /** Spindle speed (rpm). Limited so feed = pitch × rpm doesn't exceed machine. */
  spindleRpm: number;
  /** Major (outside) diameter (mm). */
  majorDiameterMm: number;
  /** Minor (root) diameter (mm). */
  minorDiameterMm: number;
  /** Start Z, end Z (mm). */
  startZ: number;
  endZ: number;
  /** Thread angle (deg, typ. 60° metric, 55° BSW). */
  threadAngleDeg: number;
  /** Pass count. Standard 5-9 for finer threads. */
  passCount: number;
}

/** Build thread cycle passes — depth decreases with √(pass index) for
 *  constant chip area per pass (the constant-load convention). */
export function buildThreadPasses(cycle: ThreadCycle): Array<{ radiusMm: number; depthMm: number }> {
  const totalDepth = (cycle.majorDiameterMm - cycle.minorDiameterMm) / 2;
  const passes: Array<{ radiusMm: number; depthMm: number }> = [];
  let prevRadius = cycle.majorDiameterMm / 2;
  for (let i = 1; i <= cycle.passCount; i++) {
    const fraction = Math.sqrt(i / cycle.passCount);
    const newRadius = cycle.majorDiameterMm / 2 - totalDepth * fraction;
    passes.push({ radiusMm: newRadius, depthMm: prevRadius - newRadius });
    prevRadius = newRadius;
  }
  return passes;
}

// ── Rough turning: depth-of-cut sequence ─────────────────────────

/** Plan rough-turning passes from a stock radius to a final radius. */
export interface RoughTurnPlan {
  passes: Array<{ startRadiusMm: number; endRadiusMm: number; depthMm: number }>;
  /** Total radial removal. */
  totalRadialMm: number;
}

export function planRoughTurning(
  stockRadiusMm: number,
  finalRadiusMm: number,
  maxDocMm: number,
): RoughTurnPlan {
  const passes: RoughTurnPlan['passes'] = [];
  let r = stockRadiusMm;
  while (r > finalRadiusMm + 0.5) {
    const next = Math.max(finalRadiusMm + 0.5, r - maxDocMm);
    passes.push({ startRadiusMm: r, endRadiusMm: next, depthMm: r - next });
    r = next;
  }
  // Final finishing pass (last 0.5mm).
  passes.push({ startRadiusMm: r, endRadiusMm: finalRadiusMm, depthMm: r - finalRadiusMm });
  return { passes, totalRadialMm: stockRadiusMm - finalRadiusMm };
}

// ── C-axis indexing for cross features ───────────────────────────

/** Plan a circular pattern of cross-holes via C-axis indexing.
 *  Returns the LiveMillPass list. */
export function planCrossHolePattern(
  holeCount: number,
  driveSpindleRpm: number,
  feedMmPerMin: number,
  toolDiameterMm: number,
  depthMm: number,
  radiusMm: number,
  startAngleDeg: number = 0,
): LiveMillPass[] {
  const out: LiveMillPass[] = [];
  for (let i = 0; i < holeCount; i++) {
    const angle = (startAngleDeg + (360 / holeCount) * i) % 360;
    const rad = angle * Math.PI / 180;
    out.push({
      kind: 'cross-drill',
      cAngleDeg: angle,
      driveSpindleRpm,
      feedMmPerMin,
      toolDiameterMm,
      depthMm,
      entryPoint: [radiusMm * Math.cos(rad), radiusMm * Math.sin(rad)],
    });
  }
  return out;
}

// ── Sub-spindle pickoff ──────────────────────────────────────────

export interface SubSpindlePickoff {
  /** Length transferred to sub-spindle (mm). */
  transferLengthMm: number;
  /** Phase-sync required (for threaded surfaces). */
  phaseSync: boolean;
  /** Cut-off + back-machining op list. */
  backOps: MillTurnStep[];
}

export function buildPickoffSequence(p: SubSpindlePickoff): MillTurnStep[] {
  return [
    { phase: 'transfer', op: { drawbackMm: p.transferLengthMm, phaseSync: p.phaseSync } },
    ...p.backOps,
  ];
}
