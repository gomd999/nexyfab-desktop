/**
 * boundaryLayer — Blasius laminar flat-plate boundary layer, verified: the √x growth of
 * δ; the fixed Blasius shape ratios (δ-star over δ ≈ 0.344, θ over δ ≈ 0.133); the wall-shear identity
 * τ_w = ½ρU²·C_f; and the plate-average C_D = 2·C_f(L).
 */
import { describe, it, expect } from 'vitest';
import { reynoldsX, blasiusThickness, displacementThickness, momentumThickness, wallShearStress, skinFrictionLocal, dragCoefficientPlate } from './boundaryLayer';

describe('boundaryLayer — Blasius solution (verified)', () => {
  const U = 10, nu = 1.5e-5, x = 0.5;
  const Rex = reynoldsX(U, x, nu);

  it('grows the boundary-layer thickness like √x', () => {
    const ratio = blasiusThickness(2 * x, reynoldsX(U, 2 * x, nu)) / blasiusThickness(x, Rex);
    expect(ratio).toBeCloseTo(Math.SQRT2, 9);              // δ ∝ √x
  });

  it('has the fixed Blasius shape ratios δ*/δ and θ/δ', () => {
    expect(displacementThickness(x, Rex) / blasiusThickness(x, Rex)).toBeCloseTo(1.721 / 5.0, 9); // 0.3442
    expect(momentumThickness(x, Rex) / blasiusThickness(x, Rex)).toBeCloseTo(0.664 / 5.0, 9);     // 0.1328
  });

  it('satisfies the wall-shear identity τ_w = ½ρU²·C_f', () => {
    const rho = 1.225;
    expect(wallShearStress(rho, U, Rex)).toBeCloseTo(0.5 * rho * U * U * skinFrictionLocal(Rex), 9);
  });

  it('has plate-average drag C_D = 2·C_f(L)', () => {
    expect(dragCoefficientPlate(Rex)).toBeCloseTo(2 * skinFrictionLocal(Rex), 12); // 1.328 = 2·0.664
    // higher Reynolds ⇒ lower friction coefficient
    expect(dragCoefficientPlate(4 * Rex)).toBeCloseTo(dragCoefficientPlate(Rex) / 2, 9);
  });
});
