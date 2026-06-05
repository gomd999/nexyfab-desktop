/**
 * neoHookean.ts — incompressible Neo-Hookean HYPERELASTICITY (large-strain rubber).
 * The Cauchy stress is
 *
 *   σ = −p·I + μ·B,   B = F·Fᵀ (left Cauchy-Green),   det F = 1 (incompressible)
 *
 * where the hydrostatic pressure p is set by the loading (e.g. a traction-free
 * lateral face). Verified against the closed-form homogeneous deformations:
 * uniaxial σ = μ(λ²−1/λ), equibiaxial σ = μ(λ²−1/λ⁴), simple shear τ = μγ (exactly
 * linear), and the small-strain limit E = 3μ.
 */

type Mat3 = number[][];

function mul(A: Mat3, B: Mat3): Mat3 {
  return A.map((row, i) => B[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
}
function transpose(A: Mat3): Mat3 { return A[0].map((_, j) => A.map((row) => row[j])); }
function det3(A: Mat3): number {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
    - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
    + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}

/** Left Cauchy-Green tensor B = F·Fᵀ. */
export function leftCauchyGreen(F: Mat3): Mat3 { return mul(F, transpose(F)); }

/** Cauchy stress σ = μ·B − p·I for a deformation gradient F. */
export function cauchyStress(F: Mat3, mu: number, p: number): Mat3 {
  const B = leftCauchyGreen(F);
  return B.map((row, i) => row.map((v, j) => mu * v - (i === j ? p : 0)));
}

export function jacobian(F: Mat3): number { return det3(F); }

/** Incompressible uniaxial tension: stretch λ along x. Returns the axial Cauchy stress. */
export function uniaxialStress(lambda: number, mu: number): number {
  const lt = 1 / Math.sqrt(lambda);                 // lateral stretch (incompressible)
  const F: Mat3 = [[lambda, 0, 0], [0, lt, 0], [0, 0, lt]];
  // σ22 = 0 ⇒ p = μ·B22 = μ/λ ; σ11 = μλ² − p.
  const p = mu * (1 / lambda);
  return cauchyStress(F, mu, p)[0][0];
}

/** Incompressible equibiaxial tension: stretch λ in x and y. Returns the in-plane stress. */
export function equibiaxialStress(lambda: number, mu: number): number {
  const lz = 1 / (lambda * lambda);
  const F: Mat3 = [[lambda, 0, 0], [0, lambda, 0], [0, 0, lz]];
  const p = mu * (lz * lz);                          // σ33 = 0 ⇒ p = μ·B33 = μ/λ⁴
  return cauchyStress(F, mu, p)[0][0];
}

/** Incompressible simple shear γ. Returns shear stress and first normal-stress difference. */
export function simpleShear(gamma: number, mu: number): { shear: number; N1: number; jacobian: number } {
  const F: Mat3 = [[1, gamma, 0], [0, 1, 0], [0, 0, 1]];
  const p = mu;                                      // σ33 = 0 ⇒ p = μ·B33 = μ
  const s = cauchyStress(F, mu, p);
  return { shear: s[0][1], N1: s[0][0] - s[1][1], jacobian: det3(F) };
}
