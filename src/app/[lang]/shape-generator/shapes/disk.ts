import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const diskShape: ShapeConfig = {
  id: 'disk',
  tier: 1,
  icon: '⬤',
  params: [
    { key: 'diameter',  labelKey: 'paramDiameter',  default: 80,  min: 1, max: 1000, step: 1,   unit: 'mm' },
    { key: 'thickness', labelKey: 'paramThickness',  default: 8,   min: 1, max: 200,  step: 0.5, unit: 'mm' },
    { key: 'innerDia',  labelKey: 'paramInnerDia',   default: 0,   min: 0, max: 999,  step: 1,   unit: 'mm', optional: true },
    { key: 'segments',  labelKey: 'paramSegments',   default: 64,  min: 16, max: 128, step: 8,  unit: '' },
  ],
  generate(p): ShapeResult {
    const R = p.diameter / 2;
    const r = Math.min(p.innerDia / 2, R - 0.5);
    const h = p.thickness;
    const segs = Math.round(p.segments);

    let geometry: THREE.BufferGeometry;
    if (r > 0) {
      // Hollow disc — annular cross-section revolved
      const hw = h / 2;
      const pts = [
        new THREE.Vector2(r,  hw),
        new THREE.Vector2(R,  hw),
        new THREE.Vector2(R, -hw),
        new THREE.Vector2(r, -hw),
      ];
      geometry = new THREE.LatheGeometry(pts, segs);
    } else {
      geometry = new THREE.CylinderGeometry(R, R, h, segs);
    }
    geometry.computeVertexNormals();

    const PI = Math.PI;
    const rEff = r > 0 ? r : 0;
    const volume_cm3 = PI * (R * R - rEff * rEff) * h / 1000;
    const surface_area_cm2 = (
      2 * PI * R * h +
      (r > 0 ? 2 * PI * r * h : 0) +
      2 * PI * (R * R - rEff * rEff)
    ) / 100;

    const bbox = { w: Math.round(p.diameter), h: Math.round(h), d: Math.round(p.diameter) };
    return { geometry, edgeGeometry: makeEdges(geometry), volume_cm3, surface_area_cm2, bbox };
  },
};
