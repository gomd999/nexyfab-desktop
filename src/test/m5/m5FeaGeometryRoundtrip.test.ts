/**
 * M5: FEA — BufferGeometry serialized like `feaWorker` then analyzed (main-thread parity).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { runSimpleFEA } from '@/app/[lang]/shape-generator/analysis/simpleFEA';

const AL6061 = {
  youngsModulus: 69,
  poissonRatio: 0.33,
  yieldStrength: 276,
  density: 2.7,
};

/** Mirrors `workers/feaWorker.ts` reconstruction from transferable buffers. */
function geometryLikeWorkerPayload(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const posAttr = src.getAttribute('position');
  const positions = new Float32Array(posAttr.array);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, posAttr.itemSize));
  const idx = src.getIndex();
  if (idx) {
    const arr = idx.array instanceof Uint32Array ? idx.array : new Uint32Array(idx.array);
    geo.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  geo.computeVertexNormals();
  return geo;
}

describe('M5 FEA geometry round-trip', () => {
  it('runSimpleFEA succeeds on worker-style cloned indexed box mesh', () => {
    const src = new THREE.BoxGeometry(14, 11, 9);
    const geo = geometryLikeWorkerPayload(src);
    const triCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    expect(triCount).toBeGreaterThan(0);

    const result = runSimpleFEA(geo, {
      material: AL6061,
      conditions: [
        { type: 'fixed', faceIndices: [0] },
        { type: 'force', faceIndices: [Math.min(10, Math.floor(triCount) - 1)], value: [120, -300, 0] },
      ],
    });

    expect(result.vonMisesStress.length).toBeGreaterThan(0);
    expect(result.displacement.length).toBeGreaterThan(0);
    expect(result.method === 'linear-fem-tet' || result.method === 'beam-theory').toBe(true);
  });
});
