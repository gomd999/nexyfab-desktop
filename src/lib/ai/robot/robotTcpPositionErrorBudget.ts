import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  robotSystemRequirementsV2Schema,
  verifyRobotSystemRequirementsBytes,
  type RobotSystemRequirementsV2,
} from './robotSystemRequirements';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const category = z.enum([
  'reducer_lost_motion',
  'encoder_accuracy',
  'joint_mounting',
  'manufacturing_stack',
  'thermal_drift',
  'structural_compliance',
  'calibration_residual',
]);

const contributorBase = {
  id,
  category,
  accuracyBound: nonnegative,
  repeatabilityBound: nonnegative,
  sourceArtifactSha256: sha,
  basis: z.string().trim().min(1).max(1_000),
};

const contributorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('joint_angle_arcsec'), joint: z.number().int().min(1).max(6), ...contributorBase }).strict(),
  z.object({ kind: z.literal('tcp_position_mm'), ...contributorBase }).strict(),
]);

export const robotTcpPositionErrorBudgetInputSchema = z.object({
  schema: z.literal('nexyfab.robot-tcp-position-error-budget-input.v1'),
  requirementsFileSha256: sha,
  frozenRequirementsSha256: sha,
  kinematicModelArtifactSha256: sha,
  toleranceModelArtifactSha256: sha,
  calibrationPlanArtifactSha256: sha,
  physicalValidationPlanArtifactSha256: sha,
  kinematicJoints: z.array(z.object({
    joint: z.number().int().min(1).max(6),
    aMm: finite,
    alphaDeg: finite,
    dMm: finite,
    thetaOffsetDeg: finite,
  }).strict()).length(6),
  governedPoses: z.array(z.object({
    id,
    anglesDeg: z.array(finite).length(6),
  }).strict()).min(1).max(1_000),
  contributors: z.array(contributorSchema).min(7).max(1_000),
}).strict();

export type RobotTcpPositionErrorBudgetInput = z.infer<typeof robotTcpPositionErrorBudgetInputSchema>;
export type RobotTcpPoseErrorReport = {
  poseId: string;
  tcpPositionMm: { x: number; y: number; z: number };
  worstCaseAccuracyMm: number;
  worstCaseRepeatabilityMm: number;
  diagnosticRssAccuracyMm: number;
  diagnosticRssRepeatabilityMm: number;
  accuracyMarginMm: number;
  repeatabilityMarginMm: number;
  maximumContributorId: string;
  passed: boolean;
};
export type RobotTcpPositionErrorBudgetReport = {
  schema: 'nexyfab.robot-tcp-position-error-budget-report.v1';
  requirementsFileSha256: string;
  precisionInputSha256: string;
  frozenRequirementsSha256: string | null;
  kinematicModelArtifactSha256: string | null;
  status: 'passed' | 'failed';
  precisionBudgetReady: boolean;
  requiredAccuracyMm: number | null;
  requiredRepeatabilityMm: number | null;
  governedPoseCount: number;
  contributorCount: number;
  worstPoseId: string | null;
  maximumWorstCaseAccuracyMm: number | null;
  maximumWorstCaseRepeatabilityMm: number | null;
  poses: RobotTcpPoseErrorReport[];
  errors: string[];
  physicalValidationRequired: true;
  physicalValidationComplete: false;
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

type Transform = number[];
type Vec3 = { x: number; y: number; z: number };

export function evaluateRobotTcpPositionErrorBudgetBytes(
  requirementsBytes: Uint8Array,
  precisionInputBytes: Uint8Array,
): RobotTcpPositionErrorBudgetReport {
  const errors: string[] = [];
  const requirementsVerification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!requirementsVerification.requirementsReady) {
    errors.push(...requirementsVerification.errors.map(error => `requirements: ${error}`));
  }
  const requirementsRaw = decodeJson(requirementsBytes, 'requirements', errors);
  const inputRaw = decodeJson(precisionInputBytes, 'precision input', errors);
  const requirementsParsed = robotSystemRequirementsV2Schema.safeParse(requirementsRaw);
  const inputParsed = robotTcpPositionErrorBudgetInputSchema.safeParse(inputRaw);
  if (!requirementsParsed.success) errors.push(...requirementsParsed.error.issues.map(issue => `requirements.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (!inputParsed.success) errors.push(...inputParsed.error.issues.map(issue => `input.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (requirementsParsed.success && inputParsed.success && requirementsVerification.requirementsReady) {
    errors.push(...crossFieldErrors(requirementsBytes, requirementsVerification.frozenRequirementsSha256!, requirementsParsed.data, inputParsed.data));
  }
  if (!requirementsParsed.success || !inputParsed.success || !requirementsVerification.requirementsReady || errors.length) {
    return failed(requirementsBytes, precisionInputBytes, inputParsed.success ? inputParsed.data : null, errors);
  }
  return evaluateValidated(requirementsBytes, precisionInputBytes, requirementsParsed.data, inputParsed.data);
}

function evaluateValidated(
  requirementsBytes: Uint8Array,
  inputBytes: Uint8Array,
  requirements: RobotSystemRequirementsV2,
  input: RobotTcpPositionErrorBudgetInput,
): RobotTcpPositionErrorBudgetReport {
  const poses = input.governedPoses.map(pose => evaluatePose(input, requirements, pose));
  const worst = poses.reduce((current, pose) => pose.worstCaseAccuracyMm > current.worstCaseAccuracyMm ? pose : current);
  const errors: string[] = [];
  for (const pose of poses) {
    if (pose.accuracyMarginMm < -1e-9) errors.push(`${pose.poseId}: worst-case TCP accuracy exceeds requirement by ${(-pose.accuracyMarginMm).toFixed(6)} mm`);
    if (pose.repeatabilityMarginMm < -1e-9) errors.push(`${pose.poseId}: worst-case TCP repeatability exceeds requirement by ${(-pose.repeatabilityMarginMm).toFixed(6)} mm`);
  }
  const precisionBudgetReady = poses.every(pose => pose.passed) && errors.length === 0;
  return {
    schema: 'nexyfab.robot-tcp-position-error-budget-report.v1',
    requirementsFileSha256: digest(requirementsBytes),
    precisionInputSha256: digest(inputBytes),
    frozenRequirementsSha256: input.frozenRequirementsSha256,
    kinematicModelArtifactSha256: input.kinematicModelArtifactSha256,
    status: precisionBudgetReady ? 'passed' : 'failed',
    precisionBudgetReady,
    requiredAccuracyMm: requirements.performance.tcpAccuracyMm,
    requiredRepeatabilityMm: requirements.performance.tcpRepeatabilityMm,
    governedPoseCount: poses.length,
    contributorCount: input.contributors.length,
    worstPoseId: worst.poseId,
    maximumWorstCaseAccuracyMm: Math.max(...poses.map(pose => pose.worstCaseAccuracyMm)),
    maximumWorstCaseRepeatabilityMm: Math.max(...poses.map(pose => pose.worstCaseRepeatabilityMm)),
    poses,
    errors,
    physicalValidationRequired: true,
    physicalValidationComplete: false,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function evaluatePose(
  input: RobotTcpPositionErrorBudgetInput,
  requirements: RobotSystemRequirementsV2,
  pose: RobotTcpPositionErrorBudgetInput['governedPoses'][number],
): RobotTcpPoseErrorReport {
  const kinematics = buildKinematics(input.kinematicJoints, pose.anglesDeg.map(radians));
  const tcp = origin(kinematics.at(-1)!);
  const impacts = input.contributors.map(contributor => {
    if (contributor.kind === 'tcp_position_mm') {
      return { id: contributor.id, accuracy: contributor.accuracyBound, repeatability: contributor.repeatabilityBound };
    }
    const jointIndex = contributor.joint - 1;
    const leverArmMm = norm(cross(axisZ(kinematics[jointIndex]!), subtract(tcp, origin(kinematics[jointIndex]!))));
    return {
      id: contributor.id,
      accuracy: leverArmMm * arcsecondsToRadians(contributor.accuracyBound),
      repeatability: leverArmMm * arcsecondsToRadians(contributor.repeatabilityBound),
    };
  });
  const worstCaseAccuracyMm = impacts.reduce((sum, item) => sum + item.accuracy, 0);
  const worstCaseRepeatabilityMm = impacts.reduce((sum, item) => sum + item.repeatability, 0);
  const diagnosticRssAccuracyMm = Math.hypot(...impacts.map(item => item.accuracy));
  const diagnosticRssRepeatabilityMm = Math.hypot(...impacts.map(item => item.repeatability));
  const maximum = impacts.reduce((current, item) => item.accuracy > current.accuracy ? item : current);
  const accuracyMarginMm = requirements.performance.tcpAccuracyMm - worstCaseAccuracyMm;
  const repeatabilityMarginMm = requirements.performance.tcpRepeatabilityMm - worstCaseRepeatabilityMm;
  return {
    poseId: pose.id,
    tcpPositionMm: tcp,
    worstCaseAccuracyMm,
    worstCaseRepeatabilityMm,
    diagnosticRssAccuracyMm,
    diagnosticRssRepeatabilityMm,
    accuracyMarginMm,
    repeatabilityMarginMm,
    maximumContributorId: maximum.id,
    passed: accuracyMarginMm >= -1e-9 && repeatabilityMarginMm >= -1e-9,
  };
}

function crossFieldErrors(
  requirementsBytes: Uint8Array,
  frozenRequirementsSha256: string,
  requirements: RobotSystemRequirementsV2,
  input: RobotTcpPositionErrorBudgetInput,
): string[] {
  const errors: string[] = [];
  if (digest(requirementsBytes) !== input.requirementsFileSha256) errors.push('requirements bytes do not match requirementsFileSha256');
  if (frozenRequirementsSha256 !== input.frozenRequirementsSha256) errors.push('canonical frozen requirements do not match frozenRequirementsSha256');
  governedJoints(input.kinematicJoints, errors);
  const poseIds = input.governedPoses.map(pose => pose.id);
  if (new Set(poseIds).size !== poseIds.length) errors.push('governed pose ids must be unique');
  for (const pose of input.governedPoses) {
    pose.anglesDeg.forEach((angle, index) => {
      const range = requirements.mechanics.jointRanges.find(item => item.joint === index + 1)!;
      if (angle < range.minDeg || angle > range.maxDeg) errors.push(`${pose.id}: J${index + 1} angle lies outside the frozen joint range`);
    });
  }
  const contributorIds = input.contributors.map(item => item.id);
  if (new Set(contributorIds).size !== contributorIds.length) errors.push('precision contributor ids must be unique');
  for (const required of category.options) if (!input.contributors.some(item => item.category === required)) errors.push(`precision contributor category ${required} is required`);
  for (const contributor of input.contributors) if (contributor.repeatabilityBound > contributor.accuracyBound) errors.push(`${contributor.id}: repeatability bound must not exceed accuracy bound`);
  return errors;
}

function failed(
  requirementsBytes: Uint8Array,
  inputBytes: Uint8Array,
  input: RobotTcpPositionErrorBudgetInput | null,
  errors: string[],
): RobotTcpPositionErrorBudgetReport {
  return {
    schema: 'nexyfab.robot-tcp-position-error-budget-report.v1',
    requirementsFileSha256: digest(requirementsBytes),
    precisionInputSha256: digest(inputBytes),
    frozenRequirementsSha256: input?.frozenRequirementsSha256 ?? null,
    kinematicModelArtifactSha256: input?.kinematicModelArtifactSha256 ?? null,
    status: 'failed',
    precisionBudgetReady: false,
    requiredAccuracyMm: null,
    requiredRepeatabilityMm: null,
    governedPoseCount: input?.governedPoses.length ?? 0,
    contributorCount: input?.contributors.length ?? 0,
    worstPoseId: null,
    maximumWorstCaseAccuracyMm: null,
    maximumWorstCaseRepeatabilityMm: null,
    poses: [],
    errors: [...new Set(errors)],
    physicalValidationRequired: true,
    physicalValidationComplete: false,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function buildKinematics(joints: RobotTcpPositionErrorBudgetInput['kinematicJoints'], angles: readonly number[]): Transform[] {
  const transforms = [identity4()];
  for (let index = 0; index < joints.length; index++) {
    const joint = joints[index]!;
    transforms.push(multiply4(transforms[index]!, dh(joint.aMm, radians(joint.alphaDeg), joint.dMm, angles[index]! + radians(joint.thetaOffsetDeg))));
  }
  return transforms;
}

function identity4(): Transform { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function dh(a: number, alpha: number, d: number, theta: number): Transform { const c = Math.cos(theta), s = Math.sin(theta), ca = Math.cos(alpha), sa = Math.sin(alpha); return [c, -s * ca, s * sa, a * c, s, c * ca, -c * sa, a * s, 0, sa, ca, d, 0, 0, 0, 1]; }
function multiply4(a: Transform, b: Transform): Transform { const result = Array(16).fill(0) as number[]; for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) for (let index = 0; index < 4; index++) result[row * 4 + column]! += a[row * 4 + index]! * b[index * 4 + column]!; return result; }
function origin(transform: Transform): Vec3 { return { x: transform[3]!, y: transform[7]!, z: transform[11]! }; }
function axisZ(transform: Transform): Vec3 { return { x: transform[2]!, y: transform[6]!, z: transform[10]! }; }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function norm(value: Vec3) { return Math.hypot(value.x, value.y, value.z); }
function radians(value: number) { return value * Math.PI / 180; }
function arcsecondsToRadians(value: number) { return value * Math.PI / (180 * 3_600); }
function governedJoints(items: readonly { joint: number }[], errors: string[]) { const joints = items.map(item => item.joint).sort((a, b) => a - b); if (new Set(joints).size !== 6 || joints.some((joint, index) => joint !== index + 1)) errors.push('kinematic joints must contain J1..J6 exactly once'); }
function decodeJson(bytes: Uint8Array, label: string, errors: string[]): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
