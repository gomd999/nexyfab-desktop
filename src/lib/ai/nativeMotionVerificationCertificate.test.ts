import { describe, expect, it } from 'vitest';
import { buildNativeMotionVerificationCertificate, type NativeMotionVerificationInput } from './nativeMotionVerificationCertificate';

const input = (): NativeMotionVerificationInput => ({
  plan: { status: 'pass', errors: [], unresolved: [], plans: [{ jointId: 'j1', mateId: 'native:j1', stepDegrees: 5, request: { mateId: 'native:j1', fromValue: 0, toValue: 10, steps: 2 } }] },
  studies: { j1: { allConverged: true, firstFailureFrame: -1, frames: [{ index: 0 }, { index: 1 }, { index: 2 }] as never } },
  preciseIntervals: { j1: [{ partA: 'a', partB: 'b', startFrame: 0, endFrame: 2, midpointFrame: 1, status: 'proven_clear', minimumDistanceMm: 2, motionBoundMm: 0.1 }] },
  clearanceRequirements: [{ partA: 'a', partB: 'b', minimumMm: 1 }],
  clearanceEvidence: [{ partA: 'a', partB: 'b', minimumDistanceMm: 2, method: 'native_triangle_distance', artifactHashes: ['a'.repeat(64)] }],
});

describe('native motion verification certificate', () => {
  it('passes only converged, precisely clear motion with measured clearance', () => expect(buildNativeMotionVerificationCertificate(input())).toMatchObject({ status: 'pass', releaseReady: true, verifiedJointIds: ['j1'] }));
  it('keeps missing precise evidence as not_run', () => { const value = input(); value.preciseIntervals = {}; expect(buildNativeMotionVerificationCertificate(value)).toMatchObject({ status: 'not_run', releaseReady: false }); });
  it('fails confirmed collision and below-minimum clearance', () => { const value = input(); value.preciseIntervals.j1![0]!.status = 'confirmed_collision'; value.clearanceEvidence[0]!.minimumDistanceMm = 0.5; const certificate = buildNativeMotionVerificationCertificate(value); expect(certificate).toMatchObject({ status: 'fail', releaseReady: false }); expect(certificate.gates.flatMap(item => item.codes)).toEqual(expect.arrayContaining(['PRECISE_COLLISION_CONFIRMED:j1', 'CLEARANCE_BELOW_MINIMUM:a::b'])); });
  it('does not accept unhashed clearance evidence', () => { const value = input(); value.clearanceEvidence[0]!.artifactHashes = []; expect(buildNativeMotionVerificationCertificate(value).status).toBe('fail'); });
});
