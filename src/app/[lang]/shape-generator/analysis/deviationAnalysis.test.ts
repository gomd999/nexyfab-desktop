/**
 * deviationAnalysis — geometry-coupled verification of the scan↔nominal deviation
 * (closest-signed-distance from each test vertex to the reference surface). Checked
 * against pairs with KNOWN deviation:
 *
 *   identical meshes:    deviation = 0 everywhere
 *   concentric spheres:  every test vertex at radius R_t maps to the reference surface at
 *                        R_r along the same ray ⇒ uniform signed deviation R_t − R_r
 *                        (positive = test outside, negative = test inside), std ≈ 0
 *
 * (Faceted spheres add a sub-percent inscribed-facet bias on the inner case.)
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeDeviation } from './deviationAnalysis';

describe('deviationAnalysis — scan vs nominal (verified vs known offset)', () => {
  it('reports zero deviation for identical meshes', () => {
    const g = new THREE.BoxGeometry(20, 20, 20);
    const r = computeDeviation(g, g.clone());
    expect(Math.abs(r.minDeviation)).toBeLessThan(1e-4);
    expect(Math.abs(r.maxDeviation)).toBeLessThan(1e-4);
    expect(r.rmsDeviation).toBeLessThan(1e-4);
  });

  it('measures a uniform positive deviation when the test surface is outside', () => {
    const ref = new THREE.SphereGeometry(10, 32, 24);
    const test = new THREE.SphereGeometry(12, 32, 24);
    const r = computeDeviation(ref, test);
    expect(r.meanDeviation).toBeCloseTo(2, 1);      // R_t − R_r = +2
    expect(r.stdDeviation).toBeLessThan(0.1);       // uniform radial gap
    expect(r.minDeviation).toBeGreaterThan(0);      // entirely outside
  });

  it('measures a negative deviation when the test surface is inside', () => {
    const ref = new THREE.SphereGeometry(10, 32, 24);
    const test = new THREE.SphereGeometry(8, 32, 24);
    const r = computeDeviation(ref, test);
    expect(r.meanDeviation).toBeCloseTo(-2, 1);     // R_t − R_r = −2
    expect(r.maxDeviation).toBeLessThan(0);         // entirely inside
    expect(r.rmsDeviation).toBeCloseTo(2, 1);       // magnitude of the offset
  });

  it('scales the deviation with the offset', () => {
    const ref = new THREE.SphereGeometry(10, 32, 24);
    const small = computeDeviation(ref, new THREE.SphereGeometry(11, 32, 24)).meanDeviation;
    const big = computeDeviation(ref, new THREE.SphereGeometry(13, 32, 24)).meanDeviation;
    expect(big / small).toBeCloseTo(3, 1);          // (13−10)/(11−10) = 3
  });
});
