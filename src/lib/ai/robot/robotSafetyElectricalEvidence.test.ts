import { describe, expect, it } from 'vitest';
import { buildRobotSafetyElectricalEvidenceFixture } from './robotSafetyElectricalEvidence.testFixture';
import { evaluateRobotSafetyElectricalEvidenceBytes } from './robotSafetyElectricalEvidence';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('robot safety and electrical design evidence', () => {
  it('covers every frozen hazard, safety function, circuit and fault plan while retaining expert and physical blockers', () => {
    const fixture = buildRobotSafetyElectricalEvidenceFixture();
    const report = evaluateRobotSafetyElectricalEvidenceBytes(fixture.requirementsBytes, encode(fixture.safetyInput));
    expect(report.designSupportReady).toBe(true);
    expect(report.counts).toEqual({ standards: 6, hazards: 1, safetyFunctions: 1, circuits: 7, safetyIoMappings: 1, faultValidationPlans: 1 });
    expect(report).toMatchObject({ physicalFaultValidationComplete: false, expertSafetyReviewComplete: false, regulatoryConformityAssessed: false, certificationClaimed: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false } });
  });

  it('rejects missing hazard/function/I-O/fault coverage', () => {
    const fixture = buildRobotSafetyElectricalEvidenceFixture();
    fixture.safetyInput.hazardControls.push({ ...fixture.safetyInput.hazardControls[0]! });
    fixture.safetyInput.electrical.safetyIo.push({ ...fixture.safetyInput.electrical.safetyIo[0]! });
    fixture.safetyInput.faultValidationPlans.push({ ...fixture.safetyInput.faultValidationPlans[0]! });
    const report = evaluateRobotSafetyElectricalEvidenceBytes(fixture.requirementsBytes, encode(fixture.safetyInput));
    const messages = report.errors.join(' ');
    expect(messages).toContain('hazard controls must cover the frozen set exactly once');
    expect(messages).toContain('safety I/O mappings must cover the frozen set exactly once');
    expect(messages).toContain('fault-validation plans must cover the frozen set exactly once');
  });

  it('rejects changed performance targets, safe states and hazard links', () => {
    const fixture = buildRobotSafetyElectricalEvidenceFixture();
    fixture.safetyInput.safetyFunctions[0]!.requiredPerformanceTarget = 'changed target';
    fixture.safetyInput.faultValidationPlans[0]!.expectedSafeState = 'changed safe state';
    fixture.safetyInput.hazardControls[0]!.safetyFunctionIds = ['unknown-function'];
    const report = evaluateRobotSafetyElectricalEvidenceBytes(fixture.requirementsBytes, encode(fixture.safetyInput));
    const messages = report.errors.join(' ');
    expect(messages).toContain('safety-function links differ');
    expect(messages).toContain('required performance target differs');
    expect(messages).toContain('expected safe state differs');
  });

  it('rejects supply, power and circuit contradictions', () => {
    const fixture = buildRobotSafetyElectricalEvidenceFixture();
    fixture.safetyInput.electrical.supply.nominalVoltageV = 230;
    fixture.safetyInput.electrical.calculatedPeakPowerW = 13_000;
    fixture.safetyInput.electrical.circuits[6]!.subject = 'main_supply';
    const report = evaluateRobotSafetyElectricalEvidenceBytes(fixture.requirementsBytes, encode(fixture.safetyInput));
    const messages = report.errors.join(' ');
    expect(messages).toContain('electrical supply differs');
    expect(messages).toContain('calculated peak power exceeds');
    expect(messages).toContain('electrical circuit subjects must cover');
  });

  it('cannot request or claim certification through the design-support schema', () => {
    const fixture = buildRobotSafetyElectricalEvidenceFixture();
    (fixture.safetyInput as unknown as { certificationRequested: boolean }).certificationRequested = true;
    const report = evaluateRobotSafetyElectricalEvidenceBytes(fixture.requirementsBytes, encode(fixture.safetyInput));
    expect(report.designSupportReady).toBe(false);
    expect(report).toMatchObject({ certificationClaimed: false, regulatoryConformityAssessed: false, releaseReady: false });
  });

  it('fails closed on malformed input', () => {
    const report = evaluateRobotSafetyElectricalEvidenceBytes(encode({}), new Uint8Array([0xff]));
    expect(report).toMatchObject({ status: 'failed', designSupportReady: false, releaseReady: false });
  });
});
