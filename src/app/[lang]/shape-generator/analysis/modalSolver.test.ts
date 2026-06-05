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
import { computeNaturalFrequencies, type ModalMaterialSI } from './modalSolver';

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

/** Analytic cantilever fundamental frequency (Hz). dims in mm, E in Pa, ρ in kg/m³. */
function analyticF1(L: number, b: number, h: number): number {
  const Lm = L * 1e-3, bm = b * 1e-3, hm = h * 1e-3;
  const I = (bm * hm ** 3) / 12, A = bm * hm;
  const beta = 1.875104;
  return (beta * beta) / (2 * Math.PI) * Math.sqrt((steel.youngsModulus * I) / (steel.density * A * Lm ** 4));
}

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
});
