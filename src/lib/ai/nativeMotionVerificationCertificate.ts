import type { MotionStudyResult } from '@/lib/assembly/motionStudy';
import type { PreciseMotionIntervalEvidence } from '@/lib/assembly/featureTreePreciseInterference';
import type { CadNativeJointMotionPlan } from '@/lib/reference/cadNativeJointMotionPlan';

export type NativeMotionGateStatus = 'pass' | 'fail' | 'not_run';
export interface ClearanceRequirement { partA: string; partB: string; minimumMm: number; contactAllowed?: boolean; }
export interface NativeClearanceEvidence { partA: string; partB: string; minimumDistanceMm: number; method: 'native_triangle_distance'; artifactHashes: string[]; }
export interface NativeMotionVerificationInput {
  plan: CadNativeJointMotionPlan;
  studies: Record<string, MotionStudyResult>;
  preciseIntervals: Record<string, PreciseMotionIntervalEvidence[]>;
  clearanceRequirements: ClearanceRequirement[];
  clearanceEvidence: NativeClearanceEvidence[];
}
export interface NativeMotionGate { gate: 'planning' | 'solver' | 'precise_collision' | 'clearance'; status: NativeMotionGateStatus; codes: string[]; }
export interface NativeMotionVerificationCertificate { schema: 'nexyfab.native-motion-verification-certificate.v1'; status: NativeMotionGateStatus; releaseReady: boolean; gates: NativeMotionGate[]; verifiedJointIds: string[]; }

const SHA256 = /^[a-f0-9]{64}$/;
const pairKey = (a: string, b: string) => a < b ? `${a}::${b}` : `${b}::${a}`;
const gate = (name: NativeMotionGate['gate'], status: NativeMotionGateStatus, codes: string[] = []): NativeMotionGate => ({ gate: name, status, codes });

export function buildNativeMotionVerificationCertificate(input: NativeMotionVerificationInput): NativeMotionVerificationCertificate {
  const planning = input.plan.status === 'fail' ? gate('planning', 'fail', input.plan.errors) : input.plan.status !== 'pass' ? gate('planning', 'not_run', input.plan.unresolved.map(item => `${item.reason}:${item.jointId}`)) : gate('planning', 'pass');
  const solverCodes: string[] = [], collisionCodes: string[] = [];
  let solverMissing = false, collisionMissing = false;
  for (const item of input.plan.plans) {
    const study = input.studies[item.jointId];
    if (!study) { solverMissing = true; solverCodes.push(`MOTION_STUDY_MISSING:${item.jointId}`); }
    else if (!study.allConverged || study.firstFailureFrame >= 0 || study.frames.length !== item.request.steps + 1) solverCodes.push(`MOTION_SOLVER_FAILED:${item.jointId}`);
    const intervals = input.preciseIntervals[item.jointId];
    if (!intervals?.length) { collisionMissing = true; collisionCodes.push(`PRECISE_INTERVAL_EVIDENCE_MISSING:${item.jointId}`); continue; }
    if (intervals.some(interval => interval.status === 'confirmed_collision')) collisionCodes.push(`PRECISE_COLLISION_CONFIRMED:${item.jointId}`);
    if (intervals.some(interval => interval.status === 'unresolved' || interval.status === 'unavailable')) { collisionMissing = true; collisionCodes.push(`PRECISE_INTERVAL_UNRESOLVED:${item.jointId}`); }
    if (intervals.some(interval => interval.minimumDistanceMm === null)) { collisionMissing = true; collisionCodes.push(`PRECISE_DISTANCE_NOT_MEASURED:${item.jointId}`); }
  }
  const solverFailed = solverCodes.some(code => code.startsWith('MOTION_SOLVER_FAILED'));
  const collisionFailed = collisionCodes.some(code => code.startsWith('PRECISE_COLLISION_CONFIRMED'));
  const solver = gate('solver', solverFailed ? 'fail' : solverMissing ? 'not_run' : 'pass', solverCodes);
  const collision = gate('precise_collision', collisionFailed ? 'fail' : collisionMissing ? 'not_run' : 'pass', collisionCodes);

  const clearanceCodes: string[] = [], measured = new Map(input.clearanceEvidence.map(item => [pairKey(item.partA, item.partB), item]));
  let clearanceMissing = false;
  for (const requirement of input.clearanceRequirements) {
    if (!(requirement.minimumMm >= 0) || !Number.isFinite(requirement.minimumMm)) { clearanceCodes.push(`CLEARANCE_REQUIREMENT_INVALID:${pairKey(requirement.partA, requirement.partB)}`); continue; }
    const evidence = measured.get(pairKey(requirement.partA, requirement.partB));
    if (!evidence) { clearanceMissing = true; clearanceCodes.push(`CLEARANCE_EVIDENCE_MISSING:${pairKey(requirement.partA, requirement.partB)}`); continue; }
    if (!evidence.artifactHashes.length || evidence.artifactHashes.some(hash => !SHA256.test(hash))) { clearanceCodes.push(`CLEARANCE_ARTIFACT_HASH_INVALID:${pairKey(requirement.partA, requirement.partB)}`); continue; }
    if (!Number.isFinite(evidence.minimumDistanceMm) || evidence.minimumDistanceMm < 0) { clearanceCodes.push(`CLEARANCE_MEASUREMENT_INVALID:${pairKey(requirement.partA, requirement.partB)}`); continue; }
    if (!requirement.contactAllowed && evidence.minimumDistanceMm < requirement.minimumMm) clearanceCodes.push(`CLEARANCE_BELOW_MINIMUM:${pairKey(requirement.partA, requirement.partB)}`);
  }
  const clearanceFailed = clearanceCodes.some(code => code.includes('INVALID') || code.startsWith('CLEARANCE_BELOW'));
  const clearance = gate('clearance', clearanceFailed ? 'fail' : clearanceMissing ? 'not_run' : 'pass', clearanceCodes);
  const gates = [planning, solver, collision, clearance];
  const status: NativeMotionGateStatus = gates.some(item => item.status === 'fail') ? 'fail' : gates.some(item => item.status === 'not_run') ? 'not_run' : 'pass';
  return { schema: 'nexyfab.native-motion-verification-certificate.v1', status, releaseReady: status === 'pass', gates, verifiedJointIds: status === 'pass' ? input.plan.plans.map(item => item.jointId) : [] };
}
