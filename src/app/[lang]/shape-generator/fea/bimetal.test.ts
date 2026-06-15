/**
 * bimetal — thermal-mismatch effects, verified: the free thermal strain α·ΔT; the
 * fully-constrained stress E·α·ΔT; the no-bending case for matched α; the bimetal
 * curvature κ ∝ Δα·ΔT/h; and the κ→δ cantilever relation.
 */
import { describe, it, expect } from 'vitest';
import { thermalStrain, constrainedThermalStress, differentialExpansion, bimetalCurvature, bimetalTipDeflection } from './bimetal';

describe('bimetal — thermal mismatch (verified)', () => {
  const a1 = 12e-6, a2 = 24e-6, dT = 100, E = 200e9, h = 0.002, L = 0.05;

  it('gives the free strain α·ΔT and the constrained stress E·α·ΔT', () => {
    expect(thermalStrain(a1, dT)).toBeCloseTo(a1 * dT, 15);              // 1.2e-3
    expect(constrainedThermalStress(E, a1, dT)).toBeCloseTo(E * a1 * dT, 6); // 240 MPa
    expect(constrainedThermalStress(E, a1, dT)).toBeCloseTo(E * thermalStrain(a1, dT), 6);
    expect(differentialExpansion(a1, a2, dT, L)).toBeCloseTo((a2 - a1) * dT * L, 15);
  });

  it('does not bend when the two coefficients match', () => {
    expect(bimetalCurvature(a1, a1, dT, h)).toBeCloseTo(0, 15);
    expect(bimetalCurvature(a1, a2, 0, h)).toBeCloseTo(0, 15);           // no temperature change
  });

  it('curves with κ = 1.5·Δα·ΔT/h (more for a thinner strip)', () => {
    const k = bimetalCurvature(a1, a2, dT, h);
    expect(k).toBeCloseTo((1.5 * (a2 - a1) * dT) / h, 9);                // 0.9 1/m
    expect(bimetalCurvature(a1, a2, dT, h / 2)).toBeCloseTo(2 * k, 9);   // κ ∝ 1/h
  });

  it('deflects a cantilever tip by δ = κL²/2', () => {
    const k = bimetalCurvature(a1, a2, dT, h);
    expect(bimetalTipDeflection(k, L)).toBeCloseTo((k * L * L) / 2, 12);
    expect(bimetalTipDeflection(k, 2 * L)).toBeCloseTo(4 * bimetalTipDeflection(k, L), 9); // ∝ L²
  });
});
