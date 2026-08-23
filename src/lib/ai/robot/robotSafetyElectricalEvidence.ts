import { createHash } from 'node:crypto';
import { z } from 'zod';
import { robotSystemRequirementsV2Schema, verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const text = z.string().trim().min(1).max(2_000);
const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const standardId = z.enum(['ISO_10218_1', 'ISO_10218_2', 'ISO_12100', 'ISO_13849_1', 'IEC_60204_1', 'ISO_9283']);
const circuitSubject = z.enum(['main_supply', 'motor_power', 'brake_power', 'control_power', 'protective_bonding', 'emergency_stop', 'encoder_io']);

export const robotSafetyElectricalEvidenceInputSchema = z.object({
  schema: z.literal('nexyfab.robot-safety-electrical-design-input.v1'),
  requirementsFileSha256: sha,
  frozenRequirementsSha256: sha,
  certificationRequested: z.literal(false),
  standards: z.array(z.object({ id: standardId, edition: text, checkedAt: z.string().datetime({ offset: true }), sourceArtifactSha256: sha }).strict()).length(6),
  hazardControls: z.array(z.object({
    hazardId: id,
    safetyFunctionIds: z.array(id).min(1).max(32),
    riskReductionMeasures: z.array(text).min(1).max(32),
    residualRisk: text,
    acceptanceStatus: z.literal('pending_expert_review'),
    analysisArtifactSha256: sha,
  }).strict()).min(1).max(256),
  safetyFunctions: z.array(z.object({
    safetyFunctionId: id,
    requiredPerformanceTarget: text,
    verificationMethod: text,
    verificationPlanArtifactSha256: sha,
    validationStatus: z.literal('planned'),
  }).strict()).min(1).max(128),
  electrical: z.object({
    supply: z.object({ kind: z.enum(['ac_single_phase', 'ac_three_phase', 'dc']), nominalVoltageV: positive, phases: z.union([z.literal(1), z.literal(3)]), frequencyHz: nonnegative }).strict(),
    calculatedPeakPowerW: positive,
    calculatedRmsPowerW: positive,
    maximumRegenerativeReturnW: nonnegative,
    powerBudgetArtifactSha256: sha,
    oneLineArtifactSha256: sha,
    circuits: z.array(z.object({ subject: circuitSubject, nominalVoltageV: nonnegative, maximumCurrentA: nonnegative, conductorCrossSectionMm2: positive, protection: text, evidenceArtifactSha256: sha }).strict()).length(7),
    safetyIo: z.array(z.object({ safetyFunctionId: id, inputChannels: z.array(text).min(1).max(32), outputChannels: z.array(text).min(1).max(32), diagnosticChannels: z.array(text).min(1).max(32), mappingArtifactSha256: sha }).strict()).min(1).max(128),
    protectiveBondingDesignArtifactSha256: sha,
    electricalInspectionPlanArtifactSha256: sha,
  }).strict(),
  faultValidationPlans: z.array(z.object({ safetyFunctionId: id, injectedFaults: z.array(text).min(1).max(64), expectedSafeState: text, executionStatus: z.literal('planned'), planArtifactSha256: sha }).strict()).min(1).max(128),
  expertReviewPlanArtifactSha256: sha,
}).strict();

export type RobotSafetyElectricalEvidenceInput = z.infer<typeof robotSafetyElectricalEvidenceInputSchema>;
export type RobotSafetyElectricalEvidenceReport = {
  schema: 'nexyfab.robot-safety-electrical-design-report.v1';
  requirementsFileSha256: string;
  inputSha256: string;
  frozenRequirementsSha256: string | null;
  status: 'passed' | 'failed';
  designSupportReady: boolean;
  counts: { standards: number; hazards: number; safetyFunctions: number; circuits: number; safetyIoMappings: number; faultValidationPlans: number };
  errors: string[];
  physicalFaultValidationComplete: false;
  expertSafetyReviewComplete: false;
  regulatoryConformityAssessed: false;
  certificationClaimed: false;
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function evaluateRobotSafetyElectricalEvidenceBytes(requirementsBytes: Uint8Array, inputBytes: Uint8Array): RobotSafetyElectricalEvidenceReport {
  const errors: string[] = [];
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.requirementsReady) errors.push(...verification.errors.map(error => `requirements: ${error}`));
  const requirementsParsed = robotSystemRequirementsV2Schema.safeParse(decodeJson(requirementsBytes, 'requirements', errors));
  const inputParsed = robotSafetyElectricalEvidenceInputSchema.safeParse(decodeJson(inputBytes, 'safety and electrical input', errors));
  if (!requirementsParsed.success) errors.push('requirements schema is invalid');
  if (!inputParsed.success) errors.push(...inputParsed.error.issues.map(issue => `input.${issue.path.join('.') || '$'}: ${issue.message}`));
  const requirements = requirementsParsed.success ? requirementsParsed.data : null;
  const input = inputParsed.success ? inputParsed.data : null;
  if (requirements && input && verification.frozenRequirementsSha256) {
    if (digest(requirementsBytes) !== input.requirementsFileSha256) errors.push('requirements bytes do not match requirementsFileSha256');
    if (verification.frozenRequirementsSha256 !== input.frozenRequirementsSha256) errors.push('canonical frozen requirements do not match frozenRequirementsSha256');
    crossFieldErrors(requirements, input, errors);
  }
  const uniqueErrors = [...new Set(errors)];
  const designSupportReady = Boolean(requirements && input && verification.requirementsReady && uniqueErrors.length === 0);
  return {
    schema: 'nexyfab.robot-safety-electrical-design-report.v1',
    requirementsFileSha256: digest(requirementsBytes),
    inputSha256: digest(inputBytes),
    frozenRequirementsSha256: verification.frozenRequirementsSha256,
    status: designSupportReady ? 'passed' : 'failed',
    designSupportReady,
    counts: { standards: input?.standards.length ?? 0, hazards: input?.hazardControls.length ?? 0, safetyFunctions: input?.safetyFunctions.length ?? 0, circuits: input?.electrical.circuits.length ?? 0, safetyIoMappings: input?.electrical.safetyIo.length ?? 0, faultValidationPlans: input?.faultValidationPlans.length ?? 0 },
    errors: uniqueErrors,
    physicalFaultValidationComplete: false,
    expertSafetyReviewComplete: false,
    regulatoryConformityAssessed: false,
    certificationClaimed: false,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function crossFieldErrors(requirements: z.infer<typeof robotSystemRequirementsV2Schema>, input: RobotSafetyElectricalEvidenceInput, errors: string[]) {
  exactEnumSet(input.standards.map(item => item.id), standardId.options, 'standards baseline', errors);
  const hazardIds = requirements.safety.hazards.map(item => item.id);
  exactSet(input.hazardControls.map(item => item.hazardId), hazardIds, 'hazard controls', errors);
  const requirementFunctions = requirements.safety.safetyFunctions;
  const safetyFunctionIds = requirementFunctions.map(item => item.id);
  exactSet(input.safetyFunctions.map(item => item.safetyFunctionId), safetyFunctionIds, 'safety-function verification plans', errors);
  exactSet(input.electrical.safetyIo.map(item => item.safetyFunctionId), safetyFunctionIds, 'safety I/O mappings', errors);
  exactSet(input.faultValidationPlans.map(item => item.safetyFunctionId), safetyFunctionIds, 'fault-validation plans', errors);
  for (const control of input.hazardControls) {
    if (new Set(control.safetyFunctionIds).size !== control.safetyFunctionIds.length) errors.push(`${control.hazardId}: safety-function references must be unique`);
    const expected = requirementFunctions.filter(item => item.hazardIds.includes(control.hazardId)).map(item => item.id).sort();
    if (canonical([...control.safetyFunctionIds].sort()) !== canonical(expected)) errors.push(`${control.hazardId}: safety-function links differ from frozen requirements`);
  }
  for (const evidence of input.safetyFunctions) {
    const expected = requirementFunctions.find(item => item.id === evidence.safetyFunctionId);
    if (expected && evidence.requiredPerformanceTarget !== expected.requiredPerformanceTarget) errors.push(`${evidence.safetyFunctionId}: required performance target differs from frozen requirements`);
  }
  for (const plan of input.faultValidationPlans) {
    const expected = requirementFunctions.find(item => item.id === plan.safetyFunctionId);
    if (expected && plan.expectedSafeState !== expected.safeState) errors.push(`${plan.safetyFunctionId}: expected safe state differs from frozen requirements`);
    if (new Set(plan.injectedFaults).size !== plan.injectedFaults.length) errors.push(`${plan.safetyFunctionId}: injected fault cases must be unique`);
  }
  const supply = requirements.power.supply;
  if (canonical(input.electrical.supply) !== canonical(supply)) errors.push('electrical supply differs from frozen requirements');
  if (input.electrical.calculatedPeakPowerW > requirements.power.peakPowerW) errors.push('calculated peak power exceeds the frozen power budget');
  if (input.electrical.calculatedRmsPowerW > requirements.power.rmsPowerW) errors.push('calculated RMS power exceeds the frozen power budget');
  if (input.electrical.calculatedPeakPowerW < input.electrical.calculatedRmsPowerW) errors.push('calculated peak power must not be below calculated RMS power');
  if (input.electrical.maximumRegenerativeReturnW > requirements.power.regenerative.maximumReturnPowerW) errors.push('regenerative return exceeds the frozen power budget');
  exactEnumSet(input.electrical.circuits.map(item => item.subject), circuitSubject.options, 'electrical circuit subjects', errors);
  for (const mapping of input.electrical.safetyIo) {
    for (const [label, channels] of [['input', mapping.inputChannels], ['output', mapping.outputChannels], ['diagnostic', mapping.diagnosticChannels]] as const) if (new Set(channels).size !== channels.length) errors.push(`${mapping.safetyFunctionId}: ${label} channels must be unique`);
  }
}

function exactSet(actual: readonly string[], expected: readonly string[], label: string, errors: string[]) {
  if (new Set(actual).size !== actual.length || canonical([...actual].sort()) !== canonical([...expected].sort())) errors.push(`${label} must cover the frozen set exactly once`);
}
function exactEnumSet<T extends string>(actual: readonly T[], expected: readonly T[], label: string, errors: string[]) { exactSet(actual, expected, label, errors); }
function decodeJson(bytes: Uint8Array, label: string, errors: string[]): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
