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
  it('counts a zero-degree clocking angle at the aligned configuration', () => {
    const state = {
      parts: [
        { id: 'base', name: 'base', partTemplateId: 'base', position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: true },
        { id: 'drive', name: 'drive', partTemplateId: 'drive', position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: false },
      ],
      mates: [
        { id: 'axis', kind: 'concentric' as const, a: { partId: 'base', refId: 'z_axis', refKind: 'axis' as const }, b: { partId: 'drive', refId: 'z_axis', refKind: 'axis' as const } },
        { id: 'mount', kind: 'coincident' as const, a: { partId: 'base', refId: 'xy_plane', refKind: 'plane' as const }, b: { partId: 'drive', refId: 'xy_plane', refKind: 'plane' as const } },
        { id: 'clocking', kind: 'angle' as const, value: 0, a: { partId: 'base', refId: 'x_axis', refKind: 'axis' as const }, b: { partId: 'drive', refId: 'x_axis', refKind: 'axis' as const } },
      ],
    };
    const localResolver = featureTreeGeometryResolver(new Map([['base', { nodes: [] }], ['drive', { nodes: [] }]]));
    expect(analyzeConstraintRank({ ...state, mates: state.mates.slice(0, 2) }, localResolver).dof).toBe(1);
    expect(analyzeConstraintRank(state, localResolver).dof).toBe(0);
  });
});
