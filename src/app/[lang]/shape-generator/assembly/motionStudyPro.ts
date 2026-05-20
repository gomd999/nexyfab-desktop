/**
 * motionStudyPro.ts — Event-based motion + cam follower simulation.
 *
 * Stage 1 motion (`motionStudy.ts`) supports keyframe interpolation.
 * SolidWorks Motion Pro adds:
 *
 *   - **Event-based motion** — actions triggered by sensors (position
 *     reaches X, time reaches T, contact made). Each event has a
 *     follow-on action: change velocity, stop motor, fire actuator.
 *
 *   - **Cam follower simulation** — given a cam profile (radius vs
 *     angle curve) + a follower geometry (knife-edge, flat-face,
 *     roller, oscillating), compute the follower position over time
 *     as the cam rotates.
 *
 *   - **Servo motor profile** — trapezoidal velocity profile (accel
 *     ramp / cruise / decel ramp), S-curve smoothing.
 *
 *   - **Contact rigidity tuning** — penalty stiffness + damping
 *     coefficients for penetration response.
 *
 *   - **Trace path** — record the trajectory of a point over the
 *     simulation, returning the polyline.
 */

// ── Event-based motion ───────────────────────────────────────────

export type SensorKind = 'time' | 'position' | 'velocity' | 'contact';

export interface MotionSensor {
  id: string;
  kind: SensorKind;
  /** For position/velocity sensors, the entity being watched. */
  targetEntityId?: string;
  /** Trigger threshold (mm or m/s or sec). */
  threshold: number;
  /** Comparison: ≥ (default) or ≤. */
  comparison?: '≥' | '≤';
}

export type MotionActionKind = 'start-motor' | 'stop-motor' | 'set-velocity' | 'reverse' | 'pause';

export interface MotionAction {
  id: string;
  kind: MotionActionKind;
  targetMotorId: string;
  /** Numeric parameter (e.g. velocity in mm/s or rev/min). */
  value?: number;
}

export interface MotionEvent {
  id: string;
  /** Sensor that triggers this event. */
  sensorId: string;
  /** Action to take when triggered. */
  actionId: string;
  /** Has this event already fired in the current run? */
  fired?: boolean;
}

export interface MotionState {
  time: number;
  /** Per-entity positions. */
  positions: Record<string, number>;
  /** Per-entity velocities. */
  velocities: Record<string, number>;
  /** Per-motor on/off + velocity. */
  motors: Record<string, { running: boolean; velocity: number }>;
  /** Active contacts. */
  contacts: Set<string>;
}

export interface EventSimResult {
  steps: Array<{ time: number; firedEventIds: string[] }>;
  finalState: MotionState;
}

/** Check whether a sensor triggers given the current state. */
export function sensorTriggered(sensor: MotionSensor, state: MotionState): boolean {
  const cmp = sensor.comparison ?? '≥';
  let value: number;
  switch (sensor.kind) {
    case 'time':
      value = state.time;
      break;
    case 'position':
      value = state.positions[sensor.targetEntityId!] ?? 0;
      break;
    case 'velocity':
      value = state.velocities[sensor.targetEntityId!] ?? 0;
      break;
    case 'contact':
      return state.contacts.has(sensor.targetEntityId!);
  }
  return cmp === '≥' ? value >= sensor.threshold : value <= sensor.threshold;
}

export function applyAction(state: MotionState, action: MotionAction): void {
  const motor = state.motors[action.targetMotorId] ?? { running: false, velocity: 0 };
  switch (action.kind) {
    case 'start-motor':
      motor.running = true;
      if (action.value != null) motor.velocity = action.value;
      break;
    case 'stop-motor':
      motor.running = false;
      motor.velocity = 0;
      break;
    case 'set-velocity':
      motor.velocity = action.value ?? motor.velocity;
      break;
    case 'reverse':
      motor.velocity = -motor.velocity;
      break;
    case 'pause':
      motor.running = false;
      break;
  }
  state.motors[action.targetMotorId] = motor;
}

/** Run the simulation forward. Caller advances state physics; we
 *  only manage the event firing logic. */
export function stepEventSimulation(
  state: MotionState,
  sensors: MotionSensor[],
  actions: MotionAction[],
  events: MotionEvent[],
): { firedEventIds: string[] } {
  const fired: string[] = [];
  const sensorById = new Map(sensors.map(s => [s.id, s]));
  const actionById = new Map(actions.map(a => [a.id, a]));
  for (const ev of events) {
    if (ev.fired) continue;
    const sensor = sensorById.get(ev.sensorId);
    const action = actionById.get(ev.actionId);
    if (!sensor || !action) continue;
    if (sensorTriggered(sensor, state)) {
      applyAction(state, action);
      ev.fired = true;
      fired.push(ev.id);
    }
  }
  return { firedEventIds: fired };
}

// ── Cam follower simulation ──────────────────────────────────────

export type FollowerType = 'knife' | 'roller' | 'flat' | 'oscillating';

export interface CamProfile {
  /** Cam radius vs cam angle (degrees). 360 entries for full turn. */
  radii: number[];
}

/** Compute follower displacement vs cam angle. */
export function camFollowerProfile(
  cam: CamProfile,
  follower: FollowerType,
  rollerRadius: number = 5,
): number[] {
  const n = cam.radii.length;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = cam.radii[i]!;
    switch (follower) {
      case 'knife':
        out[i] = r;
        break;
      case 'roller': {
        // Follower center is at radius + rollerRadius offset along the
        // local cam-surface normal. Approx as r + rollerRadius for
        // smooth cams.
        out[i] = r + rollerRadius;
        break;
      }
      case 'flat': {
        // Flat follower averages cam height across its width — peaks
        // are smoothed. Use 5-pt moving average.
        let sum = 0;
        for (let k = -2; k <= 2; k++) {
          const idx = (i + k + n) % n;
          sum += cam.radii[idx]!;
        }
        out[i] = sum / 5;
        break;
      }
      case 'oscillating':
        // Same as knife for the radial component; rotation handled by
        // caller.
        out[i] = r;
        break;
    }
  }
  return out;
}

/** Maximum follower acceleration over the cam cycle. Used for
 *  dynamic-load + spring-sizing calculations. */
export function maxFollowerAcceleration(
  displacement: number[],
  rpm: number,
): number {
  const n = displacement.length;
  // d²x/dt² ≈ (x_{i+1} - 2·x_i + x_{i-1}) / dt²
  // dt per angle step = (60 / rpm) / n.
  const dt = (60 / rpm) / n;
  let maxAccel = 0;
  for (let i = 1; i < n - 1; i++) {
    const a = (displacement[i + 1]! - 2 * displacement[i]! + displacement[i - 1]!) / (dt * dt);
    if (Math.abs(a) > maxAccel) maxAccel = Math.abs(a);
  }
  return maxAccel;
}

// ── Servo motor profile ──────────────────────────────────────────

export interface ServoProfile {
  /** Total distance to travel (mm). */
  distanceMm: number;
  /** Peak velocity (mm/s). */
  maxVelocityMmS: number;
  /** Acceleration (mm/s²). */
  accelerationMmS2: number;
  /** S-curve jerk (mm/s³). Set 0 to use trapezoidal. */
  jerkMmS3?: number;
}

export interface ProfileSample {
  t: number;
  position: number;
  velocity: number;
  acceleration: number;
}

/** Trapezoidal velocity profile: accelerate → cruise → decelerate. */
export function trapezoidalProfile(p: ServoProfile, sampleCount: number = 100): ProfileSample[] {
  const accelTime = p.maxVelocityMmS / p.accelerationMmS2;
  const accelDist = 0.5 * p.accelerationMmS2 * accelTime * accelTime;
  let cruiseTime = 0;
  let actualPeakV = p.maxVelocityMmS;
  if (2 * accelDist >= p.distanceMm) {
    // Triangular profile (never reaches max V).
    actualPeakV = Math.sqrt(p.distanceMm * p.accelerationMmS2);
  } else {
    cruiseTime = (p.distanceMm - 2 * accelDist) / p.maxVelocityMmS;
  }
  const accelTimeReal = actualPeakV / p.accelerationMmS2;
  const totalTime = accelTimeReal * 2 + cruiseTime;

  const samples: ProfileSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = (i / (sampleCount - 1)) * totalTime;
    let pos: number, vel: number, acc: number;
    if (t < accelTimeReal) {
      acc = p.accelerationMmS2;
      vel = acc * t;
      pos = 0.5 * acc * t * t;
    } else if (t < accelTimeReal + cruiseTime) {
      acc = 0;
      vel = actualPeakV;
      pos = accelDist + actualPeakV * (t - accelTimeReal);
    } else {
      const tDec = t - (accelTimeReal + cruiseTime);
      acc = -p.accelerationMmS2;
      vel = actualPeakV - p.accelerationMmS2 * tDec;
      pos = accelDist + actualPeakV * cruiseTime + actualPeakV * tDec - 0.5 * p.accelerationMmS2 * tDec * tDec;
    }
    samples.push({ t, position: pos, velocity: vel, acceleration: acc });
  }
  return samples;
}

// ── Contact rigidity ─────────────────────────────────────────────

export interface ContactPair {
  bodyAId: string;
  bodyBId: string;
  /** Penalty stiffness (N/mm). */
  stiffnessKn: number;
  /** Damping coefficient (N·s/mm). */
  dampingC: number;
  /** Coefficient of friction. */
  friction: number;
}

/** Compute the normal contact force based on penetration depth +
 *  approach velocity. */
export function contactForce(
  penetrationMm: number,
  approachVelocityMmS: number,
  pair: ContactPair,
): number {
  if (penetrationMm <= 0) return 0;
  // Hunt-Crossley nonlinear contact: F = k·δ^n + c·δ^n·δ̇
  // For preview, use simple linear penalty.
  return pair.stiffnessKn * penetrationMm + pair.dampingC * approachVelocityMmS;
}

// ── Trace path ───────────────────────────────────────────────────

export interface TracedPath {
  entityId: string;
  points: Array<{ t: number; x: number; y: number; z: number }>;
  /** Total path length (mm). */
  totalLengthMm: number;
}

export function recordPath(trace: TracedPath, t: number, x: number, y: number, z: number): void {
  if (trace.points.length > 0) {
    const last = trace.points[trace.points.length - 1]!;
    trace.totalLengthMm += Math.hypot(x - last.x, y - last.y, z - last.z);
  }
  trace.points.push({ t, x, y, z });
}
