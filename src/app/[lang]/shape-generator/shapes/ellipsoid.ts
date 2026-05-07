import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

export const ellipsoidShape: ShapeConfig = {
  id: 'ellipsoid',
  tier: 1,
  icon: '🥚',
  params: [
    { key: 'radiusX', labelKey: 'paramRadiusX', default: 60, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'radiusY', labelKey: 'paramRadiusY', default: 40, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'radiusZ', labelKey: 'paramRadiusZ', default: 50, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'widthSegs',  labelKey: 'paramWidthSegs',  default: 32, min: 8, max: 64, step: 4, unit: '' },
    { key: 'heightSegs', labelKey: 'paramHeightSegs', default: 24, min: 6, max: 48, step: 2, unit: '' },
  ],
  generate(p): ShapeResult {
    const rx = p.radiusX, ry = p.radiusY, rz = p.radiusZ;
    const ws = Math.round(p.widthSegs), hs = Math.round(p.heightSegs);

    // SphereGeometry unit sphere scaled
    const geo = new THREE.SphereGeometry(1, ws, hs);
    geo.applyMatrix4(new THREE.Matrix4().makeScale(rx, ry, rz));
    geo.computeVertexNormals();

    const volume_cm3 = (4 / 3) * Math.PI * rx * ry * rz / 1000;

    // Approximate surface area (Knud Thomsen formula)
    const p_kt = 1.6075;
    const surface_area_cm2 = 4 * Math.PI *
      Math.pow(
        (Math.pow(rx * ry, p_kt) + Math.pow(rx * rz, p_kt) + Math.pow(ry * rz, p_kt)) / 3,
        1 / p_kt
      ) / 100;

    const bbox = { w: Math.round(2 * rx), h: Math.round(2 * ry), d: Math.round(2 * rz) };
    return { geometry: geo, edgeGeometry: makeEdges(geo), volume_cm3, surface_area_cm2, bbox };
  },
};
