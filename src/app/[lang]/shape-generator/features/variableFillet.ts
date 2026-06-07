import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { occtVariableFillet, occtEdgeSignatures, hostBoxFromGeometry, type ReplicadEdgeFinder } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { buildEdgeFinderFromSelection, buildEdgeFinderBySignature } from './topologyEdgeFinder';

// ─── Variable Fillet Types ─────────────────────────────────────────────────────

export interface VariableFilletParams {
  edgeIndex: number;
  startRadius: number;
  endRadius: number;
  segments?: number;
}

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

// ─── Apply Variable Fillet ─────────────────────────────────────────────────────

/**
 * Apply a fillet that varies linearly from startRadius to endRadius along
 * the geometry. The fillet is approximated using CSG intersection with
 * progressively offset geometries, similar to the constant fillet but with
 * a radius that interpolates along the primary axis.
 */
export function applyVariableFillet(
  geometry: THREE.BufferGeometry,
  params: VariableFilletParams,
): THREE.BufferGeometry {
  const { startRadius, endRadius, segments = 3 } = params;

  if (!geometry.index) {
    throw new Error('Variable fillet requires indexed (manifold) geometry');
  }
  if (geometry.attributes.position.count < 4) {
    throw new Error('Variable fillet requires geometry with at least 4 vertices');
  }

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const minY = bb.min.y;
  const maxY = bb.max.y;
  const rangeY = maxY - minY;

  const evaluator = new Evaluator();
  let resultBrush = makeBrush(geometry.clone());

  for (let s = 1; s <= segments; s++) {
    const t = s / (segments + 1);

    const intermediate = geometry.clone();
    intermediate.computeVertexNormals();
    const iPos = intermediate.attributes.position;
    const iNor = intermediate.attributes.normal;

    for (let i = 0; i < iPos.count; i++) {
      const y = iPos.getY(i);
      // Interpolate radius based on Y position along the geometry
      const fraction = rangeY > 0 ? (y - minY) / rangeY : 0.5;
      const localRadius = startRadius + (endRadius - startRadius) * fraction;

      // Cosine easing for smooth circular-arc profile
      const offset = localRadius * (1 - Math.cos((t * Math.PI) / 2));

      iPos.setX(i, iPos.getX(i) + iNor.getX(i) * offset);
      iPos.setY(i, iPos.getY(i) + iNor.getY(i) * offset);
      iPos.setZ(i, iPos.getZ(i) + iNor.getZ(i) * offset);
    }
    iPos.needsUpdate = true;

    resultBrush = evaluator.evaluate(resultBrush, makeBrush(intermediate), INTERSECTION);
  }

  return resultBrush.geometry;
}

// ─── OCCT B-rep path (real variable-radius fillet on the selected edge) ──────────

/** World bbox so the finder can remap a stored click point through a resize. */
function currentBboxOf(geometry: THREE.BufferGeometry):
  { min: [number, number, number]; max: [number, number, number] } | undefined {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return undefined;
  return { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] };
}

/** Re-resolve the stored edge selection to a replicad EdgeFinder. A variable
 *  radius varies along ONE edge, so only the first selection is used. */
async function buildEdgeFinder(
  ctx: FeatureApplyContext | undefined,
  geometry: THREE.BufferGeometry,
): Promise<ReplicadEdgeFinder | null> {
  const sels = ctx?.edgeSelections;
  if (!sels || sels.length === 0) return null;
  const currentBbox = currentBboxOf(geometry);
  const handle = geometry.userData?.occtHandle as string | undefined;
  if (handle) {
    const bySig = await buildEdgeFinderBySignature(sels[0]!, occtEdgeSignatures(handle), currentBbox);
    if (bySig) return bySig;
  }
  return buildEdgeFinderFromSelection(sels[0]!, { currentBbox });
}

// ─── Feature Definition ────────────────────────────────────────────────────────

export const variableFilletFeature: FeatureDefinition = {
  type: 'variableFillet',
  icon: '🔵',
  params: [
    { key: 'startRadius', labelKey: 'paramVarFilletStart', default: 2, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    { key: 'endRadius', labelKey: 'paramVarFilletEnd', default: 6, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
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
  apply(geometry, params) {
    return applyVariableFillet(geometry, {
      edgeIndex: 0,
      startRadius: params.startRadius,
      endRadius: params.endRadius,
      segments: Math.round(params.segments),
    });
  },
  async applyAsync(geometry, params, ctx) {
    const engine = Math.round(params.engine ?? 1);
    if (shouldUseOcctEngine(engine)) {
      try {
        const edgeFinder = await buildEdgeFinder(ctx, geometry);
        const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        const host = hostBoxFromGeometry(geometry);
        const result = occtVariableFillet(
          host,
          params.startRadius,
          params.endRadius,
          {},
          upstreamHandle,
          edgeFinder ?? undefined,
        );
        if (result.handle) {
          result.geometry.userData.occtHandle = result.handle;
          return result.geometry;
        }
      } catch (err) {
        console.warn('[variableFillet] OCCT path failed, falling back to mesh:', err);
      }
    }
    return applyVariableFillet(geometry, {
      edgeIndex: 0,
      startRadius: params.startRadius,
      endRadius: params.endRadius,
      segments: Math.round(params.segments),
    });
  },
};
