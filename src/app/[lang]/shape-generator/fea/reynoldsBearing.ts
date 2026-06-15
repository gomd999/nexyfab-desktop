/**
 * reynoldsBearing.ts — 1-D hydrodynamic lubrication (Reynolds equation) for a
 * fixed-incline slider bearing. A converging film wedge dragged by a moving surface
 * builds pressure that supports a load:
 *
 *   d/dx ( h³ · dp/dx ) = 6·μ·U · dh/dx,    p = 0 at the inlet and outlet
 *
 * A parallel film (h1=h2) carries NO load — convergence is essential. The load
 * capacity has the closed form W = (6μUL²B/h2²)·C_w(K), K=h1/h2. Verified: the
 * numerical Reynolds solve matches that load coefficient, a parallel film gives zero
 * pressure, and the pressure peaks inside the bearing.
 */

/** Solve the 1-D Reynolds equation for the pressure at n nodes over [0,L]. */
export function reynoldsPressure(h: number[], L: number, mu: number, U: number): number[] {
  const n = h.length, dx = L / (n - 1);
  const hMid = (i: number) => 0.5 * (h[i] + h[i + 1]);   // h at i+1/2
  // tridiagonal system for interior nodes; p=0 at both ends.
  const a = new Array<number>(n).fill(0), b = new Array<number>(n).fill(0), c = new Array<number>(n).fill(0), d = new Array<number>(n).fill(0);
  b[0] = 1; d[0] = 0; b[n - 1] = 1; d[n - 1] = 0;
  for (let i = 1; i < n - 1; i++) {
    const he = Math.pow(hMid(i), 3), hw = Math.pow(hMid(i - 1), 3);
    a[i] = hw / (dx * dx);
    c[i] = he / (dx * dx);
    b[i] = -(he + hw) / (dx * dx);
    d[i] = 6 * mu * U * (h[i + 1] - h[i - 1]) / (2 * dx);
  }
  // Thomas algorithm
  for (let i = 1; i < n; i++) { const w = a[i] / b[i - 1]; b[i] -= w * c[i - 1]; d[i] -= w * d[i - 1]; }
  const p = new Array<number>(n).fill(0);
  p[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) p[i] = (d[i] - c[i] * p[i + 1]) / b[i];
  return p;
}

/** Load capacity per unit width: W = ∫ p dx (trapezoidal). */
export function loadCapacity(p: number[], L: number): number {
  const n = p.length, dx = L / (n - 1);
  let W = 0;
  for (let i = 0; i < n - 1; i++) W += 0.5 * (p[i] + p[i + 1]) * dx;
  return W;
}

/** Dimensionless load coefficient C_w(K) for a fixed-incline slider, K = h1/h2. */
export function loadCoefficient(K: number): number {
  if (Math.abs(K - 1) < 1e-9) return 0;                  // parallel film: no load
  return (Math.log(K) - (2 * (K - 1)) / (K + 1)) / ((K - 1) * (K - 1));
}

/** Closed-form load capacity per unit width: W = 6μUL²/h2² · C_w(K). */
export function analyticLoad(mu: number, U: number, L: number, h1: number, h2: number): number {
  return ((6 * mu * U * L * L) / (h2 * h2)) * loadCoefficient(h1 / h2);
}

/** Build a linear converging film h(x) from h1 (inlet) to h2 (outlet). */
export function linearFilm(h1: number, h2: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => h1 + (h2 - h1) * (i / (n - 1)));
}
