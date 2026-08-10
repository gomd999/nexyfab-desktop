import { describe, expect, it } from 'vitest';
import { validateNativeWorkerExecutionResult, type NativeWorkerExecutionJob, type NativeWorkerExecutionResult } from './nativeWorkerExecution';

const hash = 'a'.repeat(64);
const job: NativeWorkerExecutionJob = { schema: 'nexyfab.native-worker-routing-job.v1', jobId: 'job-1', caseId: 'case-1', sourceHash: hash, source: { kind: 'direct', locator: 'a.sldasm', sha256: hash, bytes: 10, extension: 'sldasm' }, workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true, status: 'not_run' };
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const state = { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false, mirrored: false };
const result: NativeWorkerExecutionResult = { schema: 'nexyfab.native-worker-execution-result.v1.1', jobId: 'job-1', caseId: 'case-1', sourceHash: hash, sourceSha256: hash, worker: { name: 'worker', version: '1', cadSystem: 'CAD' }, coordinateSystem: { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' }, units: { length: 'mm', angle: 'deg' }, definitions: [{ id: 'assembly', kind: 'assembly' }, { id: 'part', kind: 'part', bodyCount: 1 }], occurrences: [{ id: 'root', definitionId: 'assembly', parentOccurrenceId: null, localToParent: identity, state }, { id: 'part-1', definitionId: 'part', parentOccurrenceId: 'root', localToParent: identity, state }], joints: [{ id: 'joint-1', kind: 'fixed', occurrenceA: 'root', occurrenceB: 'part-1', axis: null, originMm: null, lowerLimit: null, upperLimit: null, frame: 'world' }], nativeSemantics: { complete: true, hierarchyRecovered: true, constraintsRecovered: true } };

describe('validateNativeWorkerExecutionResult', () => {
  it('accepts a hash-bound native assembly result', () => expect(validateNativeWorkerExecutionResult(job, result)).toEqual({ status: 'pass', releaseReady: true, errors: [] }));
  it('rejects non-rigid transforms', () => expect(validateNativeWorkerExecutionResult(job, { ...result, occurrences: [{ ...result.occurrences[0]!, localToParent: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }).errors).toContain('occurrence_transform_invalid:root'));
  it('rejects reflection matrices even when their axes are orthonormal', () => expect(validateNativeWorkerExecutionResult(job, { ...result, occurrences: [{ ...result.occurrences[0]!, localToParent: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }).errors).toContain('occurrence_transform_invalid:root'));
  it('accepts an explicitly declared mirrored occurrence', () => expect(validateNativeWorkerExecutionResult(job, { ...result, occurrences: [{ ...result.occurrences[0]!, localToParent: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], state: { ...state, mirrored: true } }, result.occurrences[1]!] })).toMatchObject({ releaseReady: true, errors: [] }));
  it('requires axis, origin and ordered limits for movable native joints', () => {
    const movable = { ...result, joints: [{ ...result.joints[0]!, kind: 'revolute' as const, lowerLimit: 90, upperLimit: -90 }] };
    expect(validateNativeWorkerExecutionResult(job, movable).errors).toEqual(expect.arrayContaining(['joint_axis_invalid:joint-1', 'joint_origin_invalid:joint-1', 'joint_limits_invalid:joint-1']));
  });
  it('rejects missing native constraint semantics', () => expect(validateNativeWorkerExecutionResult(job, { ...result, nativeSemantics: { complete: false, hierarchyRecovered: true, constraintsRecovered: false } }).errors).toContain('native_semantics_incomplete'));
  it('rejects a disconnected cyclic occurrence island', () => {
    const cyclic = { ...result, occurrences: [...result.occurrences, { id: 'cycle-a', definitionId: 'part', parentOccurrenceId: 'cycle-b', localToParent: identity, state }, { id: 'cycle-b', definitionId: 'part', parentOccurrenceId: 'cycle-a', localToParent: identity, state }] };
    expect(validateNativeWorkerExecutionResult(job, cyclic).errors).toEqual(expect.arrayContaining(['occurrence_cycle:cycle-a', 'occurrence_cycle:cycle-b']));
  });
  it('rejects duplicate joint IDs and invalid runtime enum values', () => {
    const invalid = { ...result, units: { length: 'yard', angle: 'turn' }, joints: [...result.joints, { ...result.joints[0]!, kind: 'gear' }] } as unknown as NativeWorkerExecutionResult;
    expect(validateNativeWorkerExecutionResult(job, invalid).errors).toEqual(expect.arrayContaining(['units_invalid', 'joint_id_invalid:joint-1', 'joint_kind_invalid:joint-1']));
  });
  it('validates a deep complex assembly hierarchy without recursive stack growth', () => {
    const occurrences: NativeWorkerExecutionResult['occurrences'] = [{ id: 'root', definitionId: 'assembly', parentOccurrenceId: null, localToParent: identity, state }];
    for (let index = 1; index <= 20_000; index += 1) occurrences.push({ id: `part-${index}`, definitionId: 'part', parentOccurrenceId: index === 1 ? 'root' : `part-${index - 1}`, localToParent: identity, state });
    expect(validateNativeWorkerExecutionResult(job, { ...result, occurrences, joints: [] })).toMatchObject({ releaseReady: true, errors: [] });
  });
});
