/**
 * jogToolChangeGenerator.ts — Generate safe rapid-jog motion between
 * tool-change positions.
 *
 * Tool change procedure:
 *
 *   1. Retract Z to clearance / home.
 *   2. Move XY to tool change position (often M19 spindle-orient).
 *   3. M06 tool change call.
 *   4. Move back to next-operation start (rapid in Z above clearance,
 *      then descend slowly to working depth).
 *
 * Module:
 *   - Accepts current XYZ + next-operation XYZ + machine home offsets.
 *   - Computes intermediate jog points satisfying clearance + collision
 *     avoidance.
 *   - Emits G0/G1 lines in Fanuc syntax.
 *   - Estimates time using machine rapid feed rates.
 */

export interface MachinePosition {
  x: number;
  y: number;
  z: number;
}

export interface MachineConfig {
  /** Z home / clearance position (machine coords). */
  zHomeMm: number;
  /** Tool change XY position (machine coords). */
  toolChangePosition: MachinePosition;
  /** Rapid feed (mm/min). */
  rapidMmMin: number;
  /** Working clearance above part top before plunge. */
  workClearanceMm: number;
}

export interface OperationContext {
  /** Position at end of previous operation. */
  startPosition: MachinePosition;
  /** Position at beginning of next operation. */
  nextOperationStart: MachinePosition;
  /** Tool number to change to. */
  newToolNumber: number;
}

export interface JogResult {
  /** Ordered waypoints (machine coords) visited during jog. */
  waypoints: MachinePosition[];
  /** Fanuc G-code lines. */
  gcode: string[];
  /** Estimated time in seconds. */
  estimatedTimeSec: number;
  /** Total motion path length in mm. */
  totalLengthMm: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateJog(machine: MachineConfig, op: OperationContext): JogResult {
  const warnings: string[] = [];
  const waypoints: MachinePosition[] = [];
  const gcode: string[] = [];

  // 1. Retract Z to home above current position.
  const retract1: MachinePosition = { x: op.startPosition.x, y: op.startPosition.y, z: machine.zHomeMm };
  waypoints.push(retract1);
  gcode.push(`G0 Z${machine.zHomeMm.toFixed(3)}`);

  // 2. Move XY to tool change.
  const tcPos: MachinePosition = { x: machine.toolChangePosition.x, y: machine.toolChangePosition.y, z: machine.zHomeMm };
  waypoints.push(tcPos);
  gcode.push(`G0 X${machine.toolChangePosition.x.toFixed(3)} Y${machine.toolChangePosition.y.toFixed(3)}`);

  // 3. Tool change call.
  gcode.push(`M19`);
  gcode.push(`T${op.newToolNumber} M06`);
  if (op.newToolNumber <= 0) warnings.push('Tool number ≤ 0; suspicious tool change call.');

  // 4. Move to next operation XY at clearance plane.
  const above: MachinePosition = { x: op.nextOperationStart.x, y: op.nextOperationStart.y, z: machine.zHomeMm };
  waypoints.push(above);
  gcode.push(`G0 X${op.nextOperationStart.x.toFixed(3)} Y${op.nextOperationStart.y.toFixed(3)}`);

  // 5. Plunge Z to working clearance.
  const workZ = op.nextOperationStart.z + machine.workClearanceMm;
  const atClearance: MachinePosition = { x: op.nextOperationStart.x, y: op.nextOperationStart.y, z: workZ };
  waypoints.push(atClearance);
  gcode.push(`G0 Z${workZ.toFixed(3)}`);

  // 6. Slow feed to working depth.
  waypoints.push(op.nextOperationStart);
  gcode.push(`G1 Z${op.nextOperationStart.z.toFixed(3)} F500`);

  if (op.nextOperationStart.z >= machine.zHomeMm) {
    warnings.push('Next-operation Z ≥ Z-home; check work coordinate system.');
  }

  const totalLen = pathLength(waypoints);
  const time = (totalLen / Math.max(0.001, machine.rapidMmMin)) * 60;

  return { waypoints, gcode, estimatedTimeSec: time, totalLengthMm: totalLen, warnings };
}

function pathLength(points: MachinePosition[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i]!.x - points[i - 1]!.x,
      points[i]!.y - points[i - 1]!.y,
      points[i]!.z - points[i - 1]!.z,
    );
  }
  return total;
}

// ── Variant: hot-swap (no full home) for fast small jobs ──────

export function generateFastJog(machine: MachineConfig, op: OperationContext, retractDeltaMm: number = 10): JogResult {
  const warnings: string[] = [];
  const waypoints: MachinePosition[] = [];
  const gcode: string[] = [];
  const retractZ = op.startPosition.z + retractDeltaMm;
  if (retractZ > machine.zHomeMm) warnings.push('Fast retract above Z-home; not safer than full home.');

  waypoints.push({ x: op.startPosition.x, y: op.startPosition.y, z: retractZ });
  gcode.push(`G0 Z${retractZ.toFixed(3)}`);
  waypoints.push({ x: machine.toolChangePosition.x, y: machine.toolChangePosition.y, z: retractZ });
  gcode.push(`G0 X${machine.toolChangePosition.x.toFixed(3)} Y${machine.toolChangePosition.y.toFixed(3)}`);
  gcode.push(`T${op.newToolNumber} M06`);
  waypoints.push({ x: op.nextOperationStart.x, y: op.nextOperationStart.y, z: retractZ });
  gcode.push(`G0 X${op.nextOperationStart.x.toFixed(3)} Y${op.nextOperationStart.y.toFixed(3)}`);
  waypoints.push(op.nextOperationStart);
  gcode.push(`G1 Z${op.nextOperationStart.z.toFixed(3)} F500`);

  const total = pathLength(waypoints);
  return {
    waypoints,
    gcode,
    estimatedTimeSec: (total / Math.max(0.001, machine.rapidMmMin)) * 60,
    totalLengthMm: total,
    warnings,
  };
}

// ── Diagnostics ────────────────────────────────────────────────

export interface ChangeDiagnostic {
  totalPathMm: number;
  toolChangeCallCount: number;
  estimatedTimeSec: number;
}

export function diagnose(result: JogResult): ChangeDiagnostic {
  const tcCalls = result.gcode.filter(l => l.includes('M06')).length;
  return {
    totalPathMm: result.totalLengthMm,
    toolChangeCallCount: tcCalls,
    estimatedTimeSec: result.estimatedTimeSec,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface JogSummary {
  waypointCount: number;
  totalLengthMm: number;
  estimatedTimeSec: number;
  warningCount: number;
}

export function summarize(result: JogResult): JogSummary {
  return {
    waypointCount: result.waypoints.length,
    totalLengthMm: result.totalLengthMm,
    estimatedTimeSec: result.estimatedTimeSec,
    warningCount: result.warnings.length,
  };
}
