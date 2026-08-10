import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildNativeWorkerCanaryGate } from './nativeWorkerCanaryGate';
import type { NativeWorkerHealth } from './nativeWorkerHostContract';
import type { NativeWorkerExecutionJob, NativeWorkerExecutionResult } from './nativeWorkerExecution';

const hash = 'a'.repeat(64);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const job: NativeWorkerExecutionJob = { schema: 'nexyfab.native-worker-routing-job.v1', jobId: 'job-1', caseId: 'case-1', sourceHash: hash, source: { kind: 'direct', locator: 'a.sldasm', sha256: hash, bytes: 10, extension: 'sldasm' }, workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true, status: 'not_run' };
const worker = { name: 'worker', version: '1.2.3', cadSystem: 'SOLIDWORKS 2026' };
const healthRecord: NativeWorkerHealth = { schema: 'nexyfab.native-worker-health.v1', workerKind: 'solidworks-native', worker, protocol: { executionResultSchema: 'nexyfab.native-worker-execution-result.v1.1' }, host: { os: 'windows', architecture: 'x64' }, license: { status: 'valid' }, capabilities: { exactGeometry: true, nativeHierarchy: true, nativeConstraints: true, nativeParameters: true }, ready: true };
const state = { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false, mirrored: false };
const result: NativeWorkerExecutionResult = { schema: 'nexyfab.native-worker-execution-result.v1.1', jobId: 'job-1', caseId: 'case-1', sourceHash: hash, sourceSha256: hash, worker, coordinateSystem: { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' }, units: { length: 'mm', angle: 'deg' }, definitions: [{ id: 'assembly', kind: 'assembly' }, { id: 'part', kind: 'part', bodyCount: 1 }], occurrences: [{ id: 'root', definitionId: 'assembly', parentOccurrenceId: null, localToParent: identity, state }, { id: 'part-1', definitionId: 'part', parentOccurrenceId: 'root', localToParent: identity, state }], joints: [{ id: 'joint-1', kind: 'fixed', occurrenceA: 'root', occurrenceB: 'part-1', axis: null, originMm: null, lowerLimit: null, upperLimit: null, frame: 'world' }], nativeSemantics: { complete: true, hierarchyRecovered: true, constraintsRecovered: true } };
const resultSha256 = createHash('sha256').update(`${JSON.stringify(result)}\n`).digest('hex');
const now = Date.parse('2026-08-09T00:00:00.000Z');

const input = () => ({
  jobs: [job], manifestSha256: 'b'.repeat(64), nowMs: now,
  health: { generatedAt: '2026-08-08T23:00:00.000Z', results: [{ workerKind: 'solidworks-native' as const, status: 'pass' as const, health: healthRecord }] },
  execution: { manifestSha256: 'b'.repeat(64), accepted: [{ job, result, resultSha256 }] },
});

describe('native worker canary gate', () => {
  it('passes only a fresh, identity-bound, hash-valid canary', () => {
    expect(buildNativeWorkerCanaryGate(input())).toMatchObject({ releaseReady: true, summary: { pass: 1 }, gates: [{ status: 'pass', accepted: true, errors: [] }] });
  });

  it('blocks stale health before canary promotion', () => {
    const value = input(); value.health.generatedAt = '2026-08-07T00:00:00.000Z';
    expect(buildNativeWorkerCanaryGate(value)).toMatchObject({ releaseReady: false, gates: [{ status: 'blocked_health', errors: expect.arrayContaining(['health_evidence_stale_or_missing_timestamp']) }] });
  });

  it('revalidates embedded health instead of trusting a pass label', () => {
    const value = input();
    value.health.results[0]!.health = {
      ...healthRecord,
      license: { status: 'expired' },
      ready: true,
    };
    expect(buildNativeWorkerCanaryGate(value)).toMatchObject({
      releaseReady: false,
      gates: [{
        status: 'blocked_health',
        workerIdentitySha256: null,
        errors: expect.arrayContaining(['license_expired', 'ready_flag_inconsistent']),
      }],
    });
  });

  it('rejects a result from a different worker version', () => {
    const value = input(); value.execution.accepted[0]!.result = { ...result, worker: { ...worker, version: 'older' } };
    value.execution.accepted[0]!.resultSha256 = createHash('sha256').update(`${JSON.stringify(value.execution.accepted[0]!.result)}\n`).digest('hex');
    expect(buildNativeWorkerCanaryGate(value)).toMatchObject({ releaseReady: false, gates: [{ status: 'ready_to_run', accepted: false, errors: expect.arrayContaining(['worker_identity_version_mismatch']) }] });
  });

  it('rejects execution evidence from another manifest or with a bad result hash', () => {
    const value = input(); value.execution.manifestSha256 = 'c'.repeat(64); value.execution.accepted[0]!.resultSha256 = 'd'.repeat(64);
    expect(buildNativeWorkerCanaryGate(value)).toMatchObject({ releaseReady: false, gates: [{ status: 'ready_to_run', errors: expect.arrayContaining(['execution_manifest_hash_mismatch', 'execution_result_hash_mismatch']) }] });
  });

  it('fails closed on duplicate health or canary result evidence', () => {
    const duplicateHealth = input(); duplicateHealth.health.results.push(duplicateHealth.health.results[0]!);
    expect(buildNativeWorkerCanaryGate(duplicateHealth)).toMatchObject({ releaseReady: false, gates: [{ status: 'blocked_health', errors: expect.arrayContaining(['health_evidence_duplicate']) }] });
    const duplicateResult = input(); duplicateResult.execution.accepted.push(duplicateResult.execution.accepted[0]!);
    expect(buildNativeWorkerCanaryGate(duplicateResult)).toMatchObject({ releaseReady: false, gates: [{ status: 'ready_to_run', errors: expect.arrayContaining(['canary_execution_evidence_duplicate']) }] });
  });
});
