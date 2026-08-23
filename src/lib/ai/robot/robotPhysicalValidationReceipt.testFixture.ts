import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { buildRobotCableLifeSweepFixture } from './robotCableLifeSweep.testFixture';
import { evaluateRobotCableLifeSweepBytes } from './robotCableLifeSweep';
import { buildRobotEngineeringCoverageMatrixFixture } from './robotEngineeringCoverageMatrix.testFixture';
import { evaluateRobotEngineeringCoverageMatrix } from './robotEngineeringCoverageMatrix';
import { buildRobotMotionCoverageFixture } from './robotMotionCoverage.testFixture';
import { evaluateRobotMotionCoverageBytes } from './robotMotionCoverage';
import { buildRobotSafetyElectricalEvidenceFixture } from './robotSafetyElectricalEvidence.testFixture';
import { evaluateRobotSafetyElectricalEvidenceBytes } from './robotSafetyElectricalEvidence';
import { robotPhysicalValidationReceiptPayload, type RobotPhysicalValidationReceipt, type TrustedRobotPhysicalValidationKeys } from './robotPhysicalValidationReceipt';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const required: Record<RobotPhysicalValidationReceipt['stages'][number]['stage'], string[]> = {
  joint_rig: ['rated_torque', 'peak_torque', 'brake_hold', 'backlash', 'encoder_repeatability', 'bearing_temperature', 'motor_temperature', 'reducer_temperature', 'current'],
  wrist_assembly: ['cable_twist', 'connector_load', 'near_contact_clearance', 'thermal_coupling'],
  six_axis_prototype: ['tcp_accuracy', 'tcp_repeatability', 'cycle_time', 'temperature', 'vibration', 'current_power', 'cable_motion', 'safety_fault_validation'],
  endurance_teardown: ['cycle_count', 'wear', 'fastener_loosening', 'cable_damage', 'lubrication', 'seals'],
};

export function buildRobotPhysicalValidationReceiptFixture() {
  const engineeringFixture = buildRobotEngineeringCoverageMatrixFixture();
  const engineeringCoverage = encode(evaluateRobotEngineeringCoverageMatrix(engineeringFixture.requirementsBytes, engineeringFixture.manifestBytes, engineeringFixture.artifacts));
  const engineeringValue = JSON.parse(new TextDecoder().decode(engineeringCoverage)) as ReturnType<typeof evaluateRobotEngineeringCoverageMatrix>;
  const motionFixture = buildRobotMotionCoverageFixture();
  const motionCoverage = encode(evaluateRobotMotionCoverageBytes(motionFixture.requirementsBytes, encode(motionFixture.motionInput), motionFixture.sweptEvidenceArtifacts, motionFixture.trustedSigners));
  const motionValue = JSON.parse(new TextDecoder().decode(motionCoverage)) as ReturnType<typeof evaluateRobotMotionCoverageBytes>;
  const cableFixture = buildRobotCableLifeSweepFixture();
  const cableLife = encode(evaluateRobotCableLifeSweepBytes(cableFixture.requirementsBytes, cableFixture.motionReportBytes, encode(cableFixture.cableInput)));
  const cableValue = JSON.parse(new TextDecoder().decode(cableLife)) as ReturnType<typeof evaluateRobotCableLifeSweepBytes>;
  const safetyFixture = buildRobotSafetyElectricalEvidenceFixture();
  const safetyElectrical = encode(evaluateRobotSafetyElectricalEvidenceBytes(safetyFixture.requirementsBytes, encode(safetyFixture.safetyInput)));
  const safetyValue = JSON.parse(new TextDecoder().decode(safetyElectrical)) as ReturnType<typeof evaluateRobotSafetyElectricalEvidenceBytes>;

  const artifacts = new Map<string, Uint8Array>();
  artifacts.set('as-built-bom.json', encode({ specimen: 'robot-001', parts: 29 }));
  const stages = (['joint_rig', 'wrist_assembly', 'six_axis_prototype', 'endurance_teardown'] as const).map((stageName, index) => {
    const rawName = `${stageName}-raw.csv`, calibrationName = `${stageName}-calibration.json`;
    artifacts.set(rawName, encode({ stage: stageName, samples: [1, 1, 1] }));
    artifacts.set(calibrationName, encode({ equipmentId: `${stageName}-equipment`, validThrough: '2027-08-12T00:00:00+09:00' }));
    return {
      stage: stageName,
      startedAt: `2026-08-12T0${index * 2}:00:00+09:00`,
      completedAt: `2026-08-12T0${index * 2 + 1}:00:00+09:00`,
      environment: { temperatureC: 23, relativeHumidityPct: 50, location: 'Governed physical validation laboratory.' },
      calibration: [{ equipmentId: `${stageName}-equipment`, artifactName: calibrationName, artifactSha256: digest(artifacts.get(calibrationName)!), validThrough: '2027-08-12T00:00:00+09:00' }],
      measurements: required[stageName].map(subject => ({
        subject,
        value: subject === 'cycle_count' ? 10_000_000 : 1,
        unit: subject === 'cycle_count' ? 'cycles' : 'governed_unit',
        uncertainty: 0,
        acceptance: subject === 'cycle_count' ? { operator: 'gte' as const, limit: 10_000_000, tolerance: 0 } : { operator: 'lte' as const, limit: 2, tolerance: 0 },
        passed: true as const,
        rawDataArtifactName: rawName,
        rawDataArtifactSha256: digest(artifacts.get(rawName)!),
      })),
    };
  });
  const artifactDeclarations = [...artifacts].map(([name, bytes]) => ({ name, sha256: digest(bytes), kind: name === 'as-built-bom.json' ? 'as_built_bom' as const : name.endsWith('-raw.csv') ? 'raw_data' as const : 'calibration' as const }));
  const unsigned: Omit<RobotPhysicalValidationReceipt, 'signatures'> = {
    schema: 'nexyfab.robot-physical-validation-receipt.v1',
    frozenRequirementsSha256: engineeringValue.frozenRequirementsSha256!,
    engineeringCoverageReportSha256: digest(engineeringCoverage),
    engineeringCoverageHash: engineeringValue.coverageHash,
    motionCoverageReportSha256: digest(motionCoverage),
    motionCoverageHash: motionValue.coverageHash,
    cableLifeReportSha256: digest(cableLife),
    cableInputSha256: cableValue.cableInputSha256,
    safetyElectricalReportSha256: digest(safetyElectrical),
    safetyElectricalInputSha256: safetyValue.inputSha256,
    specimen: { serialNumber: 'robot-001', buildRevision: 1, asBuiltBomArtifactName: 'as-built-bom.json', asBuiltBomSha256: digest(artifacts.get('as-built-bom.json')!) },
    applicationHashes: engineeringValue.entries.map(item => item.applicationHash!),
    artifacts: artifactDeclarations,
    stages,
    generatedAt: '2026-08-12T09:00:00+09:00',
  };
  const operator = key('operator-1', 'test-operator');
  const reviewer = key('reviewer-1', 'independent-reviewer');
  const payload = robotPhysicalValidationReceiptPayload(unsigned);
  const receipt: RobotPhysicalValidationReceipt = {
    ...unsigned,
    signatures: [
      { signerId: operator.id, role: 'test-operator', signerIdentitySha256: operator.fingerprint, signedAt: '2026-08-12T10:00:00+09:00', signature: sign(null, Buffer.from(payload), operator.privateKey).toString('base64') },
      { signerId: reviewer.id, role: 'independent-reviewer', signerIdentitySha256: reviewer.fingerprint, signedAt: '2026-08-12T11:00:00+09:00', signature: sign(null, Buffer.from(payload), reviewer.privateKey).toString('base64') },
    ],
  };
  const trustedKeys: TrustedRobotPhysicalValidationKeys = {
    [operator.id]: { publicKey: operator.publicKey, roles: ['test-operator'] },
    [reviewer.id]: { publicKey: reviewer.publicKey, roles: ['independent-reviewer'] },
  };
  return { upstream: { engineeringCoverage, motionCoverage, cableLife, safetyElectrical }, receipt, receiptBytes: encode(receipt), artifacts, trustedKeys };
}

function key(id: string, role: 'test-operator' | 'independent-reviewer') {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { id, role, publicKey, privateKey: pair.privateKey, fingerprint: createHash('sha256').update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex') };
}
