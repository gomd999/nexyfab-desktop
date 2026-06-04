import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { isOcctReady, isOcctGlobalMode, occtRevolveProfile } from './occtEngine';

/** Extract the (radius, height) profile of a geometry about the chosen axis. */
function extractProfile(geometry: THREE.BufferGeometry, axis: number): THREE.Vector2[] {
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
  const pts = Array.from(profileMap.values());
  pts.sort((a, b) => a.y - b.y);
  const filtered: THREE.Vector2[] = pts.length > 0 ? [pts[0]] : [];
  for (let i = 1; i < pts.length; i++) {
    const prev = filtered[filtered.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > 0.5) filtered.push(pts[i]);
  }
  return filtered;
}

function applyRevolveMesh(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry {
  // Block degenerate sweep parameters rather than handing THREE.LatheGeometry a
  // zero angle / zero segment count, which silently produces NaN vertices.
  if (!(params.angle > 0) || !(Math.round(params.segments) >= 3)) {
    throw new Error(
      `Revolve needs a positive angle and at least 3 segments (got angle=${params.angle}, segments=${params.segments})`,
    );
  }
  const angle = (params.angle / 360) * Math.PI * 2;
  const segments = Math.round(params.segments);
  const axis = Math.round(params.axis);

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return geometry;

  let filtered = extractProfile(geometry, axis);
  if (filtered.length < 2) {
    // Fallback: use bounding box profile.
    const w = (bb.max.x - bb.min.x) / 2;
    const hMin = axis === 1 ? bb.min.y : axis === 0 ? bb.min.x : bb.min.z;
    const hMax = axis === 1 ? bb.max.y : axis === 0 ? bb.max.x : bb.max.z;
    filtered = [new THREE.Vector2(w, hMin), new THREE.Vector2(w, hMax)];
  }
  if (filtered.length < 2) return geometry;

  const lathe = new THREE.LatheGeometry(filtered, segments, 0, angle);
  lathe.computeVertexNormals();
  if (axis === 0) lathe.rotateZ(Math.PI / 2);
  else if (axis === 2) lathe.rotateX(Math.PI / 2);
  return lathe;
}

/**
 * Precise B-rep revolve via OCCT (replicad). Only used for a FULL 360° revolve —
 * occtRevolveProfile builds a full solid of revolution; partial sweeps fall back
 * to the LatheGeometry mesh. Returns null on any miss so the caller meshes.
 */
function applyRevolveOcct(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry | null {
  try {
    // The OCCT builder revolves a full turn; a partial angle can't be matched.
    if (params.angle < 359.5) return null;
    const axis = Math.round(params.axis);
    const filtered = extractProfile(geometry, axis);
    if (filtered.length < 3) return null; // builder needs ≥3 profile points

    const profile = filtered.map((v) => ({ x: v.x, y: v.y }));
    const result = occtRevolveProfile(profile);
    if (!result.handle) return null;

    // occtRevolveProfile revolves about Y; match the mesh path's axis transform.
    if (axis === 0) result.geometry.rotateZ(Math.PI / 2);
    else if (axis === 2) result.geometry.rotateX(Math.PI / 2);
    result.geometry.userData.occtHandle = result.handle;
    return result.geometry;
  } catch (err) {
    console.warn('[revolve] OCCT path failed, falling back to mesh:', err);
    return null;
  }
}

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
    return applyRevolveMesh(geometry, params);
  },
  async applyAsync(geometry, params) {
    if (isOcctReady() && isOcctGlobalMode()) {
      const brep = applyRevolveOcct(geometry, params);
      if (brep) return brep;
    }
    return applyRevolveMesh(geometry, params);
  },
};
