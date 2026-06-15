/**
 * creep.ts — secondary (steady-state) CREEP / viscoplasticity by the multiaxial
 * Norton power law:
 *
 *   ε̇_cr = (3/2) A q^{n−1} s          (q = von Mises stress, s = deviatoric stress)
 *
 * The flow is deviatoric (isochoric) and driven by the von Mises stress, so under
 * uniaxial stress it reduces to the classic ε̇_cr = A σⁿ. Verified against the exact
 * solutions: constant-stress creep accumulates strain linearly in time, and a
 * bar held at constant strain relaxes as σ(t) = σ₀e^{−EAt} (n=1) or the power-law
 * relaxation (n>1).
 *
 * Tensor 6-vector [xx,yy,zz,xy,yz,zx]; norms carry ×2 on shear terms.
 */

export interface NortonMaterial {
  A: number;   // Norton coefficient
  n: number;   // Norton exponent (≥ 1)
}

function ddot(s: ArrayLike<number>): number {
  return s[0] * s[0] + s[1] * s[1] + s[2] * s[2] + 2 * (s[3] * s[3] + s[4] * s[4] + s[5] * s[5]);
}

/** Multiaxial Norton creep strain-rate tensor for a stress state. */
export function creepStrainRate(stress: ArrayLike<number>, mat: NortonMaterial): Float64Array {
  const tr = (stress[0] + stress[1] + stress[2]) / 3;
  const s = [stress[0] - tr, stress[1] - tr, stress[2] - tr, stress[3], stress[4], stress[5]];
  const q = Math.sqrt(1.5 * ddot(s));
  const rate = new Float64Array(6);
  if (q < 1e-300) return rate;
  const f = 1.5 * mat.A * Math.pow(q, mat.n - 1);
  for (let i = 0; i < 6; i++) rate[i] = f * s[i];
  return rate;
}

/** Equivalent (von Mises) creep strain rate ε̇_eq = A qⁿ. */
export function equivalentCreepRate(vonMises: number, mat: NortonMaterial): number {
  return mat.A * Math.pow(vonMises, mat.n);
}

/** Constant-stress uniaxial creep: returns the axial creep strain history. */
export function creepUniaxial(sigma: number, mat: NortonMaterial, dt: number, steps: number): number[] {
  const out: number[] = [0];
  let ecr = 0;
  const stress = [sigma, 0, 0, 0, 0, 0];
  for (let k = 0; k < steps; k++) { ecr += creepStrainRate(stress, mat)[0] * dt; out.push(ecr); }
  return out;
}

/**
 * Uniaxial stress relaxation at constant total strain: ε = σ/E + ε_cr held fixed ⇒
 * dσ/dt = −E·ε̇_cr = −E·A·σⁿ. Integrated by backward Euler (scalar Newton each step).
 */
export function relaxUniaxial(sigma0: number, E: number, mat: NortonMaterial, dt: number, steps: number): { t: number[]; sigma: number[] } {
  const t = [0], sigma = [sigma0];
  let s = sigma0;
  for (let k = 0; k < steps; k++) {
    // solve s_{k+1} + dt·E·A·s_{k+1}ⁿ = s_k  (Newton on x)
    let x = s;
    for (let it = 0; it < 50; it++) {
      const f = x + dt * E * mat.A * Math.pow(x, mat.n) - s;
      const df = 1 + dt * E * mat.A * mat.n * Math.pow(x, mat.n - 1);
      const dx = f / df;
      x -= dx;
      if (Math.abs(dx) < 1e-12 * Math.max(1, x)) break;
    }
    s = x;
    t.push((k + 1) * dt); sigma.push(s);
  }
  return { t, sigma };
}
