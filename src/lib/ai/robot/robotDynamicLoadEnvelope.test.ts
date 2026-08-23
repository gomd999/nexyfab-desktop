import { describe, expect, it } from 'vitest';
import { evaluateRobotDynamicLoadEnvelopeBytes } from './robotDynamicLoadEnvelope';
import { buildRobotDynamicLoadEnvelopeFixture } from './robotDynamicLoadEnvelope.testFixture';

function bytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }

describe('robot dynamic load envelope', () => {
  it('matches the analytic static gravity torque of a one-metre, one-kilogram link', () => {
    const report = evaluateRobotDynamicLoadEnvelopeBytes(bytes(buildRobotDynamicLoadEnvelopeFixture()));
    expect(report).toMatchObject({ status: 'passed', dynamicsReady: true, frameCount: 2, durationS: 1, releaseReady: false, sideEffects: { persisted: false, cadModified: false } });
    expect(report.joints[0]!.peakAbsoluteTorqueNm).toBeCloseTo(9.80665, 6);
    expect(report.joints[0]!.rmsTorqueNm).toBeCloseTo(9.80665, 6);
    expect(report.traceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('matches the analytic inertia torque for a point mass at one metre', () => {
    const value = buildRobotDynamicLoadEnvelopeFixture();
    value.gravityBaseMps2 = { x: 0, y: 0, z: 0 };
    value.frames = value.frames.map(frame => ({ ...frame, accelerationDegS2: [2 * 180 / Math.PI, 0, 0, 0, 0, 0] }));
    const report = evaluateRobotDynamicLoadEnvelopeBytes(bytes(value));
    expect(report.dynamicsReady).toBe(true);
    expect(report.joints[0]!.peakAbsoluteTorqueNm).toBeCloseTo(2, 6);
  });

  it('includes an external TCP force with the correct generalized torque direction', () => {
    const value = buildRobotDynamicLoadEnvelopeFixture();
    value.gravityBaseMps2 = { x: 0, y: 0, z: 0 };
    value.joints[0]!.aMm = 1_000;
    value.joints[0]!.centerOfMassMm = { x: 0, y: 0, z: 0 };
    value.frames = value.frames.map(frame => ({ ...frame, externalWrenchBase: { forceN: { x: 0, y: -10, z: 0 }, torqueNm: { x: 0, y: 0, z: 0 } } }));
    const report = evaluateRobotDynamicLoadEnvelopeBytes(bytes(value));
    expect(report.joints[0]!.peakAbsoluteTorqueNm).toBeCloseTo(10, 6);
    expect(report.trace[0]!.torqueNm[0]).toBeGreaterThan(0);
  });

  it('matches the analytic Coriolis torque of a two-link planar point-mass model', () => {
    const value = buildRobotDynamicLoadEnvelopeFixture();
    value.gravityBaseMps2 = { x: 0, y: 0, z: 0 };
    value.joints[0]!.aMm = 1_000;
    value.joints[0]!.massKg = 0;
    value.joints[0]!.centerOfMassMm = { x: 0, y: 0, z: 0 };
    value.joints[0]!.inertiaKgM2 = { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 };
    value.joints[1]!.massKg = 1;
    value.joints[1]!.centerOfMassMm = { x: 1_000, y: 0, z: 0 };
    value.joints[1]!.inertiaKgM2 = { ixx: 1e-9, iyy: 1e-9, izz: 1e-9, ixy: 0, ixz: 0, iyz: 0 };
    value.frames = value.frames.map(frame => ({ ...frame, anglesDeg: [0, 90, 0, 0, 0, 0], velocityDegS: [180 / Math.PI, 0, 0, 0, 0, 0] }));
    const report = evaluateRobotDynamicLoadEnvelopeBytes(bytes(value));
    expect(report.dynamicsReady).toBe(true);
    expect(report.trace[0]!.torqueNm[0]).toBeCloseTo(0, 5);
    expect(report.trace[0]!.torqueNm[1]).toBeCloseTo(1, 5);
  });

  it('uses time-weighted RMS and trapezoidal energy for irregular frame spacing', () => {
    const value = buildRobotDynamicLoadEnvelopeFixture();
    value.gravityBaseMps2 = { x: 0, y: 0, z: 0 };
    value.joints[0]!.massKg = 0;
    value.joints[0]!.centerOfMassMm = { x: 0, y: 0, z: 0 };
    value.joints[0]!.inertiaKgM2 = { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 };
    value.joints[0]!.coulombFrictionNm = 10;
    const base = value.frames[0]!;
    value.frames = [
      base,
      { ...base, timeS: 1, velocityDegS: [180 / Math.PI, 0, 0, 0, 0, 0] },
      { ...base, timeS: 10, velocityDegS: [180 / Math.PI, 0, 0, 0, 0, 0] },
    ];
    const report = evaluateRobotDynamicLoadEnvelopeBytes(bytes(value));
    expect(report.dynamicsReady).toBe(true);
    expect(report.joints[0]!.rmsTorqueNm).toBeCloseTo(Math.sqrt(95), 6);
    expect(report.joints[0]!.positiveMechanicalEnergyJ).toBeCloseTo(95, 6);
    expect(report.joints[0]!.returnedMechanicalEnergyJ).toBe(0);
  });

  it('fails when the evaluated demand exceeds the authoritative drive curve', () => {
    const value = buildRobotDynamicLoadEnvelopeFixture();
    value.drives[0]!.torqueSpeedCurve = value.drives[0]!.torqueSpeedCurve.map(point => ({ ...point, continuousTorqueNm: 1, peakTorqueNm: 2 }));
    const report = evaluateRobotDynamicLoadEnvelopeBytes(bytes(value));
    expect(report).toMatchObject({ status: 'failed', dynamicsReady: false, releaseReady: false });
    expect(report.joints[0]!.passed).toBe(false);
    expect(report.errors.join('\n')).toMatch(/peak torque utilization/);
  });

  it('rejects non-monotonic time, incomplete joint identity and invalid curve evidence', () => {
    const value = buildRobotDynamicLoadEnvelopeFixture();
    value.frames[1]!.timeS = 0;
    value.joints[5]!.joint = 5;
    value.drives[0]!.torqueSpeedCurve[1]!.continuousTorqueNm = 101;
    const report = evaluateRobotDynamicLoadEnvelopeBytes(bytes(value));
    expect(report.dynamicsReady).toBe(false);
    expect(report.trace).toEqual([]);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('joints must contain J1..J6 exactly once'),
      expect.stringContaining('time must increase strictly'),
      expect.stringContaining('torque-speed limits must be non-increasing'),
    ]));
  });

  it('rejects malformed bytes without mutating CAD or creating transactions', () => {
    const report = evaluateRobotDynamicLoadEnvelopeBytes(new Uint8Array([0xff]));
    expect(report).toMatchObject({ status: 'failed', dynamicsReady: false, traceSha256: null, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } });
  });
});
