import { describe, expect, it } from 'vitest';
import {
  createMotorGearboxDriveModuleContract,
  hashMotorGearboxDriveModuleContract,
  validateMotorGearboxDriveModuleContract,
  type MechanicalPartRole,
} from './contract';

const hash = 'a'.repeat(64);
const provenance = (id: string) => ({
  sourceId: id,
  sourceRef: `rights-cleared://${id}`,
  contentSha256: hash,
  rightsReceiptSha256: hash,
  origin: 'ORIGINAL' as const,
  rightsStatus: 'APPROVED' as const,
  authorityStatus: 'APPROVED' as const,
});
const part = (id: string, role: MechanicalPartRole) => ({
  id,
  role,
  material: provenance(`${id}-material`),
  process: provenance(`${id}-process`),
  procurement: { mode: 'MAKE' as const, source: provenance(`${id}-procurement`) },
  geometryHash: hash,
  sourceRevision: 'r1',
});

function validContract() {
  return createMotorGearboxDriveModuleContract({
    schema: 'nexyfab.mechanical.motor-gearbox-drive-module.v1',
    authoritative: true,
    identity: { id: 'drive-module-001', revision: 'r1' },
    units: { length: 'mm', force: 'N', torque: 'N.m', speed: 'rpm', time: 'h', angle: 'deg', mass: 'kg', stress: 'MPa' },
    requirements: { ratedTorqueNm: 120, ratedSpeedRpm: 1450, duty: 'continuous', serviceFactor: 1.5, designLifeHours: 20_000, alignmentToleranceMm: 0.05 },
    parts: [
      part('base', 'base'), part('shaft', 'shaft'), part('bearing-a', 'bearing-support'),
      part('bearing-b', 'bearing-support'), part('coupling', 'coupling'),
      part('fasteners', 'fastener'), part('guard', 'guard'),
    ],
    datums: [{ id: 'base-a', partId: 'base', axis: 'Z', description: 'mounting reference plane', sourceRevision: 'r1' }],
    interfaces: [{ id: 'shaft-coupling', fromPartId: 'shaft', toPartId: 'coupling', kind: 'coupling', nominal: 25, tolerance: 0.02, unit: 'mm', sourceRevision: 'r1' }],
    criticalDimensions: [{ id: 'base-width', partId: 'base', datumId: 'base-a', nominal: 200, plusTolerance: 0.1, minusTolerance: 0.1, unit: 'mm', inspectionMethod: 'cmm', sourceRevision: 'r1' }],
  });
}

describe('motor gearbox drive module contract', () => {
  it('accepts a complete authoritative contract and verifies its own content hash', () => {
    const contract = validContract();
    expect(validateMotorGearboxDriveModuleContract(contract)).toEqual([]);
    expect(contract.identity.contentSha256).toBe(hashMotorGearboxDriveModuleContract(contract));
  });

  it('rejects AI/preview sources, bad rights receipts, and changes hidden under an old hash', () => {
    const candidate = structuredClone(validContract());
    candidate.parts[0]!.material.sourceRef = 'preview:inferred-material';
    candidate.parts[0]!.procurement.source.rightsReceiptSha256 = 'missing';
    candidate.requirements.ratedTorqueNm += 1;
    expect(validateMotorGearboxDriveModuleContract(candidate)).toEqual(expect.arrayContaining([
      'parts[0].material.sourceRef',
      'parts[0].procurement.source.rightsReceiptSha256',
      'identity.contentSha256:mismatch',
    ]));
  });

  it('rejects missing roles, non-finite values, cross-revision data, and broken references', () => {
    const candidate = structuredClone(validContract());
    candidate.parts = candidate.parts.filter(item => item.role !== 'guard');
    candidate.requirements.ratedTorqueNm = Number.NaN;
    candidate.datums[0]!.sourceRevision = 'old';
    candidate.criticalDimensions[0]!.datumId = 'missing';
    expect(validateMotorGearboxDriveModuleContract(candidate)).toEqual(expect.arrayContaining([
      'parts:required_role_missing:guard',
      'requirements.ratedTorqueNm',
      'datums[0].sourceRevision',
      'criticalDimensions[0].datumId',
    ]));
  });
});
