// ─── Spring Plugin — Adds a "Spring" (helix) custom shape ────────────────────

import * as THREE from 'three';
import type { PluginManifest, PluginInitFn } from '../PluginAPI';

export const springManifest: PluginManifest = {
  id: 'example-spring',
  name: 'Spring Shape',
  version: '1.0.0',
  author: 'NexyFab',
  description: 'Adds a parametric helical spring shape to the shape library',
};

export const springInit: PluginInitFn = (ctx) => {
  ctx.registerShape({
    id: 'spring',
    name: 'Spring',
    icon: '🌀',
    params: [
      { key: 'radius', label: 'Radius', min: 5, max: 100, default: 20, step: 1 },
      { key: 'wireRadius', label: 'Wire Radius', min: 0.5, max: 20, default: 3, step: 0.5 },
      { key: 'height', label: 'Height', min: 10, max: 300, default: 80, step: 1 },
      { key: 'turns', label: 'Turns', min: 2, max: 30, default: 8, step: 1 },
      { key: 'segments', label: 'Segments', min: 32, max: 256, default: 128, step: 8 },
    ],
    generate: (p) => {
      const { radius, wireRadius, height, turns, segments } = p;
      const tubularSegments = Math.max(16, Math.floor(segments));
      const radialSegments = 12;

      // Build a helix path
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= tubularSegments; i++) {
        const t = i / tubularSegments;
        const angle = t * turns * Math.PI * 2;
        const y = t * height - height / 2;
        points.push(new THREE.Vector3(
          Math.cos(angle) * radius,
          y,
          Math.sin(angle) * radius,
        ));
      }

      // Create a CatmullRom curve for smooth path
      const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);

      // TubeGeometry around the helix path
      const geometry = new THREE.TubeGeometry(curve, tubularSegments * 2, wireRadius, radialSegments, false);
      geometry.computeBoundingBox();

      return geometry;
    },
  });

  ctx.showToast('info', 'Spring shape plugin loaded');
};
