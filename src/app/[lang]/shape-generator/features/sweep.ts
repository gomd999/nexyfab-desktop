import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { isOcctReady, isOcctGlobalMode, occtSweepProfile, occtSweepHelix } from './occtEngine';

/** Rectangular cross-section half-extents from the input geometry bbox. */
function crossSection(geometry: THREE.BufferGeometry): { hw: number; hh: number } | null {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return null;
  return { hw: (bb.max.x - bb.min.x) / 2, hh: (bb.max.y - bb.min.y) / 2 };
}

function applySweepMesh(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry {
  const pathType = Math.round(params.pathType);
  const cs = crossSection(geometry);
  if (!cs) return geometry;
  const { hw, hh } = cs;

  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  let extrudePath: THREE.Curve<THREE.Vector3>;

  if (pathType === 0) {
    const L = params.length;
    extrudePath = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, L));
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
}

/** Planar path points (in the XZ plane: [x, z]) for a straight or arc sweep.
 *  Returns null for the helix (a true 3D path occtSweepProfile can't represent
 *  with its 2D polyline). */
function planarPath(params: Record<string, number>): { x: number; y: number }[] | null {
  const pathType = Math.round(params.pathType);
  if (pathType === 0) {
    return [{ x: 0, y: 0 }, { x: 0, y: params.length }];
  }
  if (pathType === 1) {
    const arcAngle = (params.arcAngle / 180) * Math.PI;
    const R = params.arcRadius;
    const pts: { x: number; y: number }[] = [];
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * arcAngle;
      pts.push({ x: R * Math.sin(a), y: R * (1 - Math.cos(a)) });
    }
    return pts;
  }
  return null;
}

/** OCCT B-rep sweep: planar paths (straight/arc) go through occtSweepProfile;
 *  the helix goes through occtSweepHelix (true 3D spine). The rectangular
 *  section + helix radius mirror the mesh path so the bbox matches; the result
 *  carries an occtHandle for downstream fillet/chamfer. Any failure → null
 *  (mesh fallback). */
function applySweepOcct(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry | null {
  try {
    const cs = crossSection(geometry);
    if (!cs || !(cs.hw > 0) || !(cs.hh > 0)) return null;
    const { hw, hh } = cs;
    const profile = [
      { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
    ];
    const pathType = Math.round(params.pathType);
    let result;
    if (pathType === 2) {
      // Helix: same radius/pitch/height as the mesh path (height = turns×pitch).
      const turns = params.helixTurns;
      const pitch = params.helixPitch;
      const helixR = Math.max(hw, hh) * 1.5 + 20;
      result = occtSweepHelix(profile, pitch, turns * pitch, helixR);
    } else {
      const path = planarPath(params);
      if (!path) return null;
      result = occtSweepProfile(profile, path, 'XZ');
    }
    if (!result.handle) return null;
    result.geometry.userData.occtHandle = result.handle;
    return result.geometry;
  } catch (err) {
    console.warn('[sweep] OCCT path failed, falling back to mesh:', err);
    return null;
  }
}

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
    return applySweepMesh(geometry, params);
  },
  async applyAsync(geometry, params) {
    if (isOcctReady() && isOcctGlobalMode()) {
      const brep = applySweepOcct(geometry, params);
      if (brep) return brep;
    }
    return applySweepMesh(geometry, params);
  },
};
