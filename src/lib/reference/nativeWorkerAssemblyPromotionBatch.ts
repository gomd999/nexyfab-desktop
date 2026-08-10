import { createHash } from 'node:crypto';
import { cadProductLineageId } from './cadCorpusProductBundle';
import type { NativeWorkerExecutionJob, NativeWorkerExecutionResult } from './nativeWorkerExecution';
import { promoteNativeWorkerResultToAssemblyEvidence } from './nativeWorkerResultPromotion';
import { writeImmutableArtifactAtomic } from './immutableArtifactStore';

export interface AcceptedNativeWorkerResult {
  job: NativeWorkerExecutionJob;
  result: NativeWorkerExecutionResult;
  resultSha256: string;
}

export interface PromotedAssemblyArtifact {
  jobId: string;
  caseId: string;
  artifact: string;
  artifactSha256: string;
  resultSha256: string;
  reviewerApprovalRequired: true;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const SHA256 = /^[a-f0-9]{64}$/;
const repair = (text: string) => {
  if (!/[ÃƒÃ¬Ã«]/.test(text)) return text;
  const decoded = Buffer.from(text, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? text : decoded;
};

export function persistNativeWorkerAssemblyPromotions(accepted: AcceptedNativeWorkerResult[], outputDirectory: string) {
  const promotedAssemblyEvidence: PromotedAssemblyArtifact[] = [];
  const assemblyPromotionNotRun: Array<{ jobId: string; caseId: string; reason: string }> = [];
  for (const item of accepted) {
    if (!item.result.definitions.some((definition) => definition.kind === 'assembly')) continue;
    const canonicalResultSha256 = sha256(`${JSON.stringify(item.result)}\n`);
    if (!SHA256.test(item.resultSha256) || canonicalResultSha256 !== item.resultSha256) {
      assemblyPromotionNotRun.push({ jobId: item.job.jobId, caseId: item.job.caseId, reason: 'accepted_result_hash_invalid' });
      continue;
    }
    const lineageId = cadProductLineageId(repair(item.job.source.locator));
    if (!lineageId) { assemblyPromotionNotRun.push({ jobId: item.job.jobId, caseId: item.job.caseId, reason: 'product_lineage_unavailable' }); continue; }
    const promoted = promoteNativeWorkerResultToAssemblyEvidence(item.job, item.result, lineageId);
    if (!promoted.evidence) { assemblyPromotionNotRun.push({ jobId: item.job.jobId, caseId: item.job.caseId, reason: promoted.errors.join(',') }); continue; }
    const bytes = Buffer.from(`${JSON.stringify(promoted.evidence, null, 2)}\n`);
    const basename = `${sha256(`${item.job.jobId}\0${item.resultSha256}`).slice(0, 40)}.json`;
    writeImmutableArtifactAtomic(outputDirectory, basename, bytes, 'assembly_evidence_artifact_collision');
    promotedAssemblyEvidence.push({ jobId: item.job.jobId, caseId: item.job.caseId, artifact: basename, artifactSha256: sha256(bytes), resultSha256: item.resultSha256, reviewerApprovalRequired: true });
  }
  return { promotedAssemblyEvidence, assemblyPromotionNotRun };
}
