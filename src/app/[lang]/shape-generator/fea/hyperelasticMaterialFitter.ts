/**
 * hyperelasticMaterialFitter.ts — Fit hyperelastic material parameters
 * (Mooney-Rivlin, Yeoh) to uniaxial stress-strain test data.
 *
 * For rubber-like materials, Hooke's law is invalid past ~10% strain.
 * Strain energy density forms commonly used:
 *
 *   Mooney-Rivlin: W = C10·(I1−3) + C01·(I2−3)
 *   Yeoh:          W = C10·(I1−3) + C20·(I1−3)² + C30·(I1−3)³
 *   Neo-Hookean:   W = C10·(I1−3)
 *
 * In uniaxial tension, λ = stretch:
 *   I1 = λ² + 2/λ; I2 = 2λ + 1/λ²
 *   σ_eng = 2·(λ − 1/λ²)·[C10 + C01/λ + 2·C20·(I1−3) + 3·C30·(I1−3)²]
 *
 * Module: least-squares fit + goodness-of-fit metric.
 */

export type ModelType = 'neo-hookean' | 'mooney-rivlin' | 'yeoh-N3';

export interface StressStrainPoint {
  /** Engineering strain (λ − 1). */
  strain: number;
  /** Engineering stress (MPa). */
  stressMpa: number;
}

export interface FitOptions {
  model: ModelType;
}

export const DEFAULT_OPTIONS: FitOptions = {
  model: 'mooney-rivlin',
};

export interface FitResult {
  model: ModelType;
  /** Coefficients in model-specific order. */
  coefficients: number[];
  /** R² goodness of fit. */
  rSquared: number;
  /** RMS error (MPa). */
  rmsErrorMpa: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function fitMaterial(data: StressStrainPoint[], options: Partial<FitOptions> = {}): FitResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  if (data.length < 3) {
    warnings.push('Need ≥ 3 data points.');
    return { model: opts.model, coefficients: [], rSquared: 0, rmsErrorMpa: 0, warnings };
  }

  // Build design matrix per model.
  const params = paramCount(opts.model);
  const A: number[][] = [];
  const b: number[] = [];
  for (const point of data) {
    const lambda = 1 + point.strain;
    if (lambda <= 0) continue;
    const I1 = lambda * lambda + 2 / lambda;
    const I2 = 2 * lambda + 1 / (lambda * lambda);
    const dW = 2 * (lambda - 1 / (lambda * lambda));
    const row: number[] = [];
    if (opts.model === 'neo-hookean') {
      row.push(dW); // C10 coefficient
    } else if (opts.model === 'mooney-rivlin') {
      row.push(dW);
      row.push(dW / lambda);
    } else {
      // Yeoh-N3.
      row.push(dW);
      row.push(2 * dW * (I1 - 3));
      row.push(3 * dW * (I1 - 3) * (I1 - 3));
    }
    void I2;
    A.push(row);
    b.push(point.stressMpa);
  }
  // Normal equation: (Aᵀ A) x = Aᵀ b.
  const at_a = multiplyMatrix(transpose(A), A, params);
  const at_b = multiplyVector(transpose(A), b, params);
  const coeffs = solveSquare(at_a, at_b);
  if (!coeffs) {
    warnings.push('Singular matrix; cannot fit.');
    return { model: opts.model, coefficients: [], rSquared: 0, rmsErrorMpa: 0, warnings };
  }

  // Evaluate fit.
  let ssRes = 0;
  let ssTot = 0;
  const meanStress = data.reduce((s, p) => s + p.stressMpa, 0) / data.length;
  for (let i = 0; i < data.length; i++) {
    const point = data[i]!;
    const lambda = 1 + point.strain;
    if (lambda <= 0) continue;
    const predicted = predictStress(opts.model, coeffs, lambda);
    ssRes += (point.stressMpa - predicted) ** 2;
    ssTot += (point.stressMpa - meanStress) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const rms = Math.sqrt(ssRes / data.length);

  return { model: opts.model, coefficients: coeffs, rSquared: r2, rmsErrorMpa: rms, warnings };
}

function paramCount(model: ModelType): number {
  if (model === 'neo-hookean') return 1;
  if (model === 'mooney-rivlin') return 2;
  return 3;
}

// ── Predict stress for a stretch λ ───────────────────────────

export function predictStress(model: ModelType, coeffs: number[], lambda: number): number {
  const dW = 2 * (lambda - 1 / (lambda * lambda));
  const I1 = lambda * lambda + 2 / lambda;
  if (model === 'neo-hookean') return dW * coeffs[0]!;
  if (model === 'mooney-rivlin') return dW * (coeffs[0]! + coeffs[1]! / lambda);
  const yeoh = coeffs[0]! + 2 * coeffs[1]! * (I1 - 3) + 3 * coeffs[2]! * (I1 - 3) * (I1 - 3);
  return dW * yeoh;
}

// ── Matrix helpers ───────────────────────────────────────────

function transpose(m: number[][]): number[][] {
  if (m.length === 0) return [];
  const cols = m[0]!.length;
  const out: number[][] = [];
  for (let c = 0; c < cols; c++) {
    out.push(m.map(row => row[c]!));
  }
  return out;
}

function multiplyMatrix(a: number[][], b: number[][], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    for (let j = 0; j < size; j++) {
      let sum = 0;
      for (let k = 0; k < b.length; k++) sum += a[i]![k]! * b[k]![j]!;
      row.push(sum);
    }
    out.push(row);
  }
  return out;
}

function multiplyVector(a: number[][], v: number[], size: number): number[] {
  const out: number[] = new Array(size).fill(0);
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < v.length; k++) out[i]! += a[i]![k]! * v[k]!;
  }
  return out;
}

function solveSquare(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  if (n === 0 || A[0]!.length !== n) return null;
  // Gaussian elimination.
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r]![i]!) > Math.abs(M[pivot]![i]!)) pivot = r;
    if (pivot !== i) [M[i], M[pivot]] = [M[pivot]!, M[i]!];
    if (Math.abs(M[i]![i]!) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const factor = M[r]![i]! / M[i]![i]!;
      for (let c = i; c <= n; c++) M[r]![c]! -= factor * M[i]![c]!;
    }
  }
  const x: number[] = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i]![n]!;
    for (let c = i + 1; c < n; c++) sum -= M[i]![c]! * x[c]!;
    x[i] = sum / M[i]![i]!;
  }
  return x;
}

// ── Model comparison ─────────────────────────────────────────

export function compareModels(data: StressStrainPoint[]): { model: ModelType; r2: number; rms: number }[] {
  const models: ModelType[] = ['neo-hookean', 'mooney-rivlin', 'yeoh-N3'];
  return models.map(m => {
    const r = fitMaterial(data, { model: m });
    return { model: m, r2: r.rSquared, rms: r.rmsErrorMpa };
  });
}

// ── Summary ────────────────────────────────────────────────────

export interface FitSummary {
  model: ModelType;
  coefficientCount: number;
  rSquared: number;
  rmsErrorMpa: number;
}

export function summarize(result: FitResult): FitSummary {
  return {
    model: result.model,
    coefficientCount: result.coefficients.length,
    rSquared: result.rSquared,
    rmsErrorMpa: result.rmsErrorMpa,
  };
}
