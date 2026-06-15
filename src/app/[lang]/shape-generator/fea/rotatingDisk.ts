/**
 * rotatingDisk.ts — centrifugal stresses in a spinning disk (density ρ, angular speed
 * ω, outer radius R, Poisson ν).
 *
 *   solid disk:   σr(r) = (3+ν)/8·ρω²(R²−r²)
 *                 σθ(r) = ρω²/8·[(3+ν)R² − (1+3ν)r²]
 *                 σ_max at the centre: σr=σθ = (3+ν)/8·ρω²R²,  σr(R)=0
 *   rotating ring (thin rim):  σθ = ρ·v² = ρ·(ωR)²
 *   annular disk:  σθ,max at the bore = ρω²/4·[(3+ν)ro² + (1−ν)ri²]
 *                  (a tiny hole DOUBLES the centre stress — concentration factor 2)
 *
 * Verified against those closed forms, the σr=σθ centre / σr=0 edge conditions, the
 * ρv² ring stress, the small-hole 2× factor, and the ω² scaling.
 */

/** Centre stress of a solid spinning disk: (3+ν)/8·ρω²R² (both σr and σθ). */
export function solidDiskCenterStress(rho: number, omega: number, R: number, nu: number): number {
  return ((3 + nu) / 8) * rho * omega * omega * R * R;
}
/** Radial stress σr(r) of a solid disk. */
export function solidDiskRadialStress(r: number, rho: number, omega: number, R: number, nu: number): number {
  return ((3 + nu) / 8) * rho * omega * omega * (R * R - r * r);
}
/** Hoop stress σθ(r) of a solid disk. */
export function solidDiskHoopStress(r: number, rho: number, omega: number, R: number, nu: number): number {
  return (rho * omega * omega / 8) * ((3 + nu) * R * R - (1 + 3 * nu) * r * r);
}
/** Hoop stress of a thin rotating ring/rim: σθ = ρ·v². */
export function rotatingRingStress(rho: number, v: number): number { return rho * v * v; }
/** Maximum hoop stress (at the bore) of an annular spinning disk. */
export function annularMaxHoopStress(rho: number, omega: number, ro: number, ri: number, nu: number): number {
  return (rho * omega * omega / 4) * ((3 + nu) * ro * ro + (1 - nu) * ri * ri);
}
