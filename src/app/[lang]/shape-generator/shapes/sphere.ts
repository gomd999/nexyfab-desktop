import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const sphereShape: ShapeConfig = {
  id: 'sphere',
  tier: 1,
  icon: '🔮',
  params: [
    { key: 'diameter',        labelKey: 'paramDiameter',        default: 50, min: 1,  max: 500, step: 1, unit: 'mm' },
    { key: 'widthSegments',   labelKey: 'paramWidthSegments',   default: 32, min: 8,  max: 64,  step: 1, unit: '' },
    { key: 'heightSegments',  labelKey: 'paramHeightSegments',  default: 16, min: 4,  max: 32,  step: 1, unit: '' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const r = p.diameter / 2;
    const wSeg = Math.round(p.widthSegments);
    const hSeg = Math.round(p.heightSegments);

    const geometry = new THREE.SphereGeometry(r, wSeg, hSeg);
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    const volume_cm3 = (4 / 3) * Math.PI * r * r * r / 1000;
    const surface_area_cm2 = 4 * Math.PI * r * r / 100;

    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox!.getSize(size);
    const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
