/**
 * mohrCoulomb.ts — the Mohr-Coulomb failure criterion for soils, rock and frictional
 * materials (pressure-dependent, unlike von Mises). On a plane τ = c + σ_n·tanφ;
 * in principal stresses (σ1 ≥ σ3, compression positive):
 *
 *   (σ1 − σ3)/2 = c·cosφ + ((σ1 + σ3)/2)·sinφ
 *   σ1 = σ3·N_φ + 2c·√N_φ,   N_φ = (1+sinφ)/(1−sinφ) = tan²(45°+φ/2)
 *
 * Uniaxial strengths: compressive σc = 2c·cosφ/(1−sinφ) = 2c√N_φ; tensile
 * σt = 2c·cosφ/(1+sinφ). At φ=0 it reduces to Tresca (max shear = c). Verified.
 */

/** Flow factor N_φ = (1+sinφ)/(1−sinφ). */
export function flowFactor(phi: number): number {
  return (1 + Math.sin(phi)) / (1 - Math.sin(phi));
}

/** Mohr-Coulomb yield function f (≤0 safe, =0 at failure). */
export function yieldFunction(s1: number, s3: number, c: number, phi: number): number {
  return (s1 - s3) / 2 - c * Math.cos(phi) - ((s1 + s3) / 2) * Math.sin(phi);
}

/** Major principal stress at failure for a given confining stress σ3. */
export function failureStress1(s3: number, c: number, phi: number): number {
  const N = flowFactor(phi);
  return s3 * N + 2 * c * Math.sqrt(N);
}

/** Uniaxial compressive strength σc = 2c·cosφ/(1−sinφ). */
export function uniaxialCompressiveStrength(c: number, phi: number): number {
  return (2 * c * Math.cos(phi)) / (1 - Math.sin(phi));
}

/** Uniaxial tensile strength (cohesion-limited) σt = 2c·cosφ/(1+sinφ). */
export function uniaxialTensileStrength(c: number, phi: number): number {
  return (2 * c * Math.cos(phi)) / (1 + Math.sin(phi));
}
