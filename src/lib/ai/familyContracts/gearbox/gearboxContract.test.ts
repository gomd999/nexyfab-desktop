import { describe, expect, it } from 'vitest';
import { verifyGearboxFamilyContractBytes } from './gearboxContract';
import { buildGearboxFamilyContractFixture } from './gearboxContract.testFixture';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
describe('gearbox family contract', () => {
  it('recomputes ratio, direction, output torque and all family margins from a byte-bound system graph', () => {
    const fixture = buildGearboxFamilyContractFixture(), report = verifyGearboxFamilyContractBytes(fixture.graphBytes, fixture.contractBytes, fixture.artifacts);
    expect(report).toMatchObject({ status: 'passed', familyContractReady: true, calculated: { ratio: 4, outputTorqueNm: 38, outputDirection: 'opposite', minimumGearBendingSafetyFactor: 2.5, minimumGearContactSafetyFactor: expect.closeTo(1000 / 450), minimumShaftSafetyFactor: expect.closeTo(80 / 38), minimumBearingStaticSafetyFactor: 1.8, minimumBearingLifeHours: 25_000 }, checks: { systemGraph: true, topology: true, ratio: true, direction: true, torque: true, gearStrength: true, shaftStrength: true, bearingLife: true, backlash: true, housing: true, thermal: true, lubrication: true, seals: true, evidence: true }, physicalValidationComplete: false, finalExpertReviewComplete: false, releaseReady: false });
    expect(report.applicationHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('fails a ratio or gear strength claim instead of averaging it away', () => { const fixture = buildGearboxFamilyContractFixture(); fixture.contract.target.ratio = 5; fixture.contract.gearStrength[0]!.allowableBendingStressMpa = 120; const report = verifyGearboxFamilyContractBytes(fixture.graphBytes, encode(fixture.contract), fixture.artifacts); expect(report.familyContractReady).toBe(false); expect(report.errors).toEqual(expect.arrayContaining(['gearbox_check_failed:ratio', 'gearbox_check_failed:gearStrength'])); });
  it('rejects duplicate component roles and another graph hash', () => { const fixture = buildGearboxFamilyContractFixture(); fixture.contract.shafts[1]!.nodeId = 'shaft-in'; fixture.contract.systemGraphHash = '0'.repeat(64); const report = verifyGearboxFamilyContractBytes(fixture.graphBytes, encode(fixture.contract), fixture.artifacts); expect(report.errors).toEqual(expect.arrayContaining(['contract systemGraphHash mismatch', 'gearbox component roles must use distinct part nodes'])); });
  it('revalidates graph artifact bytes and never promotes missing physical evidence', () => { const fixture = buildGearboxFamilyContractFixture(); fixture.artifacts.set('system-source.json', encode({ changed: true })); expect(verifyGearboxFamilyContractBytes(fixture.graphBytes, fixture.contractBytes, fixture.artifacts)).toMatchObject({ status: 'failed', familyContractReady: false, releaseReady: false, physicalValidationComplete: false }); });
});
