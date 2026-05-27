/**
 * Feature-pipeline rebuild burn-in (parametric-rebuild pillar).
 *
 * The OCCT burn-in covers the B-rep engine; this hammers the parametric rebuild
 * itself on the mesh path (no WASM, not gated): the property a parametric CAD
 * must guarantee — deterministic, side-effect-free regeneration with working
 * suppression and per-feature error isolation.
 *
 *   1. Determinism: same feature stack → identical geometry across rebuilds.
 *   2. Suppression (rollback): disabling a feature == removing it.
 *   3. Error isolation: a feature that fails is captured in errors[], never
 *      crashes, and the prior geometry is preserved.
 *   4. Empty stack returns the base geometry unchanged.
 *
 * Uses fillet (meshRounding-backed, no OCCT) as the "working" feature.
 *
 * FIXED (2026-05-20): a mesh-path boolean as the FIRST feature on a fresh
 * (unstamped) base used to error ("…reading 'array'") — CSG provenance stamping
 * added nfabFaceFeatureId to the tool while the bare base lacked it, so the
 * evaluator hit an attribute mismatch. Fix: boolean.ts now fills the missing
 * side with a sentinel-0 attribute so both operands match. The "leading boolean
 * applies" test below guards the fix.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyFeaturePipelineDetailed, type FeatureInstance } from '../features';
import { computeSignature } from './geometrySignature';

const BOX_VOLUME = 60 * 40 * 30;

function makeBox(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(60, 40, 30);
  geo.computeVertexNormals();
  return geo;
}

function fillet(id: string, radius = 4, enabled = true): FeatureInstance {
  return { id, type: 'fillet', enabled, params: { radius, segments: 3, engine: 0 } };
}

describe('pipeline rebuild — determinism', () => {
  it('same stack rebuilt 3× yields an identical hash (and actually rounds)', () => {
    const feats = [fillet('a')];
    const sigs = [0, 1, 2].map(() => computeSignature(applyFeaturePipelineDetailed(makeBox(), feats).geometry));
    expect(sigs[0]!.positionHash).toBe(sigs[1]!.positionHash);
    expect(sigs[1]!.positionHash).toBe(sigs[2]!.positionHash);
    expect(sigs[0]!.volume_mm3).toBe(sigs[2]!.volume_mm3);
    expect(sigs[0]!.volume_mm3).toBeLessThan(BOX_VOLUME);   // the fillet really applied
    expect(sigs[0]!.volume_mm3).toBeGreaterThan(BOX_VOLUME * 0.9);
  });

  it('no state accumulation: rebuilding after an unrelated run is unchanged', () => {
    const feats = [fillet('a')];
    const first = computeSignature(applyFeaturePipelineDetailed(makeBox(), feats).geometry);
    applyFeaturePipelineDetailed(makeBox(), [fillet('x', 6)]); // unrelated run
    const again = computeSignature(applyFeaturePipelineDetailed(makeBox(), feats).geometry);
    expect(again.positionHash).toBe(first.positionHash);
  });
});

describe('pipeline rebuild — suppression (rollback)', () => {
  it('a disabled feature leaves the base geometry (== empty stack)', () => {
    const disabled = computeSignature(applyFeaturePipelineDetailed(makeBox(), [fillet('a', 4, false)]).geometry);
    const empty = computeSignature(applyFeaturePipelineDetailed(makeBox(), []).geometry);
    expect(disabled.positionHash).toBe(empty.positionHash);
  });

  it('enabling vs disabling toggles between rounded and full geometry', () => {
    const on = computeSignature(applyFeaturePipelineDetailed(makeBox(), [fillet('a', 4, true)]).geometry);
    const off = computeSignature(applyFeaturePipelineDetailed(makeBox(), [fillet('a', 4, false)]).geometry);
    expect(on.volume_mm3).toBeLessThan(BOX_VOLUME);
    expect(off.volume_mm3).toBeCloseTo(BOX_VOLUME, 0);
    expect(on.positionHash).not.toBe(off.positionHash);
  });
});

describe('pipeline rebuild — leading mesh-boolean (R9 fix)', () => {
  it('a boolean as the FIRST feature on a fresh base now applies (no error)', () => {
    const cut: FeatureInstance = {
      id: 'cut', type: 'boolean', enabled: true,
      params: { operation: 1, toolShape: 1, toolWidth: 20, toolHeight: 80, toolDepth: 10, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, engine: 0 },
    };
    const r = applyFeaturePipelineDetailed(makeBox(), [cut]);
    expect(Object.keys(r.errors)).toEqual([]);                       // no attribute-mismatch error
    expect(computeSignature(r.geometry).volume_mm3).toBeLessThan(BOX_VOLUME); // material removed
  });

  it('chains: fillet then boolean both apply', () => {
    const cut: FeatureInstance = {
      id: 'cut', type: 'boolean', enabled: true,
      params: { operation: 1, toolShape: 1, toolWidth: 20, toolHeight: 80, toolDepth: 10, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, engine: 0 },
    };
    const filletOnly = computeSignature(applyFeaturePipelineDetailed(makeBox(), [fillet('f')]).geometry);
    const r = applyFeaturePipelineDetailed(makeBox(), [fillet('f'), cut]);
    expect(Object.keys(r.errors)).toEqual([]);
    expect(computeSignature(r.geometry).volume_mm3).toBeLessThan(filletOnly.volume_mm3);
  });
});

describe('pipeline rebuild — error isolation', () => {
  it('a genuinely failing feature is captured in errors[], never throws, geometry preserved', () => {
    // Zero-volume tool → boolean throws "empty result"; the pipeline must
    // isolate it (record in errors, keep prior geometry, never crash).
    const bad: FeatureInstance = {
      id: 'bad', type: 'boolean', enabled: true,
      params: { operation: 1, toolShape: 1, toolWidth: 0, toolHeight: 0, toolDepth: 0, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, engine: 0 },
    };
    let r: ReturnType<typeof applyFeaturePipelineDetailed> | null = null;
    expect(() => { r = applyFeaturePipelineDetailed(makeBox(), [fillet('f'), bad]); }).not.toThrow();
    expect(Object.keys(r!.errors)).toContain('bad');                 // isolated, recorded
    // The good fillet still applied; the bad boolean was skipped.
    expect(computeSignature(r!.geometry).volume_mm3).toBeLessThan(BOX_VOLUME);
  });
});

describe('pipeline rebuild — empty stack', () => {
  it('returns the base geometry essentially unchanged', () => {
    const out = computeSignature(applyFeaturePipelineDetailed(makeBox(), []).geometry);
    expect(out.volume_mm3).toBeCloseTo(BOX_VOLUME, 0);
  });
});
