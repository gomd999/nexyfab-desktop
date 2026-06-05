/**
 * plasticityJ2 — small-strain J2 radial-return integrator, verified at the material
 * point against the analytic responses: elastic shear modulus 2μ, von Mises shear
 * yield τ_y = σ_y/√3, the consistency condition q = σ_y(α) after every plastic step,
 * a reduced hardening tangent, pressure-insensitivity, and elastic unloading.
 */
import { describe, it, expect } from 'vitest';
import { radialReturnJ2, zeroState, vonMisesStress, J2Material } from './plasticityJ2';

const mat: J2Material = { E: 210000, nu: 0.3, yield0: 250, hardening: 2000 };
const mu = mat.E / (2 * (1 + mat.nu));
const Kbulk = mat.E / (3 * (1 - 2 * mat.nu));
const tauY = mat.yield0 / Math.sqrt(3);
const gY = tauY / (2 * mu);        // tensor shear strain at yield

/** Monotonic pure-shear loading to a target tensor shear; returns the step record. */
function shearSweep(gMax: number, n: number) {
  let state = zeroState();
  const rec: Array<{ g: number; sxy: number; vm: number; plastic: boolean; alpha: number }> = [];
  for (let i = 1; i <= n; i++) {
    const g = (gMax * i) / n;
    const r = radialReturnJ2([0, 0, 0, g, 0, 0], state, mat);
    state = r.state;
    rec.push({ g, sxy: r.stress[3], vm: r.vonMises, plastic: r.plastic, alpha: state.alpha });
  }
  return { rec, state };
}

describe('plasticityJ2 — radial-return material model (verified)', () => {
  it('elastic shear response has slope 2μ and yields at τ_y = σ_y/√3', () => {
    const { rec } = shearSweep(3 * gY, 60);
    const firstElastic = rec[0];
    expect(firstElastic.plastic).toBe(false);
    expect(firstElastic.sxy / firstElastic.g).toBeCloseTo(2 * mu, 4);       // shear modulus
    // the last elastic step's stress is at the von Mises shear yield.
    const lastElastic = [...rec].reverse().find((r) => !r.plastic)!;
    expect(lastElastic.sxy).toBeLessThanOrEqual(tauY + 1e-6);
    const firstPlastic = rec.find((r) => r.plastic)!;
    expect(firstPlastic.sxy).toBeGreaterThan(tauY - 1e-6);                  // brackets τ_y
  });

  it('every plastic step satisfies the consistency condition q = σ_y0 + H·α', () => {
    const { rec } = shearSweep(3 * gY, 60);
    for (const r of rec.filter((s) => s.plastic)) {
      expect(r.vm).toBeCloseTo(mat.yield0 + mat.hardening * r.alpha, 6);
    }
  });

  it('the post-yield tangent is reduced but positive (hardening)', () => {
    const { rec } = shearSweep(3 * gY, 60);
    const pl = rec.filter((r) => r.plastic);
    const slope = (pl[pl.length - 1].sxy - pl[0].sxy) / (pl[pl.length - 1].g - pl[0].g);
    expect(slope).toBeGreaterThan(0);
    expect(slope).toBeLessThan(2 * mu);          // softer than elastic
  });

  it('is pressure-insensitive: hydrostatic strain never yields, σ = 3K·a', () => {
    const a = 0.01;
    const r = radialReturnJ2([a, a, a, 0, 0, 0], zeroState(), mat);
    expect(r.plastic).toBe(false);
    expect(r.vonMises).toBeLessThan(1e-6);
    expect(r.stress[0]).toBeCloseTo(3 * Kbulk * a, 3);
    expect(r.state.alpha).toBe(0);
  });

  it('unloading is elastic (slope 2μ) and retains the accumulated plastic strain', () => {
    const { state } = shearSweep(3 * gY, 60);
    expect(state.alpha).toBeGreaterThan(0);                                 // yielded during loading
    expect(Math.abs(state.plasticStrain[3])).toBeGreaterThan(0);           // residual plastic shear
    // a small strain reversal from the loaded state is purely elastic.
    const atMax = radialReturnJ2([0, 0, 0, 3 * gY, 0, 0], state, mat);
    const down = radialReturnJ2([0, 0, 0, 3 * gY * 0.98, 0, 0], state, mat);
    expect(down.plastic).toBe(false);
    const slope = (atMax.stress[3] - down.stress[3]) / (3 * gY - 3 * gY * 0.98);
    expect(slope).toBeCloseTo(2 * mu, 4);
  });

  it('vonMisesStress agrees with the integrator (uniaxial stress σ → q = |σ|)', () => {
    expect(vonMisesStress([123, 0, 0, 0, 0, 0])).toBeCloseTo(123, 6);
    expect(vonMisesStress([50, 50, 50, 0, 0, 0])).toBeCloseTo(0, 6);       // hydrostatic → 0
  });
});
