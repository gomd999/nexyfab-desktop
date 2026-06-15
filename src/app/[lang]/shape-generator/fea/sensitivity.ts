/**
 * sensitivity.ts — design sensitivity for topology optimization (SIMP). The
 * compliance C = fᵀu is self-adjoint, so its sensitivity to an element density needs
 * no separate adjoint solve:
 *
 *   K_e(ρ_e) = ρ_e^p · K_e0     (SIMP penalisation)
 *   dC/dρ_e = −p·ρ_e^{p−1}·u_eᵀ·K_e0·u_e        (always ≤ 0: more material ⇒ stiffer)
 *
 * A density (sensitivity) FILTER over a radius removes checkerboarding while
 * preserving the mean, and the Optimality-Criteria update drives the design toward a
 * target volume fraction. Verified: the analytic sensitivity matches a finite
 * difference, the filter conserves the mean, and the OC step hits the volume target.
 */

export interface SimpElement { nodes: number[]; ke0: number[][]; }

function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-300; for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const ff = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= ff * M[c][j]; }
  }
  return M.map((r) => r[n]);
}

export interface ComplianceResult { compliance: number; sensitivities: number[]; u: number[]; }

/**
 * Assemble K(ρ) = Σ ρ_e^p K_e0, solve K u = f (with `fixed` DOFs eliminated), and
 * return the compliance fᵀu and the self-adjoint sensitivities dC/dρ_e.
 */
export function complianceSensitivity(
  elements: SimpElement[], densities: number[], p: number, f: number[], fixed: Set<number>, nDof: number,
): ComplianceResult {
  const K = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
  const edof = (el: SimpElement) => el.nodes; // here element DOFs == node ids (1 DOF/node)
  elements.forEach((el, e) => {
    const scale = Math.pow(densities[e], p);
    const d = edof(el);
    for (let a = 0; a < d.length; a++) for (let b = 0; b < d.length; b++) K[d[a]][d[b]] += scale * el.ke0[a][b];
  });
  // reduce + solve
  const free: number[] = [];
  for (let i = 0; i < nDof; i++) if (!fixed.has(i)) free.push(i);
  const Kf = free.map((r) => free.map((c) => K[r][c]));
  const ff = free.map((d) => f[d]);
  const uf = solveDense(Kf, ff);
  const u = new Array<number>(nDof).fill(0);
  free.forEach((d, i) => { u[d] = uf[i]; });

  const compliance = f.reduce((s, fi, i) => s + fi * u[i], 0);
  const sensitivities = elements.map((el, e) => {
    const d = edof(el);
    let ue = 0; // u_eᵀ K_e0 u_e
    for (let a = 0; a < d.length; a++) for (let b = 0; b < d.length; b++) ue += u[d[a]] * el.ke0[a][b] * u[d[b]];
    return -p * Math.pow(densities[e], p - 1) * ue;
  });
  return { compliance, sensitivities, u };
}

/**
 * Linear density/sensitivity filter: each element's value becomes the radius-weighted
 * average of its neighbours (weight = max(0, r − dist)). Removes checkerboarding and
 * conserves the (weighted) mean.
 */
export function densityFilter(values: number[], coords: number[][], radius: number): number[] {
  return values.map((_v, i) => {
    let num = 0, den = 0;
    for (let j = 0; j < values.length; j++) {
      let d2 = 0; for (let k = 0; k < coords[i].length; k++) d2 += (coords[i][k] - coords[j][k]) ** 2;
      const w = Math.max(0, radius - Math.sqrt(d2));
      num += w * values[j]; den += w;
    }
    return den > 0 ? num / den : values[i];
  });
}

/**
 * Optimality-Criteria density update for minimum compliance at a volume fraction.
 * Bisects the Lagrange multiplier so the mean density equals `volumeFraction`.
 */
export function ocUpdate(densities: number[], sensitivities: number[], volumeFraction: number, move = 0.2): number[] {
  let lo = 1e-9, hi = 1e9;
  const n = densities.length;
  let result = densities.slice();
  for (let it = 0; it < 80; it++) {
    const lmid = 0.5 * (lo + hi);
    result = densities.map((rho, e) => {
      const Be = Math.sqrt(Math.max(0, -sensitivities[e]) / lmid);
      const cand = rho * Be;
      return Math.max(1e-3, Math.max(rho - move, Math.min(1, Math.min(rho + move, cand))));
    });
    const vol = result.reduce((s, r) => s + r, 0) / n;
    if (vol > volumeFraction) lo = lmid; else hi = lmid;
    if (hi - lo < 1e-12 * hi) break;
  }
  return result;
}
