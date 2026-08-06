import { BoxGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildTopologicalMap,
  rebuildTopologicalMapWithRemap,
  topologicalMapSnapshots,
  type TopologicalMap,
} from './TopologicalNaming';

describe('TopologicalNaming regeneration report', () => {
  it('adapts live stable faces to kernel-neutral topology snapshots', () => {
    const map: TopologicalMap = {
      generation: 1,
      builtAt: 1,
      indexToStable: { 0: 'face-top' },
      faces: {
        'face-top': {
          stableId: 'face-top',
          faceIndex: 0,
          originFeatureId: 'extrude-1',
          tag: 'top',
          signature: { normal: [0, 1, 0], centroid: [5, 10, 5], area: 100, triCount: 2 },
        },
      },
    };
    expect(topologicalMapSnapshots(map)).toEqual([{
      kind: 'face', persistentRef: 'face-top', featureId: 'extrude-1', semanticRole: 'top',
      centroid: [5, 10, 5], direction: [0, 1, 0], measure: 100,
    }]);
  });

  it('reports persistent references across a dimensional regeneration', () => {
    const beforeGeometry = new BoxGeometry(10, 10, 10);
    const afterGeometry = new BoxGeometry(12, 10, 10);
    const before = buildTopologicalMap(beforeGeometry, undefined, 'box');
    const report = rebuildTopologicalMapWithRemap(afterGeometry, before, 'box');
    expect(report.remaps).toHaveLength(Object.keys(before.faces).length);
    expect(report.remaps.every(remap => remap.quality === 'persistent')).toBe(true);
    beforeGeometry.dispose();
    afterGeometry.dispose();
  });
});
