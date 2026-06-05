/**
 * slopeStability.ts — limit-equilibrium slope stability (factor of safety FS =
 * resisting ÷ driving). For a dry cohesionless infinite slope FS = tanφ/tanβ; with
 * cohesion and depth FS = [c + γz cos²β tanφ]/(γz sinβ cosβ). For a circular slip
 * surface, Bishop's simplified method of slices:
 *
 *   FS = Σ[ (c·b + (W − u·b)·tanφ)/mα ] / Σ(W·sinα),   mα = cosα + sinα·tanφ/FS
 *
 * (FS appears on both sides → iterate). Verified: the infinite-slope and sliding-block
 * closed forms, Bishop reducing to the infinite slope for a single cohesionless slice,
 * and the FS<1 instability when β>φ.
 */

/** Dry cohesionless infinite slope: FS = tanφ/tanβ (φ,β in radians). */
export function infiniteSlopeDryCohesionless(phi: number, beta: number): number {
  return Math.tan(phi) / Math.tan(beta);
}

/** Infinite slope with cohesion c, unit weight γ, depth z (φ,β radians). */
export function infiniteSlopeFS(c: number, phi: number, gamma: number, z: number, beta: number): number {
  const num = c + gamma * z * Math.cos(beta) ** 2 * Math.tan(phi);
  const den = gamma * z * Math.sin(beta) * Math.cos(beta);
  return num / den;
}

/** Sliding-block (planar wedge) FS = (c·A + W cosβ tanφ)/(W sinβ). */
export function slidingBlockFS(W: number, beta: number, c: number, area: number, phi: number): number {
  return (c * area + W * Math.cos(beta) * Math.tan(phi)) / (W * Math.sin(beta));
}

export interface Slice {
  weight: number;     // W
  baseAngle: number;  // α (radians)
  width: number;      // b (horizontal)
  c: number;          // cohesion
  phi: number;        // friction angle (radians)
  poreU?: number;     // pore pressure u at the base
}

/** Bishop's simplified method of slices (iterative). Returns the converged FS. */
export function bishopFS(slices: Slice[], initial = 1, iters = 100, tol = 1e-8): number {
  let FS = initial;
  const driving = slices.reduce((s, sl) => s + sl.weight * Math.sin(sl.baseAngle), 0);
  for (let it = 0; it < iters; it++) {
    let resist = 0;
    for (const sl of slices) {
      const tanphi = Math.tan(sl.phi);
      const u = sl.poreU ?? 0;
      const mAlpha = Math.cos(sl.baseAngle) + (Math.sin(sl.baseAngle) * tanphi) / FS;
      resist += (sl.c * sl.width + (sl.weight - u * sl.width) * tanphi) / mAlpha;
    }
    const next = resist / driving;
    if (Math.abs(next - FS) < tol) return next;
    FS = next;
  }
  return FS;
}
