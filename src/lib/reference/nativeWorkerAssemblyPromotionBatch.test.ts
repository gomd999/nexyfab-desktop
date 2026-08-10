import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeWorkerExecutionJob, NativeWorkerExecutionResult } from './nativeWorkerExecution';
import { persistNativeWorkerAssemblyPromotions } from './nativeWorkerAssemblyPromotionBatch';

const hash = 'a'.repeat(64);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const state = { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false, mirrored: false };
const job: NativeWorkerExecutionJob = { schema: 'nexyfab.native-worker-routing-job.v1', jobId: 'customer-sensitive-job-id', caseId: 'case', sourceHash: hash, source: { kind: 'direct', locator: 'set/robot.snapshot.1/root.sldasm', sha256: hash, bytes: 10, extension: 'sldasm' }, workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true, status: 'not_run' };
const result: NativeWorkerExecutionResult = { schema: 'nexyfab.native-worker-execution-result.v1.1', jobId: job.jobId, caseId: job.caseId, sourceHash: hash, sourceSha256: hash, worker: { name: 'worker', version: '1', cadSystem: 'SOLIDWORKS' }, coordinateSystem: { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' }, units: { length: 'mm', angle: 'deg' }, definitions: [{ id: 'root-def', kind: 'assembly' }, { id: 'part-def', kind: 'part', bodyCount: 1 }], occurrences: [{ id: 'root', definitionId: 'root-def', parentOccurrenceId: null, localToParent: identity, state }, { id: 'part', definitionId: 'part-def', parentOccurrenceId: 'root', localToParent: identity, state }], joints: [{ id: 'fixed', kind: 'fixed', occurrenceA: 'root', occurrenceB: 'part', axis: null, originMm: null, lowerLimit: null, upperLimit: null, frame: 'world' }], nativeSemantics: { complete: true, hierarchyRecovered: true, constraintsRecovered: true } };
const resultSha256 = (value: NativeWorkerExecutionResult) => createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('native worker assembly promotion artifact persistence', () => {
  it('writes a result-bound non-identifying artifact and is idempotent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-promotion-')); roots.push(root);
    const accepted = [{ job, result, resultSha256: resultSha256(result) }];
    const first = persistNativeWorkerAssemblyPromotions(accepted, root);
    expect(first).toMatchObject({ promotedAssemblyEvidence: [{ reviewerApprovalRequired: true, resultSha256: accepted[0]!.resultSha256 }], assemblyPromotionNotRun: [] });
    const basename = first.promotedAssemblyEvidence[0]!.artifact;
    expect(basename).toMatch(/^[a-f0-9]{40}\.json$/);
    expect(basename).not.toContain(job.jobId);
    const before = fs.readFileSync(path.join(root, basename));
    expect(persistNativeWorkerAssemblyPromotions(accepted, root).promotedAssemblyEvidence[0]!.artifact).toBe(basename);
    expect(fs.readdirSync(root)).toEqual([basename]);
    expect(fs.readFileSync(path.join(root, basename))).toEqual(before);
  });

  it('never overwrites a conflicting immutable artifact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-promotion-')); roots.push(root);
    const accepted = [{ job, result, resultSha256: resultSha256(result) }];
    const artifact = persistNativeWorkerAssemblyPromotions(accepted, root).promotedAssemblyEvidence[0]!.artifact;
    fs.writeFileSync(path.join(root, artifact), 'tampered');
    expect(() => persistNativeWorkerAssemblyPromotions(accepted, root)).toThrow('assembly_evidence_artifact_collision');
  });

  it('does not persist a promotion when the accepted result hash is invalid', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-promotion-')); roots.push(root);
    expect(persistNativeWorkerAssemblyPromotions([{ job, result, resultSha256: 'b'.repeat(64) }], root)).toMatchObject({ promotedAssemblyEvidence: [], assemblyPromotionNotRun: [{ reason: 'accepted_result_hash_invalid' }] });
    expect(fs.existsSync(root) ? fs.readdirSync(root) : []).toEqual([]);
  });
});
