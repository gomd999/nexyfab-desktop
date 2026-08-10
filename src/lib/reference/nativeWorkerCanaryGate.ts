import { createHash } from 'node:crypto';
import { validateNativeWorkerHealth, type ExternalNativeWorkerKind, type NativeWorkerHealth } from './nativeWorkerHostContract';
import { validateNativeWorkerExecutionResult, type NativeWorkerExecutionJob, type NativeWorkerExecutionResult } from './nativeWorkerExecution';

interface HealthBatch {
  generatedAt?: string;
  results: Array<{ workerKind: ExternalNativeWorkerKind; status: 'pass' | 'fail' | 'not_run'; health?: NativeWorkerHealth }>;
}
interface ExecutionItem { job: NativeWorkerExecutionJob; result: NativeWorkerExecutionResult; resultSha256: string }
interface ExecutionBatch { manifestSha256?: string; accepted: ExecutionItem[] }

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const nativeWorkerIdentitySha256 = (worker: NativeWorkerExecutionResult['worker']) =>
  sha256(JSON.stringify([worker.name, worker.version, worker.cadSystem]));
const sameWorker = (health: NativeWorkerHealth['worker'], result: NativeWorkerExecutionResult['worker']) =>
  health.name === result.name && health.version === result.version && health.cadSystem === result.cadSystem;

export function buildNativeWorkerCanaryGate(input: {
  jobs: NativeWorkerExecutionJob[];
  manifestSha256: string;
  health: HealthBatch;
  execution: ExecutionBatch;
  nowMs?: number;
  maxHealthAgeMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const maxHealthAgeMs = input.maxHealthAgeMs ?? 24 * 60 * 60 * 1000;
  const healthAt = typeof input.health.generatedAt === 'string' ? Date.parse(input.health.generatedAt) : Number.NaN;
  const healthFresh = Number.isFinite(healthAt) && healthAt <= nowMs && nowMs - healthAt <= maxHealthAgeMs;
  const manifestMatches = input.execution.manifestSha256 === input.manifestSha256;
  const workerKinds = [...new Set(input.jobs.filter((job) => job.availability === 'external-required').map((job) => job.workerKind as ExternalNativeWorkerKind))].sort();

  const gates = workerKinds.map((workerKind) => {
    const candidates = input.jobs.filter((job) => job.workerKind === workerKind && job.availability === 'external-required').sort((a, b) => a.jobId.localeCompare(b.jobId));
    const canary = candidates[0]!;
    const healthItems = input.health.results.filter((item) => item.workerKind === workerKind);
    const healthItem = healthItems.length === 1 ? healthItems[0] : undefined;
    const acceptedItems = input.execution.accepted.filter((item) => item.job.jobId === canary.jobId);
    const accepted = acceptedItems.length === 1 ? acceptedItems[0] : undefined;
    const healthValidation = healthItem?.health
      ? validateNativeWorkerHealth(workerKind, healthItem.health)
      : null;
    const errors: string[] = [];
    if (healthItems.length > 1) errors.push('health_evidence_duplicate');
    if (acceptedItems.length > 1) errors.push('canary_execution_evidence_duplicate');
    if (new Set(candidates.map((item) => item.jobId)).size !== candidates.length) errors.push('candidate_job_id_duplicate');
    if (!healthFresh) errors.push('health_evidence_stale_or_missing_timestamp');
    if (healthItem?.status !== 'pass' || !healthItem.health) errors.push('health_not_passed');
    if (healthValidation && !healthValidation.ready) errors.push(...healthValidation.errors);
    if (!manifestMatches) errors.push('execution_manifest_hash_mismatch');
    if (accepted) {
      const validation = validateNativeWorkerExecutionResult(canary, accepted.result);
      if (!validation.releaseReady) errors.push(...validation.errors);
      if (sha256(`${JSON.stringify(accepted.result)}\n`) !== accepted.resultSha256) errors.push('execution_result_hash_mismatch');
      if (accepted.job.jobId !== canary.jobId || accepted.job.sourceHash !== canary.sourceHash) errors.push('accepted_job_mismatch');
      if (healthItem?.health && !sameWorker(healthItem.health.worker, accepted.result.worker)) errors.push('worker_identity_version_mismatch');
    }
    const healthBlocked = !healthFresh || healthItems.length !== 1 || healthItem?.status !== 'pass' || !healthItem.health || !healthValidation?.ready;
    const status = healthBlocked ? 'blocked_health' as const : accepted && errors.length === 0 ? 'pass' as const : 'ready_to_run' as const;
    return {
      workerKind, status, healthStatus: healthFresh ? healthItem?.status ?? 'not_run' : 'not_run',
      canaryJobId: canary.jobId, caseId: canary.caseId, extension: canary.source.extension,
      candidateJobs: candidates.length, accepted: status === 'pass', errors,
      workerIdentitySha256: healthValidation?.ready && healthItem?.health ? nativeWorkerIdentitySha256(healthItem.health.worker) : null,
    };
  });

  return {
    schema: 'nexyfab.native-worker-canary-gate.v1' as const,
    generatedAt: new Date(nowMs).toISOString(),
    healthGeneratedAt: Number.isFinite(healthAt) ? new Date(healthAt).toISOString() : null,
    validUntil: Number.isFinite(healthAt) ? new Date(healthAt + maxHealthAgeMs).toISOString() : null,
    manifestSha256: input.manifestSha256,
    policy: { oneDeterministicCanaryPerWorker: true, freshHealthRequiredBeforeCanary: true, workerIdentityVersionBound: true, manifestAndResultHashBound: true, canaryRequiredBeforeBatch: true },
    releaseReady: gates.every((item) => item.status === 'pass'),
    summary: { workers: gates.length, pass: gates.filter((item) => item.status === 'pass').length, readyToRun: gates.filter((item) => item.status === 'ready_to_run').length, blockedHealth: gates.filter((item) => item.status === 'blocked_health').length },
    gates,
  };
}
