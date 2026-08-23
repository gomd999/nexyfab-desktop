import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluateRobotBearingReducerLifeBytes } from './robotBearingReducerLife';
import { buildRobotBearingReducerLifeFixture } from './robotBearingReducerLife.testFixture';

function bytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function digest(value: Uint8Array) { return createHash('sha256').update(value).digest('hex'); }

describe('robot bearing and reducer life verification', () => {
  it('computes analytic bearing and reducer life from a governed one-bin spectrum', () => {
    const fixture = buildRobotBearingReducerLifeFixture();
    const report = evaluateRobotBearingReducerLifeBytes(fixture.dynamicReportBytes, bytes(fixture.lifeInput));
    expect(report).toMatchObject({ status: 'passed', lifeReady: true, releaseReady: false, sideEffects: { persisted: false, cadModified: false } });
    expect(report.joints[0]!.bearingBasicRatingLifeHours).toBeCloseTo(1_000_000 * 10 ** 3 / (60 * 100), 6);
    expect(report.joints[0]!.reducerLifeDamage).toBeCloseTo(report.requiredServiceLifeHours / 80_000, 12);
    expect(report.joints[0]!.passed).toBe(true);
  });

  it('fails on cumulative life damage and insufficient static capacity', () => {
    const fixture = buildRobotBearingReducerLifeFixture();
    fixture.lifeInput.requiredServiceLifeCycles = 9_000_000_000_000;
    fixture.lifeInput.joints[0]!.bearing.staticLoadRatingN = 100;
    const report = evaluateRobotBearingReducerLifeBytes(fixture.dynamicReportBytes, bytes(fixture.lifeInput));
    expect(report.lifeReady).toBe(false);
    expect(report.errors.join('\n')).toMatch(/bearing life damage/);
    expect(report.errors.join('\n')).toMatch(/bearing static safety factor/);
    expect(report.errors.join('\n')).toMatch(/reducer life damage/);
  });

  it('rejects a spectrum that does not cover the actual dynamic trace', () => {
    const fixture = buildRobotBearingReducerLifeFixture();
    fixture.lifeInput.joints[0]!.spectrum[0]!.outputTorqueNm = 1;
    const report = evaluateRobotBearingReducerLifeBytes(fixture.dynamicReportBytes, bytes(fixture.lifeInput));
    expect(report.lifeReady).toBe(false);
    expect(report.errors.join('\n')).toMatch(/load spectrum misses dynamic peak torque/);
  });

  it('rejects dynamic-byte and trace self-report mutations', () => {
    const fixture = buildRobotBearingReducerLifeFixture();
    fixture.lifeInput.dynamicReportSha256 = 'f'.repeat(64);
    expect(evaluateRobotBearingReducerLifeBytes(fixture.dynamicReportBytes, bytes(fixture.lifeInput)).errors).toContain('dynamic report bytes do not match dynamicReportSha256');
    const mutated = { ...fixture.dynamicReport, trace: fixture.dynamicReport.trace.map((frame, index) => index ? frame : { ...frame, speedRpm: [999, ...frame.speedRpm.slice(1)] }) };
    const mutatedBytes = bytes(mutated);
    fixture.lifeInput.dynamicReportSha256 = digest(mutatedBytes);
    expect(evaluateRobotBearingReducerLifeBytes(mutatedBytes, bytes(fixture.lifeInput)).errors).toContain('dynamic trace bytes do not match traceSha256');
  });

  it('rejects invalid spectrum fractions and duplicate governed joints', () => {
    const fixture = buildRobotBearingReducerLifeFixture();
    fixture.lifeInput.joints[0]!.spectrum[0]!.durationFraction = 0.5;
    fixture.lifeInput.joints[5]!.joint = 5;
    const report = evaluateRobotBearingReducerLifeBytes(fixture.dynamicReportBytes, bytes(fixture.lifeInput));
    expect(report.joints).toEqual([]);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining('duration fractions must sum to 1'), expect.stringContaining('life joints must contain J1..J6')]));
  });

  it('rejects malformed evidence without side effects', () => {
    const report = evaluateRobotBearingReducerLifeBytes(new Uint8Array([0xff]), new Uint8Array([0xff]));
    expect(report).toMatchObject({ status: 'failed', lifeReady: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } });
  });
});
