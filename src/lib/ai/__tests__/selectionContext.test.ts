import { describe, expect, it } from 'vitest';
import type { EdgeSelectionInfo, FaceSelectionInfo } from '@/app/[lang]/shape-generator/editing/selectionInfo';
import { modelContentRevision, selectionContextFromElement, selectionRequiresConfirmation } from '../selectionContext';

const face: FaceSelectionInfo = {
  type: 'face', normal: [0, 0, 1], position: [10, 20, 30], area: 500,
  triangleCount: 2, normalLabel: 'Top', triangleIndices: [0, 1],
  persistentId: 'face:extrude-1:top', partName: 'housing-1',
};

describe('selectionContextFromElement', () => {
  it('preserves a persistent face and assembly identity for AI editing', () => {
    const context = selectionContextFromElement(face, {
      projectRevision: 'rev-12', assemblyPath: ['main'], featureId: 'extrude-1',
    });
    expect(context.partInstanceId).toBe('housing-1');
    expect(context.topology[0]).toMatchObject({
      kind: 'face', persistentRef: 'face:extrude-1:top',
      referenceQuality: 'persistent', semanticRole: 'positive_z_face',
    });
    expect(selectionRequiresConfirmation(context)).toBe(false);
  });

  it('marks an index-free geometric edge fallback as derived', () => {
    const edge: EdgeSelectionInfo = {
      type: 'edge', position: [1, 2, 3], length: 20, normal: [0, 1, 0],
      direction: [1, 0, 0], bbox: { min: [0, 0, 0], max: [20, 5, 5] },
    };
    const context = selectionContextFromElement(edge, { projectRevision: 'rev-1' });
    expect(context.topology[0]?.persistentRef).toMatch(/^derived:edge:/);
    expect(context.topology[0]?.referenceQuality).toBe('derived');
    expect(selectionRequiresConfirmation(context)).toBe(true);
  });

  it('converts multi-face selection without triangle indices in the AI contract', () => {
    const context = selectionContextFromElement({
      type: 'multi', faces: [face, { ...face, persistentId: 'face:extrude-1:bottom', normal: [0, 0, -1] }],
      totalArea: 1000, totalTriangleCount: 4, allTriangleIndices: [0, 1, 2, 3],
    }, { projectRevision: 'rev-3', bodyId: 'body-1' });
    expect(context.topology).toHaveLength(2);
    expect(context.topology.map(ref => ref.semanticRole)).toEqual(['positive_z_face', 'negative_z_face']);
    expect(JSON.stringify(context)).not.toContain('triangleIndices');
  });
});

describe('modelContentRevision', () => {
  it('is deterministic across object key order and changes with model content', () => {
    const a = modelContentRevision({ shape: 'box', params: { width: 10, height: 20 } });
    const b = modelContentRevision({ params: { height: 20, width: 10 }, shape: 'box' });
    const changed = modelContentRevision({ shape: 'box', params: { width: 11, height: 20 } });
    expect(a).toBe(b);
    expect(changed).not.toBe(a);
    expect(a).toMatch(/^model-[0-9a-f]{8}$/);
  });
});
