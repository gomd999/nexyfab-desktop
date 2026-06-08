/**
 * Helical sweep feature — sweeps a circular cross-section along a helical
 * path. Used for springs, screw threads (visual), augers, drill flutes.
 *
 * Distinct from `thread.ts` which adds a thread groove to an existing
 * cylinder. This produces a fresh helical solid (or merges onto an existing
 * geometry if one is provided).
 *
 * Path equation:
 *   p(t) = ( (R + amp·sin(α)) · cos(2π·turns·t),
 *            t·height + phase,
 *            (R + amp·sin(α)) · sin(2π·turns·t) )
 *
 * Where `turns = height / pitch` (clamped ≥ 1).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';
import { occtSweepHelix, occtBooleanSolids } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';

/** A closed circular cross-section (polygon) for the helical sweep profile. */
function circleProfile(r: number, segs = 24): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return pts;
}

export const helixFeature: FeatureDefinition = {
  type: 'helix',
  icon: '🌀',
  params: [
    { key: 'radius', labelKey: 'paramHelixRadius', default: 20, min: 1, max: 200, step: 1, unit: 'mm' },
    { key: 'pitch', labelKey: 'paramHelixPitch', default: 5, min: 0.5, max: 100, step: 0.5, unit: 'mm' },
    { key: 'turns', labelKey: 'paramHelixTurns', default: 6, min: 1, max: 60, step: 1, unit: '' },
    { key: 'wireRadius', labelKey: 'paramHelixWireRadius', default: 1.2, min: 0.1, max: 20, step: 0.1, unit: 'mm' },
    {
      // Direction along which the helix grows. Matches sweep.ts axis convention.
      key: 'axis', labelKey: 'paramHelixAxis', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'axisX' },
        { value: 1, labelKey: 'axisY' },
        { value: 2, labelKey: 'axisZ' },
      ],
    },
    {
      // Right-handed (standard threads) vs left-handed.
      key: 'handedness', labelKey: 'paramHelixHand', default: 0, min: 0, max: 1, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'helixRight' },
        { value: 1, labelKey: 'helixLeft' },
      ],
    },
  ],
  apply(geometry, params) {
    const radius = Math.max(0.5, params.radius);
    const pitch = Math.max(0.1, params.pitch);
    const turns = Math.max(1, Math.round(params.turns));
    const wireRadius = Math.max(0.05, params.wireRadius);
    const axis = Math.round(params.axis);
    const left = Math.round(params.handedness) === 1;
    const sign = left ? -1 : 1;

    const stepsPerTurn = 32;
    const totalSteps = turns * stepsPerTurn;
    const height = pitch * turns;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= totalSteps; i++) {
      const t = i / totalSteps;
      const a = sign * t * turns * Math.PI * 2;
      const along = t * height;
      // Map (radial-x, along, radial-z) into the chosen world axis.
      // For axis=Y the natural mapping is direct; X/Z swap which dim carries
      // the height vs the radial sweep.
      const rx = radius * Math.cos(a);
      const rz = radius * Math.sin(a);
      let p: THREE.Vector3;
      if (axis === 0) p = new THREE.Vector3(along, rx, rz);
      else if (axis === 2) p = new THREE.Vector3(rx, rz, along);
      else p = new THREE.Vector3(rx, along, rz);
      points.push(p);
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const tubularSegments = Math.max(64, totalSteps);
    const helixGeo = new THREE.TubeGeometry(curve, tubularSegments, wireRadius, 8, false);
    helixGeo.computeVertexNormals();

    // If the caller had an existing solid (e.g. helix added on top of a base
    // shape), merge so the user sees both. Otherwise return the helix alone.
    const hasBase =
      geometry.attributes.position && geometry.attributes.position.count > 0;
    if (hasBase) {
      try {
        const merged = mergeGeometries([geometry, helixGeo]);
        if (merged) return merged;
      } catch {
        /* fall through */
      }
    }
    return helixGeo;
  },
  async applyAsync(geometry, params) {
    if (shouldUseOcctEngine()) {
      try {
        const radius = Math.max(0.5, params.radius);
        const pitch = Math.max(0.1, params.pitch);
        const turns = Math.max(1, Math.round(params.turns));
        const wireRadius = Math.max(0.05, params.wireRadius);
        const axis = Math.round(params.axis);
        const lefthand = Math.round(params.handedness) === 1;
        // Helix axis direction (matches the mesh axis convention).
        const dir: [number, number, number] = axis === 0 ? [1, 0, 0] : axis === 2 ? [0, 0, 1] : [0, 1, 0];
        const built = occtSweepHelix(circleProfile(wireRadius), pitch, pitch * turns, radius, undefined, dir, lefthand);
        if (built.handle) {
          const hasBase = geometry.attributes.position && geometry.attributes.position.count > 0;
          const baseHandle = geometry.userData?.occtHandle as string | undefined;
          if (!hasBase) {
            // Fresh helical solid (the common spring / auger case) → B-rep.
            built.geometry.userData.occtHandle = built.handle;
            return built.geometry;
          }
          if (baseHandle) {
            // Helix on top of an upstream B-rep → fuse into one solid.
            const fused = occtBooleanSolids('union', baseHandle, built.handle);
            if (fused.handle) {
              fused.geometry.userData.occtHandle = fused.handle;
              return fused.geometry;
            }
          }
          // Base without a B-rep handle → fall through to the mesh merge.
        }
      } catch (err) {
        console.warn('[helix] OCCT path failed, falling back to mesh:', err);
      }
    }
    return noteMeshFallback(helixFeature.apply(geometry, params), { op: 'Helix' });
  },
};
