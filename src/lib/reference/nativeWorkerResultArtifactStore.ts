import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeImmutableArtifactAtomic } from './immutableArtifactStore';
import { validateNativeWorkerExecutionResult, type NativeWorkerExecutionJob, type NativeWorkerExecutionResult } from './nativeWorkerExecution';
import type { AcceptedNativeWorkerResult } from './nativeWorkerAssemblyPromotionBatch';

export interface NativeWorkerAcceptedArtifactIndex {
  job: NativeWorkerExecutionJob;
  resultArtifact: string;
  resultArtifactSha256: string;
  resultSha256: string;
}

export interface NativeWorkerExecutionArtifactReport {
  schema: 'nexyfab.native-worker-execution-batch.v1' | 'nexyfab.native-worker-execution-batch.v1.1';
  manifestSha256: string;
  artifactStore?: { nativeResultsDirectory?: string };
  accepted: Array<AcceptedNativeWorkerResult | NativeWorkerAcceptedArtifactIndex>;
}

const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT = /^[a-f0-9]{40}\.json$/;
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function persistNativeWorkerResultArtifacts(accepted: AcceptedNativeWorkerResult[], outputDirectory: string): NativeWorkerAcceptedArtifactIndex[] {
  if (new Set(accepted.map((item) => item.job.jobId)).size !== accepted.length) throw new Error('accepted_native_result_job_duplicate');
  return accepted.map((item) => {
    const validation = validateNativeWorkerExecutionResult(item.job, item.result);
    const canonicalSha256 = sha256(`${JSON.stringify(item.result)}\n`);
    if (!validation.releaseReady || !SHA256.test(item.resultSha256) || canonicalSha256 !== item.resultSha256) throw new Error(`accepted_native_result_invalid:${item.job.jobId}`);
    const bytes = Buffer.from(`${JSON.stringify(item.result, null, 2)}\n`);
    const basename = `${sha256(`${item.job.jobId}\0${item.resultSha256}`).slice(0, 40)}.json`;
    writeImmutableArtifactAtomic(outputDirectory, basename, bytes, 'native_result_artifact_collision');
    return { job: item.job, resultArtifact: basename, resultArtifactSha256: sha256(bytes), resultSha256: item.resultSha256 };
  });
}

function safeStoreDirectory(reportDirectory: string, storeName?: string) {
  const name = storeName ?? 'native-worker-results';
  if (path.basename(name) !== name || !name.trim()) throw new Error('native_result_store_name_invalid');
  return path.join(reportDirectory, name);
}

export function hydrateNativeWorkerAcceptedResults(report: NativeWorkerExecutionArtifactReport, reportDirectory: string): AcceptedNativeWorkerResult[] {
  if (new Set(report.accepted.map((item) => item.job.jobId)).size !== report.accepted.length) throw new Error('native_result_index_job_duplicate');
  if (report.schema === 'nexyfab.native-worker-execution-batch.v1' && report.accepted.some((item) => !('result' in item))) throw new Error('indexed_native_results_require_v1_1_report');
  const store = safeStoreDirectory(reportDirectory, report.artifactStore?.nativeResultsDirectory);
  return report.accepted.map((item) => {
    if ('result' in item) {
      const validation = validateNativeWorkerExecutionResult(item.job, item.result);
      if (!validation.releaseReady || sha256(`${JSON.stringify(item.result)}\n`) !== item.resultSha256) throw new Error(`inline_native_result_invalid:${item.job.jobId}`);
      return item;
    }
    if (!ARTIFACT.test(item.resultArtifact) || !SHA256.test(item.resultArtifactSha256) || !SHA256.test(item.resultSha256)) throw new Error(`native_result_index_invalid:${item.job.jobId}`);
    const filename = path.join(store, item.resultArtifact);
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size < 2 || stat.size > 128 * 1024 * 1024) throw new Error(`native_result_artifact_size_invalid:${item.job.jobId}`);
    const bytes = fs.readFileSync(filename);
    if (sha256(bytes) !== item.resultArtifactSha256) throw new Error(`native_result_artifact_hash_mismatch:${item.job.jobId}`);
    const result = JSON.parse(bytes.toString('utf8')) as NativeWorkerExecutionResult;
    const validation = validateNativeWorkerExecutionResult(item.job, result);
    if (!validation.releaseReady || sha256(`${JSON.stringify(result)}\n`) !== item.resultSha256) throw new Error(`native_result_payload_invalid:${item.job.jobId}`);
    return { job: item.job, result, resultSha256: item.resultSha256 };
  });
}
