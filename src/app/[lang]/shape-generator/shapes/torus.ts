import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const torusShape: ShapeConfig = {
  id: 'torus',
  tier: 1,
  icon: '🍩',
  params: [
    { key: 'majorDiameter',    labelKey: 'paramMajorDiameter',    default: 80, min: 10, max: 500, step: 1, unit: 'mm' },
    { key: 'tubeDiameter',     labelKey: 'paramTubeDiameter',     default: 20, min: 1,  max: 200, step: 1, unit: 'mm' },
    { key: 'radialSegments',   labelKey: 'paramRadialSegments',   default: 24, min: 6,  max: 48,  step: 1, unit: '' },
    { key: 'tubularSegments',  labelKey: 'paramTubularSegments',  default: 48, min: 6,  max: 96,  step: 1, unit: '' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const R = p.majorDiameter / 2;
    const r = p.tubeDiameter / 2;
    const radSeg = Math.round(p.radialSegments);
    const tubSeg = Math.round(p.tubularSegments);

    const geometry = new THREE.TorusGeometry(R, r, radSeg, tubSeg);
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    const volume_cm3 = 2 * Math.PI * Math.PI * R * r * r / 1000;
    const surface_area_cm2 = 4 * Math.PI * Math.PI * R * r / 100;

    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox!.getSize(size);
    const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
