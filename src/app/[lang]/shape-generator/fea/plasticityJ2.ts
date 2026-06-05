/**
 * plasticityJ2.ts — small-strain J2 (von Mises) elastoplasticity with linear
 * isotropic hardening, integrated by the RADIAL-RETURN (closest-point projection)
 * algorithm — the constitutive heart of nonlinear structural FEA.
 *
 *   yield:    f = q − (σ_y0 + H·α),   q = √(3/2)‖dev σ‖   (von Mises stress)
 *   flow:     associative (plastic flow ∥ deviatoric stress), pressure-insensitive
 *   harden:   σ_y(α) = σ_y0 + H·α     (α = accumulated equivalent plastic strain)
 *
 * The elastic predictor is projected radially back onto the yield surface; the
 * consistency condition q = σ_y(α) holds exactly after the return. Verified at the
 * material point against the analytic responses (pure shear bilinear curve, von
 * Mises shear yield τ_y = σ_y/√3, pressure-insensitivity, elastic unloading).
 *
 * Strain/stress are symmetric-tensor 6-vectors [xx, yy, zz, xy, yz, zx] with TENSOR
 * shear components (not engineering); norms carry the factor 2 on shear terms.
 * The algorithmic tangent and a global Newton driver are a documented follow-up —
 * this module supplies and verifies the material-point integrator.
 */

export interface J2Material {
  E: number;        // Young's modulus
  nu: number;       // Poisson ratio
  yield0: number;   // initial yield stress σ_y0
  hardening: number; // linear isotropic hardening modulus H (0 = perfectly plastic)
}

export interface PlasticState {
  /** Deviatoric plastic strain tensor [xx,yy,zz,xy,yz,zx]. */
  plasticStrain: Float64Array;
  /** Accumulated equivalent plastic strain α. */
  alpha: number;
}

export interface ReturnResult {
  /** Updated Cauchy stress [xx,yy,zz,xy,yz,zx]. */
  stress: Float64Array;
  state: PlasticState;
  /** Plastic multiplier increment Δγ this step (0 ⇒ elastic). */
  dGamma: number;
  /** von Mises stress after the return (= σ_y(α) when plastic). */
  vonMises: number;
  plastic: boolean;
}

export function zeroState(): PlasticState {
  return { plasticStrain: new Float64Array(6), alpha: 0 };
}

/** Tensor inner product s:t with the factor 2 on the (xy,yz,zx) shear terms. */
function ddot(s: ArrayLike<number>, t: ArrayLike<number>): number {
  return s[0] * t[0] + s[1] * t[1] + s[2] * t[2] + 2 * (s[3] * t[3] + s[4] * t[4] + s[5] * t[5]);
}

/**
 * Radial-return integration of one strain state. Given the TOTAL strain and the
 * plastic state at the start of the step, returns the updated stress and state.
 */
export function radialReturnJ2(strain: ArrayLike<number>, state: PlasticState, mat: J2Material): ReturnResult {
  const mu = mat.E / (2 * (1 + mat.nu));
  const K = mat.E / (3 * (1 - 2 * mat.nu));
  const H = mat.hardening;

  // volumetric / deviatoric split of the total strain
  const trEps = strain[0] + strain[1] + strain[2];
  const p = K * trEps;                       // hydrostatic stress (plastic-independent)
  const devEps = [
    strain[0] - trEps / 3, strain[1] - trEps / 3, strain[2] - trEps / 3,
    strain[3], strain[4], strain[5],
  ];

  // trial deviatoric stress s = 2μ (devEps − εp)
  const ep = state.plasticStrain;
  const sTrial = new Float64Array(6);
  for (let i = 0; i < 6; i++) sTrial[i] = 2 * mu * (devEps[i] - ep[i]);
  const normTrial = Math.sqrt(ddot(sTrial, sTrial));
  const qTrial = Math.sqrt(1.5) * normTrial;
  const sigY = mat.yield0 + H * state.alpha;

  const stress = new Float64Array(6);
  if (qTrial <= sigY || normTrial < 1e-300) {
    // elastic
    for (let i = 0; i < 6; i++) stress[i] = sTrial[i];
    stress[0] += p; stress[1] += p; stress[2] += p;
    return { stress, state, dGamma: 0, vonMises: qTrial, plastic: false };
  }

  // plastic: radial return. Δγ from the consistency condition q − 3μΔγ = σ_y0+H(α+Δγ).
  const dGamma = (qTrial - sigY) / (3 * mu + H);
  const alphaNew = state.alpha + dGamma;
  const factor = 1 - (3 * mu * dGamma) / qTrial;   // scales the deviatoric stress back
  const sNew = new Float64Array(6);
  for (let i = 0; i < 6; i++) sNew[i] = sTrial[i] * factor;

  // plastic strain increment Δεp = Δγ·√(3/2)·n, n = sTrial/‖sTrial‖
  const cp = dGamma * Math.sqrt(1.5) / normTrial;
  const epNew = new Float64Array(6);
  for (let i = 0; i < 6; i++) epNew[i] = ep[i] + cp * sTrial[i];

  for (let i = 0; i < 6; i++) stress[i] = sNew[i];
  stress[0] += p; stress[1] += p; stress[2] += p;
  const vm = Math.sqrt(1.5) * Math.sqrt(ddot(sNew, sNew));
  return { stress, state: { plasticStrain: epNew, alpha: alphaNew }, dGamma, vonMises: vm, plastic: true };
}

/** von Mises stress of a stress tensor [xx,yy,zz,xy,yz,zx]. */
export function vonMisesStress(stress: ArrayLike<number>): number {
  const tr = (stress[0] + stress[1] + stress[2]) / 3;
  const s = [stress[0] - tr, stress[1] - tr, stress[2] - tr, stress[3], stress[4], stress[5]];
  return Math.sqrt(1.5) * Math.sqrt(ddot(s, s));
}
