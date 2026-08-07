import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyBooleanAsync } from './boolean';

const params = {
  operation: 0, toolShape: 0, toolWidth: 5, toolHeight: 5, toolDepth: 5,
  posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0,
};

describe('applyBooleanAsync quality gate', () => {
  it('accepts a closed worker result', async () => {
    const out = await applyBooleanAsync(
      new THREE.BoxGeometry(10, 10, 10),
      params,
      async () => new THREE.BoxGeometry(12, 10, 10),
    );
    expect(out.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('rejects a non-empty but open worker result', async () => {
    await expect(applyBooleanAsync(
      new THREE.BoxGeometry(10, 10, 10),
      params,
      async () => new THREE.PlaneGeometry(10, 10),
    )).rejects.toThrow(/quality validation/i);
  });
});
