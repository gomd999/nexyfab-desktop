import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

/**
 * Persistent face ids for the box base shape. BoxGeometry tags every
 * triangle with `materialIndex 0..5` corresponding to the right / left /
 * top / bottom / front / back face respectively (three.js convention);
 * SelectionMesh reads the materialIndex off the raycast hit and maps it
 * here so fillet-on-edge can address an individual box face.
 *
 * Keys deliberately match the boxFaces structure consumed in SelectionMesh.
 */
const BOX_FACE_HASHES: Record<number, string> = {
  0: 'box_face_pos_x', // right
  1: 'box_face_neg_x', // left
  2: 'box_face_pos_y', // top
  3: 'box_face_neg_y', // bottom
  4: 'box_face_pos_z', // front
  5: 'box_face_neg_z', // back
};

export const boxShape: ShapeConfig = {
  id: 'box',
  tier: 1,
  icon: '📦',
  params: [
    { key: 'width',  labelKey: 'paramWidth',  default: 50, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'height', labelKey: 'paramHeight', default: 30, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'depth',  labelKey: 'paramDepth',  default: 20, min: 1, max: 500, step: 1, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const w = p.width;
    const h = p.height;
    const d = p.depth;

    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.computeVertexNormals();

    // Phase 3-f — stamp the 6-face topology. Stored under the synthetic
    // feature id 'box' so SelectionMesh's normal lookup picks it up
    // alongside any downstream sketchExtrude stamps via the same
    // `topoFaceMapByFeature` map.
    geometry.userData = {
      ...geometry.userData,
      topoFaceMapByFeature: {
        box: {
          featureId: 'box',
          sweepFaces: [],
          caps: ['', ''] as [string, string],
          boxFaces: BOX_FACE_HASHES,
        },
      },
    };

    const edgeGeometry = makeEdges(geometry);

    const volume_cm3 = (w * h * d) / 1000;
    const surface_area_cm2 = 2 * (w * h + h * d + w * d) / 100;
    const bbox = { w: Math.round(w), h: Math.round(h), d: Math.round(d) };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
