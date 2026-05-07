/**
 * 와셔 (Flat Washer)
 * KS B 1326 / ISO 7089 표준 평와셔
 */
import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

export const washerShape: ShapeConfig = {
  id: 'washer',
  tier: 1,
  icon: '⭕',
  params: [
    { key: 'innerDia',   labelKey: 'paramInnerDia',    default: 11,  min: 1,   max: 100, step: 0.5, unit: 'mm' },
    { key: 'outerDia',   labelKey: 'paramOuterDia',    default: 24,  min: 3,   max: 200, step: 0.5, unit: 'mm' },
    { key: 'thickness',  labelKey: 'paramNutThickness', default: 2.5, min: 0.2, max: 20,  step: 0.1, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const ri = p.innerDia / 2;
    const ro = Math.max(p.outerDia / 2, ri + 0.5);
    const t  = p.thickness;

    const shape = new THREE.Shape();
    shape.absarc(0, 0, ro, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, ri, 0, Math.PI * 2, true);
    shape.holes.push(hole);

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: t,
      bevelEnabled: false,
      curveSegments: 48,
    });
    geometry.translate(0, 0, -t / 2);
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
      bbox: { w: Math.round(ro * 2), h: Math.round(t), d: Math.round(ro * 2) },
    };
  },
};
