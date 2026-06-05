/**
 * thermalFEA — geometry-coupled verification of the steady-state conduction solver
 * against the exact 1-D analytic solution. A bar held at T_hi on one face and T_lo on the
 * opposite face has a LINEAR temperature profile T(x) = T_hi + (T_lo−T_hi)·(x−x₀)/L and a
 * uniform Fourier flux q = −k·∇T directed hot→cold, with q ∝ k.
 *
 * This test pinned a real boundary-interpolation bug: the grid→vertex trilinear clamp
 * capped the fractional coordinate at gridSize−2, so vertices on the high-side faces
 * never sampled the last grid plane and a fixed cold face read ~14% warm. The clamp now
 * lets boundary vertices reach the BC plane (fixed in this change).
 *
 * SCOPE / honest limits (asserted only on what is physical): the conduction core + fixed-
 * temperature BCs are verified here. The heat-source and convection terms remain
 * dimensional proxies. The solver now masks grid nodes OUTSIDE the solid via point-in-solid
 * (so a non-convex part no longer conducts through the empty bounding box) — the
 * two-separated-bodies test below pins that behaviour.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { runThermalFEA, THERMAL_MATERIALS } from './thermalFEA';

function bar(L: number, h: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(L, h, h, 12, 3, 3).toNonIndexed();
}

/** Two separated 20³ cubes (gap between x∈[20,40]) merged into one BufferGeometry. */
function twoCubes(): THREE.BufferGeometry {
  const a = new THREE.BoxGeometry(20, 20, 20).toNonIndexed(); a.translate(10, 10, 10);
  const b = new THREE.BoxGeometry(20, 20, 20).toNonIndexed(); b.translate(50, 10, 10);
  const pa = a.attributes.position.array as Float32Array;
  const pb = b.attributes.position.array as Float32Array;
  const merged = new Float32Array(pa.length + pb.length);
  merged.set(pa, 0); merged.set(pb, pa.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  return g;
}

describe('thermalFEA — 1-D conduction (verified vs closed form)', () => {
  it('reproduces the linear temperature profile between two fixed faces', () => {
    const L = 100, h = 20;
    const g = bar(L, h);
    const r = runThermalFEA(g, [
      { type: 'fixed_temp', faceIndex: 2, value: 100 }, // −X face hot
      { type: 'fixed_temp', faceIndex: 3, value: 0 },   // +X face cold
    ], THERMAL_MATERIALS.aluminum);

    expect(r.maxTemp).toBeCloseTo(100, 0);
    expect(r.minTemp).toBeCloseTo(0, 0);                 // the bug previously left this ~14

    const pos = g.attributes.position;
    let xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < pos.count; i++) { xmin = Math.min(xmin, pos.getX(i)); xmax = Math.max(xmax, pos.getX(i)); }
    let maxErr = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const expT = 100 + (0 - 100) * (x - xmin) / (xmax - xmin);
      maxErr = Math.max(maxErr, Math.abs(r.temperatures[i] - expT));
    }
    expect(maxErr).toBeLessThan(1.5); // within ~1.5 °C of the exact linear field (range 100)
  });

  it('obeys the maximum principle (no overshoot beyond the imposed temperatures)', () => {
    const g = bar(100, 20);
    const r = runThermalFEA(g, [
      { type: 'fixed_temp', faceIndex: 2, value: 100 },
      { type: 'fixed_temp', faceIndex: 3, value: 0 },
    ], THERMAL_MATERIALS.aluminum);
    for (let i = 0; i < r.temperatures.length; i++) {
      expect(r.temperatures[i]).toBeGreaterThanOrEqual(-1);
      expect(r.temperatures[i]).toBeLessThanOrEqual(101);
    }
  });

  it('gives a uniform Fourier flux directed hot→cold, transverse components ~0', () => {
    const g = bar(100, 20);
    const r = runThermalFEA(g, [
      { type: 'fixed_temp', faceIndex: 2, value: 100 },
      { type: 'fixed_temp', faceIndex: 3, value: 0 },
    ], THERMAL_MATERIALS.aluminum);
    let fx = 0, fyAbs = 0, fzAbs = 0;
    for (const f of r.heatFlux) { fx += f.x; fyAbs += Math.abs(f.y); fzAbs += Math.abs(f.z); }
    const n = r.heatFlux.length;
    expect(fx / n).toBeGreaterThan(0);                   // heat flows +X (hot −X → cold +X)
    expect(fyAbs / n).toBeLessThan(0.05 * (fx / n));     // negligible transverse flux
    expect(fzAbs / n).toBeLessThan(0.05 * (fx / n));
  });

  it('scales the flux with conductivity (q ∝ k)', () => {
    const g = bar(100, 20);
    const bc = [
      { type: 'fixed_temp' as const, faceIndex: 2, value: 100 },
      { type: 'fixed_temp' as const, faceIndex: 3, value: 0 },
    ];
    const al = runThermalFEA(g, bc, THERMAL_MATERIALS.aluminum); // k=205
    const st = runThermalFEA(g, bc, THERMAL_MATERIALS.steel);    // k=50
    const fxAl = al.heatFlux.reduce((s, f) => s + f.x, 0) / al.heatFlux.length;
    const fxSt = st.heatFlux.reduce((s, f) => s + f.x, 0) / st.heatFlux.length;
    expect(fxAl / fxSt).toBeCloseTo(205 / 50, 1);        // flux ratio = conductivity ratio
  });

  it('does NOT conduct heat through the empty gap between two separated bodies', () => {
    // Hot face on the far side of cube A (−X), cold face on the far side of cube B (+X).
    // With the bounding-box grid masked to the actual solid, the air gap is inactive, so
    // each cube is thermally isolated and equilibrates to its OWN boundary temperature —
    // not the bridging gradient an unmasked box grid would (wrongly) produce.
    const g = twoCubes();
    const r = runThermalFEA(g, [
      { type: 'fixed_temp', faceIndex: 2, value: 100 }, // −X (cube A far face)
      { type: 'fixed_temp', faceIndex: 3, value: 0 },   // +X (cube B far face)
    ], THERMAL_MATERIALS.aluminum);

    const pos = g.attributes.position;
    let aSum = 0, aN = 0, bSum = 0, bN = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (x < 20.5) { aSum += r.temperatures[i]; aN++; }       // cube A
      else if (x > 39.5) { bSum += r.temperatures[i]; bN++; }  // cube B
    }
    expect(aSum / aN).toBeGreaterThan(95);   // cube A ≈ its 100 °C BC (not a bridged ~83)
    expect(bSum / bN).toBeLessThan(5);       // cube B ≈ its 0 °C BC (not a bridged ~17)
  });
});
