import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const plateBendShape: ShapeConfig = {
  id: 'plateBend',
  tier: 1,
  icon: '📄',
  params: [
    { key: 'width',      labelKey: 'paramWidth',      default: 100, min: 1,  max: 500,  step: 1, unit: 'mm' },
    { key: 'length',     labelKey: 'paramLength',     default: 60,  min: 1,  max: 500,  step: 1, unit: 'mm' },
    { key: 'thickness',  labelKey: 'paramThickness',  default: 3,   min: 0.5, max: 50,  step: 0.5, unit: 'mm' },
    { key: 'bendAngle',  labelKey: 'paramBendAngle',  default: 90,  min: 0,  max: 180,  step: 1, unit: '°' },
    { key: 'bendLength', labelKey: 'paramBendLength', default: 40,  min: 1,  max: 500,  step: 1, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const w = p.width;
    const len = p.length;
    const t = p.thickness;
    const angleDeg = p.bendAngle;
    const bLen = p.bendLength;

    // First plate: flat, lying along Z axis
    const plate1 = new THREE.BoxGeometry(w, t, len);
    // Position: center of first plate at z = len/2, y = 0
    plate1.translate(0, 0, len / 2);

    // Second plate: extends from the end of the first plate at bend angle
    const plate2 = new THREE.BoxGeometry(w, t, bLen);
    // Position second plate so its near edge is at origin, extending along +Z
    plate2.translate(0, 0, bLen / 2);

    // Rotate second plate around X axis by the bend angle
    // 0° = straight (same direction), 180° = folded back
    const angleRad = (angleDeg * Math.PI) / 180;
    const rotMatrix = new THREE.Matrix4().makeRotationX(-angleRad);
    plate2.applyMatrix4(rotMatrix);

    // Translate second plate to connect at the end of the first plate (z = len)
    plate2.translate(0, 0, len);

    const geometry = mergeGeometries([plate1, plate2]);
    if (!geometry) throw new Error('Failed to merge plate bend geometries');

    geometry.computeVertexNormals();
    const edgeGeometry = makeEdges(geometry);

    // Volume: total material (both plates)
    const volume_cm3 = (w * t * (len + bLen)) / 1000;

    // Surface area: two large faces + edges for each plate
    // Each plate: 2*(w*plateLen) + 2*(t*plateLen) + 2*(w*t) but shared edge is internal
    // Simplified: total = 2*w*(len+bLen) + 2*t*(len+bLen) + 4*w*t - 2*w*t (subtract one shared face pair)
    // Actually for two separate plates joined at an edge:
    // Top/bottom faces: 2 * w * (len + bLen)
    // Side faces (along length): 2 * t * (len + bLen)
    // End faces: 2 * w * t (far ends only, the joint edge is internal visually but geometrically still counted)
    // With merged boxes, the joint area overlaps, but for analytical SA:
    const surface_area_mm2 = 2 * w * (len + bLen) + 2 * t * (len + bLen) + 2 * w * t;
    const surface_area_cm2 = surface_area_mm2 / 100;

    // Bounding box: compute from actual geometry
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const bbox = {
      w: Math.round(bb.max.x - bb.min.x),
      h: Math.round(bb.max.y - bb.min.y),
      d: Math.round(bb.max.z - bb.min.z),
    };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
