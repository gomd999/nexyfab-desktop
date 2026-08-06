import { describe, expect, it } from 'vitest';
import type { Mate } from '@/lib/assembly/mate';
import type { FeatureTree } from './featureTree';
import { reconcileFeatureTreeMateReferences } from './featureTreeReferenceReconcile';

const extrudeTree = (depth: number): FeatureTree => ({
  nodes: [{
    id: 'ext',
    name: 'Extrude',
    dependencies: [],
    payload: {
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      depth,
      direction: 'one_sided',
      mode: 'add',
    },
  }],
});

const mate: Mate = {
  id: 'mate_axis',
  kind: 'concentric',
  a: { partId: 'part_a', refId: 'extrude_axis_0', refKind: 'axis' },
  b: { partId: 'part_b', refId: 'z_axis', refKind: 'axis' },
  suppressed: false,
};

describe('reconcileFeatureTreeMateReferences', () => {
  it('keeps a mate active when its generated reference survives', () => {
    const result = reconcileFeatureTreeMateReferences({
      partId: 'part_a', before: extrudeTree(10), after: extrudeTree(20), mates: [mate],
    });
    expect(result.mates[0]?.suppressed).toBe(false);
    expect(result.review).toEqual([]);
    expect(result.remaps[0]?.quality).toBe('persistent');
  });

  it('suppresses and reports a mate when its generated reference disappears', () => {
    const result = reconcileFeatureTreeMateReferences({
      partId: 'part_a', before: extrudeTree(10), after: { nodes: [] }, mates: [mate],
    });
    expect(result.mates[0]?.suppressed).toBe(true);
    expect(result.review).toMatchObject([
      { consumer: 'mate', id: 'mate_axis', ref: 'extrude_axis_0', quality: 'broken' },
    ]);
  });
});
