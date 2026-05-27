/**
 * costRegression.ts — Feature-based part-cost regression.
 *
 * Existing `CostEstimator.ts` uses a hand-written cost-model
 * cascade (machine rate × time + material × volume + setup +
 * overhead). It's correct in form but its coefficients are
 * untrained — every customer sees the same shop's defaults.
 *
 * This module learns coefficients from a customer's historical
 * quote/win data. The regression model:
 *
 *   cost = β₀ + β₁ × volume_cm3 + β₂ × hole_count + β₃ × bend_count
 *        + β₄ × surface_area_cm2 + β₅ × tightest_tolerance_um
 *        + β_material[m] + β_finish[f]
 *
 * Fit via ordinary least squares (OLS) — the normal equation
 * X^T X β = X^T y is solved by Gauss-Jordan elimination on a small
 * dense system (10-20 features, 100s of training rows).
 *
 * Output: a `RegressionModel` with coefficients + R² score. Callers
 * use `predictCost(part, model)` to score new parts. The hand-written
 * model is still a fallback when training data is thin (< 30 rows).
 */

export interface PartFeatures {
  /** Bounding-box volume (cm³). */
  volumeCm3: number;
  /** Number of drilled / tapped holes. */
  holeCount: number;
  /** Number of bends (sheet metal). */
  bendCount: number;
  /** External surface area (cm²). */
  surfaceAreaCm2: number;
  /** Tightest tolerance the part calls out (µm). */
  tightestToleranceUm: number;
  /** Material category — one-hot encoded inside the model. */
  material: string;
  /** Finish category — one-hot encoded. */
  finish: string;
}

export interface TrainingRow {
  features: PartFeatures;
  /** Observed historical cost (USD). */
  costUsd: number;
}

export interface RegressionModel {
  /** Numeric coefficients in the order: intercept, volume, holes, bends, area, tightest_tol. */
  numericCoefficients: number[];
  /** Coefficient per material category (additive). */
  materialCoefficients: Map<string, number>;
  /** Coefficient per finish category (additive). */
  finishCoefficients: Map<string, number>;
  /** R² goodness-of-fit. */
  r2: number;
  /** Number of training rows used. */
  trainingRows: number;
  /** Mean absolute error (USD). */
  meanAbsoluteError: number;
}

// ── Model fitting ───────────────────────────────────────────────

export function fitModel(rows: TrainingRow[]): RegressionModel {
  if (rows.length < 5) {
    return emptyModel(rows.length);
  }
  const materials = new Set<string>();
  const finishes = new Set<string>();
  for (const r of rows) {
    materials.add(r.features.material);
    finishes.add(r.features.finish);
  }
  const materialList = [...materials];
  const finishList = [...finishes];

  // Numeric column count: intercept + 5 numeric features
  //                    + (materials - 1) + (finishes - 1) for one-hot avoiding dummy trap.
  const numericFeatures = 6; // intercept + 5
  const materialDummies = Math.max(0, materialList.length - 1);
  const finishDummies = Math.max(0, finishList.length - 1);
  const totalCols = numericFeatures + materialDummies + finishDummies;

  // Build design matrix X (rows × totalCols) + y vector.
  const X: number[][] = [];
  const y: number[] = [];
  for (const r of rows) {
    const row: number[] = new Array(totalCols).fill(0);
    row[0] = 1;
    row[1] = r.features.volumeCm3;
    row[2] = r.features.holeCount;
    row[3] = r.features.bendCount;
    row[4] = r.features.surfaceAreaCm2;
    row[5] = r.features.tightestToleranceUm;
    const matIdx = materialList.indexOf(r.features.material);
    if (matIdx > 0) row[numericFeatures + matIdx - 1] = 1;
    const finIdx = finishList.indexOf(r.features.finish);
    if (finIdx > 0) row[numericFeatures + materialDummies + finIdx - 1] = 1;
    X.push(row);
    y.push(r.costUsd);
  }

  // Solve X^T X β = X^T y.
  const beta = solveOls(X, y);
  if (!beta) return emptyModel(rows.length);

  // Compute predictions + R² + MAE.
  let ssRes = 0, ssTot = 0;
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  let absErrSum = 0;
  for (let i = 0; i < rows.length; i++) {
    const pred = dotRow(X[i]!, beta);
    const err = y[i]! - pred;
    ssRes += err * err;
    ssTot += (y[i]! - yMean) ** 2;
    absErrSum += Math.abs(err);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const mae = absErrSum / rows.length;

  const numericCoefficients = beta.slice(0, numericFeatures);

  const materialCoefficients = new Map<string, number>();
  materialCoefficients.set(materialList[0]!, 0); // baseline
  for (let i = 1; i < materialList.length; i++) {
    materialCoefficients.set(materialList[i]!, beta[numericFeatures + i - 1]!);
  }
  const finishCoefficients = new Map<string, number>();
  finishCoefficients.set(finishList[0]!, 0);
  for (let i = 1; i < finishList.length; i++) {
    finishCoefficients.set(finishList[i]!, beta[numericFeatures + materialDummies + i - 1]!);
  }

  return {
    numericCoefficients,
    materialCoefficients,
    finishCoefficients,
    r2,
    trainingRows: rows.length,
    meanAbsoluteError: mae,
  };
}

function emptyModel(rows: number): RegressionModel {
  return {
    numericCoefficients: [0, 0, 0, 0, 0, 0],
    materialCoefficients: new Map(),
    finishCoefficients: new Map(),
    r2: 0,
    trainingRows: rows,
    meanAbsoluteError: 0,
  };
}

// ── OLS solver ──────────────────────────────────────────────────

function solveOls(X: number[][], y: number[]): number[] | null {
  const cols = X[0]?.length ?? 0;
  if (cols === 0) return null;
  // XtX (cols × cols), Xty (cols).
  const XtX: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const Xty: number[] = new Array(cols).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i]!;
    const yi = y[i]!;
    for (let a = 0; a < cols; a++) {
      Xty[a] += row[a]! * yi;
      for (let b = 0; b < cols; b++) {
        XtX[a]![b] += row[a]! * row[b]!;
      }
    }
  }
  // Add ridge regularization for stability.
  const lambda = 1e-6;
  for (let i = 0; i < cols; i++) XtX[i]![i] += lambda;
  return gaussJordan(XtX, Xty);
}

function gaussJordan(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) {
    // Pivot.
    let pivot = i;
    let maxAbs = Math.abs(M[i]![i]!);
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r]![i]!) > maxAbs) {
        maxAbs = Math.abs(M[r]![i]!);
        pivot = r;
      }
    }
    if (maxAbs < 1e-12) return null; // singular
    if (pivot !== i) [M[i], M[pivot]] = [M[pivot]!, M[i]!];
    // Normalize.
    const div = M[i]![i]!;
    for (let c = i; c <= n; c++) M[i]![c]! /= div;
    // Eliminate.
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = M[r]![i]!;
      if (factor === 0) continue;
      for (let c = i; c <= n; c++) M[r]![c] = M[r]![c]! - factor * M[i]![c]!;
    }
  }
  return M.map(row => row[n]!);
}

function dotRow(row: number[], beta: number[]): number {
  let s = 0;
  for (let i = 0; i < row.length; i++) s += row[i]! * beta[i]!;
  return s;
}

// ── Prediction ──────────────────────────────────────────────────

export function predictCost(features: PartFeatures, model: RegressionModel): number {
  const c = model.numericCoefficients;
  let cost = c[0]! +
    c[1]! * features.volumeCm3 +
    c[2]! * features.holeCount +
    c[3]! * features.bendCount +
    c[4]! * features.surfaceAreaCm2 +
    c[5]! * features.tightestToleranceUm;
  cost += model.materialCoefficients.get(features.material) ?? 0;
  cost += model.finishCoefficients.get(features.finish) ?? 0;
  return Math.max(0, cost);
}

// ── Feature importance ──────────────────────────────────────────

export interface FeatureImportance {
  feature: string;
  /** Coefficient magnitude × feature mean — gives a rough "dollars per unit". */
  contributionUsd: number;
  /** Sign of effect. */
  sign: 'positive' | 'negative' | 'zero';
}

export function rankFeatureImportance(model: RegressionModel, rows: TrainingRow[]): FeatureImportance[] {
  if (rows.length === 0) return [];
  const means = {
    volume: avg(rows.map(r => r.features.volumeCm3)),
    holes: avg(rows.map(r => r.features.holeCount)),
    bends: avg(rows.map(r => r.features.bendCount)),
    area: avg(rows.map(r => r.features.surfaceAreaCm2)),
    tol: avg(rows.map(r => r.features.tightestToleranceUm)),
  };
  const c = model.numericCoefficients;
  const numeric: FeatureImportance[] = [
    { feature: 'volume_cm3', contributionUsd: c[1]! * means.volume, sign: signOf(c[1]!) },
    { feature: 'hole_count', contributionUsd: c[2]! * means.holes, sign: signOf(c[2]!) },
    { feature: 'bend_count', contributionUsd: c[3]! * means.bends, sign: signOf(c[3]!) },
    { feature: 'surface_area_cm2', contributionUsd: c[4]! * means.area, sign: signOf(c[4]!) },
    { feature: 'tightest_tol_um', contributionUsd: c[5]! * means.tol, sign: signOf(c[5]!) },
  ];
  numeric.sort((a, b) => Math.abs(b.contributionUsd) - Math.abs(a.contributionUsd));
  return numeric;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function signOf(x: number): 'positive' | 'negative' | 'zero' {
  if (x > 1e-9) return 'positive';
  if (x < -1e-9) return 'negative';
  return 'zero';
}

// ── Cross-validation ────────────────────────────────────────────

export interface CrossValidationResult {
  /** Mean R² across folds. */
  meanR2: number;
  /** Standard deviation of R² (lower = more stable model). */
  stdR2: number;
  /** MAE per fold. */
  maes: number[];
}

export function kFoldCrossValidate(rows: TrainingRow[], k: number = 5): CrossValidationResult {
  if (rows.length < k * 2) {
    const single = fitModel(rows);
    return { meanR2: single.r2, stdR2: 0, maes: [single.meanAbsoluteError] };
  }
  const foldSize = Math.floor(rows.length / k);
  const r2s: number[] = [];
  const maes: number[] = [];
  for (let f = 0; f < k; f++) {
    const start = f * foldSize;
    const end = f === k - 1 ? rows.length : start + foldSize;
    const test = rows.slice(start, end);
    const train = [...rows.slice(0, start), ...rows.slice(end)];
    const model = fitModel(train);
    let ssRes = 0, ssTot = 0, absErr = 0;
    const testCosts = test.map(r => r.costUsd);
    const yMean = avg(testCosts);
    for (const r of test) {
      const pred = predictCost(r.features, model);
      ssRes += (r.costUsd - pred) ** 2;
      ssTot += (r.costUsd - yMean) ** 2;
      absErr += Math.abs(r.costUsd - pred);
    }
    r2s.push(ssTot > 0 ? 1 - ssRes / ssTot : 0);
    maes.push(absErr / test.length);
  }
  const meanR2 = avg(r2s);
  const variance = avg(r2s.map(r => (r - meanR2) ** 2));
  return { meanR2, stdR2: Math.sqrt(variance), maes };
}
