import { describe, it, expect } from 'vitest';
import {
  applyMassScaling,
  worstScaled,
  suggestMeshFix,
  summarize,
  type ElementInfo,
} from './loadMassScaling';

function el(id: string, lengthMm: number, mass: number = 0.001, density: number = 7800, young: number = 200e9): ElementInfo {
  return { id, charLengthMm: lengthMm, massKg: mass, densityKgM3: density, youngPa: young };
}

describe('applyMassScaling', () => {
  it('empty list → no scaling', () => {
    const r = applyMassScaling([]);
    expect(r.scaledElements).toEqual([]);
  });

  it('coarse elements not scaled', () => {
    const r = applyMassScaling([el('big', 10)], { targetDtSec: 1e-9, maxAddedMassFraction: 0.05 });
    expect(r.scaledElements[0]!.scaleFactor).toBe(1);
  });

  it('small elements scaled up', () => {
    const r = applyMassScaling([el('tiny', 0.001)], { targetDtSec: 1e-6, maxAddedMassFraction: 100 });
    expect(r.scaledElements[0]!.scaleFactor).toBeGreaterThan(1);
  });

  it('added mass tracked', () => {
    const r = applyMassScaling([el('tiny', 0.001)], { targetDtSec: 1e-6, maxAddedMassFraction: 100 });
    expect(r.totalAddedMassKg).toBeGreaterThan(0);
  });

  it('warning when fraction exceeded', () => {
    const r = applyMassScaling([el('tiny', 0.001, 0.0001)], { targetDtSec: 1e-3, maxAddedMassFraction: 0.01 });
    expect(r.withinLimit).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('mixed mesh: only small elements scaled', () => {
    // Big element 200 mm: c = √(E/ρ) ≈ 5063 m/s, Δt = 0.2/5063 ≈ 3.95e-5 s > 1e-5 target → no scaling.
    const r = applyMassScaling([el('small', 0.1), el('big', 200)], { targetDtSec: 1e-5, maxAddedMassFraction: 100 });
    expect(r.scaledElements.find(e => e.id === 'big')!.scaleFactor).toBe(1);
    expect(r.scaledElements.find(e => e.id === 'small')!.scaleFactor).toBeGreaterThan(1);
  });

  it('addedMassFraction in [0, ...]', () => {
    const r = applyMassScaling([el('a', 1)]);
    expect(r.addedMassFraction).toBeGreaterThanOrEqual(0);
  });

  it('total original mass sums', () => {
    const r = applyMassScaling([el('a', 1, 5), el('b', 2, 10)]);
    expect(r.totalOriginalMassKg).toBe(15);
  });
});

describe('worstScaled', () => {
  it('returns top N by scale factor', () => {
    const r = applyMassScaling([el('a', 0.001), el('b', 0.005), el('c', 0.01)], { targetDtSec: 1e-6, maxAddedMassFraction: 100 });
    const worst = worstScaled(r, 2);
    expect(worst).toHaveLength(2);
    expect(worst[0]!.scaleFactor).toBeGreaterThanOrEqual(worst[1]!.scaleFactor);
  });
});

describe('suggestMeshFix', () => {
  it('counts small elements', () => {
    const elements = [el('a', 0.001), el('b', 0.005), el('big', 10)];
    const s = suggestMeshFix(elements, 1e-5);
    expect(s.smallElementCount).toBeGreaterThan(0);
  });

  it('recommended length positive', () => {
    expect(suggestMeshFix([el('a', 10)], 1e-9).recommendedMinCharLengthMm).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports counts + fraction', () => {
    const r = applyMassScaling([el('a', 0.001)]);
    const s = summarize(r);
    expect(s.elementCount).toBe(1);
    expect(s.addedMassFraction).toBe(r.addedMassFraction);
  });
});
