/**
 * j2ReturnMap3D — 3D von Mises radial return: the per-Gauss-point stress update
 * for an elastoplastic TET10 FEM. Verified against the J2 invariants (stress on
 * the yield surface, pressure unchanged, plastic incompressibility, pure-shear
 * yield) + the consistent (algorithmic) tangent.
 */
import { describe, it, expect } from 'vitest';
import {
  returnMapJ2_3D,
  elasticD,
  vonMisesVoigt,
  zeroState,
  type ElastoPlasticMaterial,
  type Voigt6,
} from './j2ReturnMap3D';

const steel: ElastoPlasticMaterial = { E: 200000, nu: 0.3, yieldStrength: 250, hardeningModulus: 2000 };
const mu = steel.E / (2 * (1 + steel.nu));

describe('returnMapJ2_3D', () => {
  it('elastic below yield: σ = Dₑ·ε, tangent = Dₑ', () => {
    const D = elasticD(steel.E, steel.nu);
    const strain: Voigt6 = [0.0005, 0, 0, 0, 0, 0];
    const r = returnMapJ2_3D(strain, zeroState(), steel);
    expect(r.plastic).toBe(false);
    expect(vonMisesVoigt(r.stress)).toBeLessThan(steel.yieldStrength);
    // σ == Dₑ·ε
    expect(r.stress[0]).toBeCloseTo(D[0]![0]! * 0.0005, 4);
    expect(r.stress[1]).toBeCloseTo(D[1]![0]! * 0.0005, 4);
    // tangent == Dₑ (elastic regime is linear)
    expect(r.tangent[0]![0]).toBeCloseTo(D[0]![0]!, 0);
    expect(r.tangent[0]![1]).toBeCloseTo(D[0]![1]!, 0);
    expect(r.tangent[3]![3]).toBeCloseTo(mu, 0);
  });

  it('plastic: stress lands on the (hardened) yield surface, pressure unchanged', () => {
    const strain: Voigt6 = [0.005, 0, 0, 0, 0, 0];
    const r = returnMapJ2_3D(strain, zeroState(), steel);
    expect(r.plastic).toBe(true);
    // von Mises of the returned stress == the grown yield surface.
    expect(vonMisesVoigt(r.stress)).toBeCloseTo(r.yieldStress, 3);
    expect(r.yieldStress).toBeCloseTo(250 + 2000 * r.dGamma, 6);
    // radial return is deviatoric → hydrostatic pressure is untouched.
    const Dtrial = elasticD(steel.E, steel.nu);
    const sigTrial = [0, 1, 2].map((i) => Dtrial[i]![0]! * 0.005);
    const pTrial = (sigTrial[0]! + sigTrial[1]! + sigTrial[2]!) / 3;
    const p = (r.stress[0] + r.stress[1] + r.stress[2]) / 3;
    expect(p).toBeCloseTo(pTrial, 3);
  });

  it('plastic strain is incompressible (tr Δεₚ = 0)', () => {
    const r = returnMapJ2_3D([0.005, 0, 0, 0, 0, 0], zeroState(), steel);
    const tr = r.state.plasticStrain[0] + r.state.plasticStrain[1] + r.state.plasticStrain[2];
    expect(tr).toBeCloseTo(0, 9);
    expect(r.state.alpha).toBeGreaterThan(0);
  });

  it('pure shear: τ = Gγ below yield, on the surface above (γ_y = Y/(√3·G))', () => {
    const gammaY = steel.yieldStrength / (Math.sqrt(3) * mu);
    const below = returnMapJ2_3D([0, 0, 0, gammaY * 0.5, 0, 0], zeroState(), steel);
    expect(below.plastic).toBe(false);
    expect(below.stress[3]).toBeCloseTo(mu * gammaY * 0.5, 4); // τ = Gγ

    const above = returnMapJ2_3D([0, 0, 0, gammaY * 3, 0, 0], zeroState(), steel);
    expect(above.plastic).toBe(true);
    expect(vonMisesVoigt(above.stress)).toBeCloseTo(above.yieldStress, 3);
  });

  it('the consistent tangent is symmetric (associative J2)', () => {
    const r = returnMapJ2_3D([0.005, 0.001, 0, 0.0008, 0, 0], zeroState(), steel);
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const avg = (Math.abs(r.tangent[i]![j]!) + Math.abs(r.tangent[j]![i]!)) / 2 + 1;
        expect(Math.abs(r.tangent[i]![j]! - r.tangent[j]![i]!) / avg).toBeLessThan(1e-3);
      }
    }
  });

  it('plastic tangent is softer than elastic (yields → lower stiffness)', () => {
    const D = elasticD(steel.E, steel.nu);
    const r = returnMapJ2_3D([0.005, 0, 0, 0, 0, 0], steel.hardeningModulus ? zeroState() : zeroState(), steel);
    // axial tangent drops below the elastic value once plastic flow starts.
    expect(r.tangent[0]![0]).toBeLessThan(D[0]![0]!);
  });
});
