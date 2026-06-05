/**
 * modalSolver — the REAL modal solver (TET10 stiffness + lumped mass, generalised
 * eigenproblem by inverse iteration) verified against closed-form natural frequencies on
 * actual part geometry. This is the dynamic counterpart of feaAnalyticBenchmark and the
 * replacement for the non-physical modalAnalysis.ts.
 *
 *   cantilever fundamental:  f₁ = (1.875104²/2π)·√(E·I/(ρ·A·L⁴))
 *
 * A clamped square-section bar should match f₁ within a few %, show the two transverse
 * bending modes as a near-degenerate pair, and scale f ∝ 1/L² with length.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeNaturalFrequencies, computeModalForPanel, type ModalMaterialSI } from './modalSolver';

const steel: ModalMaterialSI = { youngsModulus: 200e9, poissonRatio: 0.3, density: 7850 };

function facesByX(g: THREE.BufferGeometry, wantMin: boolean): number[] {
  const pos = g.attributes.position;
  const tris = pos.count / 3;
  const out: number[] = [];
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pos.count; i++) { mn = Math.min(mn, pos.getX(i)); mx = Math.max(mx, pos.getX(i)); }
  for (let f = 0; f < tris; f++) {
    const b = f * 3;
    const cx = (pos.getX(b) + pos.getX(b + 1) + pos.getX(b + 2)) / 3;
    if (wantMin && Math.abs(cx - mn) < 1e-3) out.push(f);
    if (!wantMin && Math.abs(cx - mx) < 1e-3) out.push(f);
  }
  return out;
}

/** Analytic cantilever bending frequency for eigenvalue βL (Hz). dims mm, E Pa, ρ kg/m³. */
function analyticBending(L: number, b: number, h: number, betaL: number): number {
  const Lm = L * 1e-3, bm = b * 1e-3, hm = h * 1e-3;
  const I = (bm * hm ** 3) / 12, A = bm * hm;
  return (betaL * betaL) / (2 * Math.PI) * Math.sqrt((steel.youngsModulus * I) / (steel.density * A * Lm ** 4));
}
const analyticF1 = (L: number, b: number, h: number) => analyticBending(L, b, h, 1.875104);

function cantileverModes(L: number, b: number, h: number) {
  const g = new THREE.BoxGeometry(L, h, b, 16, 3, 3).toNonIndexed();
  return computeNaturalFrequencies(g, steel, facesByX(g, true), 3, 5000);
}

describe('modalSolver — natural frequency (verified vs closed form)', () => {
  it('matches the analytic cantilever fundamental within a few %', () => {
    const L = 200, b = 20, h = 20;
    const res = cantileverModes(L, b, h);
    const f1 = analyticF1(L, b, h);
    expect(res.elementCount).toBeGreaterThan(0);
    expect(res.freeDofCount).toBeGreaterThan(0);
    expect(res.modes[0].frequencyHz / f1).toBeGreaterThan(0.9);
    expect(res.modes[0].frequencyHz / f1).toBeLessThan(1.1);
  });

  it('matches the 2nd bending mode within ~4% (the consistent mass matrix)', () => {
    // The lumped mass under-predicted the 2nd bending mode by ~5% at ANY mesh resolution
    // (a mass-matrix error, not a mesh error). The consistent TET10 mass brings it under 4%.
    const L = 200, b = 20, h = 20;
    const g = new THREE.BoxGeometry(L, h, b, 20, 4, 4).toNonIndexed();
    const res = computeNaturalFrequencies(g, steel, facesByX(g, true), 4, 9000);
    const f2 = analyticBending(L, b, h, 4.694091);   // second cantilever eigenvalue
    // modes[2] is the first of the 2nd-bending degenerate pair (modes[0],[1] are the 1st pair)
    expect(res.modes[2].frequencyHz / f2).toBeGreaterThan(0.96);
    expect(res.modes[2].frequencyHz / f2).toBeLessThan(1.04);
  });

  it('captures the longitudinal (axial) mode at c/(4L) for a fixed-free bar', () => {
    // A short stubby bar so the axial resonance is among the lowest modes. The axial wave
    // speed c=√(E/ρ) and the fixed-free fundamental f = c/(4L) are independent of
    // slenderness (unlike the bending formula, which would need a slender bar).
    const L = 40, b = 30;
    const c = Math.sqrt(steel.youngsModulus / steel.density);
    const fAxial = c / (4 * (L * 1e-3));               // ~31.5 kHz
    const g = new THREE.BoxGeometry(L, b, b, 6, 4, 4).toNonIndexed();
    const res = computeNaturalFrequencies(g, steel, facesByX(g, true), 6, 1200);
    const closest = Math.min(...res.modes.map(m => Math.abs(m.frequencyHz / fAxial - 1)));
    expect(closest).toBeLessThan(0.04);                // a mode lands within 4% of c/(4L)
    // the axial resonance is a higher mode than the 1st bending pair
    expect(fAxial).toBeGreaterThan(res.modes[0].frequencyHz);
  });

  it('conserves the exact total mass (consistent mass, ΣC=1)', () => {
    const L = 200, b = 20, h = 20;
    const g = new THREE.BoxGeometry(L, h, b, 16, 3, 3).toNonIndexed();
    const res = computeNaturalFrequencies(g, steel, facesByX(g, true), 1);
    const exactMass = steel.density * (L * 1e-3) * (b * 1e-3) * (h * 1e-3); // ρ·V (kg)
    expect(res.totalMassKg).toBeCloseTo(exactMass, 6);
  });

  it('finds the two transverse bending modes as a near-degenerate pair (square section)', () => {
    const res = cantileverModes(200, 20, 20);
    // f1 and f2 are the bending modes in the two perpendicular directions ⇒ equal for a square bar
    expect(res.modes[1].frequencyHz / res.modes[0].frequencyHz).toBeGreaterThan(0.97);
    expect(res.modes[1].frequencyHz / res.modes[0].frequencyHz).toBeLessThan(1.03);
  });

  it('scales the fundamental as f ∝ 1/L²', () => {
    const short = cantileverModes(150, 20, 20).modes[0].frequencyHz;
    const long = cantileverModes(300, 20, 20).modes[0].frequencyHz;
    // doubling L should drop f by ~4× (Euler–Bernoulli f ∝ 1/L²)
    expect(short / long).toBeGreaterThan(3.4);
    expect(short / long).toBeLessThan(4.6);
  });

  it('produces only positive, finite frequencies (no spurious rigid-body modes when clamped)', () => {
    const res = cantileverModes(200, 20, 20);
    for (const m of res.modes) {
      expect(Number.isFinite(m.frequencyHz)).toBe(true);
      expect(m.frequencyHz).toBeGreaterThan(1); // a clamped bar has no zero-frequency modes
    }
  });

  it('panel adapter: named-face fix matches the analytic fundamental and yields valid mode colours', () => {
    const L = 200, b = 20, h = 20;
    // box L along X; fixing the 'left' (−X) face is the clamped cantilever root
    const g = new THREE.BoxGeometry(L, h, b, 16, 3, 3).toNonIndexed();
    const r = computeModalForPanel(g, 'steel', ['left'], 3);
    expect(r.frequencies.length).toBe(3);
    expect(r.frequencies[0] / analyticF1(L, b, h)).toBeGreaterThan(0.9);
    expect(r.frequencies[0] / analyticF1(L, b, h)).toBeLessThan(1.1);
    // per-vertex mode magnitudes: one value per surface vertex, normalised to [0,1] with a real peak
    const surfVerts = g.attributes.position.count;
    expect(r.modeVertexMagnitudes[0].length).toBe(surfVerts);
    let peak = 0; let allFinite = true;
    for (const v of r.modeVertexMagnitudes[0]) { if (!Number.isFinite(v)) allFinite = false; if (v > peak) peak = v; }
    expect(allFinite).toBe(true);
    expect(peak).toBeCloseTo(1, 5);                 // normalised to the mode peak
    // the clamped root barely moves; the free tip moves most (cantilever mode shape)
    const pos = g.attributes.position;
    let xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < pos.count; i++) { xmin = Math.min(xmin, pos.getX(i)); xmax = Math.max(xmax, pos.getX(i)); }
    let rootMax = 0, tipMax = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), m = r.modeVertexMagnitudes[0][i];
      if (Math.abs(x - xmin) < 1) rootMax = Math.max(rootMax, m);
      if (Math.abs(x - xmax) < 1) tipMax = Math.max(tipMax, m);
    }
    expect(tipMax).toBeGreaterThan(rootMax);        // tip displaces more than the clamped root
  });
});
