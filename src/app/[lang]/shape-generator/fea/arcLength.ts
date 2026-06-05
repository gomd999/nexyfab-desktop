/**
 * arcLength.ts — the arc-length (Riks/Crisfield) continuation method for tracing a
 * nonlinear equilibrium path PAST a load limit point, where load-controlled
 * Newton-Raphson diverges (the tangent stiffness vanishes). The unknowns are the
 * displacement and the load factor λ; each step advances a fixed arc length Δℓ in
 * (u, λ) space and corrects back onto the equilibrium path.
 *
 * 1-DOF spherical arc length: predictor along the tangent, corrector solving the
 * residual + the constraint Δu² + ψ²Δλ²q² = Δℓ². Verified on the von Mises shallow
 * truss, whose snap-through has a load limit point: the traced path's peak load
 * matches the analytic maximum of the internal-force curve.
 */

export interface ArcLengthOptions {
  /** Internal restoring force f(u). */
  internalForce: (u: number) => number;
  /** Tangent stiffness k(u) = df/du. */
  tangent: (u: number) => number;
  /** Reference external load q (external load = λ·q). */
  refLoad: number;
  /** Arc-length increment Δℓ. */
  arcLength: number;
  steps: number;
  /** Constraint scaling ψ (default 1). */
  psi?: number;
  maxNewton?: number;
  tol?: number;
}

export interface PathPoint { u: number; lambda: number; }

/** Trace the equilibrium path u(λ) by the spherical arc-length method (1 DOF). */
export function arcLengthSolve(opts: ArcLengthOptions): PathPoint[] {
  const q = opts.refLoad, dl = opts.arcLength, psi = opts.psi ?? 1;
  const maxNewton = opts.maxNewton ?? 30, tol = opts.tol ?? 1e-10;
  const f = opts.internalForce, kt = opts.tangent;

  let u = 0, lambda = 0;
  const path: PathPoint[] = [{ u, lambda }];
  let prevDu = 0, prevDlam = 0;

  for (let step = 0; step < opts.steps; step++) {
    const k0 = kt(u) || 1e-30;
    const duBar = q / k0;                              // tangential displacement per unit load
    // predictor: Δλ = ±Δℓ / √(duBar² + ψ²q²)
    let dLam = dl / Math.sqrt(duBar * duBar + psi * psi * q * q);
    // sign: keep moving in the same direction as the previous increment.
    const trialDu = dLam * duBar;
    if (step > 0 && (trialDu * prevDu + dLam * prevDlam) < 0) dLam = -dLam;
    let Du = dLam * duBar, Dlam = dLam;

    // corrector (Newton with the arc-length constraint)
    for (let it = 0; it < maxNewton; it++) {
      const r = f(u + Du) - (lambda + Dlam) * q;       // residual
      if (Math.abs(r) < tol * (1 + Math.abs(q))) break;
      const k = kt(u + Du) || 1e-30;
      const duR = -r / k;                              // residual-correcting displacement
      const duT = q / k;                               // tangential displacement
      // constraint: (Du+duR+δλ·duT)² + ψ²(Dlam+δλ)²q² = Δℓ²  → quadratic a δλ²+b δλ+c=0
      const A = Du + duR;
      const a = duT * duT + psi * psi * q * q;
      const b = 2 * (A * duT + psi * psi * (Dlam) * q * q);
      const c = A * A + psi * psi * Dlam * Dlam * q * q - dl * dl;
      const disc = b * b - 4 * a * c;
      const sq = Math.sqrt(Math.max(0, disc));
      const r1 = (-b + sq) / (2 * a), r2 = (-b - sq) / (2 * a);
      // choose the root keeping the step direction (max dot with current increment).
      const dot1 = (A + r1 * duT) * Du + (Dlam + r1) * Dlam;
      const dot2 = (A + r2 * duT) * Du + (Dlam + r2) * Dlam;
      const dLambda = dot1 >= dot2 ? r1 : r2;
      Du = A + dLambda * duT;
      Dlam = Dlam + dLambda;
    }
    u += Du; lambda += Dlam;
    prevDu = Du; prevDlam = Dlam;
    path.push({ u, lambda });
  }
  return path;
}
