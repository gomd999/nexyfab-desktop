import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  exactExecutionHold,
  exactFeatureDefinitionHold,
  exactRegisteredShapeEvidenceHold,
  EXACT_OCCT_REQUIRED_ERROR,
} from './pipelineManager';
import { registerShape, resetShapeRegistry } from './occtEngine';

describe('authoritative exact pipeline policy', () => {
  it('holds a mesh-only result instead of treating it as native exact geometry', () => {
    expect(exactExecutionHold(new THREE.BoxGeometry(10, 10, 10))).toBe(EXACT_OCCT_REQUIRED_ERROR);
  });

  it('rejects forged, stale, and unmeasured live handles', () => {
    resetShapeRegistry();
    const geometry = new THREE.BoxGeometry(10, 10, 10);
    geometry.userData.occtHandle = 'occt:1';
    expect(exactExecutionHold(geometry)).toBe(EXACT_OCCT_REQUIRED_ERROR);
    geometry.userData.occtHandle = registerShape({ marker: 'native-shape' });
    expect(exactExecutionHold(geometry)).toBe(EXACT_OCCT_REQUIRED_ERROR);
    expect(exactExecutionHold(geometry, geometry.userData.occtHandle)).toBe(EXACT_OCCT_REQUIRED_ERROR);
  });

  it('requires measured single-solid kernel evidence with positive volume', () => {
    expect(exactRegisteredShapeEvidenceHold({
      kind: 'Solid', singleSolid: true, nativeShapeType: 2, solidCount: 1, volumeMm3: 1,
    })).toBeNull();
    expect(exactRegisteredShapeEvidenceHold({
      kind: 'Compound', singleSolid: false, nativeShapeType: 0, solidCount: 2, volumeMm3: 1,
    })).toBe(EXACT_OCCT_REQUIRED_ERROR);
  });

  it('requires an async native feature implementation for a map-backed exact step', () => {
    expect(exactFeatureDefinitionHold(undefined)).toBe(EXACT_OCCT_REQUIRED_ERROR);
    expect(exactFeatureDefinitionHold({ apply: (geometry: THREE.BufferGeometry) => geometry } as never)).toBe(EXACT_OCCT_REQUIRED_ERROR);
    expect(exactFeatureDefinitionHold({
      apply: (geometry: THREE.BufferGeometry) => geometry,
      applyAsync: async (geometry: THREE.BufferGeometry) => geometry,
    } as never)).toBeNull();
  });
});
