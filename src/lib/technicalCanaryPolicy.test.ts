import { describe, expect, it } from 'vitest';
import { evaluateTechnicalCanary, type TechnicalCanaryObservation } from './technicalCanaryPolicy';

const window = (overrides: Partial<TechnicalCanaryObservation> = {}): TechnicalCanaryObservation => ({
  buildId: 'build-a', trafficPercent: 1, requests: 100, errorRate: 0, p95GenerationMs: 10_000, p99GenerationMs: 20_000,
  verifiedAccuracyRate: 1, falseVerified: 0, kernelStubExecutions: 0, securityIncidents: 0, closedBetaTableDiff: 0, closedBetaFileDiff: 0, ...overrides,
});

describe('technical canary policy', () => {
  it('promotes only after three sufficiently populated stable windows', () => {
    expect(evaluateTechnicalCanary([window(), window()]).action).toBe('hold');
    expect(evaluateTechnicalCanary([window(), window(), window()])).toMatchObject({ action: 'promote', nextTrafficPercent: 10 });
  });
  it('rolls back immediately on Closed Beta drift, false verification, security incident, or stub use', () => {
    for (const bad of [{ closedBetaFileDiff: 1 }, { falseVerified: 1 }, { securityIncidents: 1 }, { kernelStubExecutions: 1 }]) {
      expect(evaluateTechnicalCanary([window(bad)])).toMatchObject({ action: 'rollback', rollbackRequired: true });
    }
  });
  it('rolls back on latency, reliability, or accuracy regression', () => {
    const slow = window({ p95GenerationMs: 30_001, errorRate: 0.02, verifiedAccuracyRate: 0.94 });
    expect(evaluateTechnicalCanary([slow, slow, slow]).reasons).toEqual(expect.arrayContaining(['window_0:p95_generation_latency', 'window_0:error_rate', 'window_0:verified_accuracy']));
  });
  it('completes only a stable 100 percent rollout', () => {
    const full = window({ trafficPercent: 100 });
    expect(evaluateTechnicalCanary([full, full, full]).action).toBe('complete');
  });
});
