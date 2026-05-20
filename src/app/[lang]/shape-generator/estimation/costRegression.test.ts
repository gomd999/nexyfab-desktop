import { describe, it, expect } from 'vitest';
import {
  fitModel,
  predictCost,
  rankFeatureImportance,
  kFoldCrossValidate,
  type TrainingRow,
  type PartFeatures,
} from './costRegression';

function feat(opts: Partial<PartFeatures> = {}): PartFeatures {
  return {
    volumeCm3: 10,
    holeCount: 0,
    bendCount: 0,
    surfaceAreaCm2: 50,
    tightestToleranceUm: 100,
    material: 'aluminum',
    finish: 'as-machined',
    ...opts,
  };
}

/** Synthetic dataset: cost = 5 + 2*volume + 3*holes + material_bonus + noise. */
function buildSyntheticDataset(n: number): TrainingRow[] {
  const rows: TrainingRow[] = [];
  const materials = ['aluminum', 'steel', 'titanium'];
  const matBonus: Record<string, number> = { aluminum: 0, steel: 5, titanium: 20 };
  for (let i = 0; i < n; i++) {
    const volume = 5 + (i % 20);
    const holes = (i % 5);
    const material = materials[i % materials.length]!;
    const cost = 5 + 2 * volume + 3 * holes + (matBonus[material] ?? 0);
    rows.push({
      features: feat({ volumeCm3: volume, holeCount: holes, material }),
      costUsd: cost,
    });
  }
  return rows;
}

describe('fitModel', () => {
  it('returns empty model for thin data', () => {
    const m = fitModel([]);
    expect(m.r2).toBe(0);
    expect(m.trainingRows).toBe(0);
  });

  it('recovers known synthetic coefficients', () => {
    const rows = buildSyntheticDataset(60);
    const m = fitModel(rows);
    // β₁ (volume) should be ~2.
    expect(m.numericCoefficients[1]).toBeCloseTo(2, 1);
    // β₂ (holes) should be ~3.
    expect(m.numericCoefficients[2]).toBeCloseTo(3, 1);
  });

  it('R² is high for clean synthetic data', () => {
    const rows = buildSyntheticDataset(60);
    const m = fitModel(rows);
    expect(m.r2).toBeGreaterThan(0.95);
  });

  it('material coefficients differ from baseline', () => {
    const rows = buildSyntheticDataset(60);
    const m = fitModel(rows);
    const aluminumCoef = m.materialCoefficients.get('aluminum') ?? 0;
    const titaniumCoef = m.materialCoefficients.get('titanium') ?? 0;
    expect(titaniumCoef).toBeGreaterThan(aluminumCoef);
  });

  it('MAE positive', () => {
    const rows = buildSyntheticDataset(30);
    const m = fitModel(rows);
    expect(m.meanAbsoluteError).toBeGreaterThanOrEqual(0);
  });
});

describe('predictCost', () => {
  it('matches fitted model on training point', () => {
    const rows = buildSyntheticDataset(60);
    const m = fitModel(rows);
    const p = predictCost(rows[0]!.features, m);
    expect(p).toBeCloseTo(rows[0]!.costUsd, 0); // within $1 of training cost
  });

  it('predictions are non-negative', () => {
    const rows = buildSyntheticDataset(60);
    const m = fitModel(rows);
    const tiny = predictCost({ ...feat(), volumeCm3: -100 }, m);
    expect(tiny).toBeGreaterThanOrEqual(0);
  });

  it('unknown material → 0 contribution from material', () => {
    const rows = buildSyntheticDataset(60);
    const m = fitModel(rows);
    const known = predictCost(feat({ material: 'aluminum' }), m);
    const unknown = predictCost(feat({ material: 'unobtainium' }), m);
    expect(known).toBeCloseTo(unknown + (m.materialCoefficients.get('aluminum') ?? 0), 5);
  });
});

describe('rankFeatureImportance', () => {
  it('sorts by absolute contribution', () => {
    const rows = buildSyntheticDataset(60);
    const m = fitModel(rows);
    const ranked = rankFeatureImportance(m, rows);
    for (let i = 1; i < ranked.length; i++) {
      expect(Math.abs(ranked[i]!.contributionUsd)).toBeLessThanOrEqual(Math.abs(ranked[i - 1]!.contributionUsd));
    }
  });

  it('volume has positive sign', () => {
    const rows = buildSyntheticDataset(60);
    const m = fitModel(rows);
    const ranked = rankFeatureImportance(m, rows);
    const volume = ranked.find(r => r.feature === 'volume_cm3');
    expect(volume?.sign).toBe('positive');
  });

  it('empty rows → empty result', () => {
    expect(rankFeatureImportance({
      numericCoefficients: [0, 0, 0, 0, 0, 0],
      materialCoefficients: new Map(),
      finishCoefficients: new Map(),
      r2: 0, trainingRows: 0, meanAbsoluteError: 0,
    }, [])).toEqual([]);
  });
});

describe('kFoldCrossValidate', () => {
  it('returns one MAE per fold', () => {
    const rows = buildSyntheticDataset(50);
    const r = kFoldCrossValidate(rows, 5);
    expect(r.maes).toHaveLength(5);
  });

  it('mean R² high on synthetic data', () => {
    const rows = buildSyntheticDataset(60);
    const r = kFoldCrossValidate(rows, 5);
    expect(r.meanR2).toBeGreaterThan(0.7);
  });

  it('falls back gracefully for tiny sets', () => {
    const rows = buildSyntheticDataset(3);
    const r = kFoldCrossValidate(rows, 5);
    expect(r.maes.length).toBeGreaterThan(0);
  });
});
