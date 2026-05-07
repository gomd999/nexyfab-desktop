import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

export const ellipticDiskShape: ShapeConfig = {
  id: 'ellipticDisk',
  tier: 1,
  icon: '⬭',
  params: [
    { key: 'semiA',    labelKey: 'paramSemiA',    default: 80, min: 1, max: 500, step: 1,   unit: 'mm' },
    { key: 'semiB',    labelKey: 'paramSemiB',    default: 50, min: 1, max: 500, step: 1,   unit: 'mm' },
    { key: 'thickness',labelKey: 'paramThickness', default: 10, min: 1, max: 200, step: 0.5, unit: 'mm' },
    { key: 'segments', labelKey: 'paramSegments',  default: 64, min: 16, max: 128, step: 8, unit: '' },
  ],
  generate(p): ShapeResult {
    const a = p.semiA, b = p.semiB, h = p.thickness;
    const segs = Math.round(p.segments);

    // Build ellipse shape
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, a, b, 0, Math.PI * 2, false, 0);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h,
      bevelEnabled: false,
      curveSegments: segs,
    });
    // Center on Y axis
    geo.translate(0, 0, -h / 2);
    // Rotate so height is along Y
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    geo.computeVertexNormals();

    const PI = Math.PI;
    const volume_cm3 = PI * a * b * h / 1000;

    // Surface area approx: 2 ellipses + lateral (Ramanujan's ellipse perimeter approx)
    const perimApprox = PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    const surface_area_cm2 = (2 * PI * a * b + perimApprox * h) / 100;

    const bbox = { w: Math.round(2 * a), h: Math.round(h), d: Math.round(2 * b) };
    return { geometry: geo, edgeGeometry: makeEdges(geo), volume_cm3, surface_area_cm2, bbox };
  },
};
