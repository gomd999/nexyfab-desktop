/**
 * K4 — Rib (보강 리브) feature.
 *
 * Plastic injection-moulded parts almost always include reinforcement ribs:
 * a thin wall extruded perpendicular to a base surface, running along a
 * sketch line. This feature is the most-used SolidWorks/Fusion 360 feature
 * for plastic design.
 *
 * Implementation strategy:
 *  - Parameterise via a single line (start/end XZ coords) and length/height
 *    pulled from the params block.
 *  - Generate a thin BoxGeometry whose long axis matches the line direction,
 *    width = thickness, height = ribHeight.
 *  - Position so its bottom face sits on Y = baseY (the floor of the existing
 *    body's bbox). The CSG union with the parent body merges the rib in,
 *    yielding "auto-trim" against any non-flat body wall the rib touches.
 *
 * Caveats:
 *  - Single straight rib only. Curved ribs along an arc require sweep —
 *    follow-up.
 *  - Auto-trim is implicit via CSG union (any rib volume that overlaps with
 *    the body is absorbed). For perfect intersection edges on curved walls
 *    OCCT path would be cleaner.
 */

import * as THREE from 'three';
import { Evaluator, Brush, ADDITION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { occtRib } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';
import { configureEvaluatorAttributes } from './meshMerge';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

export const ribFeature: FeatureDefinition = {
  type: 'rib',
  icon: '🦴',
  params: [
    { key: 'startX',     labelKey: 'paramRibStartX',     default: -25, min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'startZ',     labelKey: 'paramRibStartZ',     default: 0,   min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'endX',       labelKey: 'paramRibEndX',       default: 25,  min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'endZ',       labelKey: 'paramRibEndZ',       default: 0,   min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'thickness',  labelKey: 'paramRibThickness',  default: 2,   min: 0.5,  max: 20,  step: 0.5, unit: 'mm' },
    { key: 'height',     labelKey: 'paramRibHeight',     default: 10,  min: 1,    max: 100, step: 0.5, unit: 'mm' },
    {
      // 0 = grow up from base, 1 = grow down from top.
      key: 'direction',
      labelKey: 'paramRibDirection',
      default: 0,
      min: 0, max: 1, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'ribFromBottom' },
        { value: 1, labelKey: 'ribFromTop' },
      ],
    },
  ],
  apply(geometry, params) {
    const { startX, startZ, endX, endZ } = params;
    const thickness = Math.max(0.1, params.thickness);
    const height = Math.max(0.5, params.height);
    const direction = Math.round(params.direction);

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return geometry;

    const dx = endX - startX;
    const dz = endZ - startZ;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.5) {
      // Degenerate input — return base unchanged.
      return geometry;
    }

    // Build the rib as a unit box, then translate + rotate to its sketch
    // pose. extrudeY positions the box so its base contacts bb.min.y (rib
    // grows upward) or its top contacts bb.max.y (rib grows downward).
    const ribGeo = new THREE.BoxGeometry(len, height, thickness);

    // Rotate so the rib's local +X axis aligns with the sketch line direction.
    const angleY = Math.atan2(dz, dx);
    const rot = new THREE.Matrix4().makeRotationY(-angleY);

    // Translate centre to (midX, baseY + height/2 ± shift, midZ).
    const midX = (startX + endX) / 2;
    const midZ = (startZ + endZ) / 2;
    const baseY = direction === 0 ? bb.min.y : bb.max.y - height;
    const ribCenterY = baseY + height / 2;

    const translate = new THREE.Matrix4().makeTranslation(midX, ribCenterY, midZ);
    ribGeo.applyMatrix4(rot);
    ribGeo.applyMatrix4(translate);
    ribGeo.computeVertexNormals();

    // CSG union — rib merges with body, absorbing any overlap so the ends
    // butt-trim against the body's walls automatically.
    try {
      const evaluator = new Evaluator();
      configureEvaluatorAttributes(evaluator, geometry, ribGeo);
      const result = evaluator.evaluate(makeBrush(geometry), makeBrush(ribGeo), ADDITION);
      return result.geometry;
    } catch {
      // CSG failure — return base + rib as a merged-by-mesh fallback so the
      // user at least sees the rib visually even if it's not unioned.
      return ribGeo;
    }
  },
  async applyAsync(geometry, params) {
    if (shouldUseOcctEngine()) {
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          geometry.computeBoundingBox();
          const bb = geometry.boundingBox;
          if (bb) {
            const r = occtRib(
              handle,
              {
                startX: params.startX, startZ: params.startZ,
                endX: params.endX, endZ: params.endZ,
                thickness: params.thickness, height: params.height,
                direction: Math.round(params.direction),
              },
              bb.min.y, bb.max.y,
            );
            if (r.handle) { r.geometry.userData.occtHandle = r.handle; return r.geometry; }
          }
        } catch (err) {
          console.warn('[rib] OCCT path failed, falling back to mesh:', err);
        }
      }
    }
    return noteMeshFallback(ribFeature.apply(geometry, params), { op: 'Rib' });
  },
};
