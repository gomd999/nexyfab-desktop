/**
 * j2ReturnMap3D — 3D J2 (von Mises) radial-return constitutive integrator with
 * an algorithmic consistent tangent. This is the per-Gauss-point stress update a
 * TET10 elastoplastic FEM calls (the 3D generalisation of the 1D
 * `consistentReturnMap1D`): it takes a total strain, returns the stress that
 * lies on the (hardened) yield surface, the updated plastic state, and the
 * tangent dσ/dε for the global Newton solve.
 *
 * Voigt convention: 6-vectors ordered [xx, yy, zz, xy, yz, zx]; STRAIN uses
 * ENGINEERING shear (γ = 2ε). Linear isotropic hardening: Y = σy0 + H·α.
 *
 * Radial return (stress space):
 *   σ_tr = Dₑ·(ε − εₚ);  s = dev σ_tr;  q = √(3/2 s:s)
 *   f = q − Y;  if f ≤ 0 elastic.  else Δγ = f/(3G+H),
 *   σ = s·(1 − 3G·Δγ/q) + p·I,  Δεₚ = Dₑ⁻¹·(σ_tr − σ),  α += Δγ.
 * Then q(σ) = Y + H·Δγ exactly (stress lands on the grown surface).
 */

export type Voigt6 = [number, number, number, number, number, number];
export type Mat6 = number[][]; // 6×6

export interface ElastoPlasticMaterial {
  E: number;
  nu: number;
  yieldStrength: number;   // σy0 (MPa)
  hardeningModulus: number; // H (MPa)
}

export interface J2State {
  /** Plastic strain (Voigt, engineering shear). */
  plasticStrain: Voigt6;
  /** Accumulated equivalent plastic strain α. */
  alpha: number;
}

export interface J2Result {
  stress: Voigt6;
  state: J2State;
  /** Yield-surface size after the step (MPa). */
  yieldStress: number;
  /** Equivalent plastic strain increment this step. */
  dGamma: number;
  plastic: boolean;
  /** Algorithmic tangent dσ/dε (6×6). */
  tangent: Mat6;
}

export function zeroState(): J2State {
  return { plasticStrain: [0, 0, 0, 0, 0, 0], alpha: 0 };
}

/** Isotropic elastic stiffness (Voigt, engineering shear). */
export function elasticD(E: number, nu: number): Mat6 {
  const mu = E / (2 * (1 + nu));
  const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu));
  const a = lam + 2 * mu;
  return [
    [a, lam, lam, 0, 0, 0],
    [lam, a, lam, 0, 0, 0],
    [lam, lam, a, 0, 0, 0],
    [0, 0, 0, mu, 0, 0],
    [0, 0, 0, 0, mu, 0],
    [0, 0, 0, 0, 0, mu],
  ];
}

function matVec(D: Mat6, e: Voigt6): Voigt6 {
  const o: Voigt6 = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) {
    let s = 0;
    for (let j = 0; j < 6; j++) s += D[i]![j]! * e[j]!;
    o[i] = s;
  }
  return o;
}

function deviator(sig: Voigt6): { s: Voigt6; p: number } {
  const p = (sig[0] + sig[1] + sig[2]) / 3;
  return { s: [sig[0] - p, sig[1] - p, sig[2] - p, sig[3], sig[4], sig[5]], p };
}

/** von Mises stress from a (deviatoric or full) stress: q = √(3/2 s:s). */
export function vonMisesVoigt(sig: Voigt6): number {
  const { s } = deviator(sig);
  const ss = s[0] * s[0] + s[1] * s[1] + s[2] * s[2] + 2 * (s[3] * s[3] + s[4] * s[4] + s[5] * s[5]);
  return Math.sqrt(1.5 * ss);
}

/** The stress-only return (no tangent) — reused for the numerical tangent. */
function returnStress(strain: Voigt6, prev: J2State, m: ElastoPlasticMaterial, D: Mat6, mu: number): {
  stress: Voigt6; state: J2State; yieldStress: number; dGamma: number; plastic: boolean;
} {
  const eMinusEp: Voigt6 = [
    strain[0] - prev.plasticStrain[0], strain[1] - prev.plasticStrain[1], strain[2] - prev.plasticStrain[2],
    strain[3] - prev.plasticStrain[3], strain[4] - prev.plasticStrain[4], strain[5] - prev.plasticStrain[5],
  ];
  const sigTrial = matVec(D, eMinusEp);
  const { s: sTrial, p } = deviator(sigTrial);
  const q = vonMisesVoigt(sigTrial);
  const Y = m.yieldStrength + m.hardeningModulus * prev.alpha;
  const f = q - Y;
  if (f <= 0 || q < 1e-12) {
    return { stress: sigTrial, state: prev, yieldStress: Y, dGamma: 0, plastic: false };
  }
  const dGamma = f / (3 * mu + m.hardeningModulus);
  const scale = 1 - (3 * mu * dGamma) / q;
  const sNew: Voigt6 = [sTrial[0] * scale, sTrial[1] * scale, sTrial[2] * scale, sTrial[3] * scale, sTrial[4] * scale, sTrial[5] * scale];
  const stress: Voigt6 = [sNew[0] + p, sNew[1] + p, sNew[2] + p, sNew[3], sNew[4], sNew[5]];
  // Δεp = Dₑ⁻¹·(σ_tr − σ); the difference is purely deviatoric (Δσ = sTrial·(1−scale)).
  const k = (3 * mu * dGamma) / q; // 1 − scale
  const dEp: Voigt6 = [
    (sTrial[0] * k) / (2 * mu), (sTrial[1] * k) / (2 * mu), (sTrial[2] * k) / (2 * mu),
    (sTrial[3] * k) / mu, (sTrial[4] * k) / mu, (sTrial[5] * k) / mu,
  ];
  const state: J2State = {
    plasticStrain: [
      prev.plasticStrain[0] + dEp[0], prev.plasticStrain[1] + dEp[1], prev.plasticStrain[2] + dEp[2],
      prev.plasticStrain[3] + dEp[3], prev.plasticStrain[4] + dEp[4], prev.plasticStrain[5] + dEp[5],
    ],
    alpha: prev.alpha + dGamma,
  };
  return { stress, state, yieldStress: Y + m.hardeningModulus * dGamma, dGamma, plastic: true };
}

/**
 * 3D J2 radial return + algorithmic consistent tangent. The tangent is computed
 * by forward-differencing the return-map stress wrt each strain component — the
 * EXACT dσ/dε of the discrete update (what guarantees Newton's quadratic
 * convergence), avoiding the error-prone closed-form Voigt operator.
 */
export function returnMapJ2_3D(strain: Voigt6, prev: J2State, m: ElastoPlasticMaterial): J2Result {
  const D = elasticD(m.E, m.nu);
  const mu = m.E / (2 * (1 + m.nu));
  const base = returnStress(strain, prev, m, D, mu);

  // Algorithmic tangent via CENTRAL differences (O(h²)) — the exact dσ/dε of the
  // discrete update, accurate enough to recover the symmetry associative J2
  // guarantees (a forward difference's O(h) truncation breaks it by ~%).
  const h = 1e-7;
  const tangent: Mat6 = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let j = 0; j < 6; j++) {
    const eP = [...strain] as Voigt6;
    const eM = [...strain] as Voigt6;
    eP[j] += h;
    eM[j] -= h;
    const sp = returnStress(eP, prev, m, D, mu).stress;
    const sm = returnStress(eM, prev, m, D, mu).stress;
    for (let i = 0; i < 6; i++) tangent[i]![j] = (sp[i]! - sm[i]!) / (2 * h);
  }

  return {
    stress: base.stress,
    state: base.state,
    yieldStress: base.yieldStress,
    dGamma: base.dGamma,
    plastic: base.plastic,
    tangent,
  };
}
