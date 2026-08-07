import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  domainCandidateGroundTruthHash,
  type DomainAccuracyApproval,
  type DomainAccuracyCandidate,
} from '../src/lib/ai/domainAccuracyCandidate';
import { DOMAIN_ACCURACY_PROFILES } from '../src/lib/ai/domainAccuracyProgram';

export interface ReviewPacketArgs { candidatesFile: string }

export function parseReviewPacketArgs(args: readonly string[]): ReviewPacketArgs {
  const index = args.indexOf('--candidates');
  const candidatesFile = index >= 0 ? args[index + 1] : undefined;
  if (!candidatesFile) throw new TypeError('--candidates <candidate-manifest.json> is required');
  return { candidatesFile };
}

export function buildReviewPacket(candidate: DomainAccuracyCandidate) {
  const requiredAxes = DOMAIN_ACCURACY_PROFILES[candidate.domain].requiredAxes;
  const assertions = candidate.groundTruthAssertions ?? [];
  const present = new Set(assertions.map(item => item.axis));
  const missingAxes = requiredAxes.filter(axis => !present.has(axis));
  const issues = [
    ...(candidate.sourceKind === 'internal-template' ? ['independent_holdout_source_required'] : []),
    ...(!candidate.sourceRights?.benchmarkingAllowed ? ['benchmark_rights_required'] : []),
    ...(!assertions.length ? ['ground_truth_required'] : []),
    ...missingAxes.map(axis => `ground_truth_axis_missing:${axis}`),
  ];
  const groundTruthHash = domainCandidateGroundTruthHash(candidate);
  const approvalTemplate: DomainAccuracyApproval = {
    schema: 'nexyfab.domain-accuracy-approval.v1',
    caseId: candidate.caseId,
    sourceHash: candidate.sourceHash,
    artifactHash: candidate.artifactHash,
    groundTruthHash,
    reviewerId: '',
    reviewedAt: '',
    decision: 'approve',
    independent: true,
  };
  return {
    schema: 'nexyfab.domain-accuracy-review-packet.v1',
    caseId: candidate.caseId,
    domain: candidate.domain,
    scoreReadyForReview: issues.length === 0,
    issues,
    signedTarget: { sourceHash: candidate.sourceHash, artifactHash: candidate.artifactHash, groundTruthHash },
    sourceRights: candidate.sourceRights ?? null,
    assertions,
    checklist: [
      'source_identity_and_commercial_benchmark_rights',
      'holdout_not_used_for_prompting_or_tuning',
      'artifact_matches_source_and_domain_intent',
      'every_required_axis_has_authoritative_ground_truth',
      'tolerances_are_domain-appropriate_and_not_result-fitted',
      'reviewer_is_independent_from_author_and_other_reviewer',
    ],
    approvalTemplate,
  };
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const { candidatesFile } = parseReviewPacketArgs(args);
    const parsed: unknown = JSON.parse(await readFile(resolve(candidatesFile), 'utf8'));
    if (!Array.isArray(parsed)) throw new TypeError('candidates must be a JSON array');
    const packets = (parsed as DomainAccuracyCandidate[]).map(buildReviewPacket);
    const ready = packets.filter(item => item.scoreReadyForReview).length;
    process.stdout.write(`${JSON.stringify({ summary: { candidates: packets.length, ready, incomplete: packets.length - ready }, packets }, null, 2)}\n`);
    return packets.length >= 20 && ready === packets.length ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await main();
