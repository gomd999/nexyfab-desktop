/**
 * mooneyRivlin.ts — incompressible MOONEY-RIVLIN hyperelasticity, the two-parameter
 * generalisation of Neo-Hookean: W = C10(I1−3) + C01(I2−3). The Cauchy stress is
 *
 *   σ = −p·I + 2·C10·B − 2·C01·B⁻¹,   B = F·Fᵀ,   det F = 1
 *
 * Neo-Hookean is the special case C01 = 0 (with μ = 2·C10). The extra C01 term shapes
 * the large-stretch response while keeping simple shear exactly linear. Verified
 * against the closed-form uniaxial σ = 2(λ²−1/λ)(C10+C01/λ), the Neo-Hookean
 * reduction, simple shear τ = 2(C10+C01)γ, and the small-strain modulus μ = 2(C10+C01).
 */

type Mat3 = number[][];

function transpose(A: Mat3): Mat3 { return A[0].map((_, j) => A.map((row) => row[j])); }
function mul(A: Mat3, B: Mat3): Mat3 { return A.map((row, i) => B[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0))); }
function det3(A: Mat3): number {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}
function inv3(A: Mat3): Mat3 {
  const d = det3(A);
  const c = [
    [A[1][1] * A[2][2] - A[1][2] * A[2][1], A[0][2] * A[2][1] - A[0][1] * A[2][2], A[0][1] * A[1][2] - A[0][2] * A[1][1]],
    [A[1][2] * A[2][0] - A[1][0] * A[2][2], A[0][0] * A[2][2] - A[0][2] * A[2][0], A[0][2] * A[1][0] - A[0][0] * A[1][2]],
    [A[1][0] * A[2][1] - A[1][1] * A[2][0], A[0][1] * A[2][0] - A[0][0] * A[2][1], A[0][0] * A[1][1] - A[0][1] * A[1][0]],
  ];
  return c.map((row) => row.map((v) => v / d));
}

/** Cauchy stress σ = 2·C10·B − 2·C01·B⁻¹ − p·I for a deformation gradient F. */
export function cauchyStress(F: Mat3, C10: number, C01: number, p: number): Mat3 {
  const B = mul(F, transpose(F)), Bi = inv3(B);
  return B.map((row, i) => row.map((_v, j) => 2 * C10 * B[i][j] - 2 * C01 * Bi[i][j] - (i === j ? p : 0)));
}

export function jacobian(F: Mat3): number { return det3(F); }

/** Incompressible uniaxial tension at stretch λ. */
export function uniaxialStress(lambda: number, C10: number, C01: number): number {
  const lt = 1 / Math.sqrt(lambda);
  const F: Mat3 = [[lambda, 0, 0], [0, lt, 0], [0, 0, lt]];
  const p = 2 * C10 * (1 / lambda) - 2 * C01 * lambda;   // σ22 = 0
  return cauchyStress(F, C10, C01, p)[0][0];
}

/** Incompressible simple shear γ. */
export function simpleShear(gamma: number, C10: number, C01: number): { shear: number; jacobian: number } {
  const F: Mat3 = [[1, gamma, 0], [0, 1, 0], [0, 0, 1]];
  const p = 2 * C10 - 2 * C01;                           // σ33 = 0 (B33=1, B⁻¹33=1)
  const s = cauchyStress(F, C10, C01, p);
  return { shear: s[0][1], jacobian: det3(F) };
}

/** Small-strain shear modulus μ = 2(C10 + C01). */
export function shearModulus(C10: number, C01: number): number { return 2 * (C10 + C01); }
