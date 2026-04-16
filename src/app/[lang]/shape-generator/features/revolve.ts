import * as THREE from 'three';
import type { FeatureDefinition } from './types';

export const revolveFeature: FeatureDefinition = {
  type: 'revolve',
  icon: '🔄',
  params: [
    { key: 'angle', labelKey: 'paramRevolveAngle', default: 360, min: 10, max: 360, step: 5, unit: '°' },
    { key: 'segments', labelKey: 'paramRevolveSegments', default: 32, min: 8, max: 64, step: 4, unit: '' },
    {
      key: 'axis', labelKey: 'paramRevolveAxis', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'axisX' },
        { value: 1, labelKey: 'axisY' },
        { value: 2, labelKey: 'axisZ' },
      ],
    },
  ],
  apply(geometry, params) {
    const angle = (params.angle / 360) * Math.PI * 2;
    const segments = Math.round(params.segments);
    const axis = Math.round(params.axis);

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return geometry;

    // Sample vertices and convert to polar (r, h) relative to chosen axis
    const positions = geometry.attributes.position;
    const profileMap = new Map<string, THREE.Vector2>();

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);

      let r: number, h: number;
      if (axis === 1) { r = Math.sqrt(x * x + z * z); h = y; }
      else if (axis === 0) { r = Math.sqrt(y * y + z * z); h = x; }
      else { r = Math.sqrt(x * x + y * y); h = z; }

      if (r < 0.01) continue;
      const key = `${r.toFixed(1)},${h.toFixed(1)}`;
      if (!profileMap.has(key)) profileMap.set(key, new THREE.Vector2(r, h));
    }

    let pts = Array.from(profileMap.values());
    if (pts.length < 2) {
      // Fallback: use bounding box profile
      const w = (bb.max.x - bb.min.x) / 2;
      const hMin = axis === 1 ? bb.min.y : axis === 0 ? bb.min.x : bb.min.z;
      const hMax = axis === 1 ? bb.max.y : axis === 0 ? bb.max.x : bb.max.z;
      pts = [new THREE.Vector2(w, hMin), new THREE.Vector2(w, hMax)];
    }

    pts.sort((a, b) => a.y - b.y);

    // Deduplicate
    const filtered: THREE.Vector2[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = filtered[filtered.length - 1];
      if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > 0.5) {
        filtered.push(pts[i]);
      }
    }
    if (filtered.length < 2) return geometry;

    const lathe = new THREE.LatheGeometry(filtered, segments, 0, angle);
    lathe.computeVertexNormals();

    if (axis === 0) lathe.rotateZ(Math.PI / 2);
    else if (axis === 2) lathe.rotateX(Math.PI / 2);

    return lathe;
  },
};
