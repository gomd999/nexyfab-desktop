/**
 * I빔 / H빔 (I-Beam / H-Beam)
 * 구조용 강재 — KS D 3503 / JIS G 3101 호환
 */
import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

export const iBeamShape: ShapeConfig = {
  id: 'iBeam',
  tier: 1,
  icon: 'Ⅰ',
  params: [
    { key: 'height',       labelKey: 'paramBeamHeight',      default: 200, min: 50,  max: 1000, step: 10,  unit: 'mm' },
    { key: 'flangeWidth',  labelKey: 'paramFlangeWidth',     default: 100, min: 30,  max: 500,  step: 5,   unit: 'mm' },
    { key: 'webThick',     labelKey: 'paramWebThick',        default: 8,   min: 2,   max: 50,   step: 1,   unit: 'mm' },
    { key: 'flangeThick',  labelKey: 'paramFlangeThick',     default: 12,  min: 2,   max: 80,   step: 1,   unit: 'mm' },
    { key: 'length',       labelKey: 'paramLength',          default: 1000, min: 50, max: 12000, step: 50, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const H  = p.height;
    const BF = p.flangeWidth;
    const tw = p.webThick;
    const tf = p.flangeThick;
    const L  = p.length;

    // I-shape cross section (clockwise outer, CCW inner cavities)
    // Built as a single closed path with no holes
    const hw  = tw / 2;          // half web thickness
    const hbf = BF / 2;          // half flange width
    const hH  = H / 2;           // half height
    const webH = H / 2 - tf;     // half web height (distance from center to flange inner face)

    const shape = new THREE.Shape();
    // Start bottom-left of bottom flange, go clockwise
    shape.moveTo(-hbf, -hH);
    shape.lineTo( hbf, -hH);
    shape.lineTo( hbf, -hH + tf);
    shape.lineTo( hw,  -hH + tf);
    shape.lineTo( hw,   hH - tf);
    shape.lineTo( hbf,  hH - tf);
    shape.lineTo( hbf,  hH);
    shape.lineTo(-hbf,  hH);
    shape.lineTo(-hbf,  hH - tf);
    shape.lineTo(-hw,   hH - tf);
    shape.lineTo(-hw,  -hH + tf);
    shape.lineTo(-hbf, -hH + tf);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: L,
      bevelEnabled: false,
    });
    geometry.translate(0, 0, -L / 2);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);
    const volume_cm3 = meshVolume(geometry) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

    return {
      geometry,
      edgeGeometry,
      volume_cm3,
      surface_area_cm2,
      bbox: { w: Math.round(BF), h: Math.round(L), d: Math.round(H) },
    };
  },
};
