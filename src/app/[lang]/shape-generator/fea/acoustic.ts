/**
 * acoustic.ts — 1-D acoustic (Helmholtz) duct/cavity eigenmodes by linear FEM. The
 * pressure satisfies −p'' = (ω/c)²·p; discretised this is the generalized
 * eigenproblem K φ = (ω/c)² M φ, with the 1-D Laplacian stiffness and consistent
 * mass. A rigid (closed) end is a natural Neumann BC (∂p/∂n=0); an open end is a
 * pressure-release Dirichlet BC (p=0).
 *
 * Verified against the analytic duct resonances:
 *   closed-closed / open-open:  f_n = n·c/(2L)
 *   closed-open:                f_n = (2n−1)·c/(4L)
 */
import { naturalFrequencies } from './craigBampton';

export type DuctEnd = 'closed' | 'open';

/** Lowest acoustic resonance frequencies (Hz) of a 1-D duct. */
export function ductModes(L: number, c: number, nElems: number, left: DuctEnd, right: DuctEnd, nModes: number): number[] {
  const h = L / nElems, nNodes = nElems + 1;
  const K = Array.from({ length: nNodes }, () => new Array<number>(nNodes).fill(0));
  const M = Array.from({ length: nNodes }, () => new Array<number>(nNodes).fill(0));
  for (let e = 0; e < nElems; e++) {
    const ke = [[1 / h, -1 / h], [-1 / h, 1 / h]];
    const me = [[h / 3, h / 6], [h / 6, h / 3]];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { K[e + a][e + b] += ke[a][b]; M[e + a][e + b] += me[a][b]; }
  }
  // open ends → Dirichlet p=0 (remove those DOFs).
  const fixed = new Set<number>();
  if (left === 'open') fixed.add(0);
  if (right === 'open') fixed.add(nNodes - 1);
  const free: number[] = [];
  for (let i = 0; i < nNodes; i++) if (!fixed.has(i)) free.push(i);
  const Mf = free.map((r) => free.map((cc) => M[r][cc]));
  // shift K by σM so an all-closed duct (singular K, λ=0 constant-pressure mode) is
  // still positive-definite; we subtract σ back exactly from the eigenvalues.
  const sigma = (Math.PI / L) ** 2;
  const Kf = free.map((r) => free.map((cc) => K[r][cc] + sigma * M[r][cc]));

  // eigenvalues of the shifted system are λ+σ; the rigid mode (λ≈0) is dropped.
  const sqrtShifted = naturalFrequencies(Kf, Mf, nModes + 3); // = √(λ+σ)
  const freqs = sqrtShifted
    .map((sl) => sl * sl - sigma)            // λ = (√(λ+σ))² − σ
    .filter((lam) => lam > 1e-3)
    .map((lam) => (c * Math.sqrt(lam)) / (2 * Math.PI))  // f = c·√λ/(2π)
    .sort((a, b) => a - b);
  return freqs.slice(0, nModes);
}

/** Analytic duct resonances for the given end conditions. */
export function analyticDuctModes(L: number, c: number, left: DuctEnd, right: DuctEnd, nModes: number): number[] {
  const mixed = left !== right;                       // one closed, one open
  const out: number[] = [];
  for (let n = 1; n <= nModes; n++) {
    out.push(mixed ? ((2 * n - 1) * c) / (4 * L) : (n * c) / (2 * L));
  }
  return out;
}
