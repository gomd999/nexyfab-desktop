import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';

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
  ],
  apply(geometry, params) {
    const thickness = params.wallThickness;
    const openFace = Math.round(params.openFace);

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

    const evaluator = new Evaluator();
    let result = evaluator.evaluate(makeBrush(geometry), makeBrush(inner), SUBTRACTION);

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

      result = evaluator.evaluate(result, makeBrush(cutBox), SUBTRACTION);
    }

    return result.geometry;
  },
};
