import { createHash } from 'node:crypto';
import { buildRobotDynamicLoadEnvelopeFixture } from './robotDynamicLoadEnvelope.testFixture';
import { evaluateRobotDynamicLoadEnvelopeBytes } from './robotDynamicLoadEnvelope';
import { buildRobotStructuralComplianceFixture } from './robotStructuralCompliance.testFixture';
import { buildValidRobotSystemRequirementsFixture } from './robotSystemRequirements.testFixture';
import { buildRobotTcpPositionErrorBudgetFixture } from './robotTcpPositionErrorBudget.testFixture';
import { verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';

const HASH = 'f'.repeat(64);
const SOURCE_HASH = 'a'.repeat(64);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

export function buildRobotEngineeringAnalysisPacketFixture(options: { requirementsBytes?: Uint8Array; payloadCaseId?: string } = {}) {
  const requirementsBytes = options.requirementsBytes ?? encode(buildValidRobotSystemRequirementsFixture());
  const requirementsValue = JSON.parse(new TextDecoder().decode(requirementsBytes)) as ReturnType<typeof buildValidRobotSystemRequirementsFixture>;
  const requirementsVerification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!requirementsVerification.frozenRequirementsSha256) throw new Error('requirements fixture must verify');

  const dynamicInput = buildRobotDynamicLoadEnvelopeFixture();
  dynamicInput.requirementsSha256 = requirementsVerification.frozenRequirementsSha256;
  dynamicInput.modelArtifactSha256 = HASH;
  dynamicInput.pathArtifactSha256 = SOURCE_HASH;
  const governedPayload = requirementsValue.mechanics.payloadCases.find(item => item.id === (options.payloadCaseId ?? 'payload-zero'));
  if (!governedPayload) throw new Error('requested payload fixture must exist in requirements');
  dynamicInput.payload = {
    caseId: governedPayload.id,
    massKg: governedPayload.massKg,
    centerOfMassToolMm: governedPayload.centerOfMassMm,
    inertiaToolKgM2: governedPayload.inertiaKgM2,
    sourceArtifactSha256: governedPayload.authority.sourceArtifactSha256,
  };
  for (const drive of dynamicInput.drives) {
    drive.maximumMechanicalPowerW = 1_000_000;
    drive.torqueSpeedCurve = [
      { speedRpm: 0, continuousTorqueNm: 5_000, peakTorqueNm: 10_000 },
      { speedRpm: 100, continuousTorqueNm: 2_500, peakTorqueNm: 5_000 },
    ];
  }
  const dynamicInputBytes = encode(dynamicInput);
  const dynamicReport = evaluateRobotDynamicLoadEnvelopeBytes(dynamicInputBytes);
  const dynamicReportBytes = encode(dynamicReport);

  const thermalNode = { thermalResistanceCPerW: 1, thermalCapacitanceJPerC: 10, maximumTemperatureC: 60, initialTemperatureC: 20 };
  const thermalInput = {
    schema: 'nexyfab.robot-drive-duty-thermal-input.v1' as const,
    dynamicReportSha256: digest(dynamicReportBytes),
    requirementsSha256: requirementsVerification.frozenRequirementsSha256,
    ambientTemperatureC: 20,
    dutyCycleRatio: 0.7,
    maximumEvaluationCycles: 1_000,
    steadyStateToleranceC: 1e-6,
    joints: Array.from({ length: 6 }, (_, index) => ({
      joint: index + 1,
      gearRatio: 1,
      motoringEfficiency: 0.9,
      regeneratingEfficiency: 0.8,
      motorLoss: { constantLossW: 10, torqueSquaredCoefficientWPerNm2: 0, speedCoefficientWPerRpm: 0, standbyLossW: 1 },
      reducerLoss: { constantLossW: 0, standbyLossW: 0 },
      brakeReleasePowerW: 0,
      motorThermal: { ...thermalNode },
      reducerThermal: { ...thermalNode },
      brakeThermal: { ...thermalNode },
      sourceArtifactSha256: SOURCE_HASH,
    })),
  };

  const lifeInput = {
    schema: 'nexyfab.robot-bearing-reducer-life-input.v1' as const,
    dynamicReportSha256: digest(dynamicReportBytes),
    requirementsSha256: requirementsVerification.frozenRequirementsSha256,
    requiredServiceLifeCycles: 10_000_000,
    cycleTimeS: 4,
    joints: Array.from({ length: 6 }, (_, index) => ({
      joint: index + 1,
      spectrumArtifactSha256: SOURCE_HASH,
      spectrum: [{ durationFraction: 1, outputTorqueNm: 5_000, outputSpeedRpm: 100, equivalentBearingLoadN: 10, peakBearingLoadN: 20 }],
      bearing: { dynamicLoadRatingN: 100_000, staticLoadRatingN: 100_000, lifeExponent: 3 as const, reliabilityFactor: 1, requiredStaticSafetyFactor: 1.5, sourceArtifactSha256: SOURCE_HASH },
      reducer: { ratedOutputTorqueNm: 10_000, peakOutputTorqueNm: 20_000, ratedOutputSpeedRpm: 100, ratedLifeHours: 1_000_000, lifeExponent: 3, sourceArtifactSha256: SOURCE_HASH },
    })),
  };

  const complianceFixture = buildRobotStructuralComplianceFixture();
  const complianceInput = complianceFixture.complianceInput;
  complianceInput.requirementsFileSha256 = digest(requirementsBytes);
  complianceInput.frozenRequirementsSha256 = requirementsVerification.frozenRequirementsSha256;
  complianceInput.kinematicModelArtifactSha256 = HASH;

  const precisionFixture = buildRobotTcpPositionErrorBudgetFixture();
  const precisionInput = precisionFixture.precisionInput;
  precisionInput.requirementsFileSha256 = digest(requirementsBytes);
  precisionInput.frozenRequirementsSha256 = requirementsVerification.frozenRequirementsSha256;
  precisionInput.kinematicModelArtifactSha256 = HASH;
  const structural = precisionInput.contributors.find(item => item.category === 'structural_compliance');
  if (!structural) throw new Error('precision fixture needs structural contributor');
  structural.accuracyBound = 0.1;

  return {
    requirements: requirementsBytes,
    dynamicInput: dynamicInputBytes,
    dynamicReport: dynamicReportBytes,
    thermalInput: encode(thermalInput),
    lifeInput: encode(lifeInput),
    complianceInput: encode(complianceInput),
    precisionInput: encode(precisionInput),
  };
}
