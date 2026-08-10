import type { NativeWorkerExecutionJob } from './nativeWorkerExecution';

export interface NativeWorkerCanaryAuthorizationArtifact {
  schema: string;
  generatedAt?: string;
  healthGeneratedAt?: string | null;
  validUntil?: string | null;
  manifestSha256?: string;
  gates: Array<{
    workerKind: string;
    status: 'pass' | 'ready_to_run' | 'blocked_health';
    canaryJobId: string;
    workerIdentitySha256?: string | null;
  }>;
}

export function authorizeNativeWorkerJobs(
  jobs: NativeWorkerExecutionJob[],
  artifact: NativeWorkerCanaryAuthorizationArtifact,
  options: { nowMs?: number; maxAgeMs?: number; manifestSha256?: string } = {},
) {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
  const generatedAtMs = typeof artifact.generatedAt === 'string' ? Date.parse(artifact.generatedAt) : Number.NaN;
  if (artifact.schema !== 'nexyfab.native-worker-canary-gate.v1' || !Number.isFinite(generatedAtMs) || generatedAtMs > nowMs || nowMs - generatedAtMs > maxAgeMs) throw new Error('native_worker_canary_gate_stale_or_invalid');
  const validUntilMs = typeof artifact.validUntil === 'string' ? Date.parse(artifact.validUntil) : Number.NaN;
  if (!Number.isFinite(validUntilMs) || validUntilMs < nowMs) throw new Error('native_worker_health_evidence_expired');
  if (options.manifestSha256 && artifact.manifestSha256 !== options.manifestSha256) throw new Error('native_worker_canary_manifest_mismatch');
  if (new Set(jobs.map((job) => job.jobId)).size !== jobs.length) throw new Error('native_worker_job_id_duplicate');
  const identityByWorker = new Map<string, string>();
  for (const job of jobs) {
    const gates = artifact.gates.filter((item) => item.workerKind === job.workerKind);
    if (gates.length !== 1) throw new Error(`${gates.length ? 'native_worker_canary_gate_duplicate' : 'native_worker_canary_gate_missing'}:${job.workerKind}`);
    const gate = gates[0]!;
    const isDeclaredCanary = gate.canaryJobId === job.jobId;
    if (gate.status !== 'pass' && !(jobs.length === 1 && isDeclaredCanary && gate.status === 'ready_to_run')) throw new Error(`native_worker_canary_required:${job.workerKind}:${job.jobId}`);
    if (!gate.workerIdentitySha256) throw new Error(`native_worker_identity_evidence_missing:${job.workerKind}`);
    identityByWorker.set(job.workerKind, gate.workerIdentitySha256);
  }
  return { generatedAt: artifact.generatedAt!, identityByWorker };
}
