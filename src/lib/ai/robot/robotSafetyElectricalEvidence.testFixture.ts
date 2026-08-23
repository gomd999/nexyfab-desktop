import { createHash } from 'node:crypto';
import { buildValidRobotSystemRequirementsFixture } from './robotSystemRequirements.testFixture';
import { verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';

const HASH = 'c'.repeat(64);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function buildRobotSafetyElectricalEvidenceFixture() {
  const requirements = buildValidRobotSystemRequirementsFixture();
  const requirementsBytes = encode(requirements);
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.frozenRequirementsSha256) throw new Error('requirements fixture must verify');
  const standardIds = ['ISO_10218_1', 'ISO_10218_2', 'ISO_12100', 'ISO_13849_1', 'IEC_60204_1', 'ISO_9283'] as const;
  const circuitSubjects = ['main_supply', 'motor_power', 'brake_power', 'control_power', 'protective_bonding', 'emergency_stop', 'encoder_io'] as const;
  const safetyFunction = requirements.safety.safetyFunctions[0]!;
  const safetyInput = {
    schema: 'nexyfab.robot-safety-electrical-design-input.v1' as const,
    requirementsFileSha256: digest(requirementsBytes),
    frozenRequirementsSha256: verification.frozenRequirementsSha256,
    certificationRequested: false as const,
    standards: standardIds.map(id => ({ id, edition: 'Governed edition selected for product review.', checkedAt: '2026-08-12T00:00:00+09:00', sourceArtifactSha256: HASH })),
    hazardControls: requirements.safety.hazards.map(hazard => ({ hazardId: hazard.id, safetyFunctionIds: requirements.safety.safetyFunctions.filter(item => item.hazardIds.includes(hazard.id)).map(item => item.id), riskReductionMeasures: ['Guarding and monitored protective stop are included in the design review.'], residualRisk: 'Application integrator must validate the safeguarded cell and residual risk.', acceptanceStatus: 'pending_expert_review' as const, analysisArtifactSha256: HASH })),
    safetyFunctions: requirements.safety.safetyFunctions.map(item => ({ safetyFunctionId: item.id, requiredPerformanceTarget: item.requiredPerformanceTarget, verificationMethod: 'Review architecture, calculate target and execute governed fault injection.', verificationPlanArtifactSha256: HASH, validationStatus: 'planned' as const })),
    electrical: {
      supply: { ...requirements.power.supply },
      calculatedPeakPowerW: 10_000,
      calculatedRmsPowerW: 4_000,
      maximumRegenerativeReturnW: 3_000,
      powerBudgetArtifactSha256: HASH,
      oneLineArtifactSha256: HASH,
      circuits: circuitSubjects.map(subject => ({ subject, nominalVoltageV: subject === 'brake_power' || subject === 'control_power' || subject === 'encoder_io' ? 24 : 400, maximumCurrentA: 20, conductorCrossSectionMm2: 2.5, protection: 'Governed protective device and disconnect are specified in the electrical design.', evidenceArtifactSha256: HASH })),
      safetyIo: requirements.safety.safetyFunctions.map(item => ({ safetyFunctionId: item.id, inputChannels: [`${item.id}-input`], outputChannels: [`${item.id}-output`], diagnosticChannels: [`${item.id}-diagnostic`], mappingArtifactSha256: HASH })),
      protectiveBondingDesignArtifactSha256: HASH,
      electricalInspectionPlanArtifactSha256: HASH,
    },
    faultValidationPlans: requirements.safety.safetyFunctions.map(item => ({ safetyFunctionId: item.id, injectedFaults: ['Open input channel', 'Output feedback mismatch'], expectedSafeState: item.safeState, executionStatus: 'planned' as const, planArtifactSha256: HASH })),
    expertReviewPlanArtifactSha256: HASH,
  };
  return { requirementsBytes, safetyInput, safetyFunction };
}
