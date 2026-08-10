export const TECHNICAL_CANARY_PERCENTAGES = [1, 10, 50, 100] as const;
export type TechnicalCanaryPercentage = typeof TECHNICAL_CANARY_PERCENTAGES[number];

export interface TechnicalCanaryObservation {
  buildId: string;
  trafficPercent: TechnicalCanaryPercentage;
  requests: number;
  errorRate: number;
  p95GenerationMs: number;
  p99GenerationMs: number;
  verifiedAccuracyRate: number;
  falseVerified: number;
  kernelStubExecutions: number;
  securityIncidents: number;
  closedBetaTableDiff: number;
  closedBetaFileDiff: number;
}

export interface TechnicalCanaryPolicy {
  minimumRequestsPerWindow: number;
  stableWindowsRequired: number;
  maximumErrorRate: number;
  maximumP95GenerationMs: number;
  maximumP99GenerationMs: number;
  minimumVerifiedAccuracyRate: number;
}

export interface TechnicalCanaryDecision {
  action: 'hold' | 'promote' | 'complete' | 'rollback';
  currentTrafficPercent: TechnicalCanaryPercentage;
  nextTrafficPercent: TechnicalCanaryPercentage | null;
  reasons: string[];
  rollbackRequired: boolean;
}

export const DEFAULT_TECHNICAL_CANARY_POLICY: TechnicalCanaryPolicy = {
  minimumRequestsPerWindow: 100,
  stableWindowsRequired: 3,
  maximumErrorRate: 0.01,
  maximumP95GenerationMs: 30_000,
  maximumP99GenerationMs: 60_000,
  minimumVerifiedAccuracyRate: 0.95,
};

/** Fail-closed rollout decision. Integrity, security, false verification, or
 * stub-kernel use triggers immediate rollback; sparse evidence only holds. */
export function evaluateTechnicalCanary(
  observations: readonly TechnicalCanaryObservation[],
  policy: TechnicalCanaryPolicy = DEFAULT_TECHNICAL_CANARY_POLICY,
): TechnicalCanaryDecision {
  if (!observations.length) return { action: 'hold', currentTrafficPercent: 1, nextTrafficPercent: null, reasons: ['canary_observations_missing'], rollbackRequired: false };
  const current = observations.at(-1)!;
  const identityMismatch = observations.some(item => item.buildId !== current.buildId || item.trafficPercent !== current.trafficPercent);
  if (identityMismatch) return rollback(current.trafficPercent, ['canary_window_identity_mismatch']);
  const fatal = observations.flatMap((item, index) => [
    ...(item.falseVerified > 0 ? [`window_${index}:false_verified`] : []),
    ...(item.kernelStubExecutions > 0 ? [`window_${index}:kernel_stub_execution`] : []),
    ...(item.securityIncidents > 0 ? [`window_${index}:security_incident`] : []),
    ...(item.closedBetaTableDiff !== 0 || item.closedBetaFileDiff !== 0 ? [`window_${index}:closed_beta_integrity_drift`] : []),
  ]);
  if (fatal.length) return rollback(current.trafficPercent, fatal);
  const recent = observations.slice(-policy.stableWindowsRequired);
  if (recent.length < policy.stableWindowsRequired || recent.some(item => item.requests < policy.minimumRequestsPerWindow)) {
    return { action: 'hold', currentTrafficPercent: current.trafficPercent, nextTrafficPercent: null, reasons: ['canary_evidence_window_incomplete'], rollbackRequired: false };
  }
  const regression = recent.flatMap((item, index) => [
    ...(item.errorRate > policy.maximumErrorRate ? [`window_${index}:error_rate`] : []),
    ...(item.p95GenerationMs > policy.maximumP95GenerationMs ? [`window_${index}:p95_generation_latency`] : []),
    ...(item.p99GenerationMs > policy.maximumP99GenerationMs ? [`window_${index}:p99_generation_latency`] : []),
    ...(item.verifiedAccuracyRate < policy.minimumVerifiedAccuracyRate ? [`window_${index}:verified_accuracy`] : []),
  ]);
  if (regression.length) return rollback(current.trafficPercent, regression);
  const index = TECHNICAL_CANARY_PERCENTAGES.indexOf(current.trafficPercent);
  if (index < 0) return rollback(current.trafficPercent, ['canary_percentage_invalid']);
  if (current.trafficPercent === 100) return { action: 'complete', currentTrafficPercent: 100, nextTrafficPercent: null, reasons: [], rollbackRequired: false };
  return { action: 'promote', currentTrafficPercent: current.trafficPercent, nextTrafficPercent: TECHNICAL_CANARY_PERCENTAGES[index + 1]!, reasons: [], rollbackRequired: false };
}

function rollback(currentTrafficPercent: TechnicalCanaryPercentage, reasons: string[]): TechnicalCanaryDecision {
  return { action: 'rollback', currentTrafficPercent, nextTrafficPercent: null, reasons: [...new Set(reasons)], rollbackRequired: true };
}
