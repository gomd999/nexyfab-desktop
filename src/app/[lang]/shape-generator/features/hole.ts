import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { isOcctReady, isOcctGlobalMode, occtBoxBooleanWithPrimitive, hostBoxFromGeometry } from './occtEngine';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

export const holeFeature: FeatureDefinition = {
  type: 'hole',
  icon: '🕳️',
  params: [
    {
      key: 'holeType',
      labelKey: 'paramHoleType',
      default: 0,
      min: 0,
      max: 2,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'holeThrough' },
        { value: 1, labelKey: 'holeCounterbore' },
        { value: 2, labelKey: 'holeCountersink' },
      ],
    },
    { key: 'diameter', labelKey: 'paramHoleDiameter', default: 10, min: 1, max: 100, step: 0.5, unit: 'mm' },
    { key: 'posX', labelKey: 'paramHolePosX', default: 0, min: -200, max: 200, step: 1, unit: 'mm' },
    { key: 'posZ', labelKey: 'paramHolePosZ', default: 0, min: -200, max: 200, step: 1, unit: 'mm' },
    { key: 'depth', labelKey: 'paramHoleDepth', default: 999, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'counterboreDia', labelKey: 'paramCounterboreDia', default: 18, min: 1, max: 150, step: 0.5, unit: 'mm' },
    { key: 'counterboreDepth', labelKey: 'paramCounterboreDepth', default: 5, min: 1, max: 50, step: 0.5, unit: 'mm' },
    { key: 'countersinkAngle', labelKey: 'paramCountersinkAngle', default: 90, min: 60, max: 120, step: 1, unit: '°' },
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
    const holeType = Math.round(params.holeType);
    const r = params.diameter / 2;
    const posX = params.posX;
    const posZ = params.posZ;
    const depth = params.depth;

    // Compute bounding box once from the input geometry for accurate Y positioning
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const topY = bb.max.y;
    const bottomY = bb.min.y;
    const centerY = (topY + bottomY) / 2;

    // Use actual depth or full height if depth >= 999 (through hole)
    const actualDepth = depth >= 999 ? (topY - bottomY) + 10 : depth;
    const engine = Math.round(params.engine ?? 0);

    if ((engine === 1 || isOcctGlobalMode()) && isOcctReady()) {
      try {
        let currentHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        let currentGeo = geometry;
        const host = hostBoxFromGeometry(geometry);

        // Main hole
        const res1 = occtBoxBooleanWithPrimitive('subtract', host, { shape: 'cylinder', w: r * 2, h: actualDepth, d: r * 2, cx: posX, cy: centerY, cz: posZ, rx: 0, ry: 0, rz: 0 }, undefined, currentHandle);
        currentHandle = res1.handle ?? currentHandle;
        currentGeo = res1.geometry;

        if (holeType === 1) { // Counterbore
          const cbR = params.counterboreDia / 2;
          const cbDepth = params.counterboreDepth;
          const res2 = occtBoxBooleanWithPrimitive('subtract', host, { shape: 'cylinder', w: cbR * 2, h: cbDepth, d: cbR * 2, cx: posX, cy: topY - cbDepth / 2, cz: posZ, rx: 0, ry: 0, rz: 0 }, undefined, currentHandle);
          currentHandle = res2.handle ?? currentHandle;
          currentGeo = res2.geometry;
        }

        if (holeType === 2) { // Countersink
          // We don't have a cone primitive in occtEngine.js right now. 
          // We can fallback or add it, but since countersink requires a cone, we can throw error to fallback to CSG for countersink!
          throw new Error('Countersink not supported yet in OCCT');
        }

        if (currentHandle) currentGeo.userData.occtHandle = currentHandle;
        return currentGeo;
      } catch (err) {
        console.warn('[hole] OCCT path failed, falling back to three-bvh-csg:', err);
      }
    }

    const evaluator = new Evaluator();
    const brushA = makeBrush(geometry);

    // Main hole cylinder — centered on geometry's actual Y center
    const holeCyl = new THREE.CylinderGeometry(r, r, actualDepth, 32);
    holeCyl.translate(posX, centerY, posZ);
    const brushB = makeBrush(holeCyl);
    let result = evaluator.evaluate(brushA, brushB, SUBTRACTION);

    // Counterbore: subtract a wider, shallower cylinder at the top face
    if (holeType === 1) {
      const cbR = params.counterboreDia / 2;
      const cbDepth = params.counterboreDepth;
      const cbCyl = new THREE.CylinderGeometry(cbR, cbR, cbDepth, 32);
      // Use the already-computed topY from the input geometry (not stale reference)
      cbCyl.translate(posX, topY - cbDepth / 2, posZ);
      const brushCB = makeBrush(cbCyl);
      result = evaluator.evaluate(result, brushCB, SUBTRACTION);
    }

    // Countersink: subtract a cone at the top face
    if (holeType === 2) {
      const csHalfAngle = ((params.countersinkAngle) * Math.PI) / 360;
      const csR = r * 2;
      const csDepth = csR / Math.tan(csHalfAngle);
      const cone = new THREE.ConeGeometry(csR, csDepth, 32);
      // Use the already-computed topY from the input geometry
      cone.rotateX(Math.PI);
      cone.translate(posX, topY, posZ);
      const brushCS = makeBrush(cone);
      result = evaluator.evaluate(result, brushCS, SUBTRACTION);
    }

    return result.geometry;
  },
};
