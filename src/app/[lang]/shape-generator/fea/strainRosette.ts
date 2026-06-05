/**
 * strainRosette.ts — reduce measured surface strains from a rosette strain gauge to the
 * in-plane strain state, then to principal strains via Mohr's strain circle.
 *
 *   45° rectangular (0°/45°/90°):  εx=εa, εy=εc, γxy = 2εb − εa − εc
 *   60° delta       (0°/60°/120°): εx=εa, εy=(2εb+2εc−εa)/3, γxy = 2(εb−εc)/√3
 *   principal:   ε₁,₂ = (εx+εy)/2 ± √( ((εx−εy)/2)² + (γxy/2)² )
 *   max shear:   γ_max = √((εx−εy)² + γxy²) = ε₁ − ε₂
 *   angle:       2θ_p = atan2(γxy, εx−εy)
 *
 * Verified against a known uniaxial field (γxy=0 when the gauge aligns with the principal
 * axes), the first strain invariant εx+εy = ε₁+ε₂, and γ_max = ε₁−ε₂.
 */

export interface PlaneStrain { ex: number; ey: number; gxy: number; }

/** 45° rectangular rosette (0°/45°/90°) → in-plane strain. */
export function rosette45(ea: number, eb: number, ec: number): PlaneStrain {
  return { ex: ea, ey: ec, gxy: 2 * eb - ea - ec };
}
/** 60° delta rosette (0°/60°/120°) → in-plane strain. */
export function rosette60(ea: number, eb: number, ec: number): PlaneStrain {
  return { ex: ea, ey: (2 * eb + 2 * ec - ea) / 3, gxy: (2 * (eb - ec)) / Math.sqrt(3) };
}
/** Principal strains ε₁ ≥ ε₂ from Mohr's strain circle. */
export function principalStrains(s: PlaneStrain): { e1: number; e2: number } {
  const avg = (s.ex + s.ey) / 2;
  const R = Math.sqrt(((s.ex - s.ey) / 2) ** 2 + (s.gxy / 2) ** 2);
  return { e1: avg + R, e2: avg - R };
}
/** Maximum (in-plane) shear strain γ_max = ε₁ − ε₂. */
export function maxShearStrain(s: PlaneStrain): number {
  return Math.sqrt((s.ex - s.ey) ** 2 + s.gxy ** 2);
}
/** Principal-axis orientation θ_p (radians). */
export function principalAngle(s: PlaneStrain): number {
  return 0.5 * Math.atan2(s.gxy, s.ex - s.ey);
}
