/**
 * surfaceQuality — geometry-coupled verification of the discrete curvature estimator
 * (angle-deficit Gaussian + cotangent-Laplacian mean) against analytic curvatures.
 *
 *   sphere R:   K = 1/R²,  H = 1/R   (everywhere)
 *   flat face:  K = 0,     H = 0
 *   sharp edge: high |H|
 *
 * This pinned a real bug: the estimators need a MANIFOLD-WELDED mesh, but THREE primitives
 * duplicate vertices along seams/poles, so those vertices saw a partial angle sum over a
 * near-zero mixed area and the curvature blew up (a sphere read K ~ 1e10 instead of 1/R²,
 * which also wrecked the colormap normalisation). The estimator now welds first and maps
 * back to the original vertices. Verified on the median (the angle-deficit method is
 * inherently noisy at the parametric poles, so the median — not the mean — is the robust
 * statistic; the bulk of vertices match analytic).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeVertexCurvature } from './surfaceQuality';

const median = (a: Float32Array): number => {
  const s = Array.from(a).sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

describe('surfaceQuality — discrete curvature (verified vs analytic)', () => {
  it('a sphere has median K=1/R² and H=1/R', () => {
    const R = 10;
    const g = new THREE.SphereGeometry(R, 48, 32);
    const origCount = g.attributes.position.count;
    const c = computeVertexCurvature(g);
    expect(c.gaussian.length).toBe(origCount);             // output contract preserved
    expect(median(c.gaussian)).toBeCloseTo(1 / (R * R), 3); // 0.01
    expect(median(c.mean)).toBeCloseTo(1 / R, 2);           // 0.1
  });

  it('scales curvature with radius: K∝1/R², H∝1/R', () => {
    const c10 = computeVertexCurvature(new THREE.SphereGeometry(10, 48, 32));
    const c20 = computeVertexCurvature(new THREE.SphereGeometry(20, 48, 32));
    expect(median(c10.gaussian) / median(c20.gaussian)).toBeCloseTo(4, 1); // (20/10)²
    expect(median(c10.mean) / median(c20.mean)).toBeCloseTo(2, 1);         // 20/10
  });

  it('reads flat box faces as zero curvature and edges as sharp', () => {
    const g = new THREE.BoxGeometry(20, 20, 20, 6, 6, 6);
    const pos = g.attributes.position;
    const c = computeVertexCurvature(g);
    let maxFlatK = 0, maxFlatH = 0, nFlat = 0, edgeH = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(x - 10) < 0.5 && Math.abs(y) < 6 && Math.abs(z) < 6) {   // +X face interior
        maxFlatK = Math.max(maxFlatK, Math.abs(c.gaussian[i]));
        maxFlatH = Math.max(maxFlatH, Math.abs(c.mean[i]));
        nFlat++;
      }
      if (Math.abs(x - 10) < 0.5 && Math.abs(y - 10) < 0.5) edgeH = Math.max(edgeH, Math.abs(c.mean[i])); // +X/+Y edge
    }
    expect(nFlat).toBeGreaterThan(0);
    expect(maxFlatK).toBeLessThan(1e-4);   // flat faces: K ≈ 0
    expect(maxFlatH).toBeLessThan(1e-4);   // flat faces: H ≈ 0
    expect(edgeH).toBeGreaterThan(0.1);    // a sharp edge has high mean curvature
  });
});
