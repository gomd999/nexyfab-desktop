import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { holeFeature } from './hole';
import {
  ensureOcctReady,
  getShape,
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
});
