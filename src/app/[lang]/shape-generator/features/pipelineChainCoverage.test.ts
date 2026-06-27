/**
 * Pipeline chain coverage — integration level, above featureApplyCoverage (which
 * applies ONE feature in isolation). Runs realistic MULTI-feature programs through
 * the real applyFeaturePipelineDetailed and asserts every feature in the chain
 * applies without error and the result is non-empty — catching feature-interaction
 * bugs (feature B silently dropped/broken after feature A) that single-feature and
 * unit tests miss.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyFeaturePipelineDetailed, FEATURE_MAP } from './index';
import { stampFaceFeatureIdAll } from './faceProvenance';
import type { FeatureInstance } from './types';

let seq = 0;
function feat(type: string, overrides: Record<string, number> = {}): FeatureInstance {
   
  const def = (FEATURE_MAP as any)[type];
  const params: Record<string, number> = {};
  (def?.params ?? []).forEach((p: { key: string; default: number }) => { params[p.key] = p.default; });
  Object.assign(params, overrides);
  return { id: `${type}_${seq++}`, type: type as FeatureInstance['type'], params, enabled: true } as FeatureInstance;
}
// Mesh-path base is non-indexed (the form the mesh-CSG features expect, matching
// the real modeler's base for the mesh fallback path).
// Mesh-path base, face-id-stamped to match the real base (mesh-CSG features stamp
// their cutter with FACE_FEATURE_ID_ATTR; the base must carry it too or
// three-bvh-csg's merge fails on mismatched attributes). `indexed` per chain:
// hole/CSG want non-indexed; shell/variable* want indexed manifold.
function box(indexed = false): THREE.BufferGeometry {
  const g0 = new THREE.BoxGeometry(60, 20, 40);
  const g = indexed ? g0 : g0.toNonIndexed();
  stampFaceFeatureIdAll(g, '__base__');
  return g;
}

const CHAINS: { name: string; indexed?: boolean; feats: FeatureInstance[] }[] = [
  { name: 'bracket: hole→fillet→chamfer', feats: [feat('hole', { posX: 0, posY: 0, diameter: 8 }), feat('fillet', { radius: 2 }), feat('chamfer', { distance: 1 })] },
  { name: 'sheet-metal: flange→bend', feats: [feat('flange', { edgeIndex: 0, height: 20, angle: 90, radius: 1.5 }), feat('bend', { angle: 45, radius: 1.5, position: 0.5 })] },
  { name: 'enclosure: shell (indexed)', indexed: true, feats: [feat('shell', { thickness: 1.5 })] },
  { name: 'ribbed: rib→fillet', feats: [feat('rib'), feat('fillet', { radius: 1 })] },
  { name: 'multi-hole: hole×3', feats: [feat('hole', { posX: -15 }), feat('hole', { posX: 0 }), feat('hole', { posX: 15 })] },
  { name: 'pattern: hole→linearPattern', feats: [feat('hole', { posX: -20, diameter: 5 }), feat('linearPattern')] },
  { name: 'mirror: hole→mirror', feats: [feat('hole', { posX: 15, diameter: 5 }), feat('mirror')] },
];

describe('pipeline chain coverage', () => {
  it('runs multi-feature chains end-to-end with no dropped/errored features', () => {
    const rows: { name: string; status: string; detail: string }[] = [];
    for (const chain of CHAINS) {
      try {
        const res = applyFeaturePipelineDetailed(box(chain.indexed), chain.feats);
        const cnt = res.geometry?.attributes?.position?.count ?? 0;
        const errs = Object.entries(res.errors ?? {});
        if (errs.length > 0) rows.push({ name: chain.name, status: 'FEATURE-ERR', detail: errs.map(([k, v]) => `${k}:${v}`).join(' | ').slice(0, 90) });
        else if (cnt === 0) rows.push({ name: chain.name, status: 'EMPTY', detail: '' });
        else rows.push({ name: chain.name, status: 'OK', detail: cnt + ' verts' });
      } catch (e) { rows.push({ name: chain.name, status: 'THREW', detail: (e instanceof Error ? e.message : String(e)).slice(0, 80) }); }
    }
    const bad = rows.filter(r => r.status !== 'OK');
    console.log(`\n===== PIPELINE CHAIN COVERAGE: ${rows.filter(r => r.status === 'OK').length}/${rows.length} OK =====`);
    rows.forEach(r => console.log(`  ${r.status.padEnd(12)} ${r.name}  ${r.detail}`));
    expect(bad.map(r => `${r.name} → ${r.status} ${r.detail}`), 'feature chains that failed end-to-end').toEqual([]);
  });
});
