import fs from 'node:fs';
import path from 'node:path';
import type { ExternalNativeWorkerKind } from '../../src/lib/reference/nativeWorkerHostContract';
import type { NativeWorkerExecutionJob } from '../../src/lib/reference/nativeWorkerExecution';

const manifestPath = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-routing-manifest.json');
const healthPath = path.resolve(process.argv[3] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-health-probe.json');
const executionPath = path.resolve(process.argv[4] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-execution-results.json');
const output = path.resolve(process.argv[5] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-canary-gate.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { jobs: NativeWorkerExecutionJob[] };
const health = JSON.parse(fs.readFileSync(healthPath, 'utf8')) as { results: Array<{ workerKind: ExternalNativeWorkerKind; status: 'pass' | 'fail' | 'not_run' }> };
const execution = JSON.parse(fs.readFileSync(executionPath, 'utf8')) as { accepted: Array<{ job: NativeWorkerExecutionJob }> };
const workerKinds = [...new Set(manifest.jobs.filter(item => item.availability === 'external-required').map(item => item.workerKind as ExternalNativeWorkerKind))].sort();
const gates = workerKinds.map(workerKind => {
  const candidates = manifest.jobs.filter(item => item.workerKind === workerKind && item.availability === 'external-required').sort((a, b) => a.jobId.localeCompare(b.jobId));
  const canary = candidates[0]!;
  const healthStatus = health.results.find(item => item.workerKind === workerKind)?.status ?? 'not_run';
  const accepted = execution.accepted.some(item => item.job.jobId === canary.jobId);
  const status = healthStatus !== 'pass' ? 'blocked_health' : accepted ? 'pass' : 'ready_to_run';
  return { workerKind, status, healthStatus, canaryJobId: canary.jobId, caseId: canary.caseId, extension: canary.source.extension, candidateJobs: candidates.length, accepted };
});
const artifact = { schema: 'nexyfab.native-worker-canary-gate.v1', policy: { oneDeterministicCanaryPerWorker: true, healthRequiredBeforeCanary: true, canaryRequiredBeforeBatch: true }, releaseReady: gates.every(item => item.status === 'pass'), summary: { workers: gates.length, pass: gates.filter(item => item.status === 'pass').length, readyToRun: gates.filter(item => item.status === 'ready_to_run').length, blockedHealth: gates.filter(item => item.status === 'blocked_health').length }, gates };
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary, releaseReady: artifact.releaseReady }));
