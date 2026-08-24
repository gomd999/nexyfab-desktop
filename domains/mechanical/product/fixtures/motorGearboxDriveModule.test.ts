import { describe, expect, it } from 'vitest';
import { motorGearboxDriveModuleFixture } from './motorGearboxDriveModule';

describe('motor gearbox drive module fixture', () => {
  it('has unique stable component ids and roles are represented', () => {
    const components = motorGearboxDriveModuleFixture.components;
    expect(new Set(components.map((component) => component.id)).size).toBe(components.length);
    expect(components.map((component) => component.role)).toEqual([
      'base', 'shaft', 'bearing_support', 'bearing_support', 'coupling', 'fasteners', 'guard',
    ]);
    expect(components.filter((component) => component.role === 'bearing_support')).toHaveLength(2);
  });

  it('declares original rights-cleared provenance without external sources', () => {
    expect(motorGearboxDriveModuleFixture.provenance.rightsStatus).toBe('RIGHTS_CLEARED_ORIGINAL');
    expect(motorGearboxDriveModuleFixture.provenance.externalSourcesUsed).toHaveLength(0);
    expect(motorGearboxDriveModuleFixture.provenance.sourceKind).toBe('SELF_GENERATED_PARAMETER_SET');
  });

  it('is explicitly not manufacturing-approved and keeps unrun gates blocked', () => {
    expect(motorGearboxDriveModuleFixture.manufacturingApproval.approved).toBe(false);
    expect(Object.values(motorGearboxDriveModuleFixture.verificationStatus).every((status) => status === 'NOT_RUN')).toBe(true);
    expect(motorGearboxDriveModuleFixture.designBasis.numericalBasis).toMatch(/Educational synthetic/);
  });

  it('covers the first vertical product interfaces and inspection records', () => {
    expect(motorGearboxDriveModuleFixture.interfaces.drivenShaft.diameter).toBeGreaterThan(0);
    expect(motorGearboxDriveModuleFixture.requirements.ratedTorqueNm).toBeGreaterThan(0);
    expect(motorGearboxDriveModuleFixture.requirements.designLifeHours).toBeGreaterThan(0);
    for (const record of motorGearboxDriveModuleFixture.inspection) {
      expect(motorGearboxDriveModuleFixture.components.some((component) => component.id === record.componentId)).toBe(true);
      expect(record.critical).toBe(true);
    }
  });
});
