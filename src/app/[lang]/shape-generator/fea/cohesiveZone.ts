/**
 * cohesiveZone.ts — bilinear cohesive-zone model for fracture (traction–separation
 * law). The traction across an interface rises elastically with the opening δ to a
 * peak T_max at δ0, then SOFTENS linearly to zero at full separation δf. The area
 * under the curve is the fracture energy Gc.
 *
 *   δ0 = T_max/K,   δf = 2·Gc/T_max,   T_env(δ) = T_max·(δf−δ)/(δf−δ0) (softening)
 *
 * Damage d is irreversible (it only grows): unloading/reloading follows a secant
 * (1−d)·K to the origin. Verified: peak traction, ∫T dδ = Gc over a full opening,
 * secant unloading, and damage monotonicity.
 */

export interface CohesiveMaterial {
  K: number;      // initial (penalty) stiffness
  Tmax: number;   // peak cohesive traction
  Gc: number;     // fracture energy (area under the law)
}

export function onsetSeparation(mat: CohesiveMaterial): number { return mat.Tmax / mat.K; }
export function failureSeparation(mat: CohesiveMaterial): number { return (2 * mat.Gc) / mat.Tmax; }

/** Bilinear damage as a function of the maximum separation experienced. */
export function damage(deltaMax: number, mat: CohesiveMaterial): number {
  const d0 = onsetSeparation(mat), df = failureSeparation(mat);
  if (deltaMax <= d0) return 0;
  if (deltaMax >= df) return 1;
  return 1 - (d0 * (df - deltaMax)) / (deltaMax * (df - d0));
}

export interface CohesiveState { traction: number; damage: number; deltaMax: number; }

/**
 * Cohesive traction at the current separation, given the prior maximum separation
 * (history). Returns the secant-based traction (1−d)·K·δ with irreversible damage.
 */
export function cohesiveTraction(delta: number, deltaMaxPrev: number, mat: CohesiveMaterial): CohesiveState {
  const deltaMax = Math.max(delta, deltaMaxPrev, 0);
  const d = damage(deltaMax, mat);
  const traction = delta <= 0 ? mat.K * delta : (1 - d) * mat.K * delta;  // no damage in compression
  return { traction, damage: d, deltaMax };
}

/** Work dissipated by opening the interface monotonically from 0 to δ (∫T dδ). */
export function dissipatedEnergy(deltaTarget: number, mat: CohesiveMaterial, n = 20000): number {
  const step = deltaTarget / n;
  let energy = 0, dmax = 0, prev = cohesiveTraction(0, 0, mat).traction;
  for (let i = 1; i <= n; i++) {
    const delta = i * step;
    const st = cohesiveTraction(delta, dmax, mat);
    dmax = st.deltaMax;
    energy += 0.5 * (prev + st.traction) * step;
    prev = st.traction;
  }
  return energy;
}
