import { describe, expect, it } from 'vitest';
import { featureTreeGeometryResolver } from './geometryResolver';
import { analyzeConstraintRank } from './constraintJacobianRank';
import { ROBOT_6AXIS_KINEMATIC_SKELETON } from '@/lib/ai/golden/robot6Axis';

const resolver = featureTreeGeometryResolver(new Map(ROBOT_6AXIS_KINEMATIC_SKELETON.parts.map(part => [part.id, { nodes: [] }])));
describe('multi-component constraint Jacobian rank', () => {
  it('measures six remaining DoF for a six-hinge serial robot', () => {
    const result = analyzeConstraintRank(ROBOT_6AXIS_KINEMATIC_SKELETON, resolver);
    expect(result).toMatchObject({ dof: 6, rank: 30, authoritative: true });
  });
  it('does not double-count a duplicate hinge', () => {
    const duplicate = { ...ROBOT_6AXIS_KINEMATIC_SKELETON, mates: [...ROBOT_6AXIS_KINEMATIC_SKELETON.mates, { ...ROBOT_6AXIS_KINEMATIC_SKELETON.mates[0]!, id: 'duplicate' }] };
    const result = analyzeConstraintRank(duplicate, resolver);
    expect(result.dof).toBe(6);
    expect(result.redundantRows).toBeGreaterThan(0);
  });
});
