import {
  NATIVE_WORKER_HOST_REQUIREMENTS,
  type ExternalNativeWorkerKind,
} from './nativeWorkerHostContract';

export type NativeWorkerOperationalStatus =
  | 'unconfigured'
  | 'configured_unprobed'
  | 'health_failed'
  | 'health_stale'
  | 'ready_for_canary'
  | 'canary_passed';

export interface NativeWorkerProbeEvidence {
  observedAtMs: number;
  results: Array<{ workerKind: ExternalNativeWorkerKind; status: 'pass' | 'fail' | 'not_run'; validated: boolean }>;
}

export interface NativeWorkerCanaryEvidence {
  observedAtMs: number;
  validUntilMs: number;
  manifestSha256: string;
  gates: Array<{ workerKind: ExternalNativeWorkerKind; status: 'pass' | 'ready_to_run' | 'blocked_health'; workerIdentitySha256?: string | null }>;
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;

export function evaluateNativeWorkerReadiness(
  env: Record<string, string | undefined>,
  health: NativeWorkerProbeEvidence | null,
  canary: NativeWorkerCanaryEvidence | null,
  options: { nowMs?: number; maxEvidenceAgeMs?: number } = {},
) {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxEvidenceAgeMs ?? DEFAULT_MAX_AGE_MS;
  const healthFresh = Boolean(health && nowMs - health.observedAtMs >= 0 && nowMs - health.observedAtMs <= maxAgeMs);
  const canaryObservedFresh = Boolean(canary && nowMs - canary.observedAtMs >= 0 && nowMs - canary.observedAtMs <= maxAgeMs);
  const canaryContractValid = Boolean(canary && Number.isFinite(canary.validUntilMs) && SHA256.test(canary.manifestSha256));
  const canaryHealthUnexpired = Boolean(canary && Number.isFinite(canary.validUntilMs) && canary.validUntilMs >= nowMs);
  const canaryFresh = Boolean(canary
    && canaryObservedFresh
    && canaryContractValid
    && canaryHealthUnexpired);

  const workers = (Object.entries(NATIVE_WORKER_HOST_REQUIREMENTS) as Array<[
    ExternalNativeWorkerKind,
    (typeof NATIVE_WORKER_HOST_REQUIREMENTS)[ExternalNativeWorkerKind],
  ]>).map(([workerKind, requirement]) => {
    const configured = Boolean(env[requirement.environment]?.trim());
    const healthItems = health?.results.filter((item) => item.workerKind === workerKind) ?? [];
    const healthItem = healthItems.length === 1 ? healthItems[0] : undefined;
    const healthStatus = healthItems.length > 1 ? 'fail' : healthItem?.validated ? healthItem.status : healthItem ? 'fail' : 'not_run';
    const canaryItems = canary?.gates.filter((item) => item.workerKind === workerKind) ?? [];
    const canaryItem = canaryItems.length === 1 ? canaryItems[0] : undefined;
    const canaryStatus = canaryItem?.status === 'pass' && !SHA256.test(canaryItem.workerIdentitySha256 ?? '')
      ? 'blocked_health'
      : canaryItems.length > 1 ? 'blocked_health' : canaryItem?.status ?? 'blocked_health';
    let status: NativeWorkerOperationalStatus;
    if (!configured) status = 'unconfigured';
    else if (!health) status = 'configured_unprobed';
    else if (!healthFresh) status = 'health_stale';
    else if (healthStatus !== 'pass') status = healthStatus === 'fail' ? 'health_failed' : 'configured_unprobed';
    else if (canaryFresh && canaryStatus === 'pass') status = 'canary_passed';
    else status = 'ready_for_canary';

    return {
      workerKind,
      nativeApplication: requirement.nativeApplication,
      configured,
      status,
      healthStatus: healthFresh ? healthStatus : 'not_run' as const,
      canaryStatus: canaryFresh ? canaryStatus : 'blocked_health' as const,
      batchEligible: status === 'canary_passed',
    };
  });

  return {
    releaseReady: workers.every((worker) => worker.batchEligible),
    evidenceStatus: {
      health: !health ? 'missing' as const : healthFresh ? 'fresh' as const : 'stale' as const,
      canary: !canary ? 'missing' as const
        : !canaryContractValid ? 'invalid' as const
          : !canaryHealthUnexpired ? 'expired' as const
            : canaryObservedFresh ? 'fresh' as const : 'stale' as const,
    },
    policy: {
      commandPresenceIsNotReadiness: true,
      healthMaxAgeMs: maxAgeMs,
      canaryRequiredBeforeBatch: true,
      healthPayloadRevalidated: true,
      healthExpiryInheritedByCanary: true,
      manifestAndWorkerIdentityRequired: true,
      secretsAndCommandPathsExcluded: true,
    },
    summary: {
      workers: workers.length,
      configured: workers.filter((worker) => worker.configured).length,
      healthReady: workers.filter((worker) => worker.status === 'ready_for_canary' || worker.status === 'canary_passed').length,
      canaryPassed: workers.filter((worker) => worker.status === 'canary_passed').length,
    },
    workers,
  };
}
