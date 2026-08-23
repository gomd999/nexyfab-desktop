import { describe, expect, it } from 'vitest';
import { buildRobotTcpPositionErrorBudgetFixture } from './robotTcpPositionErrorBudget.testFixture';
import { evaluateRobotTcpPositionErrorBudgetBytes } from './robotTcpPositionErrorBudget';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('robot TCP position error budget', () => {
  it('propagates an angular bound through the analytic 1 m Jacobian and uses worst-case sums for acceptance', () => {
    const fixture = buildRobotTcpPositionErrorBudgetFixture();
    const report = evaluateRobotTcpPositionErrorBudgetBytes(fixture.requirementsBytes, encode(fixture.precisionInput));
    expect(report.precisionBudgetReady).toBe(true);
    expect(report.poses[0]!.worstCaseAccuracyMm).toBeCloseTo(0.04 + 3 * Math.PI / 648, 10);
    expect(report.poses[0]!.diagnosticRssAccuracyMm).toBeLessThan(report.poses[0]!.worstCaseAccuracyMm);
    expect(report).toMatchObject({ physicalValidationRequired: true, physicalValidationComplete: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false, rfqSent: false } });
  });

  it('fails when the guaranteed worst-case bound exceeds the frozen accuracy requirement even if RSS passes', () => {
    const fixture = buildRobotTcpPositionErrorBudgetFixture();
    for (const contributor of fixture.precisionInput.contributors) {
      if (contributor.kind === 'tcp_position_mm') contributor.accuracyBound = 0.047;
    }
    const report = evaluateRobotTcpPositionErrorBudgetBytes(fixture.requirementsBytes, encode(fixture.precisionInput));
    expect(report.poses[0]!.diagnosticRssAccuracyMm).toBeLessThan(0.2);
    expect(report.precisionBudgetReady).toBe(false);
    expect(report.errors.join(' ')).toContain('worst-case TCP accuracy exceeds');
  });

  it('binds the exact requirements bytes and canonical frozen revision', () => {
    const fixture = buildRobotTcpPositionErrorBudgetFixture();
    fixture.precisionInput.requirementsFileSha256 = 'a'.repeat(64);
    const report = evaluateRobotTcpPositionErrorBudgetBytes(fixture.requirementsBytes, encode(fixture.precisionInput));
    expect(report.precisionBudgetReady).toBe(false);
    expect(report.errors).toContain('requirements bytes do not match requirementsFileSha256');
  });

  it('requires all governed contributor categories and unique ids', () => {
    const fixture = buildRobotTcpPositionErrorBudgetFixture();
    fixture.precisionInput.contributors.pop();
    fixture.precisionInput.contributors.push({ ...fixture.precisionInput.contributors[0]!, id: fixture.precisionInput.contributors[1]!.id });
    const report = evaluateRobotTcpPositionErrorBudgetBytes(fixture.requirementsBytes, encode(fixture.precisionInput));
    expect(report.precisionBudgetReady).toBe(false);
    expect(report.errors.join(' ')).toContain('precision contributor category calibration_residual is required');
    expect(report.errors).toContain('precision contributor ids must be unique');
  });

  it('rejects poses outside the frozen joint range and inverted repeatability bounds', () => {
    const fixture = buildRobotTcpPositionErrorBudgetFixture();
    fixture.precisionInput.governedPoses[0]!.anglesDeg[0] = 181;
    fixture.precisionInput.contributors[0]!.repeatabilityBound = 2;
    const report = evaluateRobotTcpPositionErrorBudgetBytes(fixture.requirementsBytes, encode(fixture.precisionInput));
    expect(report.errors.join(' ')).toContain('angle lies outside the frozen joint range');
    expect(report.errors.join(' ')).toContain('repeatability bound must not exceed accuracy bound');
  });

  it('fails closed on malformed evidence', () => {
    const report = evaluateRobotTcpPositionErrorBudgetBytes(encode({}), new Uint8Array([0xff]));
    expect(report).toMatchObject({ status: 'failed', precisionBudgetReady: false, poses: [], releaseReady: false });
  });
});
