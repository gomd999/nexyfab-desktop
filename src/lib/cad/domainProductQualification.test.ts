import { describe, expect, it } from 'vitest';
import { DOMAIN_PRODUCT_AXES } from './domainProductReceipt';
import { buildDomainProductQualification } from './domainProductQualification';

const sha = (value: string) => value.repeat(64).slice(0, 64);
const revision = { id: 'interior-r1', sha256: sha('a') };

function input() {
  return {
    domain: 'interior' as const,
    productId: 'small-office-fitout',
    projectId: 'project-1',
    projectRevision: revision,
    claimedState: 'DOMAIN_VERIFIED' as const,
    requirementsSha256: sha('b'),
    semanticModelSha256: sha('c'),
    geometryOrModelSha256: sha('d'),
    relationshipsSha256: sha('e'),
    calculationArtifactSha256s: [sha('f')],
    validationEvidence: DOMAIN_PRODUCT_AXES.interior.map(axis => ({
      axis, status: 'PASS' as const, caseCount: 1, accuracyBasisPoints: 10_000,
      coverageBasisPoints: 10_000, falseVerificationCount: 0,
      artifactSha256: sha('1'), sourceRevision: revision.id,
    })),
    issuedAt: '2026-08-24T00:00:00.000Z',
  };
}

describe('domain product qualification builder', () => {
  it('fails closed when authority and deliverable bindings are unavailable', () => {
    const result = buildDomainProductQualification(input());
    expect(result.receipt.authorityManifestSha256).toBeNull();
    expect(result.receipt.deliverableManifestSha256).toBeNull();
    expect(result.evaluation).toMatchObject({ structurallyValid: true, status: 'HOLD', eligibleState: 'CONCEPT' });
    expect(result.evaluation.blockers).toEqual(expect.arrayContaining(['authority_manifest_not_run', 'authority_manifest_hash_missing']));
  });

  it('does not turn a single passing fixture case into domain verification', () => {
    const result = buildDomainProductQualification(input());
    expect(result.receipt.validationEvidence.every(item => item.caseCount === 1)).toBe(true);
    expect(result.evaluation.status).toBe('HOLD');
    expect(result.evaluation.blockers.some(blocker => blocker.startsWith('validation_axis_case_count:'))).toBe(true);
    expect(result.evaluation.blockers).toContain('campaign_count_below_three');
  });

  it('does not fabricate reviews, pilots, campaigns, or exchange evidence', () => {
    const result = buildDomainProductQualification({ ...input(), claimedState: 'PRODUCT_QUALIFIED' });
    expect(result.receipt.campaignEvidence).toEqual([]);
    expect(result.receipt.independentReviews).toEqual([]);
    expect(result.receipt.pilots).toEqual([]);
    expect(result.receipt.exchangeReceiptSha256).toBeNull();
    expect(result.evaluation.status).toBe('HOLD');
  });
});
