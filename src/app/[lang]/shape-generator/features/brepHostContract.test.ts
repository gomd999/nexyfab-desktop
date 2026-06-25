/**
 * brepHostContract — ungated unit tests for the FAIL-CLEAN OCCT host contract
 * (occtEngine.resolveBrepHostHandle / isBboxFaithfulBox) and the stale-handle
 * hygiene helpers (downgradeNotice.clearStaleBrepHandle / noteMeshFallback).
 *
 * Background (silently-wrong-geometry class): OCCT fillet/chamfer/shell/boolean
 * used to rebuild a handle-less host as makeBaseBox(bbox) and ship the result
 * as success — the part was silently replaced by its bounding box (measured
 * 95 880 vs 29 440 mm³ on the reference L-bracket). The contract under test:
 *
 *   - registered handle            → returned (real upstream solid)
 *   - no handle, mesh IS a box     → null (box host is exactly faithful)
 *   - anything else                → BrepHostUnavailableError (caller falls to
 *                                    its mesh fallback / pipeline error)
 *
 * The kernel-touching bridge (resolveBrepHostHandleAsync on a non-box mesh)
 * is exercised by the gated reference-parts suite (RUN_OCCT_FEASIBILITY=1).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  isBboxFaithfulBox,
  resolveBrepHostHandle,
  resolveBrepHostHandleAsync,
  BrepHostUnavailableError,
  registerShape,
  resetShapeRegistry,
} from './occtEngine';
import {
  clearStaleBrepHandle,
  noteMeshFallback,
  collectDowngrades,
} from './downgradeNotice';

function box(w = 60, h = 40, d = 30): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.computeVertexNormals();
  return g;
}

/** L-shaped solid: two merged boxes — bbox 60×40×30 but only ~58% filled. */
function lShape(): THREE.BufferGeometry {
  const a = new THREE.BoxGeometry(60, 10, 30);
  a.translate(0, -15, 0);
  const b = new THREE.BoxGeometry(10, 30, 30);
  b.translate(-25, 5, 0);
  const merged = mergeGeometries([a, b]);
  if (!merged) throw new Error('fixture merge failed');
  return merged;
}

afterEach(() => {
  resetShapeRegistry();
});

describe('isBboxFaithfulBox', () => {
  it('accepts a true axis-aligned box', () => {
    expect(isBboxFaithfulBox(box())).toBe(true);
  });

  it('accepts a translated box (center offset does not matter)', () => {
    const g = box(20, 50, 7);
    g.translate(13, -4, 99);
    expect(isBboxFaithfulBox(g)).toBe(true);
  });

  it('rejects an L-shaped solid (the historic bbox-replacement victim)', () => {
    expect(isBboxFaithfulBox(lShape())).toBe(false);
  });

  it('rejects a cylinder', () => {
    const g = new THREE.CylinderGeometry(10, 10, 30, 32);
    expect(isBboxFaithfulBox(g)).toBe(false);
  });

  it('rejects an empty geometry', () => {
    expect(isBboxFaithfulBox(new THREE.BufferGeometry())).toBe(false);
  });

  it('rejects a double-covered box (merged duplicate — volume 2×bbox)', () => {
    const merged = mergeGeometries([box(), box()]);
    expect(merged).toBeTruthy();
    expect(isBboxFaithfulBox(merged!)).toBe(false);
  });
});

describe('resolveBrepHostHandle — fail-clean contract', () => {
  it('returns the registered upstream handle when present', () => {
    const g = lShape();
    const handle = registerShape({ fake: 'solid' });
    g.userData.occtHandle = handle;
    expect(resolveBrepHostHandle(g)).toBe(handle);
  });

  it('returns null for a handle-less TRUE box (box host is faithful)', () => {
    expect(resolveBrepHostHandle(box())).toBeNull();
  });

  it('THROWS for a handle-less non-box body — never a bbox stand-in', () => {
    expect(() => resolveBrepHostHandle(lShape())).toThrow(BrepHostUnavailableError);
  });

  it('THROWS for a STALE handle (not in the registry) on a non-box body', () => {
    const g = lShape();
    g.userData.occtHandle = 'occt:999999'; // never registered / cleared registry
    expect(() => resolveBrepHostHandle(g)).toThrow(BrepHostUnavailableError);
  });

  it('a stale handle on a true box still resolves to the faithful box host (null)', () => {
    const g = box();
    g.userData.occtHandle = 'occt:999999';
    expect(resolveBrepHostHandle(g)).toBeNull();
  });

  it('async variant resolves the no-bridge-needed cases identically', async () => {
    await expect(resolveBrepHostHandleAsync(box())).resolves.toBeNull();
    const g = lShape();
    const handle = registerShape({ fake: 'solid' });
    g.userData.occtHandle = handle;
    await expect(resolveBrepHostHandleAsync(g)).resolves.toBe(handle);
  });
});

describe('clearStaleBrepHandle — mesh fallback handle hygiene', () => {
  it('removes occtHandle from the result', () => {
    const g = box();
    g.userData.occtHandle = 'occt:1';
    clearStaleBrepHandle(g);
    expect(g.userData.occtHandle).toBeUndefined();
  });

  it('detaches shared userData: the upstream clone donor keeps ITS handle', () => {
    // THREE's clone()/copy() shares userData BY REFERENCE — the exact aliasing
    // that made the draft fallback poison its upstream. Clearing the clone
    // must not delete the original's (still valid) handle.
    const upstream = box();
    upstream.userData.occtHandle = 'occt:42';
    const clone = upstream.clone();
    expect(clone.userData).toBe(upstream.userData); // precondition: shared ref
    clearStaleBrepHandle(clone);
    expect(clone.userData.occtHandle).toBeUndefined();
    expect(upstream.userData.occtHandle).toBe('occt:42');
  });

  it('keeps the rest of userData intact', () => {
    const g = box();
    g.userData = { occtHandle: 'occt:7', nfabFeatureStack: ['boolean'] };
    clearStaleBrepHandle(g);
    expect(g.userData.nfabFeatureStack).toEqual(['boolean']);
  });

  it('no-ops on a geometry without a handle', () => {
    const g = box();
    const before = g.userData;
    clearStaleBrepHandle(g);
    expect(g.userData).toBe(before);
  });
});

describe('noteMeshFallback — clears stale handles uniformly', () => {
  it('drops the stale handle on every mesh fallback (even mesh-engine intent)', () => {
    const g = box();
    g.userData.occtHandle = 'occt:3';
    noteMeshFallback(g, { op: 'Boolean', engine: 0 }); // explicit mesh engine
    expect(g.userData.occtHandle).toBeUndefined();
  });

  it('keeps a valid handle on an isNoOp fallback (geometry unchanged)', () => {
    const g = box();
    g.userData.occtHandle = 'occt:3';
    noteMeshFallback(g, { op: 'MoldTool', engine: 1, isNoOp: true });
    expect(g.userData.occtHandle).toBe('occt:3');
  });

  it('stampDowngrade is copy-on-write: notices never leak into the clone donor', () => {
    const upstream = box();
    const clone = upstream.clone(); // shares userData by reference
    noteMeshFallback(clone, { op: 'Draft', engine: 1 });
    expect(collectDowngrades(clone)).toHaveLength(1);
    expect(collectDowngrades(upstream)).toHaveLength(0);
  });
});
