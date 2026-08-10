import { describe, expect, it } from 'vitest';
import { authorizeNativeWorkerJobs, type NativeWorkerCanaryAuthorizationArtifact } from './nativeWorkerExecutionAuthorization';
import type { NativeWorkerExecutionJob } from './nativeWorkerExecution';

const now = Date.parse('2026-08-09T00:00:00.000Z');
const job = (id: string): NativeWorkerExecutionJob => ({ schema: 'nexyfab.native-worker-routing-job.v1', jobId: id, caseId: id, sourceHash: 'a'.repeat(64), source: { kind: 'direct', locator: `${id}.sldasm`, sha256: 'a'.repeat(64), bytes: 1, extension: 'sldasm' }, workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true, status: 'not_run' });
const gate = (status: 'pass' | 'ready_to_run' | 'blocked_health'): NativeWorkerCanaryAuthorizationArtifact => ({ schema: 'nexyfab.native-worker-canary-gate.v1', generatedAt: '2026-08-08T23:00:00.000Z', healthGeneratedAt: '2026-08-08T23:00:00.000Z', validUntil: '2026-08-09T23:00:00.000Z', manifestSha256: 'c'.repeat(64), gates: [{ workerKind: 'solidworks-native', status, canaryJobId: 'canary', workerIdentitySha256: 'b'.repeat(64) }] });

describe('native worker execution authorization', () => {
  it('allows only the declared single canary before promotion', () => {
    expect(authorizeNativeWorkerJobs([job('canary')], gate('ready_to_run'), { nowMs: now }).identityByWorker.get('solidworks-native')).toBe('b'.repeat(64));
    expect(() => authorizeNativeWorkerJobs([job('other')], gate('ready_to_run'), { nowMs: now })).toThrow('native_worker_canary_required');
  });

  it('blocks a family batch until the worker canary passed', () => {
    expect(() => authorizeNativeWorkerJobs([job('canary'), job('other')], gate('ready_to_run'), { nowMs: now })).toThrow('native_worker_canary_required');
    expect(authorizeNativeWorkerJobs([job('canary'), job('other')], gate('pass'), { nowMs: now }).identityByWorker.size).toBe(1);
  });

  it('blocks stale gates and gates without a bound worker identity', () => {
    const stale = gate('pass'); stale.generatedAt = '2026-08-07T00:00:00.000Z';
    expect(() => authorizeNativeWorkerJobs([job('other')], stale, { nowMs: now })).toThrow('native_worker_canary_gate_stale_or_invalid');
    const missing = gate('pass'); missing.gates[0]!.workerIdentitySha256 = null;
    expect(() => authorizeNativeWorkerJobs([job('other')], missing, { nowMs: now })).toThrow('native_worker_identity_evidence_missing');
  });

  it('blocks a gate produced from a different routing manifest', () => {
    expect(() => authorizeNativeWorkerJobs([job('other')], gate('pass'), {
      nowMs: now,
      manifestSha256: 'd'.repeat(64),
    })).toThrow('native_worker_canary_manifest_mismatch');
  });

  it('expires with the underlying health evidence even if the gate is recent', () => {
    const artifact = gate('pass');
    artifact.generatedAt = '2026-08-09T00:00:00.000Z';
    artifact.validUntil = '2026-08-08T23:59:59.000Z';
    expect(() => authorizeNativeWorkerJobs([job('other')], artifact, { nowMs: now }))
      .toThrow('native_worker_health_evidence_expired');
  });

  it('rejects duplicate jobs and duplicate worker gates', () => {
    expect(() => authorizeNativeWorkerJobs([job('other'), job('other')], gate('pass'), { nowMs: now })).toThrow('native_worker_job_id_duplicate');
    const duplicated = gate('pass'); duplicated.gates.push({ ...duplicated.gates[0]! });
    expect(() => authorizeNativeWorkerJobs([job('other')], duplicated, { nowMs: now })).toThrow('native_worker_canary_gate_duplicate');
  });
});
