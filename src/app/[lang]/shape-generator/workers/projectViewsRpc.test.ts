import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyFeaturePipelineDetailedAsync } from '../features';
import {
  ensureOcctReady,
  getShape,
  resetShapeRegistry,
} from '../features/occtEngine';
import type { FeatureInstance } from '../features/types';
import { handleProjectViewsRequest, settlePendingProjections } from './projectViewsRpc';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

function arcPathCount(paths: unknown[]): number {
  return paths.flat(3).map(String).filter(path => /A/i.test(path)).length;
}

const holes: FeatureInstance[] = [-20, 20].map((posX, index) => ({
  id: `hole-${index + 1}`,
  type: 'hole',
  enabled: true,
  params: {
    holeType: 0,
    diameter: 10,
    posX,
    posZ: 0,
    depth: 999,
    endCondition: 1,
    counterboreDia: 18,
    counterboreDepth: 5,
    countersinkAngle: 90,
    engine: 1,
  },
}));

describeMaybe('PROJECT_VIEWS worker RPC boundary', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 120_000);

  it('projects the final Ø10×2 pipeline handle without ferrying kernel state', async () => {
    resetShapeRegistry();
    const base = new THREE.BoxGeometry(100, 8, 60);
    const result = await applyFeaturePipelineDetailedAsync(base, holes, {
      occtMode: true,
      baseSpec: { shapeId: 'box', params: { width: 100, height: 8, depth: 60 } },
    });

    expect(result.errors).toEqual({});
    const handle = result.geometry.userData?.occtHandle as string;
    expect(handle).toMatch(/^occt:\d+$/);
    expect(getShape(handle)).toBeTruthy();

    const response = await handleProjectViewsRequest({
      requestId: 41,
      handle,
      views: ['front', 'top', 'right'],
    });

    expect(response.type).toBe('PROJECT_RESULT');
    expect(response.requestId).toBe(41);
    expect(response).not.toHaveProperty('handle');
    expect(response.projectedViews).not.toBeNull();
    expect(arcPathCount(response.projectedViews!.front.visible)).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('preserves request correlation and returns null for an unknown handle', async () => {
    const response = await handleProjectViewsRequest({
      requestId: 42,
      handle: 'occt:missing',
      views: ['front'],
    });
    expect(response).toEqual({ type: 'PROJECT_RESULT', requestId: 42, projectedViews: null });
  });

  it('fails closed for malformed requests and projector failures', async () => {
    await expect(handleProjectViewsRequest({ requestId: -1, handle: '', views: [] }))
      .resolves.toEqual({ type: 'PROJECT_RESULT', requestId: -1, projectedViews: null });
    await expect(handleProjectViewsRequest(
      { requestId: 43, handle: 'occt:1', views: ['front'] },
      () => { throw new Error('worker projection failed'); },
    )).resolves.toEqual({ type: 'PROJECT_RESULT', requestId: 43, projectedViews: null });
  });

  it('settles and clears every pending projection when the worker is discarded', () => {
    const settled: Array<[number, unknown]> = [];
    const pending = new Map<number, (value: unknown | null) => void>([
      [51, value => settled.push([51, value])],
      [52, value => settled.push([52, value])],
    ]);

    settlePendingProjections(pending);

    expect(settled).toEqual([[51, null], [52, null]]);
    expect(pending.size).toBe(0);
  });
});
