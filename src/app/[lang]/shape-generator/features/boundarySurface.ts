import * as THREE from 'three';
import type { FeatureDefinition } from './types';

// ─── Boundary Surface Types ────────────────────────────────────────────────────

export interface BoundarySurfaceParams {
  curves: THREE.Vector3[][]; // 4 boundary curves (U0, U1, V0, V1)
  uSegments?: number;
  vSegments?: number;
}

// ─── Coons Patch Interpolation ─────────────────────────────────────────────────

/**
 * Create a smooth surface filling 4 boundary curves using Coons patch
 * interpolation (bilinear blending of ruling surfaces).
 *
 * The four curves define the boundary:
 *   - curves[0] = U0 (u varies, v=0) — bottom edge
 *   - curves[1] = U1 (u varies, v=1) — top edge
 *   - curves[2] = V0 (v varies, u=0) — left edge
 *   - curves[3] = V1 (v varies, u=1) — right edge
 *
 * Corner consistency: curves must share corner points:
 *   U0(0) = V0(0), U0(1) = V1(0), U1(0) = V0(1), U1(1) = V1(1)
 */
export function createBoundarySurface(params: BoundarySurfaceParams): THREE.BufferGeometry {
  const { curves, uSegments = 32, vSegments = 32 } = params;

  if (curves.length < 4) {
    throw new Error('Boundary surface requires exactly 4 boundary curves');
  }

  const u0Curve = curves[0]; // bottom (u varies, v=0)
  const u1Curve = curves[1]; // top    (u varies, v=1)
  const v0Curve = curves[2]; // left   (v varies, u=0)
  const v1Curve = curves[3]; // right  (v varies, u=1)

  // Helper: sample a polyline curve at parameter t (0..1)
  function sampleCurve(pts: THREE.Vector3[], t: number): THREE.Vector3 {
    if (pts.length === 0) return new THREE.Vector3();
    if (pts.length === 1) return pts[0].clone();
    const idx = t * (pts.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, pts.length - 1);
    const frac = idx - i0;
    return pts[i0].clone().lerp(pts[i1], frac);
  }

  // Corner points
  const c00 = sampleCurve(u0Curve, 0);
  const c10 = sampleCurve(u0Curve, 1);
  const c01 = sampleCurve(u1Curve, 0);
  const c11 = sampleCurve(u1Curve, 1);

  // Generate vertices using Coons patch formula:
  // P(u,v) = Lc(u,v) + Ld(u,v) - B(u,v)
  // where:
  //   Lc(u,v) = (1-v)*U0(u) + v*U1(u)           (ruled surface in u)
  //   Ld(u,v) = (1-u)*V0(v) + u*V1(v)            (ruled surface in v)
  //   B(u,v)  = (1-u)(1-v)*c00 + u(1-v)*c10 + (1-u)v*c01 + uv*c11  (bilinear)

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= vSegments; j++) {
    const v = j / vSegments;
    for (let i = 0; i <= uSegments; i++) {
      const u = i / uSegments;

      // Ruled surface in u direction
      const lcU0 = sampleCurve(u0Curve, u);
      const lcU1 = sampleCurve(u1Curve, u);
      const lc = lcU0.multiplyScalar(1 - v).add(lcU1.multiplyScalar(v));

      // Ruled surface in v direction
      const ldV0 = sampleCurve(v0Curve, v);
      const ldV1 = sampleCurve(v1Curve, v);
      const ld = ldV0.multiplyScalar(1 - u).add(ldV1.multiplyScalar(u));

      // Bilinear interpolation of corners
      const b = new THREE.Vector3()
        .addScaledVector(c00, (1 - u) * (1 - v))
        .addScaledVector(c10, u * (1 - v))
        .addScaledVector(c01, (1 - u) * v)
        .addScaledVector(c11, u * v);

      // Coons patch: P = Lc + Ld - B
      const p = lc.add(ld).sub(b);

      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
  }

  // Generate triangle indices
  for (let j = 0; j < vSegments; j++) {
    for (let i = 0; i < uSegments; i++) {
      const a = j * (uSegments + 1) + i;
      const b = a + 1;
      const c = a + (uSegments + 1);
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();

  return geo;
}

// ─── Feature Definition ────────────────────────────────────────────────────────

/**
 * The boundary surface feature replaces the current geometry with a Coons patch
 * surface generated from 4 procedural boundary curves derived from the geometry's
 * bounding box edges. This provides a smooth surface that can be further modified.
 */
export const boundarySurfaceFeature: FeatureDefinition = {
  type: 'boundarySurface',
  icon: '🌊',
  params: [
    { key: 'uSegments', labelKey: 'paramSurfUSegments', default: 24, min: 4, max: 64, step: 4, unit: '' },
    { key: 'vSegments', labelKey: 'paramSurfVSegments', default: 24, min: 4, max: 64, step: 4, unit: '' },
    { key: 'curvature', labelKey: 'paramSurfCurvature', default: 20, min: 0, max: 100, step: 5, unit: 'mm' },
  ],
  apply(geometry, params) {
    const uSegs = Math.round(params.uSegments);
    const vSegs = Math.round(params.vSegments);
    const curvature = params.curvature;

    // Derive 4 boundary curves from the geometry's bounding box
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const minX = bb.min.x, maxX = bb.max.x;
    const minZ = bb.min.z, maxZ = bb.max.z;
    const baseY = bb.min.y;

    const steps = 10;

    // U0: bottom edge (z = minZ, x varies)
    const u0: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = minX + (maxX - minX) * t;
      u0.push(new THREE.Vector3(x, baseY, minZ));
    }

    // U1: top edge (z = maxZ, x varies) — with curvature bulge
    const u1: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = minX + (maxX - minX) * t;
      const yOffset = curvature * Math.sin(t * Math.PI);
      u1.push(new THREE.Vector3(x, baseY + yOffset, maxZ));
    }

    // V0: left edge (x = minX, z varies)
    const v0: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const z = minZ + (maxZ - minZ) * t;
      const yOffset = curvature * Math.sin(t * Math.PI) * 0.5;
      v0.push(new THREE.Vector3(minX, baseY + yOffset, z));
    }

    // V1: right edge (x = maxX, z varies)
    const v1: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const z = minZ + (maxZ - minZ) * t;
      const yOffset = curvature * Math.sin(t * Math.PI) * 0.5;
      v1.push(new THREE.Vector3(maxX, baseY + yOffset, z));
    }

    return createBoundarySurface({
      curves: [u0, u1, v0, v1],
      uSegments: uSegs,
      vSegments: vSegs,
    });
  },
};
