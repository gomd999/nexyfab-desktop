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
const positive = finite.positive();
const vector = z.object({ x: finite, y: finite, z: finite }).strict();
const compliance = z.object({ xx: finite.nonnegative(), yy: finite.nonnegative(), zz: finite.nonnegative(), xy: finite, xz: finite, yz: finite }).strict();

export const robotStructuralComplianceInputSchema = z.object({
  schema: z.literal('nexyfab.robot-structural-compliance-input.v1'),
  requirementsFileSha256: sha,
  frozenRequirementsSha256: sha,
  kinematicModelArtifactSha256: sha,
  structuralModelArtifactSha256: sha,
  physicalStiffnessValidationPlanArtifactSha256: sha,
  allowableTcpDeflectionMm: positive,
  kinematicJoints: z.array(z.object({ joint: z.number().int().min(1).max(6), aMm: finite, alphaDeg: finite, dMm: finite, thetaOffsetDeg: finite }).strict()).length(6),
  jointStiffness: z.array(z.object({
    joint: z.number().int().min(1).max(6),
    minimumOutputTorsionalStiffnessNmPerRad: positive,
    sourceArtifactSha256: sha,
  }).strict()).length(6),
  loadCases: z.array(z.object({
    id,
    anglesDeg: z.array(finite).length(6),
    forceBaseN: vector,
    torqueBaseNm: vector,
    maximumLinkTranslationalComplianceMPerN: compliance,
    complianceArtifactSha256: sha,
  }).strict()).min(1).max(1_000),
}).strict();

export type RobotStructuralComplianceInput = z.infer<typeof robotStructuralComplianceInputSchema>;
export type RobotStructuralLoadCaseReport = {
  loadCaseId: string;
  jointTorqueNm: number[];
  jointDeflectionRad: number[];
  jointElasticTcpDeflectionMm: { x: number; y: number; z: number };
  linkElasticTcpDeflectionMm: { x: number; y: number; z: number };
  totalTcpDeflectionMm: { x: number; y: number; z: number };
  totalTcpDeflectionMagnitudeMm: number;
  allowableMarginMm: number;
  passed: boolean;
};
export type RobotStructuralComplianceReport = {
  schema: 'nexyfab.robot-structural-compliance-report.v1';
  requirementsFileSha256: string;
  complianceInputSha256: string;
  frozenRequirementsSha256: string | null;
  structuralModelArtifactSha256: string | null;
  status: 'passed' | 'failed';
  structuralComplianceReady: boolean;
  allowableTcpDeflectionMm: number | null;
  maximumTcpDeflectionMm: number | null;
  worstLoadCaseId: string | null;
  loadCases: RobotStructuralLoadCaseReport[];
  errors: string[];
  physicalStiffnessValidationRequired: true;
  physicalStiffnessValidationComplete: false;
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

type Vec3 = { x: number; y: number; z: number };
type Transform = number[];

export function evaluateRobotStructuralComplianceBytes(requirementsBytes: Uint8Array, inputBytes: Uint8Array): RobotStructuralComplianceReport {
  const errors: string[] = [];
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.requirementsReady) errors.push(...verification.errors.map(error => `requirements: ${error}`));
  const requirementsRaw = decodeJson(requirementsBytes, 'requirements', errors);
  const inputRaw = decodeJson(inputBytes, 'structural compliance input', errors);
  const requirementsParsed = robotSystemRequirementsV2Schema.safeParse(requirementsRaw);
  const inputParsed = robotStructuralComplianceInputSchema.safeParse(inputRaw);
  if (!requirementsParsed.success) errors.push(...requirementsParsed.error.issues.map(issue => `requirements.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (!inputParsed.success) errors.push(...inputParsed.error.issues.map(issue => `input.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (requirementsParsed.success && inputParsed.success && verification.requirementsReady) errors.push(...crossFieldErrors(requirementsBytes, verification.frozenRequirementsSha256!, requirementsParsed.data, inputParsed.data));
  if (!requirementsParsed.success || !inputParsed.success || !verification.requirementsReady || errors.length) return failed(requirementsBytes, inputBytes, inputParsed.success ? inputParsed.data : null, errors);
  return evaluateValidated(requirementsBytes, inputBytes, inputParsed.data);
}

function evaluateValidated(requirementsBytes: Uint8Array, inputBytes: Uint8Array, input: RobotStructuralComplianceInput): RobotStructuralComplianceReport {
  const stiffness = new Map(input.jointStiffness.map(item => [item.joint, item.minimumOutputTorsionalStiffnessNmPerRad]));
  const loadCases = input.loadCases.map(loadCase => {
    const kinematics = buildKinematics(input.kinematicJoints, loadCase.anglesDeg.map(radians));
    const tcp = origin(kinematics.at(-1)!);
    const jacobian = input.kinematicJoints.map((joint, index) => {
      const transform = kinematics[index]!;
      return { joint: joint.joint, linearM: scale(cross(axisZ(transform), subtract(tcp, origin(transform))), 0.001), angular: axisZ(transform) };
    });
    const jointTorqueNm = jacobian.map(column => dot(column.linearM, loadCase.forceBaseN) + dot(column.angular, loadCase.torqueBaseNm));
    const jointDeflectionRad = jointTorqueNm.map((torque, index) => torque / stiffness.get(index + 1)!);
    const jointDeflectionM = jacobian.reduce((sum, column, index) => add(sum, scale(column.linearM, jointDeflectionRad[index]!)), zero());
    const c = loadCase.maximumLinkTranslationalComplianceMPerN;
    const linkDeflectionM = {
      x: c.xx * loadCase.forceBaseN.x + c.xy * loadCase.forceBaseN.y + c.xz * loadCase.forceBaseN.z,
      y: c.xy * loadCase.forceBaseN.x + c.yy * loadCase.forceBaseN.y + c.yz * loadCase.forceBaseN.z,
      z: c.xz * loadCase.forceBaseN.x + c.yz * loadCase.forceBaseN.y + c.zz * loadCase.forceBaseN.z,
    };
    const jointElasticTcpDeflectionMm = scale(jointDeflectionM, 1_000);
    const linkElasticTcpDeflectionMm = scale(linkDeflectionM, 1_000);
    const totalTcpDeflectionMm = add(jointElasticTcpDeflectionMm, linkElasticTcpDeflectionMm);
    const totalTcpDeflectionMagnitudeMm = norm(totalTcpDeflectionMm);
    return {
      loadCaseId: loadCase.id,
      jointTorqueNm,
      jointDeflectionRad,
      jointElasticTcpDeflectionMm,
      linkElasticTcpDeflectionMm,
      totalTcpDeflectionMm,
      totalTcpDeflectionMagnitudeMm,
      allowableMarginMm: input.allowableTcpDeflectionMm - totalTcpDeflectionMagnitudeMm,
      passed: totalTcpDeflectionMagnitudeMm <= input.allowableTcpDeflectionMm + 1e-9,
    };
  });
  const worst = loadCases.reduce((current, item) => item.totalTcpDeflectionMagnitudeMm > current.totalTcpDeflectionMagnitudeMm ? item : current);
  const errors = loadCases.filter(item => !item.passed).map(item => `${item.loadCaseId}: TCP structural deflection exceeds its allocation by ${(-item.allowableMarginMm).toFixed(6)} mm`);
  const structuralComplianceReady = loadCases.every(item => item.passed) && errors.length === 0;
  return {
    schema: 'nexyfab.robot-structural-compliance-report.v1',
    requirementsFileSha256: digest(requirementsBytes),
    complianceInputSha256: digest(inputBytes),
    frozenRequirementsSha256: input.frozenRequirementsSha256,
    structuralModelArtifactSha256: input.structuralModelArtifactSha256,
    status: structuralComplianceReady ? 'passed' : 'failed',
    structuralComplianceReady,
    allowableTcpDeflectionMm: input.allowableTcpDeflectionMm,
    maximumTcpDeflectionMm: worst.totalTcpDeflectionMagnitudeMm,
    worstLoadCaseId: worst.loadCaseId,
    loadCases,
    errors,
    physicalStiffnessValidationRequired: true,
    physicalStiffnessValidationComplete: false,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function crossFieldErrors(requirementsBytes: Uint8Array, frozenHash: string, requirements: RobotSystemRequirementsV2, input: RobotStructuralComplianceInput): string[] {
  const errors: string[] = [];
  if (digest(requirementsBytes) !== input.requirementsFileSha256) errors.push('requirements bytes do not match requirementsFileSha256');
  if (frozenHash !== input.frozenRequirementsSha256) errors.push('canonical frozen requirements do not match frozenRequirementsSha256');
  if (input.allowableTcpDeflectionMm > requirements.performance.tcpAccuracyMm) errors.push('structural deflection allocation must not exceed the frozen TCP accuracy requirement');
  governedJoints(input.kinematicJoints, 'kinematic joints', errors);
  governedJoints(input.jointStiffness, 'joint stiffness', errors);
  const ids = input.loadCases.map(item => item.id);
  if (new Set(ids).size !== ids.length) errors.push('structural load case ids must be unique');
  for (const loadCase of input.loadCases) {
    loadCase.anglesDeg.forEach((angle, index) => {
      const range = requirements.mechanics.jointRanges.find(item => item.joint === index + 1)!;
      if (angle < range.minDeg || angle > range.maxDeg) errors.push(`${loadCase.id}: J${index + 1} angle lies outside the frozen joint range`);
    });
    if (!positiveSemidefinite(loadCase.maximumLinkTranslationalComplianceMPerN)) errors.push(`${loadCase.id}: link translational compliance tensor must be positive semidefinite`);
  }
  return errors;
}

function positiveSemidefinite(value: RobotStructuralComplianceInput['loadCases'][number]['maximumLinkTranslationalComplianceMPerN']) {
  const scaleValue = Math.max(value.xx, value.yy, value.zz, Math.abs(value.xy), Math.abs(value.xz), Math.abs(value.yz), 1);
  const tolerance = scaleValue * 1e-12;
  const xy = value.xx * value.yy - value.xy ** 2;
  const xz = value.xx * value.zz - value.xz ** 2;
  const yz = value.yy * value.zz - value.yz ** 2;
  const determinant = value.xx * value.yy * value.zz + 2 * value.xy * value.xz * value.yz - value.xx * value.yz ** 2 - value.yy * value.xz ** 2 - value.zz * value.xy ** 2;
  return xy >= -tolerance && xz >= -tolerance && yz >= -tolerance && determinant >= -tolerance;
}

function failed(requirementsBytes: Uint8Array, inputBytes: Uint8Array, input: RobotStructuralComplianceInput | null, errors: string[]): RobotStructuralComplianceReport {
  return { schema: 'nexyfab.robot-structural-compliance-report.v1', requirementsFileSha256: digest(requirementsBytes), complianceInputSha256: digest(inputBytes), frozenRequirementsSha256: input?.frozenRequirementsSha256 ?? null, structuralModelArtifactSha256: input?.structuralModelArtifactSha256 ?? null, status: 'failed', structuralComplianceReady: false, allowableTcpDeflectionMm: input?.allowableTcpDeflectionMm ?? null, maximumTcpDeflectionMm: null, worstLoadCaseId: null, loadCases: [], errors: [...new Set(errors)], physicalStiffnessValidationRequired: true, physicalStiffnessValidationComplete: false, releaseReady: false, sideEffects: noSideEffects() };
}

function buildKinematics(joints: RobotStructuralComplianceInput['kinematicJoints'], angles: readonly number[]): Transform[] { const transforms = [identity4()]; for (let index = 0; index < joints.length; index++) { const joint = joints[index]!; transforms.push(multiply4(transforms[index]!, dh(joint.aMm, radians(joint.alphaDeg), joint.dMm, angles[index]! + radians(joint.thetaOffsetDeg)))); } return transforms; }
function identity4(): Transform { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function dh(a: number, alpha: number, d: number, theta: number): Transform { const c = Math.cos(theta), s = Math.sin(theta), ca = Math.cos(alpha), sa = Math.sin(alpha); return [c, -s * ca, s * sa, a * c, s, c * ca, -c * sa, a * s, 0, sa, ca, d, 0, 0, 0, 1]; }
function multiply4(a: Transform, b: Transform): Transform { const result = Array(16).fill(0) as number[]; for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) for (let index = 0; index < 4; index++) result[row * 4 + column]! += a[row * 4 + index]! * b[index * 4 + column]!; return result; }
function origin(transform: Transform): Vec3 { return { x: transform[3]!, y: transform[7]!, z: transform[11]! }; }
function axisZ(transform: Transform): Vec3 { return { x: transform[2]!, y: transform[6]!, z: transform[10]! }; }
function zero(): Vec3 { return { x: 0, y: 0, z: 0 }; }
function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(value: Vec3, factor: number): Vec3 { return { x: value.x * factor, y: value.y * factor, z: value.z * factor }; }
function dot(a: Vec3, b: Vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function norm(value: Vec3) { return Math.hypot(value.x, value.y, value.z); }
function radians(value: number) { return value * Math.PI / 180; }
function governedJoints(items: readonly { joint: number }[], label: string, errors: string[]) { const joints = items.map(item => item.joint).sort((a, b) => a - b); if (new Set(joints).size !== 6 || joints.some((joint, index) => joint !== index + 1)) errors.push(`${label} must contain J1..J6 exactly once`); }
function decodeJson(bytes: Uint8Array, label: string, errors: string[]): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
