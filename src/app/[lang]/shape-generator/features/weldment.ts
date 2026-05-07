import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';

function makeSectionShape(sectionType: number, size: number, thickness: number): THREE.Shape {
  const shape = new THREE.Shape();
  const s = size / 2;
  const t = thickness;

  if (sectionType === 0) {
    // Rectangular tube (hollow square)
    shape.moveTo(-s, -s); shape.lineTo(s, -s); shape.lineTo(s, s); shape.lineTo(-s, s); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-s+t, -s+t); hole.lineTo(s-t, -s+t); hole.lineTo(s-t, s-t); hole.lineTo(-s+t, s-t); hole.closePath();
    shape.holes.push(hole);
  } else if (sectionType === 1) {
    // I-beam
    shape.moveTo(-s, -s); shape.lineTo(s, -s); shape.lineTo(s, -s+t);
    shape.lineTo(t/2, -s+t); shape.lineTo(t/2, s-t); shape.lineTo(s, s-t);
    shape.lineTo(s, s); shape.lineTo(-s, s); shape.lineTo(-s, s-t);
    shape.lineTo(-t/2, s-t); shape.lineTo(-t/2, -s+t); shape.lineTo(-s, -s+t);
    shape.closePath();
  } else if (sectionType === 2) {
    // L-angle bracket
    shape.moveTo(-s, -s); shape.lineTo(s, -s); shape.lineTo(s, -s+t);
    shape.lineTo(-s+t, -s+t); shape.lineTo(-s+t, s); shape.lineTo(-s, s);
    shape.closePath();
  } else if (sectionType === 3) {
    // Round tube (hollow circle)
    shape.absarc(0, 0, s, 0, Math.PI*2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, s - t, 0, Math.PI*2, true);
    shape.holes.push(hole);
  } else {
    // Solid rod
    shape.absarc(0, 0, s, 0, Math.PI*2, false);
  }
  return shape;
}

export const weldmentFeature: FeatureDefinition = {
  type: 'weldment',
  icon: '🔧',
  params: [
    { key: 'sectionType', labelKey: 'paramWeldSection', default: 0, min: 0, max: 4, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'weldRectTube' },
        { value: 1, labelKey: 'weldIBeam' },
        { value: 2, labelKey: 'weldAngle' },
        { value: 3, labelKey: 'weldRoundTube' },
        { value: 4, labelKey: 'weldRod' },
      ]
    },
    { key: 'size', labelKey: 'paramWeldSize', default: 40, min: 10, max: 200, step: 5, unit: 'mm' },
    { key: 'thickness', labelKey: 'paramWeldThickness', default: 4, min: 1, max: 20, step: 1, unit: 'mm' },
    { key: 'pathAxis', labelKey: 'paramWeldAxis', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'axisX' },
        { value: 1, labelKey: 'axisY' },
        { value: 2, labelKey: 'axisZ' },
      ]
    },
    { key: 'length', labelKey: 'paramWeldLength', default: 200, min: 10, max: 1000, step: 10, unit: 'mm' },
  ],
  apply(geometry, params) {
    const sectionType = Math.round(params.sectionType);
    const size = params.size;
    const thickness = Math.min(params.thickness, size * 0.4);
    const pathAxis = Math.round(params.pathAxis);
    const length = params.length;

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return geometry;

    const shape = makeSectionShape(sectionType, size, thickness);

    let path: THREE.Curve<THREE.Vector3>;
    if (pathAxis === 0) {
      path = new THREE.LineCurve3(new THREE.Vector3(bb.min.x, 0, 0), new THREE.Vector3(bb.min.x + length, 0, 0));
    } else if (pathAxis === 1) {
      path = new THREE.LineCurve3(new THREE.Vector3(0, bb.min.y, 0), new THREE.Vector3(0, bb.min.y + length, 0));
    } else {
      path = new THREE.LineCurve3(new THREE.Vector3(0, 0, bb.min.z), new THREE.Vector3(0, 0, bb.min.z + length));
    }

    const memberGeo = new THREE.ExtrudeGeometry(shape, {
      steps: 2,
      bevelEnabled: false,
      extrudePath: path,
    });
    memberGeo.computeVertexNormals();

    try {
      const merged = mergeGeometries([geometry, memberGeo]);
      return merged ?? memberGeo;
    } catch {
      return memberGeo;
    }
  },
};
