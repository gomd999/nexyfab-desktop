/**
 * solidKernelBindings — the headless-verifiable half of the W3 pipeline glue:
 * the bbox helper, the deps wiring shape, and the kernel selector. The replicad
 * ops themselves (occtExtrudeProfile…) are browser-runtime and exercised in the
 * NEXYFAB_OCCT_REAL e2e; here we verify the wiring + mesh helpers in node.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { boundsOf, replicadDeps, selectSolidKernel } from './solidKernelBindings';

describe('boundsOf', () => {
  it('returns the axis-aligned bounds of a BufferGeometry', () => {
    const b = boundsOf(new THREE.BoxGeometry(10, 20, 30));
    expect(b).toBeDefined();
    expect(b!.min).toEqual({ x: -5, y: -10, z: -15 });
    expect(b!.max).toEqual({ x: 5, y: 10, z: 15 });
  });

  it('returns undefined for an empty / non-geometry input', () => {
    expect(boundsOf(new THREE.BufferGeometry())).toBeUndefined();
    expect(boundsOf(null)).toBeUndefined();
    expect(boundsOf({})).toBeUndefined();
  });
});

describe('replicadDeps wiring', () => {
  it('exposes all six injected bindings', () => {
    const d = replicadDeps();
    for (const k of ['extrudeProfile', 'revolveProfile', 'booleanSolids', 'exportStep', 'meshVolume', 'boundsOf'] as const) {
      expect(typeof d[k]).toBe('function');
    }
  });

  it('the injected meshVolume measures a mesh (box ≈ 1000)', () => {
    const d = replicadDeps();
    expect(Math.abs(d.meshVolume(new THREE.BoxGeometry(10, 10, 10)))).toBeCloseTo(1000, 0);
  });
});

describe('selectSolidKernel', () => {
  it('default → a replicad-backed kernel; useWorker → a K-series kernel; both expose the full op set', () => {
    for (const useWorker of [false, true]) {
      const k = selectSolidKernel(useWorker);
      for (const op of ['extrude', 'revolve', 'boolean', 'fillet', 'thicken', 'surfaceTrim', 'exportStep', 'release'] as const) {
        expect(typeof k[op]).toBe('function');
      }
    }
  });
});
