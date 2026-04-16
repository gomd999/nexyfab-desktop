import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

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

    const edgeGeometry = makeEdges(geometry);

    const volume_cm3 = (w * h * d) / 1000;
    const surface_area_cm2 = 2 * (w * h + h * d + w * d) / 100;
    const bbox = { w: Math.round(w), h: Math.round(h), d: Math.round(d) };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
