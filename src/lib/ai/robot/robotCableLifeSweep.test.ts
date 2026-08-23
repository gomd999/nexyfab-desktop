import { describe, expect, it } from 'vitest';
import { buildRobotCableLifeSweepFixture } from './robotCableLifeSweep.testFixture';
import { evaluateRobotCableLifeSweepBytes } from './robotCableLifeSweep';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('robot cable life sweep', () => {
  it('computes route bend radius, twist density, service loop and cumulative flex damage over all motion combinations', () => {
    const fixture = buildRobotCableLifeSweepFixture();
    const report = evaluateRobotCableLifeSweepBytes(fixture.requirementsBytes, fixture.motionReportBytes, encode(fixture.cableInput));
    expect(report.cableLifeReady).toBe(true);
    expect(report.cables[0]!.minimumDynamicBendRadiusMm).toBeCloseTo(Math.sqrt(1_250), 10);
    expect(report.cables[0]!.maximumTwistDegPerM).toBeCloseTo(100, 10);
    expect(report.cables[0]!.minimumServiceLoopReserveMm).toBeCloseTo(100 - Math.sqrt(5_000), 10);
    expect(report.cables[0]!.cumulativeLifeDamage).toBeGreaterThan(0);
    expect(report).toMatchObject({ fullMotionCombinationCoverageComplete: true, physicalFlexValidationComplete: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false } });
  });

  it('fails a geometrically computed bend radius below both limit and governed life curve', () => {
    const fixture = buildRobotCableLifeSweepFixture();
    fixture.cableInput.combinations[0]!.cableStates[0]!.routePointsMm = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }];
    const report = evaluateRobotCableLifeSweepBytes(fixture.requirementsBytes, fixture.motionReportBytes, encode(fixture.cableInput));
    expect(report.cableLifeReady).toBe(false);
    expect(report.errors.join(' ')).toContain('bend radius violates the cable minimum');
    expect(report.errors.join(' ')).toContain('below the governed life curve');
  });

  it('fails twist, clearance, service-loop and connector limits independently', () => {
    const fixture = buildRobotCableLifeSweepFixture();
    const state = fixture.cableInput.combinations[0]!.cableStates[0]!;
    state.accumulatedTwistDeg = 30;
    state.minimumExactClearanceMm = 1;
    state.maximumConnectorDisplacementMm = 3;
    fixture.cableInput.cables[0]!.minimumServiceLoopReserveMm = 40;
    const report = evaluateRobotCableLifeSweepBytes(fixture.requirementsBytes, fixture.motionReportBytes, encode(fixture.cableInput));
    const messages = report.errors.join(' ');
    expect(messages).toContain('twist per metre exceeds');
    expect(messages).toContain('exact clearance violates');
    expect(messages).toContain('service-loop reserve is insufficient');
    expect(messages).toContain('connector displacement exceeds');
  });

  it('requires every motion combination and normalized usage fractions', () => {
    const fixture = buildRobotCableLifeSweepFixture();
    fixture.cableInput.combinations.pop();
    const report = evaluateRobotCableLifeSweepBytes(fixture.requirementsBytes, fixture.motionReportBytes, encode(fixture.cableInput));
    expect(report.fullMotionCombinationCoverageComplete).toBe(false);
    expect(report.errors.join(' ')).toContain('is missing from cable life sweep');
    expect(report.errors).toContain('motion combination usage fractions must sum to one');
  });

  it('binds the exact passed motion report and frozen service life', () => {
    const fixture = buildRobotCableLifeSweepFixture();
    fixture.cableInput.motionCoverageReportSha256 = 'c'.repeat(64);
    fixture.cableInput.requiredServiceLifeCycles = 1;
    const report = evaluateRobotCableLifeSweepBytes(fixture.requirementsBytes, fixture.motionReportBytes, encode(fixture.cableInput));
    expect(report.errors).toContain('motion coverage report bytes do not match motionCoverageReportSha256');
    expect(report.errors).toContain('cable service-life cycles differ from frozen requirements');
  });

  it('fails closed on malformed evidence', () => {
    const report = evaluateRobotCableLifeSweepBytes(encode({}), encode({}), new Uint8Array([0xff]));
    expect(report).toMatchObject({ status: 'failed', cableLifeReady: false, cables: [], releaseReady: false });
  });
});
