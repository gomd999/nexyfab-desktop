import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildNativeWorkerCanaryGate } from '../../src/lib/reference/nativeWorkerCanaryGate';
import type { ExternalNativeWorkerKind, NativeWorkerHealth } from '../../src/lib/reference/nativeWorkerHostContract';
import type { NativeWorkerExecutionJob, NativeWorkerExecutionResult } from '../../src/lib/reference/nativeWorkerExecution';
import { hydrateNativeWorkerAcceptedResults, type NativeWorkerExecutionArtifactReport } from '../../src/lib/reference/nativeWorkerResultArtifactStore';
import { writeLatestArtifactAtomic } from '../../src/lib/reference/immutableArtifactStore';

const manifestPath = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-routing-manifest.json');
const healthPath = path.resolve(process.argv[3] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-health-probe.json');
const executionPath = path.resolve(process.argv[4] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-execution-results.json');
const output = path.resolve(process.argv[5] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-canary-gate.json');
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8')) as { jobs: NativeWorkerExecutionJob[] };
const health = JSON.parse(fs.readFileSync(healthPath, 'utf8')) as { generatedAt?: string; results: Array<{ workerKind: ExternalNativeWorkerKind; status: 'pass' | 'fail' | 'not_run'; health?: NativeWorkerHealth }> };
const executionReport = JSON.parse(fs.readFileSync(executionPath, 'utf8')) as NativeWorkerExecutionArtifactReport;
const execution: { manifestSha256?: string; accepted: Array<{ job: NativeWorkerExecutionJob; result: NativeWorkerExecutionResult; resultSha256: string }> } = {
  manifestSha256: executionReport.manifestSha256,
  accepted: hydrateNativeWorkerAcceptedResults(executionReport, path.dirname(executionPath)),
};
const artifact = buildNativeWorkerCanaryGate({ jobs: manifest.jobs, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), health, execution });
writeLatestArtifactAtomic(output, Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`));
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary, releaseReady: artifact.releaseReady }));
