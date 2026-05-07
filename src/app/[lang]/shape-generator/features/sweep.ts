import * as THREE from 'three';
import type { FeatureDefinition } from './types';

export const sweepFeature: FeatureDefinition = {
  type: 'sweep',
  icon: '〰️',
  params: [
    {
      key: 'pathType', labelKey: 'paramSweepPath', default: 0, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'sweepPathStraight' },
        { value: 1, labelKey: 'sweepPathArc' },
        { value: 2, labelKey: 'sweepPathHelix' },
      ],
    },
    { key: 'length', labelKey: 'paramSweepLength', default: 100, min: 10, max: 500, step: 5, unit: 'mm' },
    { key: 'arcAngle', labelKey: 'paramSweepArcAngle', default: 90, min: 10, max: 360, step: 5, unit: '°' },
    { key: 'arcRadius', labelKey: 'paramSweepArcRadius', default: 60, min: 10, max: 300, step: 5, unit: 'mm' },
    { key: 'helixPitch', labelKey: 'paramSweepHelixPitch', default: 20, min: 1, max: 100, step: 1, unit: 'mm' },
    { key: 'helixTurns', labelKey: 'paramSweepHelixTurns', default: 3, min: 1, max: 20, step: 1, unit: '' },
  ],
  apply(geometry, params) {
    const pathType = Math.round(params.pathType);

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return geometry;

    const hw = (bb.max.x - bb.min.x) / 2;
    const hh = (bb.max.y - bb.min.y) / 2;

    // Cross-section shape (rectangle from bounding box)
    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hh);
    shape.lineTo( hw, -hh);
    shape.lineTo( hw,  hh);
    shape.lineTo(-hw,  hh);
    shape.closePath();

    let extrudePath: THREE.Curve<THREE.Vector3>;

    if (pathType === 0) {
      const L = params.length;
      extrudePath = new THREE.LineCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, L),
      );
    } else if (pathType === 1) {
      const arcAngle = (params.arcAngle / 180) * Math.PI;
      const R = params.arcRadius;
      const pts: THREE.Vector3[] = [];
      const steps = 32;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * arcAngle;
        pts.push(new THREE.Vector3(R * Math.sin(a), 0, R * (1 - Math.cos(a))));
      }
      extrudePath = new THREE.CatmullRomCurve3(pts);
    } else {
      const turns = params.helixTurns;
      const pitch = params.helixPitch;
      const helixR = Math.max(hw, hh) * 1.5 + 20;
      const pts: THREE.Vector3[] = [];
      const steps = Math.round(turns * 36);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * turns * Math.PI * 2;
        pts.push(new THREE.Vector3(helixR * Math.cos(a), t * turns * pitch, helixR * Math.sin(a)));
      }
      extrudePath = new THREE.CatmullRomCurve3(pts);
    }

    const swept = new THREE.ExtrudeGeometry(shape, {
      steps: pathType === 2 ? Math.round(params.helixTurns * 36) : 48,
      bevelEnabled: false,
      extrudePath,
    });
    swept.computeVertexNormals();
    return swept;
  },
};
