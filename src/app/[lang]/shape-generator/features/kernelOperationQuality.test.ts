import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { assessKernelOperationGeometry, requireValidBrepResult } from './kernelOperationQuality';

describe('kernel operation quality contract', () => {
  it('never labels a valid tessellated fallback as exact B-rep', () => {
    const result = assessKernelOperationGeometry(new THREE.BoxGeometry(10, 10, 10), { geometryClass: 'mesh' });
    expect(result).toMatchObject({ valid: true, grade: 'FACETED', geometryClass: 'mesh' });
    expect(result.metrics.volumeMm3).toBeCloseTo(1000, 3);
  });
  it('requires an OCCT handle before granting exact or recovered B-rep status', () => {
    const detached = assessKernelOperationGeometry(new THREE.BoxGeometry(10, 10, 10), { geometryClass: 'brep' });
    expect(detached).toMatchObject({ valid: false, grade: 'INCOMPLETE' });
    expect(detached.issues).toContain('error:brep_handle_missing');
    const exact = new THREE.BoxGeometry(10, 10, 10); exact.userData.occtHandle = 'shape-1';
    expect(assessKernelOperationGeometry(exact, { geometryClass: 'brep' })).toMatchObject({ valid: true, grade: 'EXACT' });
    expect(assessKernelOperationGeometry(exact, { geometryClass: 'brep', recoveryStrategies: ['shape-heal'] })).toMatchObject({ valid: true, grade: 'RECOVERED' });
  });
  it('fails closed for missing, open and non-finite geometry', () => {
    expect(assessKernelOperationGeometry(null, { geometryClass: 'mesh' })).toMatchObject({ valid: false, grade: 'FAILED' });
    expect(assessKernelOperationGeometry(new THREE.PlaneGeometry(10, 10), { geometryClass: 'mesh' })).toMatchObject({ valid: false, grade: 'INCOMPLETE' });
    const invalid = new THREE.BoxGeometry(10, 10, 10);
    (invalid.attributes.position as THREE.BufferAttribute).setX(0, Number.NaN);
    expect(assessKernelOperationGeometry(invalid, { geometryClass: 'mesh' }).valid).toBe(false);
  });
  it('materializes a valid OCCT handle and rejects invalid OCCT output', () => {
    const valid = requireValidBrepResult({ geometry: new THREE.BoxGeometry(10, 10, 10), handle: 'shape-2' });
    expect(valid.geometry.userData.occtHandle).toBe('shape-2');
    expect(valid.quality.grade).toBe('EXACT');
    expect(() => requireValidBrepResult({ geometry: new THREE.PlaneGeometry(10, 10), handle: 'shape-3' })).toThrow(/invalid solid/i);
    expect(() => requireValidBrepResult({ geometry: new THREE.BoxGeometry(10, 10, 10), handle: null })).toThrow(/brep_handle_missing/i);
  });
});
