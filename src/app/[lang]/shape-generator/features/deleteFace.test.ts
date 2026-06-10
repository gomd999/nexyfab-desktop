/**
 * deleteFace — registration + honest-failure contract (no WASM).
 *
 * Delete Face is B-rep ONLY (no geometrically sound mesh approximation of
 * face healing exists), so the ungated suite locks the refusal behaviour:
 * every failure is a STRUCTURED Error with an actionable message, never
 * silently wrong geometry. The OCCT healing itself (boss/hole removal with
 * closed-form volume identities, scope rejections) is covered by
 * __tests__/occtEngine.directEdit.test.ts behind RUN_OCCT_FEASIBILITY=1.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { deleteFaceFeature } from './deleteFace';
import { FEATURE_MAP } from './index';
import type { FaceSelectionInfo } from '../editing/selectionInfo';

const SEL: FaceSelectionInfo = {
  type: 'face',
  position: [0, 10, 0],
  normal: [0, 1, 0],
  area: 400,
  triangleCount: 2,
  normalLabel: '+Y',
  triangleIndices: [],
};

describe('deleteFace — registration', () => {
  it('is registered with no numeric params (selection-driven)', () => {
    const def = FEATURE_MAP.deleteFace;
    expect(def).toBeTruthy();
    expect(def.params).toHaveLength(0);
    expect(typeof def.applyAsync).toBe('function');
  });
});

describe('deleteFace — honest failure contract (OCCT unavailable)', () => {
  it('sync apply (mesh pipeline) throws a structured error, never approximates', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    expect(() => deleteFaceFeature.apply(box, {})).toThrow(/B-rep \(OCCT\)/);
  });

  it('applyAsync without a face selection explains what to select', async () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    await expect(
      deleteFaceFeature.applyAsync!(box, {}, { featureId: 'f1' }),
    ).rejects.toThrow(/no face selected/i);
  });

  it('applyAsync with a selection but no OCCT kernel fails with a clear error', async () => {
    // vitest runs without ensureOcctReady() here, so isOcctReady() is false.
    const box = new THREE.BoxGeometry(20, 20, 20);
    await expect(
      deleteFaceFeature.applyAsync!(box, {}, { featureId: 'f1', faceSelections: [SEL] }),
    ).rejects.toThrow(/OCCT/);
  });
});
