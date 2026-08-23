import { createHash } from 'node:crypto';
import { evaluateRobotDynamicLoadEnvelopeBytes } from './robotDynamicLoadEnvelope';
import { buildRobotDynamicLoadEnvelopeFixture } from './robotDynamicLoadEnvelope.testFixture';

const HASH = 'c'.repeat(64);
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }

export function buildRobotDriveDutyThermalFixture() {
  const dynamicInputBytes = new TextEncoder().encode(JSON.stringify(buildRobotDynamicLoadEnvelopeFixture()));
  const dynamicReport = evaluateRobotDynamicLoadEnvelopeBytes(dynamicInputBytes);
  const dynamicReportBytes = new TextEncoder().encode(JSON.stringify(dynamicReport));
  const thermalNode = { thermalResistanceCPerW: 1, thermalCapacitanceJPerC: 10, maximumTemperatureC: 40, initialTemperatureC: 20 };
  const thermalInput = {
    schema: 'nexyfab.robot-drive-duty-thermal-input.v1' as const,
    dynamicReportSha256: digest(dynamicReportBytes),
    requirementsSha256: dynamicReport.requirementsSha256!,
    ambientTemperatureC: 20,
    dutyCycleRatio: 1,
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
      reducerThermal: { ...thermalNode, maximumTemperatureC: 50 },
      brakeThermal: { ...thermalNode, maximumTemperatureC: 50 },
      sourceArtifactSha256: HASH,
    })),
  };
  return { dynamicReport, dynamicReportBytes, thermalInput };
}
