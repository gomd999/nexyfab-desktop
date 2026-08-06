import { describe, expect, it } from 'vitest';
import { remapTopologyEntities, type TopologyEntitySnapshot } from './topologyRemap';

const face = (ref: string, x: number, role = 'positive_z_face'): TopologyEntitySnapshot => ({
  kind: 'face', persistentRef: ref, featureId: 'extrude-1', semanticRole: role,
  centroid: [x, 0, 10], direction: [0, 0, 1], measure: 100, adjacency: ['side-a', 'side-b'],
});

describe('topology remapping', () => {
  it('preserves a surviving generative provenance id regardless of dimensional change', () => {
    const result = remapTopologyEntities([face('f.cap.top', 0)], [{ ...face('f.cap.top', 50), measure: 400 }]);
    expect(result[0]).toMatchObject({ mappedRef: 'f.cap.top', quality: 'persistent', score: 1 });
  });

  it('remaps a renamed boolean face using semantic and geometric invariants', () => {
    const result = remapTopologyEntities([face('boolean-old/top', 0)], [face('boolean-new/top', 0.2)]);
    expect(result[0]?.quality).toBe('derived');
    expect(result[0]?.mappedRef).toBe('boolean-new/top');
  });

  it('refuses to guess between equivalent split faces', () => {
    const old = face('before', 0);
    const candidates = [face('split-a', -0.1), face('split-b', 0.1)];
    const result = remapTopologyEntities([old], candidates);
    expect(result[0]?.quality).toBe('ambiguous');
    expect(result[0]?.mappedRef).toBeUndefined();
  });

  it('marks a removed entity broken instead of silently retargeting another role', () => {
    const result = remapTopologyEntities([face('top', 0)], [face('bottom', 0, 'negative_z_face')]);
    expect(result[0]?.quality).toBe('broken');
  });
});
