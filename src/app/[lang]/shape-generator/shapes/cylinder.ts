import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const cylinderShape: ShapeConfig = {
  id: 'cylinder',
  tier: 1,
  icon: '🔩',
  params: [
    { key: 'diameter',      labelKey: 'paramDiameter',      default: 40, min: 1,  max: 500, step: 1, unit: 'mm' },
    { key: 'height',        labelKey: 'paramHeight',        default: 50, min: 1,  max: 500, step: 1, unit: 'mm' },
    { key: 'innerDiameter', labelKey: 'paramInnerDiameter', default: 0,  min: 0,  max: 499, step: 1, unit: 'mm', optional: true },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const R = p.diameter / 2;
    const h = p.height;
    const r = (p.innerDiameter || 0) / 2;
    const segments = 48;

    let geometry: THREE.BufferGeometry;

    if (r > 0 && r < R) {
      // Hollow cylinder via LatheGeometry — rectangular profile rotated around Y axis
      const halfH = h / 2;
      const points = [
        new THREE.Vector2(r,  halfH),   // inner top
        new THREE.Vector2(R,  halfH),   // outer top
        new THREE.Vector2(R, -halfH),   // outer bottom
        new THREE.Vector2(r, -halfH),   // inner bottom
      ];
      geometry = new THREE.LatheGeometry(points, segments);
    } else {
      // Solid cylinder
      geometry = new THREE.CylinderGeometry(R, R, h, segments);
    }

    geometry.computeVertexNormals();
    const edgeGeometry = makeEdges(geometry);

    const PI = Math.PI;
    const volume_cm3 = PI * (R * R - r * r) * h / 1000;

    let surface_area_mm2: number;
    if (r > 0 && r < R) {
      // Hollow: outer lateral + inner lateral + 2 annular ends
      surface_area_mm2 =
        2 * PI * R * h +              // outer lateral
        2 * PI * r * h +              // inner lateral
        2 * PI * (R * R - r * r);     // two annular ends
    } else {
      // Solid: lateral + 2 circles
      surface_area_mm2 = 2 * PI * R * h + 2 * PI * R * R;
    }
    const surface_area_cm2 = surface_area_mm2 / 100;

    const bboxW = Math.round(p.diameter);
    const bbox = { w: bboxW, h: Math.round(h), d: bboxW };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
