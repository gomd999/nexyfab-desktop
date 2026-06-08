/**
 * nonlinearAnalysis.ts — Large-deformation + elastoplastic FEA.
 *
 * Stage 1 FEA (`displacement.ts`, `stressField.ts`) assumes:
 *   - Small displacements (geometric linearity)
 *   - Linear elastic stress-strain
 *
 * Real parts under high load violate both assumptions:
 *   - **Geometric nonlinearity** — large rotations / displacements
 *     change the stiffness matrix as the part deforms.
 *   - **Material nonlinearity** — once stress passes yield, the
 *     material flows plastically. Subsequent loading sees a lower
 *     effective modulus.
 *
 * SolidWorks Simulation Premium has both. NexyFab Stage 2 (here)
 * adds:
 *
 *   1. **Newton-Raphson incremental loading** — apply load in N
 *      steps, re-linearise tangent stiffness at each step.
 *   2. **Bilinear elastoplastic material model** — elastic up to
 *      σ_y, then strain-hardening at modulus E_t (= E × hardening
 *      ratio, typical 0.01–0.1).
 *   3. **Convergence diagnostics** — residual + step-size adaptation.
 *
 * We don't ship a full 3D nonlinear FE solver — that's a serious
 * undertaking. Instead we provide the *constitutive model* (per-
 * element stress integration) + the *incremental loading loop*. The
 * external solver supplies linear-elastic strain increments; this
 * module returns the nonlinear stress increment.
 */

export interface BilinearElastoPlastic {
  /** Elastic modulus (MPa). */
  E: number;
  /** Poisson's ratio. */
  nu: number;
  /** Yield stress (MPa). */
  yieldStrength: number;
  /** Tangent modulus (post-yield). MPa. Typical 0.01·E to 0.1·E. */
  tangentModulus: number;
}

export interface PlasticState {
  /** Accumulated plastic strain (von Mises equivalent). */
  plasticStrain: number;
  /** Current yield surface size (grows with strain hardening). */
  currentYield: number;
  /** Hydrostatic stress component. */
  hydroStress: number;
}

export function newPlasticState(material: BilinearElastoPlastic): PlasticState {
  return {
    plasticStrain: 0,
    currentYield: material.yieldStrength,
    hydroStress: 0,
  };
}

/** von Mises equivalent stress from principal stresses. */
export function vonMises(sigma1: number, sigma2: number, sigma3: number): number {
  return Math.sqrt(0.5 * (
    (sigma1 - sigma2) ** 2
    + (sigma2 - sigma3) ** 2
    + (sigma3 - sigma1) ** 2
  ));
}

/** Radial-return mapping algorithm — the standard plasticity update.
 *  Input: trial elastic stress (computed assuming purely elastic
 *  step). Output: corrected stress that lies on the yield surface
 *  + updated plastic state.
 *
 *  Returns:
 *    - newStress    (MPa, post-return)
 *    - newState     (updated plastic strain + yield surface)
 *    - plasticIncrement  (this step's plastic strain increment) */
export interface StressUpdateResult {
  newStress: { sigma1: number; sigma2: number; sigma3: number };
  newState: PlasticState;
  plasticIncrement: number;
  wasPlastic: boolean;
}

export function radialReturn(
  trialStress: { sigma1: number; sigma2: number; sigma3: number },
  state: PlasticState,
  material: BilinearElastoPlastic,
): StressUpdateResult {
  const vmTrial = vonMises(trialStress.sigma1, trialStress.sigma2, trialStress.sigma3);
  const f = vmTrial - state.currentYield;

  if (f <= 0) {
    // Elastic step — no plastic update.
    return {
      newStress: { ...trialStress },
      newState: { ...state },
      plasticIncrement: 0,
      wasPlastic: false,
    };
  }

  // Plastic step. Compute plastic multiplier dλ.
  // For bilinear material with isotropic hardening:
  //   dλ = f / (3G + E_t)   where G = E / (2(1+ν))
  const G = material.E / (2 * (1 + material.nu));
  const dLambda = f / (3 * G + material.tangentModulus);

  // Hydrostatic part (mean stress).
  const hydro = (trialStress.sigma1 + trialStress.sigma2 + trialStress.sigma3) / 3;
  // Deviatoric components.
  const s1 = trialStress.sigma1 - hydro;
  const s2 = trialStress.sigma2 - hydro;
  const s3 = trialStress.sigma3 - hydro;
  const sNorm = Math.sqrt(s1 * s1 + s2 * s2 + s3 * s3);
  // Direction of plastic flow (normal to yield surface).
  const n1 = sNorm > 0 ? s1 / sNorm : 0;
  const n2 = sNorm > 0 ? s2 / sNorm : 0;
  const n3 = sNorm > 0 ? s3 / sNorm : 0;
  // Stress reduction along flow direction.
  const scale = 3 * G * dLambda;
  const newS1 = s1 - scale * n1;
  const newS2 = s2 - scale * n2;
  const newS3 = s3 - scale * n3;

  return {
    newStress: {
      sigma1: hydro + newS1,
      sigma2: hydro + newS2,
      sigma3: hydro + newS3,
    },
    newState: {
      plasticStrain: state.plasticStrain + dLambda,
      currentYield: state.currentYield + material.tangentModulus * dLambda,
      hydroStress: hydro,
    },
    plasticIncrement: dLambda,
    wasPlastic: true,
  };
}

// ── Incremental loading ──────────────────────────────────────────

export interface LoadStep {
  /** Load scale factor (0..1 typically). */
  factor: number;
  /** Maximum allowed plastic strain in any element. */
  maxPlasticStrain?: number;
}

export interface IncrementalResult {
  steps: Array<{
    factor: number;
    converged: boolean;
    residual: number;
    iterationsUsed: number;
    maxPlasticStrain: number;
  }>;
  /** Final stress + plastic state at every element. */
  finalState: PlasticState[];
  /** True when every step converged. */
  fullyConverged: boolean;
}

export interface SolverCallback {
  /** Caller-supplied linear FE solve at the given load factor.
   *  Returns trial principal stresses per element. */
  (loadFactor: number, state: PlasticState[]): Array<{ sigma1: number; sigma2: number; sigma3: number }>;
}

/** Drive a nonlinear analysis through Newton-Raphson incremental
 *  loading. The caller's linear solver does the heavy lifting; this
 *  module sequences the load steps + applies plasticity at each one. */
export function runIncrementalLoading(
  initialStates: PlasticState[],
  material: BilinearElastoPlastic,
  loadSteps: LoadStep[],
  linearSolver: SolverCallback,
  maxIterPerStep: number = 20,
  convergenceTol: number = 1e-4,
): IncrementalResult {
  const states = initialStates.map(s => ({ ...s }));
  const steps: IncrementalResult['steps'] = [];
  let fullyConverged = true;

  for (const step of loadSteps) {
    let residual = Infinity;
    let iters = 0;
    let maxPlastic = 0;
    let converged = false;

    for (iters = 0; iters < maxIterPerStep; iters++) {
      const trialStresses = linearSolver(step.factor, states);
      let totalPlasticIncrement = 0;

      for (let i = 0; i < states.length; i++) {
        const r = radialReturn(trialStresses[i]!, states[i]!, material);
        states[i] = r.newState;
        totalPlasticIncrement += r.plasticIncrement;
        if (states[i]!.plasticStrain > maxPlastic) {
          maxPlastic = states[i]!.plasticStrain;
        }
      }

      residual = totalPlasticIncrement / Math.max(1, states.length);
      if (residual < convergenceTol) {
        converged = true;
        break;
      }
    }

    steps.push({
      factor: step.factor,
      converged,
      residual,
      iterationsUsed: iters,
      maxPlasticStrain: maxPlastic,
    });
    if (!converged) fullyConverged = false;
    if (step.maxPlasticStrain != null && maxPlastic > step.maxPlasticStrain) {
      break; // critical strain reached — stop
    }
  }

  return { steps, finalState: states, fullyConverged };
}

// ── Consistent (closed-form) 1D J2 return map ────────────────────

export interface Return1DResult {
  /** Stress after the return (MPa). */
  stress: number;
  /** Accumulated plastic strain. */
  plasticStrain: number;
  /** Yield-surface size (MPa). */
  yieldStress: number;
  /** Consistent (algorithmic) tangent modulus dσ/dε: E elastic, E·H/(E+H) plastic. */
  tangent: number;
  plastic: boolean;
}

/**
 * Closed-form 1D J2 return map for a STRAIN-controlled step with bilinear
 * isotropic hardening. Unlike {@link runIncrementalLoading}'s fixed-point loop
 * (geometric convergence — thousands of sweeps near the surface), this returns
 * the exact stress + plastic strain + CONSISTENT TANGENT (E_t = E·H/(E+H)) in
 * ONE evaluation. This is the Track-M depth the loop deferred, for the 1D case.
 *
 *   σ_trial = E·(ε − ε_p^old);  if |σ_trial| ≤ Y → elastic.
 *   else Δλ = (|σ_trial| − Y)/(E + H);  σ = σ_trial − E·Δλ·sign(σ_trial).
 */
export function consistentReturnMap1D(
  material: BilinearElastoPlastic,
  totalStrain: number,
  prevPlasticStrain: number,
  prevYield: number,
): Return1DResult {
  const E = material.E;
  const H = material.tangentModulus;
  const sigmaTrial = E * (totalStrain - prevPlasticStrain);
  const vm = Math.abs(sigmaTrial);
  if (vm <= prevYield) {
    return { stress: sigmaTrial, plasticStrain: prevPlasticStrain, yieldStress: prevYield, tangent: E, plastic: false };
  }
  const dLambda = (vm - prevYield) / (E + H);
  const sign = Math.sign(sigmaTrial) || 1;
  return {
    stress: sigmaTrial - E * dLambda * sign,
    plasticStrain: prevPlasticStrain + dLambda,
    yieldStress: prevYield + H * dLambda,
    tangent: (E * H) / (E + H),
    plastic: true,
  };
}

export interface BilinearPoint {
  strain: number;
  stress: number;
  plasticStrain: number;
  tangent: number;
}

/**
 * Strain-controlled uniaxial σ–ε curve via the consistent return map — one
 * closed-form step per strain level (no iteration). Reproduces the bilinear law
 * σ(ε) = σ_y0 + E_t·(ε − ε_y) exactly past yield.
 */
export function uniaxialBilinearCurve(material: BilinearElastoPlastic, strains: number[]): BilinearPoint[] {
  let ep = 0;
  let Y = material.yieldStrength;
  return strains.map((eps) => {
    const r = consistentReturnMap1D(material, eps, ep, Y);
    ep = r.plasticStrain;
    Y = r.yieldStress;
    return { strain: eps, stress: r.stress, plasticStrain: ep, tangent: r.tangent };
  });
}

// ── Uniaxial elastoplastic reference solver (benchmark for the loop) ──

export interface UniaxialPlasticStep {
  /** Applied uniaxial stress for this load level (MPa). */
  appliedStress: number;
  /** Accumulated equivalent plastic strain after this level. */
  plasticStrain: number;
  /** Yield-surface size after this level (MPa). */
  currentYield: number;
  converged: boolean;
}

export interface UniaxialPlasticResult {
  steps: UniaxialPlasticStep[];
  final: PlasticState;
  fullyConverged: boolean;
}

/**
 * Single-element, stress-controlled uniaxial elastoplastic test — the reference
 * benchmark that exercises {@link runIncrementalLoading} + {@link radialReturn}
 * as a COUPLED loop (not the mock-solver unit tests). Each applied stress level
 * is held while the return-mapping hardens the yield surface up to it; the
 * material follows the bilinear law `currentYield = σ_y0 + H·ε_p`.
 *
 * Note: this loop is a fixed-point return-map iteration (no consistent tangent),
 * so it converges GEOMETRICALLY (factor 3G/(3G+H)) — a high `maxIterPerStep` is
 * needed near the surface. A closed-form single-step return / Newton with the
 * consistent elastoplastic tangent is the remaining depth (Track M M4).
 */
export function uniaxialElastoPlastic(
  material: BilinearElastoPlastic,
  appliedStresses: number[],
  maxIterPerStep = 4000,
): UniaxialPlasticResult {
  const states = [newPlasticState(material)];
  const r = runIncrementalLoading(
    states,
    material,
    appliedStresses.map((s) => ({ factor: s })),
    // `factor` IS the applied uniaxial stress; return it as the trial σ₁.
    (factor) => [{ sigma1: factor, sigma2: 0, sigma3: 0 }],
    maxIterPerStep,
    1e-9,
  );
  return {
    steps: r.steps.map((s, i) => ({
      appliedStress: appliedStresses[i]!,
      plasticStrain: s.maxPlasticStrain,
      currentYield: material.yieldStrength + material.tangentModulus * s.maxPlasticStrain,
      converged: s.converged,
    })),
    final: r.finalState[0]!,
    fullyConverged: r.fullyConverged,
  };
}

// ── Geometric nonlinearity helpers ───────────────────────────────

/** Update the deformed configuration. For large displacements, the
 *  stiffness matrix should be recomputed in the deformed shape — this
 *  is the basis of the Updated Lagrangian formulation. */
export interface DeformedNode {
  /** Original position. */
  reference: [number, number, number];
  /** Displacement vector. */
  displacement: [number, number, number];
}

export function deformedPosition(node: DeformedNode): [number, number, number] {
  return [
    node.reference[0] + node.displacement[0],
    node.reference[1] + node.displacement[1],
    node.reference[2] + node.displacement[2],
  ];
}

/** Rotation matrix from a global rotation vector (Rodrigues). */
export function rodriguesRotation(axis: [number, number, number], angleRad: number): number[][] {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / len, y = axis[1] / len, z = axis[2] / len;
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  const t = 1 - c;
  return [
    [t * x * x + c,     t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c,     t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/** Estimate Green-Lagrange strain for a 1D bar from displacements. */
export function greenLagrangeStrain1D(originalLengthMm: number, currentLengthMm: number): number {
  // E = (L² - L₀²) / (2·L₀²)
  return (currentLengthMm * currentLengthMm - originalLengthMm * originalLengthMm)
    / (2 * originalLengthMm * originalLengthMm);
}
