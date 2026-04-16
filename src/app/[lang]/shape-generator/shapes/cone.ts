import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const coneShape: ShapeConfig = {
  id: 'cone',
  tier: 1,
  icon: '🔺',
  params: [
    { key: 'bottomDiameter', labelKey: 'paramBottomDiameter', default: 50, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'topDiameter',    labelKey: 'paramTopDiameter',    default: 0,  min: 0, max: 500, step: 1, unit: 'mm' },
    { key: 'height',         labelKey: 'paramHeight',         default: 80, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'segments',       labelKey: 'paramSegments',       default: 32, min: 6, max: 64,  step: 1, unit: '' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const r1 = p.bottomDiameter / 2;
    const r2 = p.topDiameter / 2;
    const h = p.height;
    const seg = Math.round(p.segments);

    const geometry = new THREE.CylinderGeometry(r2, r1, h, seg);
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    const volume_cm3 = (Math.PI * h / 3) * (r1 * r1 + r2 * r2 + r1 * r2) / 1000;

    // Lateral surface area of a frustum + top and bottom circles
    const slantHeight = Math.sqrt((r1 - r2) * (r1 - r2) + h * h);
    const surface_area_cm2 = (Math.PI * (r1 + r2) * slantHeight + Math.PI * r1 * r1 + Math.PI * r2 * r2) / 100;

    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox!.getSize(size);
    const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
