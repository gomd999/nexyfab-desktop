import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const wedgeShape: ShapeConfig = {
  id: 'wedge',
  tier: 1,
  icon: '🔻',
  params: [
    { key: 'width',  labelKey: 'paramWidth',  default: 50, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'height', labelKey: 'paramHeight', default: 40, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'depth',  labelKey: 'paramDepth',  default: 30, min: 1, max: 500, step: 1, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const w = p.width;
    const h = p.height;
    const d = p.depth;

    // Right-triangle cross-section: (0,0) → (w,0) → (w,h) → close
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(w, 0);
    shape.lineTo(w, h);
    shape.closePath();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: d,
      bevelEnabled: false,
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Center the geometry
    geometry.center();
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    const volume_cm3 = (0.5 * w * h * d) / 1000;

    // Surface area: 2 triangles + 3 rectangles
    const hypotenuse = Math.sqrt(w * w + h * h);
    const surface_area_cm2 = (2 * 0.5 * w * h + w * d + h * d + hypotenuse * d) / 100;

    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox!.getSize(size);
    const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
