import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { isOcctReady, isOcctGlobalMode, occtFilletBox, hostBoxFromGeometry } from './occtEngine';
import { stampFaceFeatureIdAll, configureEvaluatorForProvenance, propagateFeatureIdMap } from './faceProvenance';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

export const filletFeature: FeatureDefinition = {
  type: 'fillet',
  icon: '⭕',
  params: [
    { key: 'radius', labelKey: 'paramFilletRadius', default: 3, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    { key: 'segments', labelKey: 'paramFilletSegments', default: 3, min: 1, max: 5, step: 1, unit: '' },
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
  apply(geometry, params, ctx) {
    const radius = params.radius;
    const segments = Math.round(params.segments);
    const engine = Math.round(params.engine ?? 0);

    if ((engine === 1 || isOcctGlobalMode()) && isOcctReady()) {
      try {
        const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        const host = hostBoxFromGeometry(geometry);
        const result = occtFilletBox(host, radius, {}, upstreamHandle);
        if (result.handle) result.geometry.userData.occtHandle = result.handle;
        return result.geometry;
      } catch (err) {
         
        console.warn('[fillet] OCCT path failed, falling back to mesh approximator:', err);
      }
    }

    // Validate: geometry must have index (manifold requirement for CSG)
    if (!geometry.index) {
      throw new Error('Fillet requires indexed (manifold) geometry');
    }
    if (geometry.attributes.position.count < 4) {
      throw new Error('Fillet requires geometry with at least 4 vertices');
    }

    const evaluator = new Evaluator();

    // Minkowski-sum approximation for fillet:
    // Intersect the original geometry with multiple intermediate offset
    // geometries. Each intermediate is expanded along vertex normals by an
    // amount following a cosine curve, producing a smooth rounded edge profile.
    //
    // B1 deep — every intermediate is a clone of the *original* geometry
    // so it inherits the same upstream feature ids on every triangle. We
    // then restamp each intermediate with this fillet's id, so any triangle
    // that ends up in the result via the intermediate (i.e. the rounded
    // edges) resolves back to the fillet feature. Untouched triangles from
    // the original keep their upstream provenance.
    let resultBrush = makeBrush(geometry.clone());
    let runningGeo = resultBrush.geometry;

    for (let s = 1; s <= segments; s++) {
      const t = s / (segments + 1);
      // Cosine easing gives a smooth circular-arc profile
      const offset = radius * (1 - Math.cos((t * Math.PI) / 2));

      const intermediate = geometry.clone();
      intermediate.computeVertexNormals();
      const iPos = intermediate.attributes.position;
      const iNor = intermediate.attributes.normal;

      for (let i = 0; i < iPos.count; i++) {
        iPos.setX(i, iPos.getX(i) + iNor.getX(i) * offset);
        iPos.setY(i, iPos.getY(i) + iNor.getY(i) * offset);
        iPos.setZ(i, iPos.getZ(i) + iNor.getZ(i) * offset);
      }
      iPos.needsUpdate = true;

      if (ctx?.featureId) {
        stampFaceFeatureIdAll(intermediate, ctx.featureId, { avoidIdsFrom: runningGeo });
      }
      configureEvaluatorForProvenance(evaluator, runningGeo, intermediate);
      resultBrush = evaluator.evaluate(resultBrush, makeBrush(intermediate), INTERSECTION);
      propagateFeatureIdMap(resultBrush.geometry, runningGeo, intermediate);
      runningGeo = resultBrush.geometry;
    }

    return resultBrush.geometry;
  },
};
