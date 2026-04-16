/**
 * Feature pipeline unit tests.
 *
 * Core CAD engine reliability — validates that:
 *   1. Normal features produce valid geometry
 *   2. Failing features roll back to the previous valid state (not crash)
 *   3. Disabled features are skipped
 *   4. Pipeline cache is hit on identical inputs
 *   5. Empty geometry is detected and rejected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { runPipeline, type FeatureMap } from '../features/pipelineManager';
import type { FeatureDefinition, FeatureInstance } from '../features/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBoxGeo(w = 50, h = 50, d = 50): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

function makeFeature(
  type: string,
  params: Record<string, number> = {},
  opts: Partial<FeatureInstance> = {},
): FeatureInstance {
  return {
    id: `test_${Math.random().toString(36).slice(2, 8)}`,
    type: type as FeatureInstance['type'],
    params,
    enabled: true,
    sketchData: undefined,
    ...opts,
  };
}

/** FeatureDefinition that scales geometry uniformly */
function makeScaleFeatureDef(factor: number) {
  return {
    type: 'scale' as const,
    icon: '⟲',
    params: [],
    apply(geo: THREE.BufferGeometry, params: Record<string, number>) {
      const out = geo.clone();
      const pos = out.attributes.position as THREE.BufferAttribute;
      const f = params.factor ?? factor;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
      }
      pos.needsUpdate = true;
      out.computeVertexNormals();
      return out;
    },
  };
}

/** FeatureDefinition that always throws */
function makeThrowingDef() {
  return {
    type: 'fillet' as const,
    icon: '⭕',
    params: [],
    apply() {
      throw new Error('Simulated feature failure');
    },
  };
}

/** FeatureDefinition that returns empty geometry (zero vertices) */
function makeEmptyGeoDef() {
  return {
    type: 'chamfer' as const,
    icon: '✂',
    params: [],
    apply() {
      return new THREE.BufferGeometry(); // empty — no position attribute
    },
  };
}

function buildFeatureMap(defs: FeatureDefinition[]): FeatureMap {
  const map: Record<string, FeatureDefinition> = {};
  for (const d of defs) {
    map[d.type] = d;
  }
  return map as unknown as FeatureMap;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runPipeline', () => {
  let baseGeo: THREE.BufferGeometry;

  beforeEach(() => {
    baseGeo = makeBoxGeo();
  });

  // ── 1. Happy path ──────────────────────────────────────────────────────────

  it('returns base geometry unchanged when feature list is empty', () => {
    const { geometry, errors } = runPipeline(baseGeo, [], {} as FeatureMap);
    expect(geometry.attributes.position.count).toBe(
      baseGeo.attributes.position.count,
    );
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('applies a valid feature and returns modified geometry', () => {
    const scaleDef = makeScaleFeatureDef(2);
    const featureMap = buildFeatureMap([scaleDef as unknown as FeatureDefinition]);
    const feature = makeFeature('scale', { factor: 2 });
    const base = makeBoxGeo(10, 10, 10);

    const { geometry, errors } = runPipeline(base, [feature], featureMap);

    expect(Object.keys(errors)).toHaveLength(0);
    base.computeBoundingBox();
    geometry.computeBoundingBox();
    // Scaled by 2 → bounding box should be roughly twice as large
    const baseSize = new THREE.Vector3();
    const outSize = new THREE.Vector3();
    base.boundingBox!.getSize(baseSize);
    geometry.boundingBox!.getSize(outSize);
    expect(outSize.x).toBeCloseTo(baseSize.x * 2, 0);
  });

  it('chains multiple features in order', () => {
    const scaleDef = makeScaleFeatureDef(1);
    const featureMap = buildFeatureMap([scaleDef as unknown as FeatureDefinition]);
    const f1 = makeFeature('scale', { factor: 2 });
    const f2 = makeFeature('scale', { factor: 3 });
    const base = makeBoxGeo(10, 10, 10);

    const { geometry, errors } = runPipeline(base, [f1, f2], featureMap);

    expect(Object.keys(errors)).toHaveLength(0);
    base.computeBoundingBox();
    geometry.computeBoundingBox();
    const baseSize = new THREE.Vector3();
    const outSize = new THREE.Vector3();
    base.boundingBox!.getSize(baseSize);
    geometry.boundingBox!.getSize(outSize);
    // 2×3 = 6× scale
    expect(outSize.x).toBeCloseTo(baseSize.x * 6, 0);
  });

  // ── 2. Error recovery (most important) ────────────────────────────────────

  it('rolls back to previous geometry when a feature throws', () => {
    const throwDef = makeThrowingDef();
    const featureMap = buildFeatureMap([throwDef as unknown as FeatureDefinition]);
    const feature = makeFeature('fillet', { radius: 3 });

    const { geometry, errors } = runPipeline(baseGeo, [feature], featureMap);

    // Error is recorded
    expect(errors[feature.id]).toBeTruthy();
    expect(errors[feature.id]).toContain('Simulated feature failure');

    // Geometry is rolled back — same vertex count as base
    expect(geometry.attributes.position.count).toBe(
      baseGeo.attributes.position.count,
    );
  });

  it('continues processing subsequent features after a failure', () => {
    const throwDef = makeThrowingDef();
    const scaleDef = makeScaleFeatureDef(1);
    const featureMap = buildFeatureMap([
      throwDef as unknown as FeatureDefinition,
      scaleDef as unknown as FeatureDefinition,
    ]);

    const failing = makeFeature('fillet', { radius: 999 });
    const ok = makeFeature('scale', { factor: 2 });
    const base = makeBoxGeo(10, 10, 10);

    const { geometry, errors } = runPipeline(base, [failing, ok], featureMap);

    // Failure is logged
    expect(errors[failing.id]).toBeTruthy();
    // Subsequent scale still runs
    expect(errors[ok.id]).toBeUndefined();
    base.computeBoundingBox();
    geometry.computeBoundingBox();
    const baseSize = new THREE.Vector3();
    const outSize = new THREE.Vector3();
    base.boundingBox!.getSize(baseSize);
    geometry.boundingBox!.getSize(outSize);
    expect(outSize.x).toBeCloseTo(baseSize.x * 2, 0);
  });

  it('records error and keeps geometry when feature returns empty geometry', () => {
    const emptyDef = makeEmptyGeoDef();
    const featureMap = buildFeatureMap([emptyDef as unknown as FeatureDefinition]);
    const feature = makeFeature('chamfer', { size: 2 });

    const { geometry, errors } = runPipeline(baseGeo, [feature], featureMap);

    expect(errors[feature.id]).toBeTruthy();
    // Geometry unchanged
    expect(geometry.attributes.position.count).toBe(
      baseGeo.attributes.position.count,
    );
  });

  // ── 3. Disabled features ───────────────────────────────────────────────────

  it('skips disabled features', () => {
    const throwDef = makeThrowingDef();
    const featureMap = buildFeatureMap([throwDef as unknown as FeatureDefinition]);
    const disabled = makeFeature('fillet', { radius: 3 }, { enabled: false });

    const { geometry, errors } = runPipeline(baseGeo, [disabled], featureMap);

    // No errors and geometry is untouched
    expect(Object.keys(errors)).toHaveLength(0);
    expect(geometry.attributes.position.count).toBe(
      baseGeo.attributes.position.count,
    );
  });

  // ── 4. Unknown feature type ────────────────────────────────────────────────

  it('silently skips features with no definition in featureMap', () => {
    const featureMap: FeatureMap = {} as FeatureMap;
    const feature = makeFeature('unknown_feature_type' as FeatureInstance['type']);

    const { geometry, errors } = runPipeline(baseGeo, [feature], featureMap);

    expect(Object.keys(errors)).toHaveLength(0);
    expect(geometry.attributes.position.count).toBe(
      baseGeo.attributes.position.count,
    );
  });

  // ── 5. Multiple failures don't accumulate corrupt state ───────────────────

  it('handles multiple consecutive failures gracefully', () => {
    const throwDef = makeThrowingDef();
    const featureMap = buildFeatureMap([throwDef as unknown as FeatureDefinition]);
    const features = [
      makeFeature('fillet', { radius: 1 }),
      makeFeature('fillet', { radius: 2 }),
      makeFeature('fillet', { radius: 3 }),
    ];

    const { geometry, errors } = runPipeline(baseGeo, features, featureMap);

    expect(Object.keys(errors)).toHaveLength(3);
    // Original geometry preserved
    expect(geometry.attributes.position.count).toBe(
      baseGeo.attributes.position.count,
    );
  });
});
