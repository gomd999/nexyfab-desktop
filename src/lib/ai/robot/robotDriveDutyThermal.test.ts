import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluateRobotDriveDutyThermalBytes } from './robotDriveDutyThermal';
import { buildRobotDriveDutyThermalFixture } from './robotDriveDutyThermal.testFixture';

function bytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function digest(value: Uint8Array) { return createHash('sha256').update(value).digest('hex'); }

describe('robot drive duty thermal verification', () => {
  it('converges to the analytic first-order steady temperature for constant loss', () => {
    const fixture = buildRobotDriveDutyThermalFixture();
    const report = evaluateRobotDriveDutyThermalBytes(fixture.dynamicReportBytes, bytes(fixture.thermalInput));
    expect(report).toMatchObject({ status: 'passed', thermalReady: true, cycleDurationS: 1, effectivePeriodS: 1, releaseReady: false, sideEffects: { persisted: false, cadModified: false } });
    expect(report.joints).toHaveLength(6);
    expect(report.joints[0]!.steadyStateReached).toBe(true);
    expect(report.joints[0]!.maximumMotorTemperatureC).toBeCloseTo(30, 4);
    expect(report.joints[0]!.motorTemperatureMarginC).toBeCloseTo(10, 4);
  });

  it('fails closed when the periodic steady temperature exceeds a component limit', () => {
    const fixture = buildRobotDriveDutyThermalFixture();
    fixture.thermalInput.joints[0]!.motorThermal.maximumTemperatureC = 25;
    const report = evaluateRobotDriveDutyThermalBytes(fixture.dynamicReportBytes, bytes(fixture.thermalInput));
    expect(report).toMatchObject({ status: 'failed', thermalReady: false, releaseReady: false });
    expect(report.joints[0]!.passed).toBe(false);
    expect(report.errors.join('\n')).toMatch(/motor maximum temperature exceeds/);
  });

  it('rejects a self-reported dynamic hash or trace mutation', () => {
    const fixture = buildRobotDriveDutyThermalFixture();
    fixture.thermalInput.dynamicReportSha256 = 'd'.repeat(64);
    const hashMismatch = evaluateRobotDriveDutyThermalBytes(fixture.dynamicReportBytes, bytes(fixture.thermalInput));
    expect(hashMismatch.joints).toEqual([]);
    expect(hashMismatch.errors).toContain('dynamic report bytes do not match dynamicReportSha256');

    const mutated = { ...fixture.dynamicReport, trace: fixture.dynamicReport.trace.map((frame, index) => index ? frame : { ...frame, torqueNm: [999, ...frame.torqueNm.slice(1)] }) };
    const mutatedBytes = bytes(mutated);
    fixture.thermalInput.dynamicReportSha256 = digest(mutatedBytes);
    const traceMismatch = evaluateRobotDriveDutyThermalBytes(mutatedBytes, bytes(fixture.thermalInput));
    expect(traceMismatch.joints).toEqual([]);
    expect(traceMismatch.errors).toContain('dynamic trace bytes do not match traceSha256');
  });

  it('rejects missing authoritative loss coefficients and a non-governed joint set', () => {
    const fixture = buildRobotDriveDutyThermalFixture();
    fixture.thermalInput.joints[0]!.motorLoss = { constantLossW: 0, torqueSquaredCoefficientWPerNm2: 0, speedCoefficientWPerRpm: 0, standbyLossW: 0 };
    fixture.thermalInput.joints[5]!.joint = 5;
    const report = evaluateRobotDriveDutyThermalBytes(fixture.dynamicReportBytes, bytes(fixture.thermalInput));
    expect(report.thermalReady).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining('thermal joints must contain J1..J6'), expect.stringContaining('authoritative motor loss model')]));
  });

  it('rejects malformed evidence without side effects', () => {
    const report = evaluateRobotDriveDutyThermalBytes(new Uint8Array([0xff]), new Uint8Array([0xff]));
    expect(report).toMatchObject({ status: 'failed', thermalReady: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } });
  });
});
