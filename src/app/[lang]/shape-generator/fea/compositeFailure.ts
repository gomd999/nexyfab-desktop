/**
 * compositeFailure.ts — first-ply failure criteria for a composite lamina, in the
 * ply material axes (σ1 along the fibre, σ2 transverse, τ12 in-plane shear):
 *
 *   max-stress:  failure when any of σ1/X, σ2/Y, τ12/S reaches 1
 *   Tsai-Wu:     F1σ1+F2σ2+F11σ1²+F22σ2²+F66τ12²+2F12σ1σ2 = 1 (interactive)
 *   Hashin:      separate fibre / matrix, tension / compression modes
 *
 * The strength RATIO R is the factor by which the stress state can be scaled to
 * reach failure (R≥1 safe). Verified against the uniaxial/shear strengths (FI=1 at
 * the strength), the load-scaling property, and the Hashin failure-mode split.
 */

export interface PlyStrength {
  Xt: number; Xc: number;   // longitudinal tensile / compressive (positive magnitudes)
  Yt: number; Yc: number;   // transverse tensile / compressive
  S: number;                // in-plane shear
  /** Tsai-Wu interaction coefficient F12* (normalised, default −0.5). */
  f12star?: number;
}

export interface PlyStress { sigma1: number; sigma2: number; tau12: number; }

/** Maximum-stress failure index (max of the individual ratios). */
export function maxStressIndex(s: PlyStress, X: PlyStrength): number {
  const r1 = s.sigma1 >= 0 ? s.sigma1 / X.Xt : -s.sigma1 / X.Xc;
  const r2 = s.sigma2 >= 0 ? s.sigma2 / X.Yt : -s.sigma2 / X.Yc;
  const r6 = Math.abs(s.tau12) / X.S;
  return Math.max(r1, r2, r6);
}

function tsaiWuCoeffs(X: PlyStrength) {
  const F1 = 1 / X.Xt - 1 / X.Xc, F2 = 1 / X.Yt - 1 / X.Yc;
  const F11 = 1 / (X.Xt * X.Xc), F22 = 1 / (X.Yt * X.Yc), F66 = 1 / (X.S * X.S);
  const F12 = (X.f12star ?? -0.5) * Math.sqrt(F11 * F22);
  return { F1, F2, F11, F22, F66, F12 };
}

/** Tsai-Wu failure index (= 1 at failure). */
export function tsaiWuIndex(s: PlyStress, X: PlyStrength): number {
  const { F1, F2, F11, F22, F66, F12 } = tsaiWuCoeffs(X);
  return F1 * s.sigma1 + F2 * s.sigma2 + F11 * s.sigma1 ** 2 + F22 * s.sigma2 ** 2 + F66 * s.tau12 ** 2 + 2 * F12 * s.sigma1 * s.sigma2;
}

/**
 * Tsai-Wu strength ratio R: the scalar factor on the stress state at which failure
 * occurs. Solves a·R² + b·R − 1 = 0 with a = quadratic terms, b = linear terms.
 */
export function tsaiWuStrengthRatio(s: PlyStress, X: PlyStrength): number {
  const { F1, F2, F11, F22, F66, F12 } = tsaiWuCoeffs(X);
  const a = F11 * s.sigma1 ** 2 + F22 * s.sigma2 ** 2 + F66 * s.tau12 ** 2 + 2 * F12 * s.sigma1 * s.sigma2;
  const b = F1 * s.sigma1 + F2 * s.sigma2;
  if (a <= 1e-300) return b > 0 ? 1 / b : Infinity;
  return (-b + Math.sqrt(b * b + 4 * a)) / (2 * a);
}

export type HashinMode = 'fibreTension' | 'fibreCompression' | 'matrixTension' | 'matrixCompression' | 'none';

export interface HashinResult {
  fibreTension: number; fibreCompression: number;
  matrixTension: number; matrixCompression: number;
  /** Largest index and its mode. */
  maxIndex: number; mode: HashinMode;
}

/** Hashin failure indices (fibre/matrix, tension/compression). */
export function hashinIndex(s: PlyStress, X: PlyStrength): HashinResult {
  const { sigma1, sigma2, tau12 } = s;
  const fibreTension = sigma1 >= 0 ? (sigma1 / X.Xt) ** 2 + (tau12 / X.S) ** 2 : 0;
  const fibreCompression = sigma1 < 0 ? (sigma1 / X.Xc) ** 2 : 0;
  const matrixTension = sigma2 >= 0 ? (sigma2 / X.Yt) ** 2 + (tau12 / X.S) ** 2 : 0;
  // matrix compression (Hashin): (σ2/2S)² + [(Yc/2S)²−1]σ2/Yc + (τ12/S)²
  const matrixCompression = sigma2 < 0
    ? (sigma2 / (2 * X.S)) ** 2 + ((X.Yc / (2 * X.S)) ** 2 - 1) * (sigma2 / X.Yc) + (tau12 / X.S) ** 2
    : 0;
  const modes: Array<[HashinMode, number]> = [
    ['fibreTension', fibreTension], ['fibreCompression', fibreCompression],
    ['matrixTension', matrixTension], ['matrixCompression', matrixCompression],
  ];
  let mode: HashinMode = 'none', maxIndex = 0;
  for (const [mn, v] of modes) if (v > maxIndex) { maxIndex = v; mode = mn; }
  return { fibreTension, fibreCompression, matrixTension, matrixCompression, maxIndex, mode };
}
