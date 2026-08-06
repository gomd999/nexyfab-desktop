import { describe, expect, it } from 'vitest';
import { buildExtrudeTopo } from './topoNaming';
import type { ExtrudeFeature } from './extrudeProfile';
import { reconcileNamedTopologyReferences } from './namedTopologyReferenceReconcile';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';

const extrude = (loop: ExtrudeFeature['loop'], depth = 10): ExtrudeFeature => ({
  kind: 'extrude', loop, depth, direction: 'one_sided', mode: 'add',
});
const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const triangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];

describe('reconcileNamedTopologyReferences', () => {
  it('keeps drawing, GD&T and PMI references through a depth edit', () => {
    const dimension: Dimension = { id: 'dim', viewportId: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'] };
    const gdt: GdtCallout = { id: 'flat', viewportId: 'top', kind: 'flatness', targetRef: 'f.cap.top', toleranceValue: 0.1 };
    const pmi = { id: 'ra', topoHashes: ['f.side.0'], label: 'Ra 3.2' };
    const result = reconcileNamedTopologyReferences({
      before: buildExtrudeTopo(extrude(square, 10)),
      after: buildExtrudeTopo(extrude(square, 20)), dimensions: [dimension], gdt: [gdt], pmi: [pmi],
    });
    expect(result.dimensions).toHaveLength(1);
    expect(result.gdt).toHaveLength(1);
    expect(result.pmi).toHaveLength(1);
    expect(result.review).toEqual([]);
  });

  it('quarantines every consumer of a face removed by profile regeneration', () => {
    const dimension: Dimension = { id: 'radial', viewportId: 'front', kind: 'radial', refs: ['f.side.3'] };
    const gdt: GdtCallout = { id: 'profile', viewportId: 'front', kind: 'flatness', targetRef: 'f.side.3', toleranceValue: 0.1 };
    const pmi = { id: 'note', topoHashes: ['f.side.3'], label: 'critical' };
    const result = reconcileNamedTopologyReferences({
      before: buildExtrudeTopo(extrude(square)),
      after: buildExtrudeTopo(extrude(triangle)), dimensions: [dimension], gdt: [gdt], pmi: [pmi],
    });
    expect(result.dimensions).toEqual([]);
    expect(result.reviewDimensions).toHaveLength(1);
    expect(result.reviewGdt).toHaveLength(1);
    expect(result.reviewPmi).toHaveLength(1);
    expect(result.review.map(item => item.consumer).sort()).toEqual(['dimension', 'gdt', 'pmi']);
  });
});
