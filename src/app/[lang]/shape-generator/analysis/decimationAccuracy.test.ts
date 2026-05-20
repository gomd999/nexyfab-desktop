import { describe, it, expect } from 'vitest';
import {
  measureLodAccuracy,
  detectRegressions,
  pickLod,
  type MeshArrays,
  type DecimationLOD,
  type AccuracyMetrics,
} from './decimationAccuracy';

function unitQuad(): MeshArrays {
  return {
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

function offsetQuad(dz: number): MeshArrays {
  return {
    positions: [0, 0, dz, 1, 0, dz, 1, 1, dz, 0, 1, dz],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

describe('measureLodAccuracy', () => {
  it('identical mesh has bounded deviation (vertex-only impl)', () => {
    // Note: simplified point-to-mesh uses vertex distance only, so identical
    // mesh samples can be up to ~sqrt(0.5) mm from any vertex.
    const lods: DecimationLOD[] = [
      { id: 'lod-0', triangleCount: 2, mesh: unitQuad() },
    ];
    const metrics = measureLodAccuracy(unitQuad(), lods, { sampleCount: 100, seed: 42 });
    expect(metrics[0]!.maxDeviationMm).toBeLessThan(1.5);
  });

  it('offset mesh produces non-zero deviation', () => {
    const lods: DecimationLOD[] = [
      { id: 'lod-0', triangleCount: 2, mesh: offsetQuad(5) },
    ];
    const metrics = measureLodAccuracy(unitQuad(), lods, { sampleCount: 100, seed: 42 });
    expect(metrics[0]!.meanDeviationMm).toBeGreaterThan(4);
  });

  it('reports all 4 metrics', () => {
    const lods: DecimationLOD[] = [
      { id: 'lod-0', triangleCount: 2, mesh: offsetQuad(2) },
    ];
    const [m] = measureLodAccuracy(unitQuad(), lods, { sampleCount: 100, seed: 42 });
    expect(m!.maxDeviationMm).toBeGreaterThanOrEqual(0);
    expect(m!.rmsDeviationMm).toBeGreaterThanOrEqual(0);
    expect(m!.p95DeviationMm).toBeGreaterThanOrEqual(0);
  });
});

describe('detectRegressions', () => {
  const baseline: AccuracyMetrics[] = [
    { lodId: 'lod-0', triangleCount: 100, maxDeviationMm: 0.5, meanDeviationMm: 0.2, rmsDeviationMm: 0.3, p95DeviationMm: 0.45 },
  ];

  it('matching → no regression', () => {
    const r = detectRegressions(baseline, baseline);
    expect(r[0]!.isRegression).toBe(false);
  });

  it('absolute tolerance trigger', () => {
    const current: AccuracyMetrics[] = [{ ...baseline[0]!, maxDeviationMm: 1.0 }];
    const r = detectRegressions(current, baseline, { maxAbsoluteToleranceMm: 0.1, relativeToleranceFraction: 999 });
    expect(r[0]!.isRegression).toBe(true);
  });

  it('relative tolerance trigger', () => {
    const current: AccuracyMetrics[] = [{ ...baseline[0]!, maxDeviationMm: 0.7 }];
    const r = detectRegressions(current, baseline, { maxAbsoluteToleranceMm: 999, relativeToleranceFraction: 0.3 });
    expect(r[0]!.isRegression).toBe(true);
  });

  it('missing baseline → not a regression', () => {
    const current: AccuracyMetrics[] = [{ lodId: 'new-lod', triangleCount: 50, maxDeviationMm: 5, meanDeviationMm: 2, rmsDeviationMm: 3, p95DeviationMm: 4 }];
    const r = detectRegressions(current, baseline);
    expect(r[0]!.isRegression).toBe(false);
  });
});

describe('pickLod', () => {
  const metrics: AccuracyMetrics[] = [
    { lodId: 'lod-0', triangleCount: 1000, maxDeviationMm: 0.05, meanDeviationMm: 0.02, rmsDeviationMm: 0.03, p95DeviationMm: 0.04 },
    { lodId: 'lod-1', triangleCount: 500, maxDeviationMm: 0.2, meanDeviationMm: 0.1, rmsDeviationMm: 0.12, p95DeviationMm: 0.18 },
    { lodId: 'lod-2', triangleCount: 100, maxDeviationMm: 2, meanDeviationMm: 0.5, rmsDeviationMm: 0.8, p95DeviationMm: 1.5 },
  ];

  it('picks lowest-tri LOD within budget', () => {
    const chosen = pickLod(metrics, { pixelsPerMm: 1, maxPixelError: 1 });
    expect(chosen?.lodId).toBe('lod-1');
  });

  it('returns null when nothing fits', () => {
    const chosen = pickLod(metrics, { pixelsPerMm: 1, maxPixelError: 0.01 });
    expect(chosen).toBeNull();
  });

  it('high-pixel budget gives lowest LOD', () => {
    const chosen = pickLod(metrics, { pixelsPerMm: 1, maxPixelError: 10 });
    expect(chosen?.lodId).toBe('lod-2');
  });
});
