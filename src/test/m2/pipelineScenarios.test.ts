/**
 * M2: runPipeline ↔ classifyFeatureError 연동 (목 피처만 사용, OCCT/WASM 없음).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { runPipeline, type FeatureMap } from '@/app/[lang]/shape-generator/features/pipelineManager';
import type { FeatureDefinition, FeatureInstance } from '@/app/[lang]/shape-generator/features/types';
import { classifyFeatureError } from '@/app/[lang]/shape-generator/features/featureDiagnostics';

function makeBox(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(10, 10, 10);
}

function makeInst(
  type: FeatureInstance['type'],
  id: string,
  params: Record<string, number> = {},
): FeatureInstance {
  return { id, type, params, enabled: true };
}

function buildMap(...defs: FeatureDefinition[]): FeatureMap {
  const m: Record<string, FeatureDefinition> = {};
  for (const d of defs) m[d.type] = d;
  return m as FeatureMap;
}

const emptySolidDef: FeatureDefinition = {
  type: 'chamfer',
  icon: '✂',
  params: [],
  apply() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    return g;
  },
};

const throwOcctDef: FeatureDefinition = {
  type: 'fillet',
  icon: '⭕',
  params: [],
  apply() {
    throw new Error(
      'OCCT engine not initialized — call ensureOcctReady() before using OCCT features',
    );
  },
};

describe('M2 pipeline scenarios', () => {
  it('maps pipeline empty-geometry error through classifyFeatureError', () => {
    const f = makeInst('chamfer', 'chamfer_1', { size: 1 });
    const { errors } = runPipeline(makeBox(), [f], buildMap(emptySolidDef));
    expect(errors.chamfer_1).toBe('Feature produced empty geometry');
    expect(classifyFeatureError('chamfer', errors.chamfer_1!).code).toBe('emptyOutput');
  });

  it('maps thrown OCCT-not-ready message to occtInit', () => {
    const f = makeInst('fillet', 'fillet_1', { radius: 1 });
    const { errors } = runPipeline(makeBox(), [f], buildMap(throwOcctDef));
    expect(errors.fillet_1).toContain('OCCT engine not initialized');
    expect(classifyFeatureError('fillet', errors.fillet_1!).code).toBe('occtInit');
  });

  it('keeps vertex count on failure (rollback)', () => {
    const base = makeBox();
    const n = base.attributes.position.count;
    const f = makeInst('fillet', 'fillet_2', { radius: 1 });
    const { geometry, errors } = runPipeline(base, [f], buildMap(throwOcctDef));
    expect(errors.fillet_2).toBeDefined();
    expect(geometry.attributes.position.count).toBe(n);
  });
});
