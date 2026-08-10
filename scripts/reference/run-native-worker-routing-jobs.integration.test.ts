import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nativeWorkerIdentitySha256 } from '../../src/lib/reference/nativeWorkerCanaryGate';
import type { NativeWorkerExecutionJob, NativeWorkerExecutionResult } from '../../src/lib/reference/nativeWorkerExecution';
import { hydrateNativeWorkerAcceptedResults, type NativeWorkerExecutionArtifactReport } from '../../src/lib/reference/nativeWorkerResultArtifactStore';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-native-runner-integration-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const hash = 'a'.repeat(64), identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const state = { resolved: true, suppressed: false, lightweight: false, flexible: false, hidden: false, mirrored: false };
const worker = { name: 'resume-worker', version: '1.0.0', cadSystem: 'SOLIDWORKS 2026' };
const job: NativeWorkerExecutionJob = { schema: 'nexyfab.native-worker-routing-job.v1', jobId: 'integration-job', caseId: 'integration-case', sourceHash: hash, source: { kind: 'direct', locator: 'set/robot.snapshot.1/root.sldasm', sha256: hash, bytes: 10, extension: 'sldasm' }, workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true, status: 'not_run' };
const result: NativeWorkerExecutionResult = { schema: 'nexyfab.native-worker-execution-result.v1.1', jobId: job.jobId, caseId: job.caseId, sourceHash: hash, sourceSha256: hash, worker, coordinateSystem: { handedness: 'right', upAxis: 'z', forwardAxis: '+x', matrixLayout: 'row-major', vectorConvention: 'column-vector', transformScope: 'local-to-parent' }, units: { length: 'mm', angle: 'deg' }, definitions: [{ id: 'assembly', kind: 'assembly' }, { id: 'part', kind: 'part', bodyCount: 1 }], occurrences: [{ id: 'root', definitionId: 'assembly', parentOccurrenceId: null, localToParent: identity, state }, { id: 'part', definitionId: 'part', parentOccurrenceId: 'root', localToParent: identity, state }], joints: [{ id: 'fixed', kind: 'fixed', occurrenceA: 'root', occurrenceB: 'part', axis: null, originMm: null, lowerLimit: null, upperLimit: null, frame: 'world' }], nativeSemantics: { complete: true, hierarchyRecovered: true, constraintsRecovered: true } };
const resultSha256 = createHash('sha256').update(`${JSON.stringify(result)}\n`).digest('hex');

describe('native worker routing runner indexed resume integration', () => {
  it('writes compact indexes plus immutable raw and governed artifacts without starting a worker', () => {
    const manifestPath = path.join(root, 'manifest.json'), resumePath = path.join(root, 'resume.json'), gatePath = path.join(root, 'gate.json'), corpusRoot = path.join(root, 'corpus'), output = path.join(root, 'output', 'execution.json');
    fs.mkdirSync(corpusRoot, { recursive: true });
    const manifestBytes = Buffer.from(`${JSON.stringify({ schema: 'nexyfab.native-worker-routing-manifest.v1', jobs: [job] }, null, 2)}\n`);
    fs.writeFileSync(manifestPath, manifestBytes);
    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
    fs.writeFileSync(resumePath, `${JSON.stringify({ schema: 'nexyfab.native-worker-execution-batch.v1', manifestSha256, accepted: [{ job, result, resultSha256 }] }, null, 2)}\n`);
    const now = Date.now();
    fs.writeFileSync(gatePath, `${JSON.stringify({ schema: 'nexyfab.native-worker-canary-gate.v1', generatedAt: new Date(now).toISOString(), validUntil: new Date(now + 60_000).toISOString(), manifestSha256, gates: [{ workerKind: 'solidworks-native', status: 'pass', canaryJobId: job.jobId, workerIdentitySha256: nativeWorkerIdentitySha256(worker) }] }, null, 2)}\n`);
    const execution = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('scripts/reference/run-native-worker-routing-jobs.ts'), `--manifest=${manifestPath}`, `--root=${corpusRoot}`, `--output=${output}`, `--resume=${resumePath}`, `--canary-gate=${gatePath}`], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    expect({ status: execution.status, stderr: execution.stderr }).toEqual({ status: 0, stderr: '' });
    const report = JSON.parse(fs.readFileSync(output, 'utf8')) as NativeWorkerExecutionArtifactReport & { summary: Record<string, number>; promotedAssemblyEvidence: Array<{ artifact: string }> };
    expect(report).toMatchObject({ schema: 'nexyfab.native-worker-execution-batch.v1.1', summary: { requested: 1, accepted: 1, resumed: 1, promotedAssemblyEvidence: 1, assemblyPromotionNotRun: 0 } });
    expect(JSON.stringify(report.accepted)).not.toContain('coordinateSystem');
    expect(fs.readdirSync(path.join(path.dirname(output), 'native-worker-results'))).toHaveLength(1);
    expect(fs.readdirSync(path.join(path.dirname(output), 'native-worker-assembly-evidence'))).toHaveLength(1);
    expect(hydrateNativeWorkerAcceptedResults(report, path.dirname(output))).toEqual([{ job, result, resultSha256 }]);
    const healthPath = path.join(root, 'health.json'), rebuiltGatePath = path.join(root, 'rebuilt-gate.json');
    fs.writeFileSync(healthPath, `${JSON.stringify({ schema: 'nexyfab.native-worker-health-probe-batch.v1', generatedAt: new Date(now).toISOString(), results: [{ workerKind: 'solidworks-native', status: 'pass', health: { schema: 'nexyfab.native-worker-health.v1', workerKind: 'solidworks-native', worker, protocol: { executionResultSchema: 'nexyfab.native-worker-execution-result.v1.1' }, host: { os: 'windows', architecture: 'x64' }, license: { status: 'valid' }, capabilities: { exactGeometry: true, nativeHierarchy: true, nativeConstraints: true, nativeParameters: true }, ready: true } }] }, null, 2)}\n`);
    const gateBuild = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('scripts/reference/build-native-worker-canary-gate.ts'), manifestPath, healthPath, output, rebuiltGatePath], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    expect({ status: gateBuild.status, stderr: gateBuild.stderr }).toEqual({ status: 0, stderr: '' });
    expect(JSON.parse(fs.readFileSync(rebuiltGatePath, 'utf8'))).toMatchObject({ releaseReady: true, summary: { workers: 1, pass: 1, readyToRun: 0, blockedHealth: 0 }, gates: [{ workerKind: 'solidworks-native', status: 'pass', accepted: true }] });
  });
});
