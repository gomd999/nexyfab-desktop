import { describe, expect, it } from 'vitest';
import { validateNativeWorkerExecutionResult, type NativeWorkerExecutionJob, type NativeWorkerExecutionResult } from './nativeWorkerExecution';

const hash = 'a'.repeat(64);
const job: NativeWorkerExecutionJob = { schema: 'nexyfab.native-worker-routing-job.v1', jobId: 'job-1', caseId: 'case-1', sourceHash: hash, source: { kind: 'direct', locator: 'a.sldasm', sha256: hash, bytes: 10, extension: 'sldasm' }, workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true, status: 'not_run' };
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const result: NativeWorkerExecutionResult = { schema: 'nexyfab.native-worker-execution-result.v1', jobId: 'job-1', caseId: 'case-1', sourceHash: hash, sourceSha256: hash, worker: { name: 'worker', version: '1', cadSystem: 'CAD' }, units: { length: 'mm', angle: 'deg' }, definitions: [{ id: 'assembly', kind: 'assembly' }, { id: 'part', kind: 'part', bodyCount: 1 }], occurrences: [{ id: 'root', definitionId: 'assembly', parentOccurrenceId: null, localToParent: identity }, { id: 'part-1', definitionId: 'part', parentOccurrenceId: 'root', localToParent: identity }], joints: [{ id: 'joint-1', kind: 'fixed', occurrenceA: 'root', occurrenceB: 'part-1' }], nativeSemantics: { complete: true, hierarchyRecovered: true, constraintsRecovered: true } };

describe('validateNativeWorkerExecutionResult', () => {
  it('accepts a hash-bound native assembly result', () => expect(validateNativeWorkerExecutionResult(job, result)).toEqual({ status: 'pass', releaseReady: true, errors: [] }));
  it('rejects non-rigid transforms', () => expect(validateNativeWorkerExecutionResult(job, { ...result, occurrences: [{ ...result.occurrences[0]!, localToParent: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }).errors).toContain('occurrence_transform_invalid:root'));
  it('rejects missing native constraint semantics', () => expect(validateNativeWorkerExecutionResult(job, { ...result, nativeSemantics: { complete: false, hierarchyRecovered: true, constraintsRecovered: false } }).errors).toContain('native_semantics_incomplete'));
});
