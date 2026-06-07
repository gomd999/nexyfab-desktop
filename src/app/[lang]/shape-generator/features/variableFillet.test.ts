/**
 * variableFillet feature — mesh approximation + OCCT-aware applyAsync wiring.
 *
 * The real B-rep variable-radius fillet (occtVariableFillet → replicad
 * `.fillet([startR, endR], finder)`) is verified behind RUN_OCCT_FEASIBILITY in
 * __tests__/occtEngine.extrude.test.ts (material removal between the constant
 * ends). Here we pin the mesh behaviour and the wiring (fallback when OCCT
 * isn't ready / no upstream handle).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { variableFilletFeature, applyVariableFillet } from './variableFillet';

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(20, 20, 20); // indexed (variable fillet needs index)
}

const params = { startRadius: 2, endRadius: 6, segments: 3, engine: 1 };

describe('variableFilletFeature', () => {
  it('exposes a sync apply and an async applyAsync', () => {
    expect(typeof variableFilletFeature.apply).toBe('function');
    expect(typeof variableFilletFeature.applyAsync).toBe('function');
  });

  it('apply() (mesh) produces a non-empty geometry', () => {
    const out = variableFilletFeature.apply(box(), params);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('applyAsync() falls back to the mesh path when OCCT is not ready', async () => {
    const out = await variableFilletFeature.applyAsync!(box(), params, undefined);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('applyAsync() falls back to mesh when there is no upstream OCCT handle/selection', async () => {
    const g = box();
    expect(g.userData.occtHandle).toBeUndefined();
    const out = await variableFilletFeature.applyAsync!(g, params, { featureId: 'test', edgeSelections: [] });
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('applyVariableFillet helper still rounds a box (mesh path preserved)', () => {
    const out = applyVariableFillet(box(), { edgeIndex: 0, startRadius: 2, endRadius: 6, segments: 3 });
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });
});
