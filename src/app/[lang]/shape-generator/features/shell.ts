import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { occtShellBox, occtFaceSignatures, hostBoxFromGeometry } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';
import { buildFaceFinderBySignature } from './topologyEdgeFinder';
import { stampFaceFeatureIdAll, configureEvaluatorForProvenance, propagateFeatureIdMap } from './faceProvenance';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

export const shellFeature: FeatureDefinition = {
  type: 'shell',
  icon: '🥚',
  params: [
    { key: 'wallThickness', labelKey: 'paramShellThickness', default: 3, min: 0.5, max: 50, step: 0.5, unit: 'mm' },
    {
      key: 'openFace',
      labelKey: 'paramShellOpenFace',
      default: 1,
      min: 0,
      max: 2,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'openFaceNone' },
        { value: 1, labelKey: 'openFaceTop' },
        { value: 2, labelKey: 'openFaceBottom' },
      ],
    },
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
    const thickness = params.wallThickness;
    const openFace = Math.round(params.openFace);
    const engine = Math.round(params.engine ?? 0);

    if (shouldUseOcctEngine(engine)) {
      try {
        const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        const host = hostBoxFromGeometry(geometry);
        const result = occtShellBox(host, thickness, openFace, undefined, upstreamHandle);
        if (result.handle) result.geometry.userData.occtHandle = result.handle;
        return result.geometry;
      } catch (err) {
        console.warn('[shell] OCCT path failed, falling back to three-bvh-csg:', err);
      }
    }

    // Validate: geometry must be indexed and have enough vertices for CSG
    if (!geometry.index) {
      throw new Error('Shell requires indexed (closed/manifold) geometry');
    }
    if (geometry.attributes.position.count < 4) {
      throw new Error('Shell requires geometry with at least 4 vertices');
    }

    // Create inner geometry by offsetting vertices inward along normals
    const inner = geometry.clone();
    inner.computeVertexNormals();
    const pos = inner.attributes.position;
    const nor = inner.attributes.normal;

    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) - nor.getX(i) * thickness);
      pos.setY(i, pos.getY(i) - nor.getY(i) * thickness);
      pos.setZ(i, pos.getZ(i) - nor.getZ(i) * thickness);
    }
    pos.needsUpdate = true;

    // Flip inner geometry winding order so normals face outward for CSG
    const idx = inner.index;
    if (idx) {
      const arr = idx.array;
      for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i];
        arr[i] = arr[i + 2];
        arr[i + 2] = tmp;
      }
      idx.needsUpdate = true;
    }

    // B1 deep — stamp the inner offset (it's a clone of geometry but
    // represents the shell-interior contribution) and the open-face cut
    // box (if used) so triangles inherited from them resolve back to
    // this shell feature instead of the upstream geometry.
    if (ctx?.featureId) {
      stampFaceFeatureIdAll(inner, ctx.featureId, { avoidIdsFrom: geometry });
    }
    const evaluator = new Evaluator();
    configureEvaluatorForProvenance(evaluator, geometry, inner);
    let result = evaluator.evaluate(makeBrush(geometry), makeBrush(inner), SUBTRACTION);
    propagateFeatureIdMap(result.geometry, geometry, inner);

    // Cut open face if requested
    if (openFace > 0) {
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!;
      const size = bb.getSize(new THREE.Vector3());
      const center = bb.getCenter(new THREE.Vector3());
      const cutBox = new THREE.BoxGeometry(size.x * 3, thickness * 2, size.z * 3);

      if (openFace === 1) {
        // Remove top face
        cutBox.translate(center.x, bb.max.y, center.z);
      } else {
        // Remove bottom face
        cutBox.translate(center.x, bb.min.y, center.z);
      }

      if (ctx?.featureId) {
        stampFaceFeatureIdAll(cutBox, ctx.featureId, { avoidIdsFrom: result.geometry });
      }
      configureEvaluatorForProvenance(evaluator, result.geometry, cutBox);
      const prev = result.geometry;
      result = evaluator.evaluate(result, makeBrush(cutBox), SUBTRACTION);
      propagateFeatureIdMap(result.geometry, prev, cutBox);
    }

    return noteMeshFallback(result.geometry, { op: 'Shell', engine, featureId: ctx?.featureId });
  },

  /** OCCT async path: when the user picked a face to leave open, re-resolve it
   *  against the current solid's face signatures into a FaceFinder and open
   *  exactly that face — surviving rebuilds. Otherwise defer to the sync path
   *  (OCCT openFace heuristic / mesh fallback). */
  async applyAsync(geometry, params, ctx) {
    const thickness = params.wallThickness;
    const openFace = Math.round(params.openFace);
    const engine = Math.round(params.engine ?? 0);
    const sel = ctx?.faceSelections?.[0];
    if (sel && shouldUseOcctEngine(engine)) {
      try {
        const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        if (upstreamHandle) {
          const faceFinder = await buildFaceFinderBySignature(
            { position: sel.position, normal: sel.normal },
            occtFaceSignatures(upstreamHandle),
          );
          if (faceFinder) {
            const host = hostBoxFromGeometry(geometry);
            const result = occtShellBox(host, thickness, openFace, undefined, upstreamHandle, faceFinder);
            if (result.handle) result.geometry.userData.occtHandle = result.handle;
            return result.geometry;
          }
        }
      } catch (err) {
        console.warn('[shell] OCCT face-finder path failed, falling back:', err);
      }
    }
    return shellFeature.apply(geometry, params, ctx);
  },
};
