import { describe, expect, it } from 'vitest';
import { buildCadProductBundleManifest } from './cadCorpusProductBundle';
import { validateCadNativeAssemblyEvidence } from './cadNativeAssemblyEvidence';
import type { NativeWorkerExecutionJob, NativeWorkerExecutionResult } from './nativeWorkerExecution';
import { promoteNativeWorkerResultToAssemblyEvidence } from './nativeWorkerResultPromotion';

const bytes = new TextEncoder().encode('native assembly');
const bundle = buildCadProductBundleManifest([{ relativePath: 'set/robot.snapshot.1/root.sldasm', bytes }]);
const member = bundle.members[0]!;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const state = { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false, mirrored: false };
const job: NativeWorkerExecutionJob = { schema: 'nexyfab.native-worker-routing-job.v1', jobId: 'job', caseId: 'case', sourceHash: member.sha256, source: { kind: 'direct', locator: member.relativePath, sha256: member.sha256, bytes: bytes.length, extension: 'sldasm' }, workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true, status: 'not_run' };
const result: NativeWorkerExecutionResult = { schema: 'nexyfab.native-worker-execution-result.v1.1', jobId: 'job', caseId: 'case', sourceHash: member.sha256, sourceSha256: member.sha256, worker: { name: 'worker', version: '1', cadSystem: 'SOLIDWORKS' }, coordinateSystem: { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' }, units: { length: 'mm', angle: 'deg' }, definitions: [{ id: 'root-def', kind: 'assembly' }, { id: 'link-def', kind: 'part', bodyCount: 1 }], occurrences: [{ id: 'root', definitionId: 'root-def', parentOccurrenceId: null, localToParent: identity, state }, { id: 'link', definitionId: 'link-def', parentOccurrenceId: 'root', localToParent: identity, state }], joints: [{ id: 'hinge', kind: 'revolute', occurrenceA: 'root', occurrenceB: 'link', axis: [0, 0, 1], originMm: [0, 0, 0], lowerLimit: -90, upperLimit: 90, frame: 'world' }], nativeSemantics: { complete: true, hierarchyRecovered: true, constraintsRecovered: true } };

describe('native worker result promotion', () => {
  it('enters the governed v1.1 assembly and precision-joint evidence path', () => {
    const promoted = promoteNativeWorkerResultToAssemblyEvidence(job, result, bundle.lineageId);
    expect(promoted).toMatchObject({ status: 'pass', errors: [], evidence: { schema: 'nexyfab.native-assembly-evidence.v1.1', joints: [{ axis: [0, 0, 1], lowerLimit: -90, upperLimit: 90, frame: 'world' }] } });
    expect(validateCadNativeAssemblyEvidence(bundle, promoted.evidence!)).toMatchObject({ status: 'pass', releaseReady: true, errors: [] });
  });

  it('does not promote invalid results or unsafe source paths', () => {
    expect(promoteNativeWorkerResultToAssemblyEvidence(job, { ...result, sourceSha256: 'b'.repeat(64) }, bundle.lineageId)).toMatchObject({ status: 'fail', evidence: null, errors: expect.arrayContaining(['source_payload_hash_mismatch']) });
    expect(promoteNativeWorkerResultToAssemblyEvidence({ ...job, source: { ...job.source, locator: '../outside.sldasm' } }, result, bundle.lineageId)).toMatchObject({ status: 'fail', evidence: null, errors: ['native_worker_source_path_unsafe'] });
  });
});
