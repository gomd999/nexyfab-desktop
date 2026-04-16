import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';

export const threadFeature: FeatureDefinition = {
  type: 'thread',
  icon: '🔩',
  params: [
    { key: 'pitch', labelKey: 'paramThreadPitch', default: 2, min: 0.5, max: 10, step: 0.5, unit: 'mm' },
    { key: 'depth', labelKey: 'paramThreadDepth', default: 1, min: 0.3, max: 5, step: 0.1, unit: 'mm' },
    { key: 'angle', labelKey: 'paramThreadAngle', default: 60, min: 30, max: 90, step: 5, unit: '°' },
    {
      key: 'cosmetic', labelKey: 'paramThreadCosmetic', default: 1, min: 0, max: 1, step: 1, unit: '',
      options: [{ value: 0, labelKey: 'threadReal' }, { value: 1, labelKey: 'threadCosmetic' }],
    },
  ],
  apply(geometry, params) {
    const pitch = params.pitch;
    const depth = params.depth;
    const cosmetic = Math.round(params.cosmetic) === 1;
    const flankAngle = (params.angle / 2 / 180) * Math.PI;

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return geometry;

    const height = bb.max.y - bb.min.y;
    const radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    const turns = Math.floor(height / pitch);
    if (turns < 1) return geometry;

    if (cosmetic) {
      // Cosmetic thread: add a helix tube geometry as visual indicator
      const stepsPerTurn = 32;
      const totalSteps = turns * stepsPerTurn;
      const helixPoints: THREE.Vector3[] = [];
      for (let i = 0; i <= totalSteps; i++) {
        const t = i / totalSteps;
        const a = t * turns * Math.PI * 2;
        const y = bb.min.y + pitch * 0.5 + t * (height - pitch);
        helixPoints.push(new THREE.Vector3(
          (radius + depth * 0.5) * Math.cos(a),
          y,
          (radius + depth * 0.5) * Math.sin(a),
        ));
      }

      const curve = new THREE.CatmullRomCurve3(helixPoints);
      const threadGeo = new THREE.TubeGeometry(curve, totalSteps, depth * 0.3, 4, false);
      threadGeo.computeVertexNormals();

      const merged = mergeGeometries([geometry, threadGeo]);
      return merged ?? geometry;
    }

    // Real thread: build helical groove using TubeGeometry with V-profile
    const stepsPerTurn = 24;
    const totalSteps = turns * stepsPerTurn;
    const halfDepth = depth / 2;
    const profilePts: THREE.Vector3[] = [];

    for (let i = 0; i <= totalSteps; i++) {
      const t = i / totalSteps;
      const a = t * turns * Math.PI * 2;
      const y = bb.min.y + pitch * 0.5 + t * (height - pitch);
      const r = radius - halfDepth;
      profilePts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }

    const curve = new THREE.CatmullRomCurve3(profilePts);
    const threadTube = new THREE.TubeGeometry(curve, totalSteps, halfDepth * Math.tan(flankAngle), 3, false);
    threadTube.computeVertexNormals();

    const merged = mergeGeometries([geometry, threadTube]);
    return merged ?? geometry;
  },
};
