import { describe, expect, it } from 'vitest';
import { buildRobotStructuralComplianceFixture } from './robotStructuralCompliance.testFixture';
import { evaluateRobotStructuralComplianceBytes } from './robotStructuralCompliance';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('robot structural compliance', () => {
  it('solves the analytic 1 m lever, 10 N force and 100 kNm/rad stiffness case', () => {
    const fixture = buildRobotStructuralComplianceFixture();
    const report = evaluateRobotStructuralComplianceBytes(fixture.requirementsBytes, encode(fixture.complianceInput));
    expect(report.structuralComplianceReady).toBe(true);
    expect(report.loadCases[0]!.jointTorqueNm[0]).toBeCloseTo(10, 10);
    expect(report.loadCases[0]!.jointDeflectionRad[0]).toBeCloseTo(0.0001, 10);
    expect(report.loadCases[0]!.totalTcpDeflectionMagnitudeMm).toBeCloseTo(0.1, 10);
    expect(report).toMatchObject({ physicalStiffnessValidationRequired: true, physicalStiffnessValidationComplete: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false } });
  });

  it('adds authoritative link compliance and fails above the governed allocation', () => {
    const fixture = buildRobotStructuralComplianceFixture();
    fixture.complianceInput.loadCases[0]!.maximumLinkTranslationalComplianceMPerN.yy = 0.00001;
    const report = evaluateRobotStructuralComplianceBytes(fixture.requirementsBytes, encode(fixture.complianceInput));
    expect(report.maximumTcpDeflectionMm).toBeCloseTo(0.2, 10);
    expect(report.structuralComplianceReady).toBe(false);
    expect(report.errors.join(' ')).toContain('exceeds its allocation');
  });

  it('rejects a non-physical compliance tensor', () => {
    const fixture = buildRobotStructuralComplianceFixture();
    const tensor = fixture.complianceInput.loadCases[0]!.maximumLinkTranslationalComplianceMPerN;
    tensor.xx = 1e-6;
    tensor.yy = 1e-6;
    tensor.xy = 2e-6;
    const report = evaluateRobotStructuralComplianceBytes(fixture.requirementsBytes, encode(fixture.complianceInput));
    expect(report.structuralComplianceReady).toBe(false);
    expect(report.errors.join(' ')).toContain('positive semidefinite');
  });

  it('binds requirements and keeps the allocation within frozen TCP accuracy', () => {
    const fixture = buildRobotStructuralComplianceFixture();
    fixture.complianceInput.requirementsFileSha256 = 'f'.repeat(64);
    fixture.complianceInput.allowableTcpDeflectionMm = 0.3;
    const report = evaluateRobotStructuralComplianceBytes(fixture.requirementsBytes, encode(fixture.complianceInput));
    expect(report.errors).toContain('requirements bytes do not match requirementsFileSha256');
    expect(report.errors.join(' ')).toContain('must not exceed the frozen TCP accuracy');
  });

  it('rejects duplicate/missing governed joints and out-of-range poses', () => {
    const fixture = buildRobotStructuralComplianceFixture();
    fixture.complianceInput.jointStiffness[5]!.joint = 5;
    fixture.complianceInput.loadCases[0]!.anglesDeg[0] = 121;
    const report = evaluateRobotStructuralComplianceBytes(fixture.requirementsBytes, encode(fixture.complianceInput));
    expect(report.errors.join(' ')).toContain('joint stiffness must contain J1..J6 exactly once');
    expect(report.errors.join(' ')).toContain('angle lies outside the frozen joint range');
  });

  it('fails closed on malformed input without side effects', () => {
    const report = evaluateRobotStructuralComplianceBytes(encode({}), new Uint8Array([0xff]));
    expect(report).toMatchObject({ status: 'failed', structuralComplianceReady: false, loadCases: [], releaseReady: false });
  });
});
