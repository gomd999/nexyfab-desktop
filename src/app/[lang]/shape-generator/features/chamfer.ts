import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { isOcctReady, isOcctGlobalMode, occtChamferBox, hostBoxFromGeometry } from './occtEngine';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

export const chamferFeature: FeatureDefinition = {
  type: 'chamfer',
  icon: '📐',
  params: [
    { key: 'distance', labelKey: 'paramChamferDistance', default: 2, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    {
      key: 'engine',
      labelKey: 'paramBoolEngine',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'enumEngineMeshCsg' },
        { value: 1, labelKey: 'enumEngineOcct' },
      ],
    },
  ],
  apply(geometry, params) {
    const dist = params.distance;
    const engine = Math.round(params.engine ?? 0);

    if ((engine === 1 || isOcctGlobalMode()) && isOcctReady()) {
      try {
        const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        const host = hostBoxFromGeometry(geometry);
        const result = occtChamferBox(host, dist, {}, upstreamHandle);
        if (result.handle) result.geometry.userData.occtHandle = result.handle;
        return result.geometry;
      } catch (err) {
         
        console.warn('[chamfer] OCCT path failed, falling back to mesh approximator:', err);
      }
    }

    // Validate: geometry must have index (manifold requirement for CSG)
    if (!geometry.index) {
      throw new Error('Chamfer requires indexed (manifold) geometry');
    }
    if (geometry.attributes.position.count < 4) {
      throw new Error('Chamfer requires geometry with at least 4 vertices');
    }

    // Create an expanded version of the geometry by offsetting vertices along normals
    const expanded = geometry.clone();
    expanded.computeVertexNormals();
    const pos = expanded.attributes.position;
    const nor = expanded.attributes.normal;

    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) + nor.getX(i) * dist);
      pos.setY(i, pos.getY(i) + nor.getY(i) * dist);
      pos.setZ(i, pos.getZ(i) + nor.getZ(i) * dist);
    }
    pos.needsUpdate = true;

    // Intersect the expanded version with the original geometry.
    // The expanded shape extends outward at flat faces but rounds/chamfers at
    // sharp edges, so intersecting trims those edges off the original.
    const evaluator = new Evaluator();
    const result = evaluator.evaluate(makeBrush(expanded), makeBrush(geometry), INTERSECTION);
    return result.geometry;
  },
};
