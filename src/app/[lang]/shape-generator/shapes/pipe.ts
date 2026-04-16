import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const pipeShape: ShapeConfig = {
  id: 'pipe',
  tier: 1,
  icon: '🔧',
  params: [
    { key: 'outerDiameter', labelKey: 'paramOuterDiameter', default: 60,  min: 2,  max: 500, step: 1, unit: 'mm' },
    { key: 'innerDiameter', labelKey: 'paramInnerDiameter', default: 40,  min: 1,  max: 499, step: 1, unit: 'mm' },
    { key: 'length',        labelKey: 'paramLength',        default: 100, min: 1,  max: 1000, step: 1, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const R = p.outerDiameter / 2;
    const r = p.innerDiameter / 2;
    const h = p.length;
    const segments = 48;
    const halfH = h / 2;

    // Rectangular cross-section profile rotated around Y axis
    const points = [
      new THREE.Vector2(r,  halfH),   // inner top
      new THREE.Vector2(R,  halfH),   // outer top
      new THREE.Vector2(R, -halfH),   // outer bottom
      new THREE.Vector2(r, -halfH),   // inner bottom
    ];

    const geometry = new THREE.LatheGeometry(points, segments);
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    const PI = Math.PI;
    const volume_cm3 = PI * (R * R - r * r) * h / 1000;

    // Outer lateral + inner lateral + 2 annular ends
    const surface_area_mm2 =
      2 * PI * R * h +
      2 * PI * r * h +
      2 * PI * (R * R - r * r);
    const surface_area_cm2 = surface_area_mm2 / 100;

    const bboxW = Math.round(p.outerDiameter);
    const bbox = { w: bboxW, h: Math.round(h), d: bboxW };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
