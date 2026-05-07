import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';

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

// ─── Feature Definition ────────────────────────────────────────────────────────

export const variableFilletFeature: FeatureDefinition = {
  type: 'variableFillet',
  icon: '🔵',
  params: [
    { key: 'startRadius', labelKey: 'paramVarFilletStart', default: 2, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    { key: 'endRadius', labelKey: 'paramVarFilletEnd', default: 6, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    { key: 'segments', labelKey: 'paramFilletSegments', default: 3, min: 1, max: 5, step: 1, unit: '' },
  ],
  apply(geometry, params) {
    return applyVariableFillet(geometry, {
      edgeIndex: 0,
      startRadius: params.startRadius,
      endRadius: params.endRadius,
      segments: Math.round(params.segments),
    });
  },
};
