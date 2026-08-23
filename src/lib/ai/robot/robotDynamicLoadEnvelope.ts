import { createHash } from 'node:crypto';
import { z } from 'zod';

const SHA256 = /^[a-f0-9]{64}$/;
const sha = z.string().regex(SHA256);
const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const vec3Schema = z.object({ x: finite, y: finite, z: finite }).strict();
const inertiaSchema = z.object({ ixx: nonnegative, iyy: nonnegative, izz: nonnegative, ixy: finite, ixz: finite, iyz: finite }).strict();
const curvePointSchema = z.object({ speedRpm: nonnegative, continuousTorqueNm: positive, peakTorqueNm: positive }).strict();

const jointModelSchema = z.object({
  joint: z.number().int().min(1).max(6),
  aMm: finite,
  alphaDeg: finite,
  dMm: finite,
  thetaOffsetDeg: finite,
  massKg: nonnegative,
  centerOfMassMm: vec3Schema,
  inertiaKgM2: inertiaSchema,
  reflectedInertiaKgM2: nonnegative,
  viscousFrictionNmPerRadS: nonnegative,
  coulombFrictionNm: nonnegative,
  massPropertiesArtifactSha256: sha,
}).strict();

const frameSchema = z.object({
  timeS: nonnegative,
  anglesDeg: z.array(finite).length(6),
  velocityDegS: z.array(finite).length(6),
  accelerationDegS2: z.array(finite).length(6),
  externalWrenchBase: z.object({ forceN: vec3Schema, torqueNm: vec3Schema }).strict(),
}).strict();

const driveSchema = z.object({
  joint: z.number().int().min(1).max(6),
  maximumOutputSpeedRpm: positive,
  maximumMechanicalPowerW: positive,
  torqueSpeedCurve: z.array(curvePointSchema).min(2).max(64),
  sourceArtifactSha256: sha,
}).strict();

export const robotDynamicLoadEnvelopeInputSchema = z.object({
  schema: z.literal('nexyfab.robot-dynamic-load-envelope-input.v1'),
  requirementsSha256: sha,
  modelArtifactSha256: sha,
  pathArtifactSha256: sha,
  gravityBaseMps2: vec3Schema,
  joints: z.array(jointModelSchema).length(6),
  payload: z.object({
    caseId: z.string().min(1).max(128),
    massKg: nonnegative,
    centerOfMassToolMm: vec3Schema,
    inertiaToolKgM2: inertiaSchema,
    sourceArtifactSha256: sha,
  }).strict(),
  frames: z.array(frameSchema).min(2).max(2_000),
  drives: z.array(driveSchema).length(6),
}).strict();

export type RobotDynamicLoadEnvelopeInput = z.infer<typeof robotDynamicLoadEnvelopeInputSchema>;
export type RobotDynamicTraceFrame = { timeS: number; torqueNm: number[]; speedRpm: number[]; powerW: number[] };
export type RobotDynamicJointReport = {
  joint: number;
  peakPositiveTorqueNm: number;
  peakNegativeTorqueNm: number;
  peakAbsoluteTorqueNm: number;
  rmsTorqueNm: number;
  maximumSpeedRpm: number;
  peakAbsolutePowerW: number;
  positiveMechanicalEnergyJ: number;
  returnedMechanicalEnergyJ: number;
  peakTorqueUtilization: number;
  continuousDutyUtilization: number;
  speedUtilization: number;
  powerUtilization: number;
  worstFrameIndex: number;
  curveCoverageComplete: boolean;
  passed: boolean;
  errors: string[];
};
export type RobotDynamicLoadEnvelopeReport = {
  schema: 'nexyfab.robot-dynamic-load-envelope-report.v1';
  inputSha256: string;
  requirementsSha256: string | null;
  modelArtifactSha256: string | null;
  pathArtifactSha256: string | null;
  payloadCaseId: string | null;
  status: 'passed' | 'failed';
  dynamicsReady: boolean;
  frameCount: number;
  durationS: number;
  traceSha256: string | null;
  trace: RobotDynamicTraceFrame[];
  joints: RobotDynamicJointReport[];
  errors: string[];
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

type Vec3 = { x: number; y: number; z: number };
type Mat3 = number[];
type Mat4 = number[];
type Jacobian = { linear: Vec3[]; angular: Vec3[] };

export function evaluateRobotDynamicLoadEnvelopeBytes(bytes: Uint8Array): RobotDynamicLoadEnvelopeReport {
  let raw: unknown = null;
  const errors: string[] = [];
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { errors.push('dynamic load input must be valid UTF-8 JSON'); }
  const parsed = robotDynamicLoadEnvelopeInputSchema.safeParse(raw);
  if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `input.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (parsed.success) errors.push(...crossFieldErrors(parsed.data));
  if (!parsed.success || errors.length) return failed(bytes, parsed.success ? parsed.data : null, errors);
  return evaluateValidated(bytes, parsed.data);
}

function evaluateValidated(bytes: Uint8Array, input: RobotDynamicLoadEnvelopeInput): RobotDynamicLoadEnvelopeReport {
  const traces: RobotDynamicTraceFrame[] = [];
  const calculations = input.frames.map(frame => {
    const q = frame.anglesDeg.map(radians);
    const qd = frame.velocityDegS.map(radians);
    const qdd = frame.accelerationDegS2.map(radians);
    const mass = massMatrix(input, q);
    const coriolis = qd.some(value => Math.abs(value) > 1e-12) ? coriolisVector(input, q, qd) : zero6();
    const gravity = gravityCompensation(input, q);
    const external = externalGeneralizedForce(input, q, frame.externalWrenchBase.forceN, frame.externalWrenchBase.torqueNm);
    const torque = multiplyMatrixVector(mass, qdd).map((value, index) => value + coriolis[index]! + gravity[index]! - external[index]! + friction(input.joints[index]!, qd[index]!));
    const speedRpm = qd.map(value => Math.abs(value) * 60 / (2 * Math.PI));
    const powerW = torque.map((value, index) => value * qd[index]!);
    const trace = { timeS: frame.timeS, torqueNm: torque, speedRpm, powerW };
    traces.push(trace);
    return trace;
  });
  const jointReports = input.drives.map(drive => summarizeJoint(drive, calculations));
  const traceSha256 = digest(new TextEncoder().encode(canonical(traces)));
  const errors = jointReports.flatMap(report => report.errors.map(error => `J${report.joint}: ${error}`));
  const dynamicsReady = jointReports.length === 6 && jointReports.every(report => report.passed) && errors.length === 0;
  return {
    schema: 'nexyfab.robot-dynamic-load-envelope-report.v1',
    inputSha256: digest(bytes),
    requirementsSha256: input.requirementsSha256,
    modelArtifactSha256: input.modelArtifactSha256,
    pathArtifactSha256: input.pathArtifactSha256,
    payloadCaseId: input.payload.caseId,
    status: dynamicsReady ? 'passed' : 'failed',
    dynamicsReady,
    frameCount: input.frames.length,
    durationS: input.frames.at(-1)!.timeS - input.frames[0]!.timeS,
    traceSha256,
    trace: traces,
    joints: jointReports,
    errors,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function failed(bytes: Uint8Array, input: RobotDynamicLoadEnvelopeInput | null, errors: string[]): RobotDynamicLoadEnvelopeReport {
  return {
    schema: 'nexyfab.robot-dynamic-load-envelope-report.v1',
    inputSha256: digest(bytes),
    requirementsSha256: input?.requirementsSha256 ?? null,
    modelArtifactSha256: input?.modelArtifactSha256 ?? null,
    pathArtifactSha256: input?.pathArtifactSha256 ?? null,
    payloadCaseId: input?.payload.caseId ?? null,
    status: 'failed',
    dynamicsReady: false,
    frameCount: input?.frames.length ?? 0,
    durationS: 0,
    traceSha256: null,
    trace: [],
    joints: [],
    errors: [...new Set(errors)],
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function crossFieldErrors(input: RobotDynamicLoadEnvelopeInput): string[] {
  const errors: string[] = [];
  governedJoints(input.joints, 'joints', errors);
  governedJoints(input.drives, 'drives', errors);
  if (input.payload.massKg > 0 && !physicalInertia(input.payload.inertiaToolKgM2)) errors.push('payload inertia tensor is not physically admissible');
  if (input.payload.massKg === 0 && (vectorNorm(input.payload.centerOfMassToolMm) > 0 || inertiaNorm(input.payload.inertiaToolKgM2) > 0)) errors.push('zero-mass payload must have zero center of mass and inertia');
  for (const joint of input.joints) {
    if (joint.massKg > 0 && !physicalInertia(joint.inertiaKgM2)) errors.push(`J${joint.joint}: link inertia tensor is not physically admissible`);
    if (joint.massKg === 0 && inertiaNorm(joint.inertiaKgM2) > 0) errors.push(`J${joint.joint}: zero-mass link must have zero inertia`);
  }
  for (let index = 1; index < input.frames.length; index++) if (!(input.frames[index]!.timeS > input.frames[index - 1]!.timeS)) errors.push(`frame ${index}: time must increase strictly`);
  for (const drive of input.drives) {
    const curve = drive.torqueSpeedCurve;
    if (curve[0]!.speedRpm !== 0) errors.push(`J${drive.joint}: torque-speed curve must start at zero rpm`);
    for (let index = 0; index < curve.length; index++) {
      const point = curve[index]!;
      if (point.peakTorqueNm < point.continuousTorqueNm) errors.push(`J${drive.joint}: peak curve torque must not be below continuous torque`);
      if (index > 0) {
        const previous = curve[index - 1]!;
        if (!(point.speedRpm > previous.speedRpm)) errors.push(`J${drive.joint}: torque-speed curve speeds must increase strictly`);
        if (point.continuousTorqueNm > previous.continuousTorqueNm || point.peakTorqueNm > previous.peakTorqueNm) errors.push(`J${drive.joint}: torque-speed limits must be non-increasing`);
      }
    }
    if (curve.at(-1)!.speedRpm !== drive.maximumOutputSpeedRpm) errors.push(`J${drive.joint}: curve endpoint must equal maximum output speed`);
  }
  return errors;
}

function summarizeJoint(drive: RobotDynamicLoadEnvelopeInput['drives'][number], traces: readonly RobotDynamicTraceFrame[]): RobotDynamicJointReport {
  const index = drive.joint - 1;
  let positive = -Infinity; let negative = Infinity; let peak = 0; let maximumSpeed = 0; let peakPower = 0;
  let positiveEnergy = 0; let returnedEnergy = 0; let peakUtilization = 0; let curveCoverageComplete = true; let worstFrameIndex = 0;
  const torques: number[] = []; const continuousRatios: number[] = [];
  traces.forEach((trace, frameIndex) => {
    const torque = trace.torqueNm[index]!; const speed = trace.speedRpm[index]!; const power = trace.powerW[index]!;
    torques.push(torque); positive = Math.max(positive, torque); negative = Math.min(negative, torque); maximumSpeed = Math.max(maximumSpeed, speed); peakPower = Math.max(peakPower, Math.abs(power));
    if (Math.abs(torque) > peak) { peak = Math.abs(torque); worstFrameIndex = frameIndex; }
    const limits = interpolateCurve(drive.torqueSpeedCurve, speed);
    if (!limits) { curveCoverageComplete = false; continuousRatios.push(Infinity); }
    else {
      const peakRatio = Math.abs(torque) / limits.peakTorqueNm;
      peakUtilization = Math.max(peakUtilization, peakRatio);
      continuousRatios.push(Math.abs(torque) / limits.continuousTorqueNm);
    }
    if (frameIndex > 0) {
      const dt = trace.timeS - traces[frameIndex - 1]!.timeS;
      const energy = integrateSignedPower(traces[frameIndex - 1]!.powerW[index]!, power, dt);
      positiveEnergy += energy.positiveJ; returnedEnergy += energy.returnedJ;
    }
  });
  const continuousDutyUtilization = curveCoverageComplete ? timeWeightedRms(continuousRatios, traces) : Infinity;
  const speedUtilization = maximumSpeed / drive.maximumOutputSpeedRpm;
  const powerUtilization = peakPower / drive.maximumMechanicalPowerW;
  const errors = [
    ...(!curveCoverageComplete ? ['torque-speed curve does not cover every evaluated frame'] : []),
    ...(peakUtilization > 1 + 1e-9 ? [`peak torque utilization ${peakUtilization.toFixed(4)} exceeds 1`] : []),
    ...(continuousDutyUtilization > 1 + 1e-9 ? [`continuous duty utilization ${continuousDutyUtilization.toFixed(4)} exceeds 1`] : []),
    ...(speedUtilization > 1 + 1e-9 ? [`speed utilization ${speedUtilization.toFixed(4)} exceeds 1`] : []),
    ...(powerUtilization > 1 + 1e-9 ? [`mechanical power utilization ${powerUtilization.toFixed(4)} exceeds 1`] : []),
  ];
  return {
    joint: drive.joint,
    peakPositiveTorqueNm: positive,
    peakNegativeTorqueNm: negative,
    peakAbsoluteTorqueNm: peak,
    rmsTorqueNm: timeWeightedRms(torques, traces),
    maximumSpeedRpm: maximumSpeed,
    peakAbsolutePowerW: peakPower,
    positiveMechanicalEnergyJ: positiveEnergy,
    returnedMechanicalEnergyJ: returnedEnergy,
    peakTorqueUtilization: peakUtilization,
    continuousDutyUtilization,
    speedUtilization,
    powerUtilization,
    worstFrameIndex,
    curveCoverageComplete,
    passed: errors.length === 0,
    errors,
  };
}

function timeWeightedRms(values: readonly number[], traces: readonly RobotDynamicTraceFrame[]): number {
  const duration = traces.at(-1)!.timeS - traces[0]!.timeS;
  let integral = 0;
  for (let index = 1; index < traces.length; index++) {
    const dt = traces[index]!.timeS - traces[index - 1]!.timeS;
    integral += 0.5 * (values[index - 1]! ** 2 + values[index]! ** 2) * dt;
  }
  return Math.sqrt(integral / duration);
}

function integrateSignedPower(previousW: number, currentW: number, durationS: number): { positiveJ: number; returnedJ: number } {
  if (previousW >= 0 && currentW >= 0) return { positiveJ: 0.5 * (previousW + currentW) * durationS, returnedJ: 0 };
  if (previousW <= 0 && currentW <= 0) return { positiveJ: 0, returnedJ: -0.5 * (previousW + currentW) * durationS };
  const crossingFraction = previousW / (previousW - currentW);
  if (previousW > 0) return { positiveJ: 0.5 * previousW * durationS * crossingFraction, returnedJ: 0.5 * -currentW * durationS * (1 - crossingFraction) };
  return { positiveJ: 0.5 * currentW * durationS * (1 - crossingFraction), returnedJ: 0.5 * -previousW * durationS * crossingFraction };
}

function massMatrix(input: RobotDynamicLoadEnvelopeInput, q: readonly number[]): number[][] {
  const kinematics = buildKinematics(input.joints, q);
  const matrix = matrix6();
  input.joints.forEach((link, linkIndex) => {
    if (link.massKg <= 0 && inertiaNorm(link.inertiaKgM2) <= 0 && link.reflectedInertiaKgM2 <= 0) return;
    const transform = kinematics.transforms[linkIndex]!;
    const point = transformPoint(transform, scale(link.centerOfMassMm, 0.001));
    const jacobian = pointJacobian(kinematics, point, linkIndex + 1);
    addRigidBodyMass(matrix, jacobian, link.massKg, rotateInertia(link.inertiaKgM2, transform));
    matrix[linkIndex]![linkIndex]! += link.reflectedInertiaKgM2;
  });
  if (input.payload.massKg > 0 || inertiaNorm(input.payload.inertiaToolKgM2) > 0) {
    const tool = kinematics.transforms[5]!;
    const point = transformPoint(tool, scale(input.payload.centerOfMassToolMm, 0.001));
    addRigidBodyMass(matrix, pointJacobian(kinematics, point, 6), input.payload.massKg, rotateInertia(input.payload.inertiaToolKgM2, tool));
  }
  return matrix;
}

function gravityCompensation(input: RobotDynamicLoadEnvelopeInput, q: readonly number[]): number[] {
  const kinematics = buildKinematics(input.joints, q); const result = zero6();
  input.joints.forEach((link, linkIndex) => {
    if (link.massKg <= 0) return;
    const point = transformPoint(kinematics.transforms[linkIndex]!, scale(link.centerOfMassMm, 0.001));
    const jacobian = pointJacobian(kinematics, point, linkIndex + 1);
    const force = scale(input.gravityBaseMps2, link.massKg);
    for (let joint = 0; joint < 6; joint++) result[joint]! -= dot(jacobian.linear[joint]!, force);
  });
  if (input.payload.massKg > 0) {
    const tool = kinematics.transforms[5]!; const point = transformPoint(tool, scale(input.payload.centerOfMassToolMm, 0.001));
    const jacobian = pointJacobian(kinematics, point, 6); const force = scale(input.gravityBaseMps2, input.payload.massKg);
    for (let joint = 0; joint < 6; joint++) result[joint]! -= dot(jacobian.linear[joint]!, force);
  }
  return result;
}

function coriolisVector(input: RobotDynamicLoadEnvelopeInput, q: readonly number[], qd: readonly number[]): number[] {
  const epsilon = 1e-5;
  const derivatives = Array.from({ length: 6 }, (_, axis) => {
    const plus = [...q]; const minus = [...q]; plus[axis]! += epsilon; minus[axis]! -= epsilon;
    const upper = massMatrix(input, plus); const lower = massMatrix(input, minus);
    return upper.map((row, i) => row.map((value, j) => (value - lower[i]![j]!) / (2 * epsilon)));
  });
  const result = zero6();
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) for (let k = 0; k < 6; k++) {
    const christoffel = 0.5 * (derivatives[k]![i]![j]! + derivatives[j]![i]![k]! - derivatives[i]![j]![k]!);
    result[i]! += christoffel * qd[j]! * qd[k]!;
  }
  return result;
}

function externalGeneralizedForce(input: RobotDynamicLoadEnvelopeInput, q: readonly number[], force: Vec3, torque: Vec3): number[] {
  const kinematics = buildKinematics(input.joints, q); const toolPoint = transformPoint(kinematics.transforms[5]!, { x: 0, y: 0, z: 0 });
  const jacobian = pointJacobian(kinematics, toolPoint, 6);
  return jacobian.linear.map((linear, index) => dot(linear, force) + dot(jacobian.angular[index]!, torque));
}

function buildKinematics(joints: readonly RobotDynamicLoadEnvelopeInput['joints'][number][], q: readonly number[]) {
  let transform = identity4(); const origins: Vec3[] = []; const axes: Vec3[] = []; const transforms: Mat4[] = [];
  joints.forEach((joint, index) => {
    origins.push({ x: transform[3]!, y: transform[7]!, z: transform[11]! });
    axes.push({ x: transform[2]!, y: transform[6]!, z: transform[10]! });
    transform = multiply4(transform, dh(joint.aMm * 0.001, radians(joint.alphaDeg), joint.dMm * 0.001, q[index]! + radians(joint.thetaOffsetDeg)));
    transforms.push(transform);
  });
  return { origins, axes, transforms };
}

function pointJacobian(kinematics: ReturnType<typeof buildKinematics>, point: Vec3, activeJoints: number): Jacobian {
  const linear: Vec3[] = []; const angular: Vec3[] = [];
  for (let joint = 0; joint < 6; joint++) {
    if (joint < activeJoints) { const axis = kinematics.axes[joint]!; linear.push(cross(axis, subtract(point, kinematics.origins[joint]!))); angular.push(axis); }
    else { linear.push({ x: 0, y: 0, z: 0 }); angular.push({ x: 0, y: 0, z: 0 }); }
  }
  return { linear, angular };
}

function addRigidBodyMass(matrix: number[][], jacobian: Jacobian, massKg: number, inertiaWorld: Mat3) {
  for (let row = 0; row < 6; row++) for (let column = 0; column < 6; column++) {
    matrix[row]![column]! += massKg * dot(jacobian.linear[row]!, jacobian.linear[column]!) + dot(jacobian.angular[row]!, multiply3Vector(inertiaWorld, jacobian.angular[column]!));
  }
}

function rotateInertia(inertia: z.infer<typeof inertiaSchema>, transform: Mat4): Mat3 {
  const local = [inertia.ixx, inertia.ixy, inertia.ixz, inertia.ixy, inertia.iyy, inertia.iyz, inertia.ixz, inertia.iyz, inertia.izz];
  const rotation = [transform[0]!, transform[1]!, transform[2]!, transform[4]!, transform[5]!, transform[6]!, transform[8]!, transform[9]!, transform[10]!];
  return multiply3(multiply3(rotation, local), transpose3(rotation));
}

function interpolateCurve(curve: readonly z.infer<typeof curvePointSchema>[], speedRpm: number) {
  if (speedRpm < 0 || speedRpm > curve.at(-1)!.speedRpm + 1e-9) return null;
  for (let index = 1; index < curve.length; index++) {
    const lower = curve[index - 1]!; const upper = curve[index]!;
    if (speedRpm <= upper.speedRpm) {
      const ratio = (speedRpm - lower.speedRpm) / (upper.speedRpm - lower.speedRpm);
      return { continuousTorqueNm: lower.continuousTorqueNm + ratio * (upper.continuousTorqueNm - lower.continuousTorqueNm), peakTorqueNm: lower.peakTorqueNm + ratio * (upper.peakTorqueNm - lower.peakTorqueNm) };
    }
  }
  return curve.at(-1)!;
}

function physicalInertia(value: z.infer<typeof inertiaSchema>): boolean {
  const scaleValue = Math.max(1, value.ixx, value.iyy, value.izz); const tolerance = scaleValue ** 3 * 1e-10;
  const xy = value.ixx * value.iyy - value.ixy ** 2; const xz = value.ixx * value.izz - value.ixz ** 2; const yz = value.iyy * value.izz - value.iyz ** 2;
  const determinant = value.ixx * value.iyy * value.izz + 2 * value.ixy * value.ixz * value.iyz - value.ixx * value.iyz ** 2 - value.iyy * value.ixz ** 2 - value.izz * value.ixy ** 2;
  return value.ixx > 0 && value.iyy > 0 && value.izz > 0 && xy >= -tolerance && xz >= -tolerance && yz >= -tolerance && determinant >= -tolerance
    && value.ixx <= value.iyy + value.izz + tolerance && value.iyy <= value.ixx + value.izz + tolerance && value.izz <= value.ixx + value.iyy + tolerance;
}

function governedJoints(items: readonly { joint: number }[], label: string, errors: string[]) { const values = items.map(item => item.joint).sort((a, b) => a - b); if (new Set(values).size !== 6 || values.some((value, index) => value !== index + 1)) errors.push(`${label} must contain J1..J6 exactly once`); }
function friction(joint: RobotDynamicLoadEnvelopeInput['joints'][number], speedRadS: number) { return joint.viscousFrictionNmPerRadS * speedRadS + (Math.abs(speedRadS) > 1e-12 ? Math.sign(speedRadS) * joint.coulombFrictionNm : 0); }
function inertiaNorm(value: z.infer<typeof inertiaSchema>) { return Math.max(...Object.values(value).map(Math.abs)); }
function vectorNorm(value: Vec3) { return Math.hypot(value.x, value.y, value.z); }
function radians(value: number) { return value * Math.PI / 180; }
function zero6() { return Array(6).fill(0) as number[]; }
function matrix6() { return Array.from({ length: 6 }, () => zero6()); }
function multiplyMatrixVector(matrix: readonly number[][], vector: readonly number[]) { return matrix.map(row => row.reduce((sum, value, index) => sum + value * vector[index]!, 0)); }
function dot(a: Vec3, b: Vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(value: Vec3, factor: number): Vec3 { return { x: value.x * factor, y: value.y * factor, z: value.z * factor }; }
function identity4(): Mat4 { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function dh(a: number, alpha: number, d: number, theta: number): Mat4 { const c = Math.cos(theta), s = Math.sin(theta), ca = Math.cos(alpha), sa = Math.sin(alpha); return [c, -s * ca, s * sa, a * c, s, c * ca, -c * sa, a * s, 0, sa, ca, d, 0, 0, 0, 1]; }
function multiply4(a: Mat4, b: Mat4): Mat4 { const out = Array(16).fill(0) as number[]; for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) for (let index = 0; index < 4; index++) out[row * 4 + column]! += a[row * 4 + index]! * b[index * 4 + column]!; return out; }
function transformPoint(transform: Mat4, point: Vec3): Vec3 { return { x: transform[0]! * point.x + transform[1]! * point.y + transform[2]! * point.z + transform[3]!, y: transform[4]! * point.x + transform[5]! * point.y + transform[6]! * point.z + transform[7]!, z: transform[8]! * point.x + transform[9]! * point.y + transform[10]! * point.z + transform[11]! }; }
function multiply3(a: Mat3, b: Mat3): Mat3 { const out = Array(9).fill(0) as number[]; for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) for (let index = 0; index < 3; index++) out[row * 3 + column]! += a[row * 3 + index]! * b[index * 3 + column]!; return out; }
function transpose3(value: Mat3): Mat3 { return [value[0]!, value[3]!, value[6]!, value[1]!, value[4]!, value[7]!, value[2]!, value[5]!, value[8]!]; }
function multiply3Vector(matrix: Mat3, vector: Vec3): Vec3 { return { x: matrix[0]! * vector.x + matrix[1]! * vector.y + matrix[2]! * vector.z, y: matrix[3]! * vector.x + matrix[4]! * vector.y + matrix[5]! * vector.z, z: matrix[6]! * vector.x + matrix[7]! * vector.y + matrix[8]! * vector.z }; }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
