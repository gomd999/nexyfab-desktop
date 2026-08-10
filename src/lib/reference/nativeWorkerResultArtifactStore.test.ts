import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeWorkerExecutionJob, NativeWorkerExecutionResult } from './nativeWorkerExecution';
import { hydrateNativeWorkerAcceptedResults, persistNativeWorkerResultArtifacts } from './nativeWorkerResultArtifactStore';

const hash = 'a'.repeat(64), identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const state = { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false, mirrored: false };
const job: NativeWorkerExecutionJob = { schema: 'nexyfab.native-worker-routing-job.v1', jobId: 'job', caseId: 'case', sourceHash: hash, source: { kind: 'direct', locator: 'set/robot.snapshot.1/root.sldasm', sha256: hash, bytes: 10, extension: 'sldasm' }, workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true, status: 'not_run' };
const result: NativeWorkerExecutionResult = { schema: 'nexyfab.native-worker-execution-result.v1.1', jobId: 'job', caseId: 'case', sourceHash: hash, sourceSha256: hash, worker: { name: 'worker', version: '1', cadSystem: 'SOLIDWORKS' }, coordinateSystem: { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' }, units: { length: 'mm', angle: 'deg' }, definitions: [{ id: 'assembly', kind: 'assembly' }, { id: 'part', kind: 'part', bodyCount: 1 }], occurrences: [{ id: 'root', definitionId: 'assembly', parentOccurrenceId: null, localToParent: identity, state }, { id: 'part', definitionId: 'part', parentOccurrenceId: 'root', localToParent: identity, state }], joints: [{ id: 'fixed', kind: 'fixed', occurrenceA: 'root', occurrenceB: 'part', axis: null, originMm: null, lowerLimit: null, upperLimit: null, frame: 'world' }], nativeSemantics: { complete: true, hierarchyRecovered: true, constraintsRecovered: true } };
const resultSha256 = createHash('sha256').update(`${JSON.stringify(result)}\n`).digest('hex');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('native worker result artifact store', () => {
  it('keeps the report index small and hydrates an immutable result', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-result-store-')); roots.push(root);
    const store = path.join(root, 'native-worker-results');
    const accepted = [{ job, result, resultSha256 }];
    const index = persistNativeWorkerResultArtifacts(accepted, store);
    expect(index[0]).toMatchObject({ resultArtifact: expect.stringMatching(/^[a-f0-9]{40}\.json$/), resultSha256 });
    expect(JSON.stringify(index)).not.toContain('coordinateSystem');
    const hydrated = hydrateNativeWorkerAcceptedResults({ schema: 'nexyfab.native-worker-execution-batch.v1.1', manifestSha256: hash, artifactStore: { nativeResultsDirectory: 'native-worker-results' }, accepted: index }, root);
    expect(hydrated).toEqual(accepted);
    expect(persistNativeWorkerResultArtifacts(accepted, store)).toEqual(index);
  });

  it('rejects artifact tampering and unsafe store names', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-result-store-')); roots.push(root);
    const store = path.join(root, 'native-worker-results'), index = persistNativeWorkerResultArtifacts([{ job, result, resultSha256 }], store);
    fs.writeFileSync(path.join(store, index[0]!.resultArtifact), 'tampered');
    expect(() => hydrateNativeWorkerAcceptedResults({ schema: 'nexyfab.native-worker-execution-batch.v1.1', manifestSha256: hash, artifactStore: { nativeResultsDirectory: 'native-worker-results' }, accepted: index }, root)).toThrow('native_result_artifact_hash_mismatch');
    expect(() => hydrateNativeWorkerAcceptedResults({ schema: 'nexyfab.native-worker-execution-batch.v1.1', manifestSha256: hash, artifactStore: { nativeResultsDirectory: '../outside' }, accepted: index }, root)).toThrow('native_result_store_name_invalid');
    expect(() => hydrateNativeWorkerAcceptedResults({ schema: 'nexyfab.native-worker-execution-batch.v1', manifestSha256: hash, artifactStore: { nativeResultsDirectory: 'native-worker-results' }, accepted: index }, root)).toThrow('indexed_native_results_require_v1_1_report');
  });

  it('hydrates a validated legacy inline report during migration', () => {
    expect(hydrateNativeWorkerAcceptedResults({ schema: 'nexyfab.native-worker-execution-batch.v1', manifestSha256: hash, accepted: [{ job, result, resultSha256 }] }, '.')).toEqual([{ job, result, resultSha256 }]);
  });

  it('rejects duplicate job entries before persistence or resume hydration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-result-store-')); roots.push(root);
    const accepted = { job, result, resultSha256 };
    expect(() => persistNativeWorkerResultArtifacts([accepted, accepted], path.join(root, 'native-worker-results'))).toThrow('accepted_native_result_job_duplicate');
    expect(() => hydrateNativeWorkerAcceptedResults({ schema: 'nexyfab.native-worker-execution-batch.v1', manifestSha256: hash, accepted: [accepted, accepted] }, root)).toThrow('native_result_index_job_duplicate');
  });
});
