import { createHash } from 'node:crypto';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const thermalNodeSchema = z.object({ thermalResistanceCPerW: positive, thermalCapacitanceJPerC: positive, maximumTemperatureC: finite, initialTemperatureC: finite }).strict();

const traceFrameSchema = z.object({
  timeS: nonnegative,
  torqueNm: z.array(finite).length(6),
  speedRpm: z.array(nonnegative).length(6),
  powerW: z.array(finite).length(6),
}).strict();

const dynamicReportSchema = z.object({
  schema: z.literal('nexyfab.robot-dynamic-load-envelope-report.v1'),
  requirementsSha256: sha,
  modelArtifactSha256: sha,
  pathArtifactSha256: sha,
  payloadCaseId: z.string().min(1),
  status: z.literal('passed'),
  dynamicsReady: z.literal(true),
  traceSha256: sha,
  trace: z.array(traceFrameSchema).min(2).max(2_000),
  errors: z.array(z.string()).length(0),
}).passthrough();

export const robotDriveDutyThermalInputSchema = z.object({
  schema: z.literal('nexyfab.robot-drive-duty-thermal-input.v1'),
  dynamicReportSha256: sha,
  requirementsSha256: sha,
  ambientTemperatureC: finite,
  dutyCycleRatio: positive.max(1),
  maximumEvaluationCycles: z.number().int().min(2).max(100_000),
  steadyStateToleranceC: positive,
  joints: z.array(z.object({
    joint: z.number().int().min(1).max(6),
    gearRatio: positive,
    motoringEfficiency: positive.max(1),
    regeneratingEfficiency: positive.max(1),
    motorLoss: z.object({ constantLossW: nonnegative, torqueSquaredCoefficientWPerNm2: nonnegative, speedCoefficientWPerRpm: nonnegative, standbyLossW: nonnegative }).strict(),
    reducerLoss: z.object({ constantLossW: nonnegative, standbyLossW: nonnegative }).strict(),
    brakeReleasePowerW: nonnegative,
    motorThermal: thermalNodeSchema,
    reducerThermal: thermalNodeSchema,
    brakeThermal: thermalNodeSchema,
    sourceArtifactSha256: sha,
  }).strict()).length(6),
}).strict();

export type RobotDriveDutyThermalInput = z.infer<typeof robotDriveDutyThermalInputSchema>;
export type RobotThermalJointReport = {
  joint: number;
  cyclesEvaluated: number;
  steadyStateReached: boolean;
  maximumMotorTemperatureC: number;
  maximumReducerTemperatureC: number;
  maximumBrakeTemperatureC: number;
  motorTemperatureMarginC: number;
  reducerTemperatureMarginC: number;
  brakeTemperatureMarginC: number;
  maximumMotorLossW: number;
  maximumReducerLossW: number;
  maximumBrakeLossW: number;
  passed: boolean;
  errors: string[];
};
export type RobotDriveDutyThermalReport = {
  schema: 'nexyfab.robot-drive-duty-thermal-report.v1';
  dynamicReportSha256: string;
  thermalInputSha256: string;
  requirementsSha256: string | null;
  traceSha256: string | null;
  status: 'passed' | 'failed';
  thermalReady: boolean;
  cycleDurationS: number;
  effectivePeriodS: number;
  joints: RobotThermalJointReport[];
  errors: string[];
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

type TraceFrame = z.infer<typeof traceFrameSchema>;
type ThermalNode = z.infer<typeof thermalNodeSchema>;
type TemperatureState = { motor: number; reducer: number; brake: number };
type LossState = { motor: number; reducer: number; brake: number };

export function evaluateRobotDriveDutyThermalBytes(dynamicReportBytes: Uint8Array, thermalInputBytes: Uint8Array): RobotDriveDutyThermalReport {
  const errors: string[] = [];
  const dynamicRaw = decodeJson(dynamicReportBytes, 'dynamic report', errors);
  const inputRaw = decodeJson(thermalInputBytes, 'thermal input', errors);
  const dynamicParsed = dynamicReportSchema.safeParse(dynamicRaw);
  const inputParsed = robotDriveDutyThermalInputSchema.safeParse(inputRaw);
  if (!dynamicParsed.success) errors.push(...dynamicParsed.error.issues.map(issue => `dynamic.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (!inputParsed.success) errors.push(...inputParsed.error.issues.map(issue => `input.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (dynamicParsed.success && inputParsed.success) errors.push(...crossFieldErrors(dynamicReportBytes, dynamicParsed.data, inputParsed.data));
  if (!dynamicParsed.success || !inputParsed.success || errors.length) return failed(dynamicReportBytes, thermalInputBytes, inputParsed.success ? inputParsed.data.requirementsSha256 : null, dynamicParsed.success ? dynamicParsed.data.traceSha256 : null, errors);
  return evaluateValidated(dynamicReportBytes, thermalInputBytes, dynamicParsed.data, inputParsed.data);
}

function evaluateValidated(dynamicBytes: Uint8Array, inputBytes: Uint8Array, dynamic: z.infer<typeof dynamicReportSchema>, input: RobotDriveDutyThermalInput): RobotDriveDutyThermalReport {
  const cycleDurationS = dynamic.trace.at(-1)!.timeS - dynamic.trace[0]!.timeS;
  const effectivePeriodS = cycleDurationS / input.dutyCycleRatio;
  const offDurationS = effectivePeriodS - cycleDurationS;
  const reports = input.joints.map(joint => simulateJoint(dynamic.trace, joint, input.ambientTemperatureC, offDurationS, input.maximumEvaluationCycles, input.steadyStateToleranceC));
  const errors = reports.flatMap(report => report.errors.map(error => `J${report.joint}: ${error}`));
  const thermalReady = reports.length === 6 && reports.every(report => report.passed) && errors.length === 0;
  return {
    schema: 'nexyfab.robot-drive-duty-thermal-report.v1',
    dynamicReportSha256: digest(dynamicBytes),
    thermalInputSha256: digest(inputBytes),
    requirementsSha256: input.requirementsSha256,
    traceSha256: dynamic.traceSha256,
    status: thermalReady ? 'passed' : 'failed',
    thermalReady,
    cycleDurationS,
    effectivePeriodS,
    joints: reports,
    errors,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function simulateJoint(trace: readonly TraceFrame[], input: RobotDriveDutyThermalInput['joints'][number], ambientC: number, offDurationS: number, maximumCycles: number, toleranceC: number): RobotThermalJointReport {
  let state: TemperatureState = { motor: input.motorThermal.initialTemperatureC, reducer: input.reducerThermal.initialTemperatureC, brake: input.brakeThermal.initialTemperatureC };
  let maxima = { ...state }; let maximumLoss: LossState = { motor: 0, reducer: 0, brake: 0 }; let steady = false; let cycles = 0;
  for (cycles = 1; cycles <= maximumCycles; cycles++) {
    const priorEnd = { ...state };
    for (let frameIndex = 1; frameIndex < trace.length; frameIndex++) {
      const previous = lossesAt(trace[frameIndex - 1]!, input);
      const current = lossesAt(trace[frameIndex]!, input);
      const loss = { motor: (previous.motor + current.motor) / 2, reducer: (previous.reducer + current.reducer) / 2, brake: (previous.brake + current.brake) / 2 };
      maximumLoss = { motor: Math.max(maximumLoss.motor, previous.motor, current.motor), reducer: Math.max(maximumLoss.reducer, previous.reducer, current.reducer), brake: Math.max(maximumLoss.brake, previous.brake, current.brake) };
      const dt = trace[frameIndex]!.timeS - trace[frameIndex - 1]!.timeS;
      state = advanceAll(state, loss, dt, ambientC, input);
      maxima = maxTemperatures(maxima, state);
    }
    if (offDurationS > 0) {
      state = advanceAll(state, { motor: input.motorLoss.standbyLossW, reducer: input.reducerLoss.standbyLossW, brake: 0 }, offDurationS, ambientC, input);
      maxima = maxTemperatures(maxima, state);
    }
    const delta = Math.max(Math.abs(state.motor - priorEnd.motor), Math.abs(state.reducer - priorEnd.reducer), Math.abs(state.brake - priorEnd.brake));
    if (cycles >= 2 && delta <= toleranceC) { steady = true; break; }
  }
  const motorMargin = input.motorThermal.maximumTemperatureC - maxima.motor;
  const reducerMargin = input.reducerThermal.maximumTemperatureC - maxima.reducer;
  const brakeMargin = input.brakeThermal.maximumTemperatureC - maxima.brake;
  const errors = [
    ...(!steady ? [`thermal cycle did not reach periodic steady state within ${maximumCycles} cycles`] : []),
    ...(motorMargin < -1e-9 ? [`motor maximum temperature exceeds its limit by ${(-motorMargin).toFixed(4)} C`] : []),
    ...(reducerMargin < -1e-9 ? [`reducer maximum temperature exceeds its limit by ${(-reducerMargin).toFixed(4)} C`] : []),
    ...(brakeMargin < -1e-9 ? [`brake maximum temperature exceeds its limit by ${(-brakeMargin).toFixed(4)} C`] : []),
  ];
  return { joint: input.joint, cyclesEvaluated: Math.min(cycles, maximumCycles), steadyStateReached: steady, maximumMotorTemperatureC: maxima.motor, maximumReducerTemperatureC: maxima.reducer, maximumBrakeTemperatureC: maxima.brake, motorTemperatureMarginC: motorMargin, reducerTemperatureMarginC: reducerMargin, brakeTemperatureMarginC: brakeMargin, maximumMotorLossW: maximumLoss.motor, maximumReducerLossW: maximumLoss.reducer, maximumBrakeLossW: maximumLoss.brake, passed: errors.length === 0, errors };
}

function lossesAt(frame: TraceFrame, input: RobotDriveDutyThermalInput['joints'][number]): LossState {
  const index = input.joint - 1; const outputTorque = Math.abs(frame.torqueNm[index]!); const outputSpeedRpm = frame.speedRpm[index]!; const outputPowerW = frame.powerW[index]!;
  const efficiency = outputPowerW >= 0 ? input.motoringEfficiency : input.regeneratingEfficiency;
  const motorTorqueNm = outputPowerW >= 0 ? outputTorque / (input.gearRatio * efficiency) : outputTorque * efficiency / input.gearRatio;
  const motorSpeedRpm = outputSpeedRpm * input.gearRatio;
  const motor = input.motorLoss.constantLossW + input.motorLoss.torqueSquaredCoefficientWPerNm2 * motorTorqueNm ** 2 + input.motorLoss.speedCoefficientWPerRpm * motorSpeedRpm;
  const reducerTransmissionLoss = outputPowerW >= 0 ? Math.abs(outputPowerW) * (1 / efficiency - 1) : Math.abs(outputPowerW) * (1 - efficiency);
  const reducer = input.reducerLoss.constantLossW + reducerTransmissionLoss;
  const brake = outputSpeedRpm > 1e-9 ? input.brakeReleasePowerW : 0;
  return { motor, reducer, brake };
}

function advanceAll(state: TemperatureState, loss: LossState, durationS: number, ambientC: number, input: RobotDriveDutyThermalInput['joints'][number]): TemperatureState {
  return { motor: advanceNode(state.motor, loss.motor, durationS, ambientC, input.motorThermal), reducer: advanceNode(state.reducer, loss.reducer, durationS, ambientC, input.reducerThermal), brake: advanceNode(state.brake, loss.brake, durationS, ambientC, input.brakeThermal) };
}

function advanceNode(temperatureC: number, lossW: number, durationS: number, ambientC: number, node: ThermalNode): number {
  const steadyRiseC = lossW * node.thermalResistanceCPerW;
  const decay = Math.exp(-durationS / (node.thermalResistanceCPerW * node.thermalCapacitanceJPerC));
  return ambientC + steadyRiseC + (temperatureC - ambientC - steadyRiseC) * decay;
}

function crossFieldErrors(dynamicBytes: Uint8Array, dynamic: z.infer<typeof dynamicReportSchema>, input: RobotDriveDutyThermalInput): string[] {
  const errors: string[] = [];
  if (digest(dynamicBytes) !== input.dynamicReportSha256) errors.push('dynamic report bytes do not match dynamicReportSha256');
  if (dynamic.requirementsSha256 !== input.requirementsSha256) errors.push('thermal input requirements hash does not match the dynamic report');
  if (digest(new TextEncoder().encode(canonical(dynamic.trace))) !== dynamic.traceSha256) errors.push('dynamic trace bytes do not match traceSha256');
  const joints = input.joints.map(item => item.joint).sort((a, b) => a - b);
  if (new Set(joints).size !== 6 || joints.some((joint, index) => joint !== index + 1)) errors.push('thermal joints must contain J1..J6 exactly once');
  for (let index = 1; index < dynamic.trace.length; index++) if (!(dynamic.trace[index]!.timeS > dynamic.trace[index - 1]!.timeS)) errors.push(`dynamic trace frame ${index} time must increase strictly`);
  for (const joint of input.joints) {
    if (joint.motorLoss.constantLossW + joint.motorLoss.torqueSquaredCoefficientWPerNm2 + joint.motorLoss.speedCoefficientWPerRpm <= 0) errors.push(`J${joint.joint}: authoritative motor loss model must contain at least one positive coefficient`);
    for (const [name, node] of [['motor', joint.motorThermal], ['reducer', joint.reducerThermal], ['brake', joint.brakeThermal]] as const) {
      if (node.initialTemperatureC < input.ambientTemperatureC - 100 || node.initialTemperatureC > node.maximumTemperatureC) errors.push(`J${joint.joint}: ${name} initial temperature is outside the admissible range`);
      if (node.maximumTemperatureC <= input.ambientTemperatureC) errors.push(`J${joint.joint}: ${name} maximum temperature must exceed ambient`);
    }
  }
  return errors;
}

function failed(dynamicBytes: Uint8Array, inputBytes: Uint8Array, requirementsSha256: string | null, traceSha256: string | null, errors: string[]): RobotDriveDutyThermalReport {
  return { schema: 'nexyfab.robot-drive-duty-thermal-report.v1', dynamicReportSha256: digest(dynamicBytes), thermalInputSha256: digest(inputBytes), requirementsSha256, traceSha256, status: 'failed', thermalReady: false, cycleDurationS: 0, effectivePeriodS: 0, joints: [], errors: [...new Set(errors)], releaseReady: false, sideEffects: noSideEffects() };
}

function decodeJson(bytes: Uint8Array, label: string, errors: string[]): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function maxTemperatures(a: TemperatureState, b: TemperatureState): TemperatureState { return { motor: Math.max(a.motor, b.motor), reducer: Math.max(a.reducer, b.reducer), brake: Math.max(a.brake, b.brake) }; }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
