import { describe, expect, it } from 'vitest';
import { planComplexRepair } from './complexRepairRegistry';

describe('complex deterministic repair registry', () => {
  it('creates the same bounded plan regardless of input ordering', () => {
    const a = planComplexRepair({ errorCodes: ['PART_NOT_WATERTIGHT', 'PART_NON_MANIFOLD'], affectedPaths: ['parts.arm.geometry', 'parts.base.geometry'], lockedPaths: [] });
    const b = planComplexRepair({ errorCodes: ['PART_NON_MANIFOLD', 'PART_NOT_WATERTIGHT'], affectedPaths: ['parts.base.geometry', 'parts.arm.geometry'], lockedPaths: [] });
    expect(a).toEqual(b); expect(a).toMatchObject({ disposition: 'auto_retry', rollbackTo: 'S4_KERNEL', downstreamStages: ['S4_KERNEL', 'S5_ASSEMBLY', 'S6_MOTION_COLLISION', 'S7_MANUFACTURING_ROUNDTRIP', 'S8_REPAIR'] });
  });
  it('blocks mutation outside the registered boundary', () => expect(planComplexRepair({ errorCodes: ['ASSEMBLY_TRANSFORM_INVALID'], affectedPaths: ['parts.arm.width'], lockedPaths: [] })).toMatchObject({ disposition: 'stop', reasons: ['repair_path_outside_boundary:parts.arm.width'] }));
  it('protects confirmed fields including ancestor mutations', () => expect(planComplexRepair({ errorCodes: ['PART_KERNEL_INVALID'], affectedPaths: ['parts.arm'], lockedPaths: ['parts.arm.width'] })).toMatchObject({ disposition: 'stop', reasons: ['repair_locked_path:parts.arm'] }));
  it('requires review for geometric collision instead of resizing automatically', () => expect(planComplexRepair({ errorCodes: ['PRECISE_COLLISION_CONFIRMED:j1'], affectedPaths: ['motion.j1'], lockedPaths: [] })).toMatchObject({ disposition: 'manual_review', mutations: [] }));
  it('stops unknown and repeatedly identical failures', () => {
    expect(planComplexRepair({ errorCodes: ['ALIEN_FAILURE'], affectedPaths: ['parts.x'], lockedPaths: [] }).disposition).toBe('stop');
    const request = { errorCodes: ['PART_KERNEL_INVALID'], affectedPaths: ['parts.x.geometry'], lockedPaths: [] };
    const first = planComplexRepair(request); expect(planComplexRepair({ ...request, previousFingerprints: [first.fingerprint, first.fingerprint, first.fingerprint] })).toMatchObject({ disposition: 'stop', reasons: ['repair_identical_attempt_limit:3'] });
  });
});
