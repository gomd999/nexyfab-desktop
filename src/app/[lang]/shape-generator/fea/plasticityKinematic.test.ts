/**
 * plasticityKinematic — combined isotropic/kinematic J2 hardening, verified with a
 * shear cycle against both signatures: the monotonic curve is identical for the
 * same total hardening, but on reversal kinematic hardening yields early (constant
 * elastic span 2τ_y0 — the Bauschinger effect) while isotropic hardening yields late
 * (span 2τ_y(ᾱ), grown by the accumulated plastic strain).
 */
import { describe, it, expect } from 'vitest';
import { radialReturnKinematic, zeroCyclicState, KinematicMaterial } from './plasticityKinematic';

const base = { E: 210000, nu: 0.3, yield0: 250 };
const mu = base.E / (2 * (1 + base.nu));
const tauY = base.yield0 / Math.sqrt(3);
const gY = tauY / (2 * mu);               // tensor shear strain at yield

/** Shear cycle 0 → gMax → −gMax; returns peak stress, accumulated plastic, reverse span. */
function shearCycle(iso: number, kin: number) {
  const mat: KinematicMaterial = { ...base, isoHardening: iso, kinHardening: kin };
  let st = zeroCyclicState();
  const gMax = 8 * gY, N = 400;
  let sMax = 0;
  for (let i = 1; i <= N; i++) { const g = (gMax * i) / N; const r = radialReturnKinematic([0, 0, 0, g, 0, 0], st, mat); st = r.state; sMax = r.stress[3]; }
  const aMax = st.alpha;
  // reverse: elastic span until plasticity resumes.
  let revYield = sMax;
  for (let i = 1; i <= 2 * N; i++) {
    const g = gMax - (2 * gMax * i) / (2 * N);
    const r = radialReturnKinematic([0, 0, 0, g, 0, 0], st, mat); st = r.state;
    if (r.plastic) break;
    revYield = r.stress[3];
  }
  return { sMax, aMax, span: sMax - revYield };
}

describe('plasticityKinematic — Bauschinger effect (verified)', () => {
  const kin = shearCycle(0, 50000);
  const iso = shearCycle(50000, 0);
  const comb = shearCycle(25000, 25000);

  it('the monotonic curve is identical for the same total hardening H', () => {
    expect(kin.sMax).toBeCloseTo(iso.sMax, 4);
    expect(comb.sMax).toBeCloseTo(iso.sMax, 4);
  });

  it('kinematic hardening: reverse elastic span stays 2·τ_y0 (early reverse yield)', () => {
    expect(kin.span / (2 * tauY)).toBeGreaterThan(0.97);
    expect(kin.span / (2 * tauY)).toBeLessThan(1.02);
  });

  it('isotropic hardening: reverse span grows to 2·τ_y(ᾱ)', () => {
    const expected = 2 * (base.yield0 + 50000 * iso.aMax) / Math.sqrt(3);
    expect(iso.span / expected).toBeGreaterThan(0.97);
    expect(iso.span / expected).toBeLessThan(1.02);
  });

  it('Bauschinger: kinematic yields far earlier on reversal than isotropic', () => {
    expect(kin.span).toBeLessThan(iso.span * 0.6);     // markedly smaller elastic span
    // combined hardening lies between the two limits.
    expect(comb.span).toBeGreaterThan(kin.span);
    expect(comb.span).toBeLessThan(iso.span);
  });
});
