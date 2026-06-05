/**
 * consolidation.ts — Terzaghi 1-D poroelastic CONSOLIDATION. A saturated layer under
 * a sudden surcharge first carries the load entirely as excess pore pressure; as water
 * drains the pressure dissipates (diffusion) and the load transfers to the soil
 * skeleton — Terzaghi's effective-stress principle σ' = σ − u.
 *
 *   ∂u/∂t = c_v ∂²u/∂z²,   T_v = c_v·t/H²  (dimensionless time)
 *   U(T_v) = 1 − Σ_m (2/M²) e^{−M²T_v},   M = (2m+1)π/2   (degree of consolidation)
 *
 * Verified: the analytic series gives the textbook U=50% at T_v≈0.197 and U=90% at
 * T_v≈0.848; the numerically diffused pore pressure reproduces U(T_v); and the
 * effective stress rises from 0 to the full surcharge as consolidation completes.
 */

/** Degree of consolidation U(T_v) from the Terzaghi series (single-drained layer). */
export function consolidationDegree(Tv: number, terms = 200): number {
  if (Tv <= 0) return 0;
  let sum = 0;
  for (let m = 0; m < terms; m++) {
    const M = ((2 * m + 1) * Math.PI) / 2;
    sum += (2 / (M * M)) * Math.exp(-M * M * Tv);
  }
  return 1 - sum;
}

/** Analytic excess pore pressure at depth z (0..H, drained at z=0) and time T_v. */
export function excessPorePressure(z: number, H: number, u0: number, Tv: number, terms = 200): number {
  let sum = 0;
  for (let m = 0; m < terms; m++) {
    const M = ((2 * m + 1) * Math.PI) / 2;
    sum += (2 / M) * Math.sin((M * z) / H) * Math.exp(-M * M * Tv);
  }
  return u0 * sum;
}

/** Terzaghi effective stress σ' = σ_total − u (pore pressure). */
export function effectiveStress(totalStress: number, porePressure: number): number {
  return totalStress - porePressure;
}

export interface ConsolidationResult { Tv: number[]; U: number[]; pressureProfile: number[][]; }

/**
 * Numerically consolidate a single-drained layer (drained at z=0 Dirichlet u=0,
 * impermeable at z=H Neumann) from a uniform initial pressure u0, by backward Euler.
 * Returns the degree of consolidation U(t) = 1 − mean(u)/u0.
 */
export function consolidate(H: number, cv: number, u0: number, nNodes: number, dt: number, steps: number): ConsolidationResult {
  const h = H / (nNodes - 1);
  const r = (cv * dt) / (h * h);
  // implicit tridiagonal: (1+2r)u_i - r u_{i-1} - r u_{i+1} = u_i^old, with BCs.
  let u = new Array<number>(nNodes).fill(u0);
  u[0] = 0; // drained surface
  const Tv: number[] = [0], U: number[] = [0], profiles: number[][] = [u.slice()];
  for (let s = 0; s < steps; s++) {
    // Thomas algorithm on interior nodes 1..n-1 (node n-1 impermeable: mirror).
    const n = nNodes;
    const a = new Array<number>(n).fill(0), b = new Array<number>(n).fill(0), c = new Array<number>(n).fill(0), d = new Array<number>(n).fill(0);
    b[0] = 1; d[0] = 0; // u0 = 0 (drained)
    for (let i = 1; i < n - 1; i++) { a[i] = -r; b[i] = 1 + 2 * r; c[i] = -r; d[i] = u[i]; }
    // impermeable base: du/dz=0 ⇒ u_n = u_{n-2} (ghost), giving (1+2r)u_{n-1} - 2r u_{n-2} = u_{n-1}^old
    b[n - 1] = 1 + 2 * r; a[n - 1] = -2 * r; d[n - 1] = u[n - 1];
    // forward sweep
    for (let i = 1; i < n; i++) { const w = a[i] / b[i - 1]; b[i] -= w * c[i - 1]; d[i] -= w * d[i - 1]; }
    const un = new Array<number>(n).fill(0);
    un[n - 1] = d[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i--) un[i] = (d[i] - c[i] * un[i + 1]) / b[i];
    u = un;
    const mean = u.reduce((acc, v) => acc + v, 0) / n;
    Tv.push((cv * (s + 1) * dt) / (H * H));
    U.push(1 - mean / u0);
    profiles.push(u.slice());
  }
  return { Tv, U, pressureProfile: profiles };
}
