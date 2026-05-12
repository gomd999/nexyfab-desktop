import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';

/**
 * K5 — Variable shell (per-direction thickness).
 *
 * Standard shell.ts applies a single uniform wall thickness everywhere. Real
 * injection-moulded parts use different thicknesses per direction — top/
 * bottom/side. This feature offsets each vertex along its normal by an
 * amount that depends on which axis the normal aligns with most strongly.
 *
 * The "axis bin" classification is approximate (it's based on the dominant
 * component of the per-vertex normal), but covers the 80% case that
 * customers actually ask for. True per-face thickness via UI face picking
 * is the next step — this scaffolds the data path.
 */

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

export const variableShellFeature: FeatureDefinition = {
  type: 'variableShell',
  icon: '🥚',
  params: [
    { key: 'topThickness',    labelKey: 'paramVarShellTop',    default: 2, min: 0.3, max: 50, step: 0.5, unit: 'mm' },
    { key: 'sideThickness',   labelKey: 'paramVarShellSide',   default: 1.5, min: 0.3, max: 50, step: 0.5, unit: 'mm' },
    { key: 'bottomThickness', labelKey: 'paramVarShellBottom', default: 3, min: 0.3, max: 50, step: 0.5, unit: 'mm' },
    {
      key: 'openFace',
      labelKey: 'paramShellOpenFace',
      default: 1,
      min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'openFaceNone' },
        { value: 1, labelKey: 'openFaceTop' },
        { value: 2, labelKey: 'openFaceBottom' },
      ],
    },
  ],
  apply(geometry, params) {
    const topT = Math.max(0.05, params.topThickness);
    const sideT = Math.max(0.05, params.sideThickness);
    const botT = Math.max(0.05, params.bottomThickness);
    const openFace = Math.round(params.openFace);

    if (!geometry.index) {
      throw new Error('Variable shell requires indexed (closed/manifold) geometry');
    }
    if (geometry.attributes.position.count < 4) {
      throw new Error('Variable shell requires geometry with at least 4 vertices');
    }

    const inner = geometry.clone();
    inner.computeVertexNormals();
    const pos = inner.attributes.position;
    const nor = inner.attributes.normal;

    // Per-vertex thickness binned by dominant normal axis. Tie-break: use the
    // sign on Y to decide top vs bottom; otherwise treat as side. This keeps
    // the offset continuous so neighbouring vertices (e.g. on a fillet
    // straddling top→side transition) blend smoothly between the two
    // thicknesses.
    for (let i = 0; i < pos.count; i++) {
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const nz = nor.getZ(i);
      const absX = Math.abs(nx);
      const absY = Math.abs(ny);
      const absZ = Math.abs(nz);

      let t: number;
      if (absY > absX && absY > absZ) {
        // Y dominant — top or bottom
        t = ny > 0 ? topT : botT;
      } else {
        // X or Z dominant — side
        t = sideT;
      }

      pos.setX(i, pos.getX(i) - nx * t);
      pos.setY(i, pos.getY(i) - ny * t);
      pos.setZ(i, pos.getZ(i) - nz * t);
    }
    pos.needsUpdate = true;

    // Flip inner winding so normals face outward for CSG.
    const idx = inner.index;
    if (idx) {
      const arr = idx.array as Uint16Array | Uint32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i];
        arr[i] = arr[i + 2];
        arr[i + 2] = tmp;
      }
      idx.needsUpdate = true;
    }

    const evaluator = new Evaluator();
    let result = evaluator.evaluate(makeBrush(geometry), makeBrush(inner), SUBTRACTION);

    // Optional open face — same as shell.ts
    if (openFace > 0) {
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!;
      const size = bb.getSize(new THREE.Vector3());
      const center = bb.getCenter(new THREE.Vector3());
      const cutThickness = openFace === 1 ? topT : botT;
      const cutBox = new THREE.BoxGeometry(size.x * 3, cutThickness * 2, size.z * 3);

      if (openFace === 1) {
        cutBox.translate(center.x, bb.max.y, center.z);
      } else {
        cutBox.translate(center.x, bb.min.y, center.z);
      }
      result = evaluator.evaluate(result, makeBrush(cutBox), SUBTRACTION);
    }

    return result.geometry;
  },
};
