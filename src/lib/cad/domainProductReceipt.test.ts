import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DOMAIN_AUTHORITY_SCHEMA, hashDomainAuthorityManifest, type DomainAuthorityManifest } from './domainAuthorityManifest';
import { canonicalDomainDeliverableManifestHash, createDomainDeliverableManifest } from './domainDeliverableManifest';
import {
  DOMAIN_PRODUCT_AXES,
  DOMAIN_PRODUCT_RECEIPT_SCHEMA,
  evaluateDomainProductReceipt,
  hashDomainProductReceipt,
  type DomainProductReceipt,
} from './domainProductReceipt';

const h = (seed: string) => createHash('sha256').update(seed).digest('hex');
const revision = { id: 'rev-1', sha256: h('a') };
const authority: DomainAuthorityManifest = {
  schemaVersion: DOMAIN_AUTHORITY_SCHEMA,
  domain: 'mechanical',
  projectId: 'drive-module',
  projectRevision: revision,
  sourceRevision: { id: 'requirements-1', sha256: h('b') },
  authorities: [{
    id: 'client-requirements', kind: 'client', sourceRef: 'rights-cleared://drive-module/requirements-1',
    contentSha256: h('c'), capturedAt: '2026-08-24T00:00:00Z', reviewedAt: '2026-08-24T00:00:00Z',
    status: 'APPROVED', rights: { status: 'APPROVED', receiptSha256: h('d') },
  }],
};
const deliverable = createDomainDeliverableManifest({
  domain: 'mechanical', projectRevision: revision.id, modelContentHash: h('g'), generatedAt: '2026-08-24T00:00:00.000Z',
  deliverables: [
    { id: 'step', kind: 'step', format: 'step', contentSha256: h('h'), byteLength: 10, sourceRevision: revision.id, generatedAt: '2026-08-24T00:00:00.000Z', verificationStatus: 'verified' },
    { id: 'drawing', kind: 'drawing', format: 'drawing', contentSha256: h('i'), byteLength: 10, sourceRevision: revision.id, generatedAt: '2026-08-24T00:00:00.000Z', verificationStatus: 'verified' },
    { id: 'bom', kind: 'bom', format: 'bom', contentSha256: h('j'), byteLength: 10, sourceRevision: revision.id, generatedAt: '2026-08-24T00:00:00.000Z', verificationStatus: 'verified' },
  ],
});

function completeReceipt(): DomainProductReceipt {
  return {
    schema: DOMAIN_PRODUCT_RECEIPT_SCHEMA, domain: 'mechanical', productId: 'motor-gearbox-drive-module', projectId: 'drive-module', projectRevision: revision,
    claimedState: 'PRODUCT_QUALIFIED', requirementsSha256: h('e'), authorityManifestSha256: hashDomainAuthorityManifest(authority), semanticModelSha256: h('f'), geometryOrModelSha256: h('g'), relationshipsSha256: h('k'),
    calculationArtifactSha256s: [h('l')], deliverableManifestSha256: canonicalDomainDeliverableManifestHash(deliverable), exchangeReceiptSha256: h('m'),
    validationEvidence: DOMAIN_PRODUCT_AXES.mechanical.map((axis, index) => ({ axis, status: 'PASS', caseCount: 20, accuracyBasisPoints: 10_000, coverageBasisPoints: 10_000, falseVerificationCount: 0, artifactSha256: h(String.fromCharCode(97 + index)), sourceRevision: revision.id })),
    campaignEvidence: ['campaign-1', 'campaign-2', 'campaign-3'].map((campaignId, index) => ({ campaignId, status: 'PASS', repeatCount: 5, falseVerificationCount: 0, artifactSha256: h(String.fromCharCode(110 + index)), sourceRevision: revision.id })),
    independentReviews: ['reviewer-1', 'reviewer-2'].map((reviewerId, index) => ({ reviewerId, status: 'APPROVED', receiptSha256: h(String.fromCharCode(113 + index)), sourceRevision: revision.id })),
    pilots: ['pilot-1', 'pilot-2', 'pilot-3'].map((pilotId, index) => ({ pilotId, status: 'PASS', receiptSha256: h(String.fromCharCode(115 + index)), sourceRevision: revision.id })),
    currentBlockers: [], issuedAt: '2026-08-24T00:00:00Z',
  };
}

describe('domain product receipt', () => {
  it('qualifies only a fully bound current-revision product', () => {
    const receipt = completeReceipt();
    const result = evaluateDomainProductReceipt(receipt, { authorityManifest: authority, deliverableManifest: deliverable });
    expect(result).toMatchObject({ structurallyValid: true, status: 'PASS', eligibleState: 'PRODUCT_QUALIFIED' });
    expect(result.canonicalSha256).toBe(hashDomainProductReceipt(receipt));
  });

  it('keeps a commercial claim on HOLD when external pilots are absent', () => {
    const receipt = { ...completeReceipt(), pilots: [] };
    const result = evaluateDomainProductReceipt(receipt, { authorityManifest: authority, deliverableManifest: deliverable });
    expect(result.status).toBe('HOLD');
    expect(result.eligibleState).toBe('DELIVERY_CANDIDATE');
    expect(result.blockers).toContain('pilot_count_below_three');
  });

  it('does not average away stale or safety-critical evidence', () => {
    const receipt = completeReceipt();
    receipt.validationEvidence = receipt.validationEvidence.map(item => item.axis === 'assembly' ? { ...item, status: 'STALE', accuracyBasisPoints: 9_999 } : item);
    const result = evaluateDomainProductReceipt(receipt, { authorityManifest: authority, deliverableManifest: deliverable });
    expect(result.status).toBe('HOLD');
    expect(result.eligibleState).toBe('DESIGN_CANDIDATE');
    expect(result.blockers).toEqual(expect.arrayContaining(['validation_axis_stale:assembly', 'validation_axis_accuracy:assembly']));
  });

  it('rejects unknown structure without minting a receipt hash', () => {
    const result = evaluateDomainProductReceipt({ ...completeReceipt(), undeclared: true }, { authorityManifest: authority, deliverableManifest: deliverable });
    expect(result).toMatchObject({ structurallyValid: false, status: 'HOLD', eligibleState: 'CONCEPT', blockers: ['receipt_keys_invalid'] });
    expect(result.canonicalSha256).toBeUndefined();
  });
});
