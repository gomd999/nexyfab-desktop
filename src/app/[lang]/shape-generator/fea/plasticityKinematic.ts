/**
 * plasticityKinematic.ts — J2 plasticity with COMBINED isotropic + linear KINEMATIC
 * (Prager) hardening, by radial return. Kinematic hardening translates the yield
 * surface (back-stress α) instead of only expanding it, capturing the BAUSCHINGER
 * effect: after forward yielding, reverse yielding starts early.
 *
 *   relative stress:  ξ = dev(σ) − α        (α = deviatoric back-stress)
 *   yield:            f = √(3/2)‖ξ‖ − (σ_y0 + H_iso·ᾱ)
 *   isotropic:        the surface grows by H_iso·ᾱ   (ᾱ = accumulated plastic strain)
 *   kinematic:        the surface centre moves, dα = (2/3) H_kin dε_p   (Prager)
 *
 * Pure isotropic ⇒ reverse-yield elastic span grows as 2σ_y(ᾱ); pure kinematic ⇒ it
 * stays 2σ_y0 (early reverse yield). The monotonic curve is identical for the same
 * total H = H_iso + H_kin. Verified against both signatures with a shear cycle.
 *
 * Symmetric-tensor 6-vector [xx,yy,zz,xy,yz,zx], tensor shear; norms carry ×2 on shear.
 */
import { J2Material } from './plasticityJ2';

export interface KinematicMaterial extends Omit<J2Material, 'hardening'> {
  /** Isotropic hardening modulus (surface expansion). */
  isoHardening: number;
  /** Kinematic hardening modulus (surface translation / Bauschinger). */
  kinHardening: number;
}

export interface CyclicState {
  plasticStrain: Float64Array;   // deviatoric plastic strain
  backStress: Float64Array;      // deviatoric back-stress α
  alpha: number;                 // accumulated equivalent plastic strain ᾱ
}

export interface CyclicReturnResult {
  stress: Float64Array;
  state: CyclicState;
  dGamma: number;
  plastic: boolean;
}

export function zeroCyclicState(): CyclicState {
  return { plasticStrain: new Float64Array(6), backStress: new Float64Array(6), alpha: 0 };
}

function ddot(s: ArrayLike<number>, t: ArrayLike<number>): number {
  return s[0] * t[0] + s[1] * t[1] + s[2] * t[2] + 2 * (s[3] * t[3] + s[4] * t[4] + s[5] * t[5]);
}

/** Combined isotropic/kinematic radial return for a total strain state. */
export function radialReturnKinematic(strain: ArrayLike<number>, state: CyclicState, mat: KinematicMaterial): CyclicReturnResult {
  const mu = mat.E / (2 * (1 + mat.nu));
  const K = mat.E / (3 * (1 - 2 * mat.nu));
  const Hiso = mat.isoHardening, Hkin = mat.kinHardening;

  const trEps = strain[0] + strain[1] + strain[2];
  const p = K * trEps;
  const devEps = [strain[0] - trEps / 3, strain[1] - trEps / 3, strain[2] - trEps / 3, strain[3], strain[4], strain[5]];
  const ep = state.plasticStrain, bs = state.backStress;

  // trial deviatoric + relative stress
  const sTrial = new Float64Array(6);
  for (let i = 0; i < 6; i++) sTrial[i] = 2 * mu * (devEps[i] - ep[i]);
  const xi = new Float64Array(6);
  for (let i = 0; i < 6; i++) xi[i] = sTrial[i] - bs[i];
  const normXi = Math.sqrt(ddot(xi, xi));
  const q = Math.sqrt(1.5) * normXi;
  const sigY = mat.yield0 + Hiso * state.alpha;

  const stress = new Float64Array(6);
  if (q <= sigY || normXi < 1e-300) {
    for (let i = 0; i < 6; i++) stress[i] = sTrial[i];
    stress[0] += p; stress[1] += p; stress[2] += p;
    return { stress, state, dGamma: 0, plastic: false };
  }

  const dGamma = (q - sigY) / (3 * mu + Hkin + Hiso);
  const n = new Float64Array(6);
  for (let i = 0; i < 6; i++) n[i] = xi[i] / normXi;
  // plastic strain Δε_p = Δγ√(3/2)·n ; back-stress Δα = (2/3)H_kin Δε_p
  const cPl = dGamma * Math.sqrt(1.5);
  const epNew = new Float64Array(6), bsNew = new Float64Array(6);
  for (let i = 0; i < 6; i++) { epNew[i] = ep[i] + cPl * n[i]; bsNew[i] = bs[i] + (2 / 3) * Hkin * cPl * n[i]; }
  // deviatoric stress: s = s_trial − 2μ·Δγ√(3/2)·n
  const sNew = new Float64Array(6);
  for (let i = 0; i < 6; i++) sNew[i] = sTrial[i] - 2 * mu * cPl * n[i];
  for (let i = 0; i < 6; i++) stress[i] = sNew[i];
  stress[0] += p; stress[1] += p; stress[2] += p;
  return { stress, state: { plasticStrain: epNew, backStress: bsNew, alpha: state.alpha + dGamma }, dGamma, plastic: true };
}
