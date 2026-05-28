import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { isOcctReady, isOcctGlobalMode, occtShellBox, occtFaceSignatures, hostBoxFromGeometry } from './occtEngine';
import { buildFaceFinderBySignature } from './topologyEdgeFinder';
import { stampFaceFeatureIdAll, configureEvaluatorForProvenance, propagateFeatureIdMap } from './faceProvenance';
import {
  serverShell,
  type ServerShellParams,
  type ShellOpenFace,
} from '@/lib/occt-server-client';
import { tryServerOp, getSourceR2Key, type ServerOpts } from './serverOcctHelper';

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

    if ((engine === 1 || isOcctGlobalMode()) && isOcctReady()) {
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

    return result.geometry;
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
    if (sel && (engine === 1 || isOcctGlobalMode()) && isOcctReady()) {
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

/** Local openFace code (numeric 0..5) → worker's string enum.
 *  Order matches the existing UI param definition. */
const OPEN_FACE_MAP: Record<number, ShellOpenFace> = {
  0: 'top',
  1: 'bottom',
  2: 'front',
  3: 'back',
  4: 'left',
  5: 'right',
};

/** W17 server-fallback variant — see fillet.ts for the rationale.
 *  Same chained-input pattern: reads geometry.userData.serverStepR2Key
 *  when present. Falls back to shellFeature.applyAsync (which itself
 *  falls back to apply) if server skipped / fails. */
export async function applyShellAsyncWithServer(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
  serverOpts?: ServerOpts,
): Promise<THREE.BufferGeometry> {
  // W17 — respect engine choice (see fillet.ts). Server is OCCT.
  const engine = Math.round(params.engine ?? 0);
  const wantsOcct = engine === 1 || isOcctGlobalMode();

  if (wantsOcct && serverOpts?.jwtToken) {
    const thickness = params.wallThickness!;
    const openFaceNum = Math.round(params.openFace ?? 0);
    const openFace = OPEN_FACE_MAP[openFaceNum] ?? 'top';
    const sourceR2Key = getSourceR2Key(geometry);
    const serverParams: ServerShellParams = sourceR2Key
      ? { sourceR2Key, thickness, openFace }
      : { host: hostBoxFromGeometry(geometry), thickness, openFace };
    const result = await tryServerOp(
      'shell',
      geometry,
      (opts) => serverShell(serverParams, opts),
      serverOpts,
    );
    if (result) return result;
  }
  // Defer to the feature def's applyAsync, which already has its own
  // OCCT face-finder logic plus the mesh fallback chain.
  if (shellFeature.applyAsync) {
    return shellFeature.applyAsync(geometry, params, ctx);
  }
  return shellFeature.apply(geometry, params, ctx);
}
