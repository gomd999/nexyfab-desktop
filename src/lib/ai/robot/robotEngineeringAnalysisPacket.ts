import { createHash } from 'node:crypto';
import { evaluateRobotBearingReducerLifeBytes, robotBearingReducerLifeInputSchema, type RobotBearingReducerLifeReport } from './robotBearingReducerLife';
import { evaluateRobotDriveDutyThermalBytes, robotDriveDutyThermalInputSchema, type RobotDriveDutyThermalReport } from './robotDriveDutyThermal';
import {
  evaluateRobotDynamicLoadEnvelopeBytes,
  robotDynamicLoadEnvelopeInputSchema,
  type RobotDynamicLoadEnvelopeReport,
} from './robotDynamicLoadEnvelope';
import { evaluateRobotStructuralComplianceBytes, robotStructuralComplianceInputSchema, type RobotStructuralComplianceReport } from './robotStructuralCompliance';
import {
  evaluateRobotTcpPositionErrorBudgetBytes,
  robotTcpPositionErrorBudgetInputSchema,
  type RobotTcpPositionErrorBudgetReport,
} from './robotTcpPositionErrorBudget';
import {
  robotSystemRequirementsV2Schema,
  verifyRobotSystemRequirementsBytes,
} from './robotSystemRequirements';

export type RobotEngineeringAnalysisPacketReport = {
  schema: 'nexyfab.robot-engineering-analysis-packet.v1';
  applicationHash: string;
  requirementsFileSha256: string;
  frozenRequirementsSha256: string | null;
  dynamicInputSha256: string;
  dynamicReportSha256: string;
  thermalInputSha256: string;
  lifeInputSha256: string;
  complianceInputSha256: string;
  precisionInputSha256: string;
  payloadCaseId: string | null;
  governedPathArtifactSha256: string | null;
  status: 'passed' | 'failed';
  engineeringAnalysisReady: boolean;
  componentStatus: {
    requirements: boolean;
    dynamics: boolean;
    thermal: boolean;
    life: boolean;
    structuralCompliance: boolean;
    tcpPrecisionBudget: boolean;
    structuralPrecisionBinding: boolean;
  };
  dynamic: RobotDynamicLoadEnvelopeReport;
  thermal: RobotDriveDutyThermalReport;
  life: RobotBearingReducerLifeReport;
  structuralCompliance: RobotStructuralComplianceReport;
  tcpPrecisionBudget: RobotTcpPositionErrorBudgetReport;
  errors: string[];
  scope: { onePayloadPathCombination: true; fullRequirementsCoverageComplete: false };
  externalValidationRequired: readonly ['tcp_accuracy_repeatability', 'structural_stiffness', 'thermal_duty', 'service_life'];
  externalValidationComplete: false;
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export type RobotEngineeringAnalysisPacketFiles = {
  requirements: Uint8Array;
  dynamicInput: Uint8Array;
  dynamicReport: Uint8Array;
  thermalInput: Uint8Array;
  lifeInput: Uint8Array;
  complianceInput: Uint8Array;
  precisionInput: Uint8Array;
};

export function evaluateRobotEngineeringAnalysisPacket(files: RobotEngineeringAnalysisPacketFiles): RobotEngineeringAnalysisPacketReport {
  const errors: string[] = [];
  const requirementsVerification = verifyRobotSystemRequirementsBytes(files.requirements);
  if (!requirementsVerification.requirementsReady) errors.push(...requirementsVerification.errors.map(error => `requirements: ${error}`));
  const requirementsParsed = robotSystemRequirementsV2Schema.safeParse(decodeJson(files.requirements, 'requirements', errors));
  const dynamicInputParsed = robotDynamicLoadEnvelopeInputSchema.safeParse(decodeJson(files.dynamicInput, 'dynamic input', errors));
  const thermalInputParsed = robotDriveDutyThermalInputSchema.safeParse(decodeJson(files.thermalInput, 'thermal input', errors));
  const lifeInputParsed = robotBearingReducerLifeInputSchema.safeParse(decodeJson(files.lifeInput, 'life input', errors));
  const complianceInputParsed = robotStructuralComplianceInputSchema.safeParse(decodeJson(files.complianceInput, 'compliance input', errors));
  const precisionInputParsed = robotTcpPositionErrorBudgetInputSchema.safeParse(decodeJson(files.precisionInput, 'precision input', errors));
  const suppliedDynamicReport = decodeJson(files.dynamicReport, 'dynamic report', errors);
  const dynamic = evaluateRobotDynamicLoadEnvelopeBytes(files.dynamicInput);
  const thermal = evaluateRobotDriveDutyThermalBytes(files.dynamicReport, files.thermalInput);
  const life = evaluateRobotBearingReducerLifeBytes(files.dynamicReport, files.lifeInput);
  const structuralCompliance = evaluateRobotStructuralComplianceBytes(files.requirements, files.complianceInput);
  const tcpPrecisionBudget = evaluateRobotTcpPositionErrorBudgetBytes(files.requirements, files.precisionInput);

  if (!requirementsParsed.success) errors.push('requirements schema is invalid');
  if (!dynamicInputParsed.success) errors.push('dynamic input schema is invalid');
  if (!thermalInputParsed.success) errors.push('thermal input schema is invalid');
  if (!lifeInputParsed.success) errors.push('life input schema is invalid');
  if (!complianceInputParsed.success) errors.push('compliance input schema is invalid');
  if (!precisionInputParsed.success) errors.push('precision input schema is invalid');
  if (canonical(suppliedDynamicReport) !== canonical(dynamic)) errors.push('supplied dynamic report does not equal the independently recomputed report');

  let structuralPrecisionBinding = false;
  if (requirementsParsed.success && dynamicInputParsed.success && thermalInputParsed.success && lifeInputParsed.success && complianceInputParsed.success && precisionInputParsed.success && requirementsVerification.frozenRequirementsSha256) {
    const requirements = requirementsParsed.data;
    const dynamicInput = dynamicInputParsed.data;
    if (dynamicInput.requirementsSha256 !== requirementsVerification.frozenRequirementsSha256) errors.push('dynamic input is not bound to the canonical frozen requirements');
    if (!requirements.motion.governedPaths.some(path => path.artifactSha256 === dynamicInput.pathArtifactSha256)) errors.push('dynamic input path is not a governed path in the frozen requirements');
    const payload = requirements.mechanics.payloadCases.find(item => item.id === dynamicInput.payload.caseId);
    if (!payload) errors.push('dynamic payload case is not governed by the frozen requirements');
    else {
      if (payload.massKg !== dynamicInput.payload.massKg) errors.push('dynamic payload mass differs from the frozen payload case');
      if (canonical(payload.centerOfMassMm) !== canonical(dynamicInput.payload.centerOfMassToolMm)) errors.push('dynamic payload center of mass differs from the frozen payload case');
      if (canonical(payload.inertiaKgM2) !== canonical(dynamicInput.payload.inertiaToolKgM2)) errors.push('dynamic payload inertia differs from the frozen payload case');
      if (payload.authority.sourceArtifactSha256 !== dynamicInput.payload.sourceArtifactSha256) errors.push('dynamic payload authority differs from the frozen payload case');
    }
    if (thermalInputParsed.data.dutyCycleRatio !== requirements.performance.dutyCycleRatio) errors.push('thermal duty cycle differs from the frozen performance requirement');
    if (lifeInputParsed.data.requiredServiceLifeCycles !== requirements.performance.serviceLifeCycles) errors.push('life cycles differ from the frozen service-life requirement');
    if (lifeInputParsed.data.cycleTimeS !== requirements.performance.cycleTimeS) errors.push('life cycle time differs from the frozen performance requirement');
    if (dynamicInput.modelArtifactSha256 !== complianceInputParsed.data.kinematicModelArtifactSha256 || dynamicInput.modelArtifactSha256 !== precisionInputParsed.data.kinematicModelArtifactSha256) errors.push('dynamic, structural and precision kinematic model hashes differ');
    const structuralContributors = precisionInputParsed.data.contributors.filter(item => item.category === 'structural_compliance');
    if (structuralContributors.length !== 1 || structuralContributors[0]?.kind !== 'tcp_position_mm') {
      errors.push('precision budget must contain exactly one Cartesian structural_compliance contributor');
    } else if (structuralCompliance.maximumTcpDeflectionMm === null || structuralContributors[0].accuracyBound + 1e-12 < structuralCompliance.maximumTcpDeflectionMm) {
      errors.push('precision structural_compliance bound is below the computed maximum TCP structural deflection');
    } else {
      structuralPrecisionBinding = true;
    }
  }

  if (!dynamic.dynamicsReady) errors.push(...dynamic.errors.map(error => `dynamics: ${error}`));
  if (!thermal.thermalReady) errors.push(...thermal.errors.map(error => `thermal: ${error}`));
  if (!life.lifeReady) errors.push(...life.errors.map(error => `life: ${error}`));
  if (!structuralCompliance.structuralComplianceReady) errors.push(...structuralCompliance.errors.map(error => `structural: ${error}`));
  if (!tcpPrecisionBudget.precisionBudgetReady) errors.push(...tcpPrecisionBudget.errors.map(error => `precision: ${error}`));

  const componentStatus = {
    requirements: requirementsVerification.requirementsReady,
    dynamics: dynamic.dynamicsReady,
    thermal: thermal.thermalReady,
    life: life.lifeReady,
    structuralCompliance: structuralCompliance.structuralComplianceReady,
    tcpPrecisionBudget: tcpPrecisionBudget.precisionBudgetReady,
    structuralPrecisionBinding,
  };
  const uniqueErrors = [...new Set(errors)];
  const engineeringAnalysisReady = Object.values(componentStatus).every(Boolean) && uniqueErrors.length === 0;
  const hashes = {
    requirementsFileSha256: digest(files.requirements),
    dynamicInputSha256: digest(files.dynamicInput),
    dynamicReportSha256: digest(files.dynamicReport),
    thermalInputSha256: digest(files.thermalInput),
    lifeInputSha256: digest(files.lifeInput),
    complianceInputSha256: digest(files.complianceInput),
    precisionInputSha256: digest(files.precisionInput),
  };
  return {
    schema: 'nexyfab.robot-engineering-analysis-packet.v1',
    applicationHash: digest(new TextEncoder().encode(canonical({ ...hashes, frozenRequirementsSha256: requirementsVerification.frozenRequirementsSha256, componentStatus }))),
    ...hashes,
    frozenRequirementsSha256: requirementsVerification.frozenRequirementsSha256,
    payloadCaseId: dynamic.payloadCaseId,
    governedPathArtifactSha256: dynamic.pathArtifactSha256,
    status: engineeringAnalysisReady ? 'passed' : 'failed',
    engineeringAnalysisReady,
    componentStatus,
    dynamic,
    thermal,
    life,
    structuralCompliance,
    tcpPrecisionBudget,
    errors: uniqueErrors,
    scope: { onePayloadPathCombination: true, fullRequirementsCoverageComplete: false },
    externalValidationRequired: ['tcp_accuracy_repeatability', 'structural_stiffness', 'thermal_duty', 'service_life'],
    externalValidationComplete: false,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function decodeJson(bytes: Uint8Array, label: string, errors: string[]): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
