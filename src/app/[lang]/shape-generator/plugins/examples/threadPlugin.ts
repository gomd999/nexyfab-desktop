// ─── Thread Plugin — Adds a parametric external thread (bolt) custom shape ────

import * as THREE from 'three';
import type { PluginManifest, PluginInitFn } from '../PluginAPI';

export const threadManifest: PluginManifest = {
  id: 'nexyfab-thread',
  name: 'External Thread',
  version: '1.0.0',
  author: 'NexyFab',
  description: 'Adds a parametric helical external thread (bolt thread profile) to the shape library',
};

export const threadInit: PluginInitFn = (ctx) => {
  ctx.registerShape({
    id: 'thread',
    name: 'External Thread',
    icon: '🔩',
    params: [
      { key: 'nominalDiameter', label: 'Nominal Diameter (mm)', min: 1,   max: 100, default: 6,   step: 0.5  },
      { key: 'pitch',           label: 'Pitch (mm)',            min: 0.2, max: 5,   default: 1.0, step: 0.1  },
      { key: 'length',          label: 'Length (mm)',           min: 2,   max: 200, default: 20,  step: 1    },
      { key: 'threadDepth',     label: 'Thread Depth (mm)',     min: 0.1, max: 2,   default: 0.6, step: 0.05 },
      { key: 'segments',        label: 'Segments',              min: 32,  max: 256, default: 64,  step: 16   },
    ],
    generate: (p) => {
      const { nominalDiameter, pitch, length, threadDepth, segments } = p;

      const outerRadius  = nominalDiameter / 2;          // thread crest radius
      const ridgeRadius  = threadDepth / 2;              // tube radius of the helical ridge
      const turns        = Math.max(1, Math.floor(length / pitch));
      const totalPoints  = Math.max(64, Math.floor(segments) * turns);
      const radialSegs   = 6;                            // cross-section sides of the ridge tube

      // ── Build helix path for the thread ridge ─────────────────────────────
      // The path runs along the outer radius of the shaft, rising at the pitch rate.
      // We centre the thread on Y = 0 so it sits naturally in the viewport.
      const halfLen = length / 2;
      const points: THREE.Vector3[] = [];

      for (let i = 0; i <= totalPoints; i++) {
        const t     = i / totalPoints;
        const angle = t * turns * Math.PI * 2;
        const y     = t * length - halfLen;
        points.push(new THREE.Vector3(
          Math.cos(angle) * outerRadius,
          y,
          Math.sin(angle) * outerRadius,
        ));
      }

      const curve    = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
      const helixGeo = new THREE.TubeGeometry(curve, totalPoints, ridgeRadius, radialSegs, false);

      // ── Build core shaft ──────────────────────────────────────────────────
      const shaftRadius = outerRadius - threadDepth;
      const shaftGeo    = new THREE.CylinderGeometry(
        shaftRadius, shaftRadius, length,
        Math.max(32, Math.floor(segments)),
        1, false,
      );

      // ── Merge shaft + helix by concatenating position/normal arrays ───────
      helixGeo.computeVertexNormals();
      shaftGeo.computeVertexNormals();

      const helixPos  = helixGeo.attributes.position.array as Float32Array;
      const helixNorm = helixGeo.attributes.normal.array  as Float32Array;
      const shaftPos  = shaftGeo.attributes.position.array as Float32Array;
      const shaftNorm = shaftGeo.attributes.normal.array   as Float32Array;

      // Convert indexed geometries to non-indexed so positions are directly addressable
      const helixNI = helixGeo.index  ? helixGeo.toNonIndexed()  : helixGeo;
      const shaftNI = shaftGeo.index  ? shaftGeo.toNonIndexed()  : shaftGeo;

      helixNI.computeVertexNormals();
      shaftNI.computeVertexNormals();

      const hPos  = helixNI.attributes.position.array as Float32Array;
      const hNorm = helixNI.attributes.normal.array   as Float32Array;
      const sPos  = shaftNI.attributes.position.array as Float32Array;
      const sNorm = shaftNI.attributes.normal.array   as Float32Array;

      const mergedPos  = new Float32Array(hPos.length  + sPos.length);
      const mergedNorm = new Float32Array(hNorm.length + sNorm.length);
      mergedPos.set(hPos,   0);
      mergedPos.set(sPos,   hPos.length);
      mergedNorm.set(hNorm, 0);
      mergedNorm.set(sNorm, hNorm.length);

      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(mergedPos,  3));
      merged.setAttribute('normal',   new THREE.BufferAttribute(mergedNorm, 3));
      merged.computeBoundingBox();

      return merged;
    },
  });

  ctx.showToast('info', 'External Thread plugin loaded');
};
