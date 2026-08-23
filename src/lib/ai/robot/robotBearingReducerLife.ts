import { createHash } from 'node:crypto';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const traceFrameSchema = z.object({ timeS: nonnegative, torqueNm: z.array(finite).length(6), speedRpm: z.array(nonnegative).length(6), powerW: z.array(finite).length(6) }).strict();
const dynamicReportSchema = z.object({
  schema: z.literal('nexyfab.robot-dynamic-load-envelope-report.v1'), requirementsSha256: sha, status: z.literal('passed'), dynamicsReady: z.literal(true), traceSha256: sha,
  trace: z.array(traceFrameSchema).min(2).max(2_000), errors: z.array(z.string()).length(0),
}).passthrough();

const spectrumBinSchema = z.object({
  durationFraction: positive.max(1),
  outputTorqueNm: nonnegative,
  outputSpeedRpm: nonnegative,
  equivalentBearingLoadN: nonnegative,
  peakBearingLoadN: nonnegative,
}).strict();

export const robotBearingReducerLifeInputSchema = z.object({
  schema: z.literal('nexyfab.robot-bearing-reducer-life-input.v1'),
  dynamicReportSha256: sha,
  requirementsSha256: sha,
  requiredServiceLifeCycles: z.number().int().positive().safe(),
  cycleTimeS: positive,
  joints: z.array(z.object({
    joint: z.number().int().min(1).max(6),
    spectrumArtifactSha256: sha,
    spectrum: z.array(spectrumBinSchema).min(1).max(256),
    bearing: z.object({
      dynamicLoadRatingN: positive,
      staticLoadRatingN: positive,
      lifeExponent: z.union([z.literal(3), z.literal(10 / 3)]),
      reliabilityFactor: positive.max(1),
      requiredStaticSafetyFactor: z.number().min(1).finite(),
      sourceArtifactSha256: sha,
    }).strict(),
    reducer: z.object({
      ratedOutputTorqueNm: positive,
      peakOutputTorqueNm: positive,
      ratedOutputSpeedRpm: positive,
      ratedLifeHours: positive,
      lifeExponent: positive,
      sourceArtifactSha256: sha,
    }).strict(),
  }).strict()).length(6),
}).strict();

export type RobotBearingReducerLifeInput = z.infer<typeof robotBearingReducerLifeInputSchema>;
export type RobotBearingReducerJointReport = {
  joint: number;
  requiredServiceLifeHours: number;
  equivalentBearingLoadN: number;
  bearingBasicRatingLifeHours: number | null;
  bearingLifeDamage: number;
  bearingLifeMargin: number;
  availableBearingStaticSafetyFactor: number | null;
  bearingStaticSafetyMargin: number | null;
  reducerLifeDamage: number;
  reducerLifeMargin: number;
  reducerPeakTorqueMarginNm: number;
  spectrumTorqueCoverageMarginNm: number;
  spectrumSpeedCoverageMarginRpm: number;
  passed: boolean;
  errors: string[];
};
export type RobotBearingReducerLifeReport = {
  schema: 'nexyfab.robot-bearing-reducer-life-report.v1';
  dynamicReportSha256: string;
  lifeInputSha256: string;
  requirementsSha256: string | null;
  traceSha256: string | null;
  status: 'passed' | 'failed';
  lifeReady: boolean;
  requiredServiceLifeHours: number;
  joints: RobotBearingReducerJointReport[];
  errors: string[];
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function evaluateRobotBearingReducerLifeBytes(dynamicReportBytes: Uint8Array, lifeInputBytes: Uint8Array): RobotBearingReducerLifeReport {
  const errors: string[] = [];
  const dynamicRaw = decodeJson(dynamicReportBytes, 'dynamic report', errors);
  const inputRaw = decodeJson(lifeInputBytes, 'life input', errors);
  const dynamicParsed = dynamicReportSchema.safeParse(dynamicRaw);
  const inputParsed = robotBearingReducerLifeInputSchema.safeParse(inputRaw);
  if (!dynamicParsed.success) errors.push(...dynamicParsed.error.issues.map(issue => `dynamic.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (!inputParsed.success) errors.push(...inputParsed.error.issues.map(issue => `input.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (dynamicParsed.success && inputParsed.success) errors.push(...crossFieldErrors(dynamicReportBytes, dynamicParsed.data, inputParsed.data));
  if (!dynamicParsed.success || !inputParsed.success || errors.length) return failed(dynamicReportBytes, lifeInputBytes, inputParsed.success ? inputParsed.data.requirementsSha256 : null, dynamicParsed.success ? dynamicParsed.data.traceSha256 : null, errors);
  return evaluateValidated(dynamicReportBytes, lifeInputBytes, dynamicParsed.data, inputParsed.data);
}

function evaluateValidated(dynamicBytes: Uint8Array, inputBytes: Uint8Array, dynamic: z.infer<typeof dynamicReportSchema>, input: RobotBearingReducerLifeInput): RobotBearingReducerLifeReport {
  const requiredHours = input.requiredServiceLifeCycles * input.cycleTimeS / 3_600;
  const reports = input.joints.map(joint => evaluateJoint(joint, dynamic.trace, requiredHours));
  const errors = reports.flatMap(report => report.errors.map(error => `J${report.joint}: ${error}`));
  const lifeReady = reports.length === 6 && reports.every(report => report.passed) && errors.length === 0;
  return { schema: 'nexyfab.robot-bearing-reducer-life-report.v1', dynamicReportSha256: digest(dynamicBytes), lifeInputSha256: digest(inputBytes), requirementsSha256: input.requirementsSha256, traceSha256: dynamic.traceSha256, status: lifeReady ? 'passed' : 'failed', lifeReady, requiredServiceLifeHours: requiredHours, joints: reports, errors, releaseReady: false, sideEffects: noSideEffects() };
}

function evaluateJoint(input: RobotBearingReducerLifeInput['joints'][number], trace: readonly z.infer<typeof traceFrameSchema>[], requiredHours: number): RobotBearingReducerJointReport {
  const axis = input.joint - 1;
  const tracePeakTorque = Math.max(...trace.map(frame => Math.abs(frame.torqueNm[axis]!)));
  const tracePeakSpeed = Math.max(...trace.map(frame => frame.speedRpm[axis]!));
  const spectrumPeakTorque = Math.max(...input.spectrum.map(bin => bin.outputTorqueNm));
  const spectrumPeakSpeed = Math.max(...input.spectrum.map(bin => bin.outputSpeedRpm));
  const spectrumTorqueCoverageMargin = spectrumPeakTorque - tracePeakTorque;
  const spectrumSpeedCoverageMargin = spectrumPeakSpeed - tracePeakSpeed;

  const bearingExponent = input.bearing.lifeExponent;
  let bearingDamage = 0; let weightedLoadPower = 0; let totalRevolutions = 0;
  for (const bin of input.spectrum) {
    const revolutions = requiredHours * bin.durationFraction * bin.outputSpeedRpm * 60;
    totalRevolutions += revolutions;
    weightedLoadPower += revolutions * bin.equivalentBearingLoadN ** bearingExponent;
    if (bin.equivalentBearingLoadN > 0 && revolutions > 0) {
      const lifeRevolutions = input.bearing.reliabilityFactor * 1_000_000 * (input.bearing.dynamicLoadRatingN / bin.equivalentBearingLoadN) ** bearingExponent;
      bearingDamage += revolutions / lifeRevolutions;
    }
  }
  const equivalentBearingLoad = totalRevolutions > 0 ? (weightedLoadPower / totalRevolutions) ** (1 / bearingExponent) : 0;
  const equivalentSpeed = input.spectrum.reduce((sum, bin) => sum + bin.durationFraction * bin.outputSpeedRpm, 0);
  const bearingBasicLifeHours = equivalentBearingLoad > 0 && equivalentSpeed > 0
    ? input.bearing.reliabilityFactor * 1_000_000 * (input.bearing.dynamicLoadRatingN / equivalentBearingLoad) ** bearingExponent / (60 * equivalentSpeed)
    : null;
  const peakBearingLoad = Math.max(...input.spectrum.map(bin => bin.peakBearingLoadN));
  const availableStaticFactor = peakBearingLoad > 0 ? input.bearing.staticLoadRatingN / peakBearingLoad : null;
  const staticMargin = availableStaticFactor === null ? null : availableStaticFactor - input.bearing.requiredStaticSafetyFactor;

  let reducerDamage = 0;
  for (const bin of input.spectrum) {
    if (bin.outputTorqueNm <= 0 || bin.outputSpeedRpm <= 0) continue;
    const lifeAtBinHours = input.reducer.ratedLifeHours
      * (input.reducer.ratedOutputTorqueNm / bin.outputTorqueNm) ** input.reducer.lifeExponent
      * (input.reducer.ratedOutputSpeedRpm / bin.outputSpeedRpm);
    reducerDamage += requiredHours * bin.durationFraction / lifeAtBinHours;
  }
  const reducerPeakMargin = input.reducer.peakOutputTorqueNm - spectrumPeakTorque;
  const errors = [
    ...(spectrumTorqueCoverageMargin < -1e-9 ? [`load spectrum misses dynamic peak torque by ${(-spectrumTorqueCoverageMargin).toFixed(4)} Nm`] : []),
    ...(spectrumSpeedCoverageMargin < -1e-9 ? [`load spectrum misses dynamic peak speed by ${(-spectrumSpeedCoverageMargin).toFixed(4)} rpm`] : []),
    ...(bearingDamage > 1 + 1e-9 ? [`bearing life damage ${bearingDamage.toFixed(6)} exceeds 1`] : []),
    ...(staticMargin !== null && staticMargin < -1e-9 ? [`bearing static safety factor is below the requirement by ${(-staticMargin).toFixed(4)}`] : []),
    ...(reducerDamage > 1 + 1e-9 ? [`reducer life damage ${reducerDamage.toFixed(6)} exceeds 1`] : []),
    ...(reducerPeakMargin < -1e-9 ? [`reducer peak torque is exceeded by ${(-reducerPeakMargin).toFixed(4)} Nm`] : []),
  ];
  return { joint: input.joint, requiredServiceLifeHours: requiredHours, equivalentBearingLoadN: equivalentBearingLoad, bearingBasicRatingLifeHours: bearingBasicLifeHours, bearingLifeDamage: bearingDamage, bearingLifeMargin: 1 - bearingDamage, availableBearingStaticSafetyFactor: availableStaticFactor, bearingStaticSafetyMargin: staticMargin, reducerLifeDamage: reducerDamage, reducerLifeMargin: 1 - reducerDamage, reducerPeakTorqueMarginNm: reducerPeakMargin, spectrumTorqueCoverageMarginNm: spectrumTorqueCoverageMargin, spectrumSpeedCoverageMarginRpm: spectrumSpeedCoverageMargin, passed: errors.length === 0, errors };
}

function crossFieldErrors(dynamicBytes: Uint8Array, dynamic: z.infer<typeof dynamicReportSchema>, input: RobotBearingReducerLifeInput): string[] {
  const errors: string[] = [];
  if (digest(dynamicBytes) !== input.dynamicReportSha256) errors.push('dynamic report bytes do not match dynamicReportSha256');
  if (dynamic.requirementsSha256 !== input.requirementsSha256) errors.push('life input requirements hash does not match the dynamic report');
  if (digest(new TextEncoder().encode(canonical(dynamic.trace))) !== dynamic.traceSha256) errors.push('dynamic trace bytes do not match traceSha256');
  const joints = input.joints.map(item => item.joint).sort((a, b) => a - b);
  if (new Set(joints).size !== 6 || joints.some((joint, index) => joint !== index + 1)) errors.push('life joints must contain J1..J6 exactly once');
  for (const joint of input.joints) {
    const fraction = joint.spectrum.reduce((sum, bin) => sum + bin.durationFraction, 0);
    if (Math.abs(fraction - 1) > 1e-6) errors.push(`J${joint.joint}: load-spectrum duration fractions must sum to 1`);
    if (joint.reducer.peakOutputTorqueNm < joint.reducer.ratedOutputTorqueNm) errors.push(`J${joint.joint}: reducer peak torque must not be below rated torque`);
    for (const bin of joint.spectrum) if (bin.peakBearingLoadN < bin.equivalentBearingLoadN) errors.push(`J${joint.joint}: peak bearing load must not be below equivalent load`);
  }
  return errors;
}

function failed(dynamicBytes: Uint8Array, inputBytes: Uint8Array, requirementsSha256: string | null, traceSha256: string | null, errors: string[]): RobotBearingReducerLifeReport {
  return { schema: 'nexyfab.robot-bearing-reducer-life-report.v1', dynamicReportSha256: digest(dynamicBytes), lifeInputSha256: digest(inputBytes), requirementsSha256, traceSha256, status: 'failed', lifeReady: false, requiredServiceLifeHours: 0, joints: [], errors: [...new Set(errors)], releaseReady: false, sideEffects: noSideEffects() };
}

function decodeJson(bytes: Uint8Array, label: string, errors: string[]): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
