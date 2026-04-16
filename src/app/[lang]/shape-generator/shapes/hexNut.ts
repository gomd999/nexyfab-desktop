/**
 * 육각 너트 (Hex Nut)
 * KS / ISO 표준 — M3~M48 범위
 */
import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

function hexShape(acrossFlats: number): THREE.Shape {
  const r = (acrossFlats / 2) / Math.cos(Math.PI / 6); // circumradius
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    if (i === 0) shape.moveTo(r * Math.cos(a), r * Math.sin(a));
    else shape.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  shape.closePath();
  return shape;
}

export const hexNutShape: ShapeConfig = {
  id: 'hexNut',
  tier: 1,
  icon: '⬡',
  params: [
    { key: 'nominalDia',   labelKey: 'paramNominalDia',   default: 10, min: 1,   max: 100, step: 1,   unit: 'mm' },
    { key: 'acrossFlats',  labelKey: 'paramAcrossFlats',  default: 17, min: 3,   max: 150, step: 0.5, unit: 'mm' },
    { key: 'thickness',    labelKey: 'paramNutThickness',  default: 8,  min: 0.5, max: 80,  step: 0.5, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const af = p.acrossFlats;
    const t  = p.thickness;
    const hd = p.nominalDia / 2; // hole radius

    const outer = hexShape(af);

    // Center through-hole
    const hole = new THREE.Path();
    hole.absarc(0, 0, hd, 0, Math.PI * 2, false);
    outer.holes.push(hole);

    const geometry = new THREE.ExtrudeGeometry(outer, {
      depth: t,
      bevelEnabled: false,
    });
    geometry.translate(0, 0, -t / 2);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);
    const volume_cm3 = meshVolume(geometry) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;
    const cr = (af / 2) / Math.cos(Math.PI / 6);

    return {
      geometry,
      edgeGeometry,
      volume_cm3,
      surface_area_cm2,
      bbox: { w: Math.round(cr * 2), h: Math.round(t), d: Math.round(cr * 2) },
    };
  },
};
