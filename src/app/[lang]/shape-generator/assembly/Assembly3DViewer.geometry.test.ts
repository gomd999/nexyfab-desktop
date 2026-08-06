import { describe, expect, it } from 'vitest';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { bboxFromFeatureTree, geometryFromFeatureTree } from './Assembly3DViewer';

const lShape: FeatureTree = { nodes: [{
  id: 'base', name: 'L profile', dependencies: [],
  payload: {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 }],
    depth: 8, direction: 'one_sided', mode: 'add',
  },
}] };

describe('Assembly3DViewer FeatureTree geometry', () => {
  it('executes a non-rectangular sketch as a real extruded mesh', () => {
    const result = geometryFromFeatureTree(lShape);
    result.geometry.computeBoundingBox();
    expect(result.exact).toBe(true);
    expect(result.geometry.attributes.position?.count).toBeGreaterThan(8);
    expect(result.geometry.boundingBox?.max.x).toBeCloseTo(30);
    expect(result.geometry.boundingBox?.max.y).toBeCloseTo(30);
    expect(result.geometry.boundingBox?.max.z).toBeCloseTo(8);
    expect(result.offset).toEqual({ cx: 0, cy: 0, cz: 0 });
    result.geometry.dispose();
  });

  it('keeps bbox metadata for assembly bounds and fallback paths', () => {
    expect(bboxFromFeatureTree(lShape)).toEqual({ sx: 30, sy: 30, sz: 8, cx: 15, cy: 15, cz: 4 });
  });
});
