import type { RobotEngineeringSpec } from './robotEngineering';
import { solveRobotIk, type RobotTargetPose } from './robotIk';

export type RobotPathFrame = { timeS: number; anglesDeg: number[]; velocityDegS: number[]; accelerationDegS2: number[] };
export type RobotCollisionCheck = (anglesDeg: readonly number[]) => { collision: boolean; detail?: string };
export type RobotPathResult = {
  success: boolean; frames: RobotPathFrame[]; durationS: number;
  collisionVerified: boolean; collisionFree: boolean | null;
  reason?: 'invalid_path' | 'ik_failed' | 'joint_limit' | 'motion_limit' | 'collision';
  failedWaypoint?: number; errors: string[];
};

export function planCartesianRobotPath(
  spec: RobotEngineeringSpec,
  waypoints: readonly RobotTargetPose[],
  options: { samplePeriodS?: number; collisionCheck?: RobotCollisionCheck; seedDeg?: number[] } = {},
): RobotPathResult {
  if (waypoints.length < 2) return failure('invalid_path', 'At least two Cartesian waypoints are required.');
  const jointWaypoints: number[][] = [];
  let seed = options.seedDeg;
  for (let i = 0; i < waypoints.length; i += 1) {
    const solved = solveRobotIk(spec, waypoints[i]!, seed);
    if (!solved.success) return { ...failure('ik_failed', `Waypoint ${i} IK failed: ${solved.reason ?? 'unknown'}.`), failedWaypoint: i };
    jointWaypoints.push(solved.anglesDeg); seed = solved.anglesDeg;
  }
  return planJointRobotPath(spec, jointWaypoints, options);
}

export function planJointRobotPath(
  spec: RobotEngineeringSpec,
  waypoints: readonly (readonly number[])[],
  options: { samplePeriodS?: number; collisionCheck?: RobotCollisionCheck } = {},
): RobotPathResult {
  if (spec.joints.length !== 6 || waypoints.length < 2 || waypoints.some(p => p.length !== 6)) return failure('invalid_path', 'A six-axis path requires at least two six-value waypoints.');
  for (let p = 0; p < waypoints.length; p += 1) for (let j = 0; j < 6; j += 1) {
    const q = waypoints[p]![j]!, joint = spec.joints[j]!;
    if (!Number.isFinite(q) || q < joint.minDeg || q > joint.maxDeg) return { ...failure('joint_limit', `Waypoint ${p} J${j + 1} is outside its joint limit.`), failedWaypoint: p };
  }
  const dt = Math.max(0.005, options.samplePeriodS ?? 0.02);
  const segmentDurations = waypoints.slice(1).map((to, index) => durationForSegment(spec, waypoints[index]!, to));
  const frames: RobotPathFrame[] = [];
  let offset = 0;
  segmentDurations.forEach((duration, segment) => {
    const from = waypoints[segment]!, to = waypoints[segment + 1]!;
    const steps = Math.max(2, Math.ceil(duration / dt));
    for (let step = segment === 0 ? 0 : 1; step <= steps; step += 1) {
      const u = step / steps, s = u * u * u * (10 + u * (-15 + 6 * u));
      frames.push({ timeS: offset + u * duration, anglesDeg: from.map((q, j) => q + (to[j]! - q) * s), velocityDegS: Array(6).fill(0), accelerationDegS2: Array(6).fill(0) });
    }
    offset += duration;
  });
  differentiate(frames);
  const limitError = verifyMotionLimits(spec, frames);
  if (limitError) return { ...failure('motion_limit', limitError), frames, durationS: offset, collisionVerified: false, collisionFree: null };
  if (options.collisionCheck) for (let i = 0; i < frames.length; i += 1) {
    const hit = options.collisionCheck(frames[i]!.anglesDeg);
    if (hit.collision) return { success: false, frames, durationS: offset, collisionVerified: true, collisionFree: false, reason: 'collision', errors: [`Collision at frame ${i}${hit.detail ? `: ${hit.detail}` : '.'}`] };
  }
  return { success: true, frames, durationS: offset, collisionVerified: Boolean(options.collisionCheck), collisionFree: options.collisionCheck ? true : null, errors: options.collisionCheck ? [] : ['Collision verification was not supplied.'] };
}

function durationForSegment(spec: RobotEngineeringSpec, from: readonly number[], to: readonly number[]) {
  let duration = 0.05;
  for (let j = 0; j < 6; j += 1) {
    const distance = Math.abs(to[j]! - from[j]!); const joint = spec.joints[j]!;
    const v = joint.maxVelocityDegS ?? 90, a = joint.maxAccelerationDegS2 ?? 180, jerk = joint.maxJerkDegS3 ?? 720;
    duration = Math.max(duration, 1.9 * distance / v, Math.sqrt(6 * distance / a), Math.cbrt(60 * distance / jerk));
  }
  return duration;
}
function differentiate(frames: RobotPathFrame[]) {
  for (let i = 1; i < frames.length; i += 1) { const dt = frames[i]!.timeS - frames[i - 1]!.timeS; frames[i]!.velocityDegS = frames[i]!.anglesDeg.map((q,j)=>(q-frames[i-1]!.anglesDeg[j]!)/dt); }
  for (let i = 1; i < frames.length; i += 1) { const dt = frames[i]!.timeS - frames[i - 1]!.timeS; frames[i]!.accelerationDegS2 = frames[i]!.velocityDegS.map((v,j)=>(v-frames[i-1]!.velocityDegS[j]!)/dt); }
}
function verifyMotionLimits(spec: RobotEngineeringSpec, frames: RobotPathFrame[]) {
  for (let i=1;i<frames.length;i++) for(let j=0;j<6;j++) {
    const joint=spec.joints[j]!, v=Math.abs(frames[i]!.velocityDegS[j]!), a=Math.abs(frames[i]!.accelerationDegS2[j]!);
    const dt=frames[i]!.timeS-frames[i-1]!.timeS, jerk=Math.abs((frames[i]!.accelerationDegS2[j]!-frames[i-1]!.accelerationDegS2[j]!)/dt);
    if(v>(joint.maxVelocityDegS??90)*1.02 || a>(joint.maxAccelerationDegS2??180)*1.05 || jerk>(joint.maxJerkDegS3??720)*1.1) return `Motion limit exceeded at frame ${i}, J${j+1}.`;
  }
  return null;
}
function failure(reason: RobotPathResult['reason'], error: string): RobotPathResult { return { success:false, frames:[], durationS:0, collisionVerified:false, collisionFree:null, reason, errors:[error] }; }
