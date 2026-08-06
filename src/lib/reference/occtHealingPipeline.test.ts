// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import type { OcctBridge } from '@/lib/occt/bridge';
import { healImportedOcctShape } from './occtHealingPipeline';

let bridge: OcctBridge | null = null;
beforeAll(async () => { const loaded = await loadOcctNode(); if (loaded.ok && loaded.oc) bridge = createNodeOcctBridge(loaded.oc); });

describe('real OCCT bounded healing pipeline', () => {
  it('does not modify an already valid solid and exposes exact healing measurements', async () => {
    if (!bridge?.inspectShapeDetailed) return;
    const made = await bridge.buildFromExtrude({ kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], depth: 10, direction: 'one_sided', mode: 'add' });
    expect(made.ok).toBe(true); const detail = await bridge.inspectShapeDetailed(made.shape!);
    expect(detail.maxTolerance).toSatisfy(Number.isFinite); expect(detail.minEdgeLength).toBeCloseTo(10, 6);
    const result = await healImportedOcctShape({ bridge, shape: made.shape!, detail, workingTolerance: 0.001, sewingTolerance: 0.001 });
    expect(result.status).toBe('not_required'); expect(result.topologyReferenceStatus).toBe('preserved_original'); expect(result.shape.id).toBe(made.shape!.id); bridge.release(result.shape);
  });

  it('executes ShapeFix/Sewing on a zero-solid face but rejects it instead of inventing a solid', async () => {
    if (!bridge?.inspectShapeDetailed || !bridge.buildPlanarFace) return;
    const made = await bridge.buildPlanarFace([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    const detail = await bridge.inspectShapeDetailed(made.shape!); expect(detail.solidCount).toBe(0);
    const result = await healImportedOcctShape({ bridge, shape: made.shape!, detail, workingTolerance: 0.001, sewingTolerance: 0.001 });
    expect(result.status).toBe('rejected'); expect(result.topologyReferenceStatus).toBe('preserved_original'); expect(result.shape.id).toBe(made.shape!.id); expect(result.decision?.accepted ?? false).toBe(false); bridge.release(result.shape);
  });
});
