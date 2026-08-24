import { describe, expect, it } from 'vitest';

import { validateMotorGearboxDriveModuleContract } from '../contract';
import { motorGearboxDriveModuleFixture } from './motorGearboxDriveModule';
import { buildMotorGearboxDriveModuleFixtureContract } from './motorGearboxDriveModuleContract';

describe('motor gearbox fixture contract adapter', () => {
  it('creates a revision-bound contract with a passing validator', () => {
    const contract = buildMotorGearboxDriveModuleFixtureContract();
    expect(validateMotorGearboxDriveModuleContract(contract)).toEqual([]);
    expect(contract.identity.revision).toBe(motorGearboxDriveModuleFixture.provenance.sourceRevision);
    expect(contract.parts.map((part) => part.role)).toEqual(expect.arrayContaining(['base', 'shaft', 'bearing-support', 'coupling', 'fastener', 'guard']));
    expect(contract.interfaces.length).toBeGreaterThanOrEqual(4);
    expect(contract.criticalDimensions.length).toBeGreaterThanOrEqual(10);
  });

  it('keeps educational fixture manufacturing approval and verification unrun', () => {
    expect(motorGearboxDriveModuleFixture.manufacturingApproval.approved).toBe(false);
    expect(motorGearboxDriveModuleFixture.verificationStatus.independentReview).toBe('NOT_RUN');
    expect(motorGearboxDriveModuleFixture.verificationStatus.fabricationPilot).toBe('NOT_RUN');
  });

  it('uses one deterministic original-rights receipt for fixture provenance', () => {
    const contract = buildMotorGearboxDriveModuleFixtureContract();
    const receiptHashes = contract.parts.flatMap((part) => [
      part.material.rightsReceiptSha256,
      part.process.rightsReceiptSha256,
      part.procurement.source.rightsReceiptSha256,
    ]);
    expect(new Set(receiptHashes).size).toBe(1);
    expect(contract.parts.every((part) => part.material.origin === 'ORIGINAL' && part.process.origin === 'ORIGINAL')).toBe(true);
  });
});
