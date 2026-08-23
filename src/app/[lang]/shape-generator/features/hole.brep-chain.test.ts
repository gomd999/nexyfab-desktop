import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { holeFeature } from './hole';
import { linearPatternFeature } from './linearPattern';
import { runPipelineAsync } from './pipelineManager';
import type { FeatureInstance, MapBackedFeatureType, FeatureDefinition } from './types';
import {
  ensureOcctReady,
  getShape,
  occtRegisteredShapeEvidence,
  occtProjectViews,
  resetShapeRegistry,
} from './occtEngine';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

const HOLE_PARAMS = {
  holeType: 0,
  diameter: 10,
  posZ: 0,
  depth: 999,
  endCondition: 1,
  counterboreDia: 18,
  counterboreDepth: 5,
  countersinkAngle: 90,
  engine: 1,
};

function handleOf(geometry: THREE.BufferGeometry): string {
  const handle = geometry.userData?.occtHandle;
  expect(typeof handle).toBe('string');
  expect(handle.length).toBeGreaterThan(0);
  expect(getShape(handle)).toBeTruthy();
  return handle;
}

function arcPathCount(paths: unknown[]): number {
  return paths.flat(3).map(String).filter(path => /A/i.test(path)).length;
}

describeMaybe('holeFeature OCCT B-rep chain regression', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 120_000);

  it('preserves both through holes in the final worker-compatible handle and HLR', () => {
    resetShapeRegistry();
    const plate = new THREE.BoxGeometry(100, 8, 60);

    const first = holeFeature.apply(
      plate,
      { ...HOLE_PARAMS, posX: -20 },
      { featureId: 'hole-left' },
    );
    const firstHandle = handleOf(first);

    const second = holeFeature.apply(
      first,
      { ...HOLE_PARAMS, posX: 20 },
      { featureId: 'hole-right' },
    );
    const secondHandle = handleOf(second);

    expect(secondHandle).not.toBe(firstHandle);
    expect(second.getAttribute('position').count).toBeGreaterThan(first.getAttribute('position').count);

    // A Y-axis through-hole is circular in the front projection (u,v)=(x,-z).
    // The two holes must survive in the final registry handle used by PROJECT_VIEWS.
    const views = occtProjectViews(secondHandle, ['front', 'top', 'right']);
    expect(views).not.toBeNull();
    expect(arcPathCount(views!.front!.visible)).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('does not reuse a stale exact handle when a second hole is appended on the next run', async () => {
    const plate = new THREE.BoxGeometry(100, 8, 60);
    const left: FeatureInstance = {
      id: 'hole-left',
      type: 'hole',
      params: { ...HOLE_PARAMS, posX: -20 },
      enabled: true,
    };
    const right: FeatureInstance = {
      id: 'hole-right',
      type: 'hole',
      params: { ...HOLE_PARAMS, posX: 20 },
      enabled: true,
    };
    const featureMap = { hole: holeFeature } as Record<MapBackedFeatureType, FeatureDefinition>;

    const firstRun = await runPipelineAsync(plate, [left], featureMap, { occtMode: true });
    handleOf(firstRun.geometry);

    const secondRun = await runPipelineAsync(plate, [left, right], featureMap, { occtMode: true });
    const finalHandle = handleOf(secondRun.geometry);
    const views = occtProjectViews(finalHandle, ['front']);
    expect(views).not.toBeNull();
    expect(arcPathCount(views!.front!.visible)).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('cuts an upright-flange hole on X in the exact B-rep (not a Y projection)', () => {
    resetShapeRegistry();
    const plate = new THREE.BoxGeometry(60, 20, 40);
    const result = holeFeature.apply(
      plate,
      { ...HOLE_PARAMS, axis: 0, posX: 0, posY: 0, posZ: 10 },
      { featureId: 'upright-x-hole' },
    );
    const handle = handleOf(result);
    const evidence = occtRegisteredShapeEvidence(handle);
    expect(evidence?.singleSolid).toBe(true);
    expect(evidence?.volumeMm3).not.toBeNull();
    // Exact cylinder volume through the X thickness. A Y-axis projection
    // would remove only 20/60 of this amount and falsely pass bbox checks.
    expect(evidence!.volumeMm3!).toBeCloseTo(60 * 20 * 40 - Math.PI * 25 * 60, -1);
    result.computeBoundingBox();
    expect(result.boundingBox!.max.x - result.boundingBox!.min.x).toBeCloseTo(60, 5);
  }, 120_000);

  it('keeps a four-hole feature pattern as one exact body (no whole-body copies)', async () => {
    resetShapeRegistry();
    const plate = new THREE.BoxGeometry(100, 20, 100);
    const features: FeatureInstance[] = [
      {
        id: 'pattern-seed-hole', type: 'hole', enabled: true,
        params: { ...HOLE_PARAMS, diameter: 10, posX: -30, posZ: 0 },
      },
      {
        id: 'four-hole-pattern', type: 'linearPattern', enabled: true,
        params: { axis: 0, count: 4, spacing: 20, patternTarget: 1, seedBack: 0 },
      },
    ];
    const map = {
      hole: holeFeature,
      linearPattern: linearPatternFeature,
    } as Record<MapBackedFeatureType, FeatureDefinition>;
    const run = await runPipelineAsync(plate, features, map, { occtMode: true });
    expect(run.errors).toEqual({});
    const handle = handleOf(run.geometry);
    const evidence = occtRegisteredShapeEvidence(handle);
    expect(evidence?.singleSolid).toBe(true);
    expect(evidence?.volumeMm3).toBeCloseTo(100 * 20 * 100 - 4 * Math.PI * 25 * 20, -1);
    run.geometry.computeBoundingBox();
    expect(run.geometry.boundingBox!.max.x - run.geometry.boundingBox!.min.x).toBeCloseTo(100, 5);
  }, 120_000);
});
