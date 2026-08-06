import { describe, expect, it } from 'vitest';
import { approximateAssemblyDoF, validateAssembly } from '@/lib/assembly/assemblyState';
import { ROBOT_6AXIS_KINEMATIC_SKELETON, ROBOT_6AXIS_REQUIREMENTS, ROBOT_REFERENCE_MANIFEST } from './robot6Axis';

describe('6-axis robot golden contract', () => {
  it('has six independent revolute joints in the deterministic skeleton', () => {
    expect(() => validateAssembly(ROBOT_6AXIS_KINEMATIC_SKELETON)).not.toThrow();
    expect(ROBOT_6AXIS_KINEMATIC_SKELETON.mates).toHaveLength(6);
    expect(approximateAssemblyDoF(ROBOT_6AXIS_KINEMATIC_SKELETON).approximate).toBe(6);
  });
  it('requires drive, sensing and harness components, not only visible links', () => {
    expect(ROBOT_6AXIS_REQUIREMENTS.requiredRoles).toEqual(expect.arrayContaining(['motor_j6', 'reducer_j6', 'bearing_set_j6', 'encoder', 'internal_harness']));
  });
  it('keeps external references evaluation-only to prevent corpus leakage', () => {
    expect(ROBOT_REFERENCE_MANIFEST.sources.every(source => source.allowedUse === 'evaluation')).toBe(true);
  });
});
