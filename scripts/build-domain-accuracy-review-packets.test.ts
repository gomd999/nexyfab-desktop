import { describe, expect, it } from 'vitest';
import { buildReviewPacket, parseReviewPacketArgs } from './build-domain-accuracy-review-packets';
import type { DomainAccuracyCandidate } from '../src/lib/ai/domainAccuracyCandidate';
import { DOMAIN_ACCURACY_PROFILES } from '../src/lib/ai/domainAccuracyProgram';

const candidate = (sourceKind: DomainAccuracyCandidate['sourceKind']): DomainAccuracyCandidate => ({
  schema: 'nexyfab.domain-accuracy-candidate.v1', caseId: 'civil-001', domain: 'civil',
  sourceHash: 'a'.repeat(64), artifactHash: 'b'.repeat(64), sourceKind, split: 'candidate',
  sourceRights: { basis: 'work-for-hire', reference: 'contract-1', benchmarkingAllowed: true },
  artifactSummary: { name: 'wall', partCount: 2, pipeCount: 0, roles: ['wall'], alignmentErrors: [], unverifiedPartCount: 0 },
  groundTruthAssertions: DOMAIN_ACCURACY_PROFILES.civil.requiredAxes.map((axis, index) => ({
    axis, tolerancePolicy: 'reviewed-domain-tolerance', provenance: 'independent-expert', artifactHashes: [(index + 1).toString(16).padStart(64, '0')],
  })),
});

describe('domain accuracy review packets', () => {
  it('emits the exact triple-hash approval target for a complete external holdout', () => {
    const packet = buildReviewPacket(candidate('expert-authored'));
    expect(packet).toMatchObject({ scoreReadyForReview: true, issues: [], approvalTemplate: { reviewerId: '', independent: true } });
    expect(packet.approvalTemplate).toMatchObject(packet.signedTarget);
    expect(packet.assertions).toHaveLength(DOMAIN_ACCURACY_PROFILES.civil.requiredAxes.length);
  });
  it('labels internal templates and missing axes as non-scoreable review inputs', () => {
    const value = candidate('internal-template');
    value.groundTruthAssertions = value.groundTruthAssertions!.slice(1);
    const packet = buildReviewPacket(value);
    expect(packet.scoreReadyForReview).toBe(false);
    expect(packet.issues).toEqual(expect.arrayContaining(['independent_holdout_source_required', 'ground_truth_axis_missing:requirements']));
  });
  it('requires an explicit candidate manifest', () => {
    expect(() => parseReviewPacketArgs([])).toThrow('--candidates');
    expect(parseReviewPacketArgs(['--candidates', 'domain.json'])).toEqual({ candidatesFile: 'domain.json' });
  });
});
