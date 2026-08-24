import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DOMAIN_AUTHORITY_SCHEMA, hashDomainAuthorityManifest, type DomainAuthorityManifest } from './domainAuthorityManifest';
import { canonicalDomainDeliverableManifestHash, createDomainDeliverableManifest, type DomainDeliverableManifest } from './domainDeliverableManifest';
import { DOMAIN_PRODUCT_AXES, DOMAIN_PRODUCT_RECEIPT_SCHEMA, evaluateDomainProductReceipt, hashDomainProductReceipt, type DomainProductReceipt } from './domainProductReceipt';
import { evaluateDomainProductQualificationView, type DomainProductQualificationViewInput } from './domainProductQualificationView';

const h = (seed: string) => createHash('sha256').update(seed).digest('hex');
const revision = { id: 'revision-1', sequence: 7, contentSha256: h('revision') } as const;

function fixtures() {
  const binding = { id: revision.id, sha256: revision.contentSha256 };
  const authority: DomainAuthorityManifest = {
    schemaVersion: DOMAIN_AUTHORITY_SCHEMA, domain: 'mechanical', projectId: 'project-1',
    projectRevision: binding, sourceRevision: { id: 'source-1', sha256: h('source') },
    authorities: [{ id: 'authority-1', kind: 'client', sourceRef: 'rights-cleared://project-1', contentSha256: h('authority'), capturedAt: '2026-08-24T00:00:00Z', reviewedAt: '2026-08-24T00:00:00Z', status: 'APPROVED', rights: { status: 'APPROVED', receiptSha256: h('rights') } }],
  };
  const deliverable = createDomainDeliverableManifest({
    domain: 'mechanical', projectRevision: revision.id, modelContentHash: h('model'), generatedAt: '2026-08-24T00:00:00.000Z',
    deliverables: [
      ['step', 'step'], ['drawing', 'drawing'], ['bom', 'bom'],
    ].map(([kind, format]) => ({ id: kind, kind, format: format as 'step' | 'drawing' | 'bom', contentSha256: h(kind), byteLength: 10, sourceRevision: revision.id, generatedAt: '2026-08-24T00:00:00.000Z', verificationStatus: 'verified' as const })),
  });
  const receipt: DomainProductReceipt = {
    schema: DOMAIN_PRODUCT_RECEIPT_SCHEMA, domain: 'mechanical', productId: 'product-1', projectId: 'project-1', projectRevision: binding,
    claimedState: 'PRODUCT_QUALIFIED', requirementsSha256: h('requirements'), authorityManifestSha256: hashDomainAuthorityManifest(authority), semanticModelSha256: h('semantic'), geometryOrModelSha256: h('model'), relationshipsSha256: h('relationships'), calculationArtifactSha256s: [h('calculation')], deliverableManifestSha256: canonicalDomainDeliverableManifestHash(deliverable), exchangeReceiptSha256: h('exchange'),
    validationEvidence: DOMAIN_PRODUCT_AXES.mechanical.map(axis => ({ axis, status: 'PASS' as const, caseCount: 20, accuracyBasisPoints: 10_000, coverageBasisPoints: 10_000, falseVerificationCount: 0, artifactSha256: h(axis), sourceRevision: revision.id })),
    campaignEvidence: [1, 2, 3].map(index => ({ campaignId: `campaign-${index}`, status: 'PASS' as const, repeatCount: 5, falseVerificationCount: 0, artifactSha256: h(`campaign-${index}`), sourceRevision: revision.id })),
    independentReviews: [1, 2].map(index => ({ reviewerId: `review-${index}`, status: 'APPROVED' as const, receiptSha256: h(`review-${index}`), sourceRevision: revision.id })),
    pilots: [1, 2, 3].map(index => ({ pilotId: `pilot-${index}`, status: 'PASS' as const, receiptSha256: h(`pilot-${index}`), sourceRevision: revision.id })),
    currentBlockers: [], issuedAt: '2026-08-24T00:00:00Z',
  };
  const evaluation = evaluateDomainProductReceipt(receipt, { authorityManifest: authority, deliverableManifest: deliverable });
  const input: DomainProductQualificationViewInput = {
    receipt, evaluation, authorityManifest: authority, deliverableManifest: deliverable, projectId: 'project-1', domain: 'mechanical',
    receiptRevision: revision, currentRevision: revision, authorityManifestSha256: hashDomainAuthorityManifest(authority), deliverableManifestSha256: canonicalDomainDeliverableManifestHash(deliverable),
  };
  return { input, receipt, authority, deliverable };
}

describe('domain product qualification view adapter', () => {
  it('passes only when the recomputed receipt is current and fully qualified', () => {
    const { input, receipt } = fixtures();
    expect(evaluateDomainProductQualificationView(input)).toMatchObject({ status: 'PASS', receiptSha256: hashDomainProductReceipt(receipt), blockers: [] });
  });

  it('never trusts a forged evaluation status and marks a current incomplete receipt HOLD', () => {
    const { input } = fixtures();
    const candidate = { ...input, receipt: { ...(input.receipt as DomainProductReceipt), pilots: [] }, evaluation: { ...(input.evaluation as object), status: 'PASS', eligibleState: 'PRODUCT_QUALIFIED' } };
    expect(evaluateDomainProductQualificationView(candidate)).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining([{ code: 'QUALIFICATION_INCOMPLETE' }]) });
  });

  it('distinguishes a stale CAS sequence from an ordinary qualification hold', () => {
    const { input } = fixtures();
    expect(evaluateDomainProductQualificationView({ ...input, currentRevision: { ...input.currentRevision, sequence: 8 } })).toMatchObject({ status: 'STALE', blockers: expect.arrayContaining([{ code: 'REVISION_SEQUENCE_MISMATCH' }]) });
  });

  it('classifies stale evidence freshness as STALE after recomputation', () => {
    const { input } = fixtures();
    const receipt = { ...(input.receipt as DomainProductReceipt), validationEvidence: (input.receipt as DomainProductReceipt).validationEvidence.map(item => item.axis === 'assembly' ? { ...item, status: 'STALE' as const } : item) };
    const evaluation = evaluateDomainProductReceipt(receipt, { authorityManifest: input.authorityManifest as DomainAuthorityManifest, deliverableManifest: input.deliverableManifest as DomainDeliverableManifest });
    expect(evaluateDomainProductQualificationView({ ...input, receipt, evaluation })).toMatchObject({ status: 'STALE', blockers: expect.arrayContaining([{ code: 'EVIDENCE_NOT_CURRENT' }]) });
  });

  it('keeps manifest attestation mismatches at HOLD rather than calling them stale', () => {
    const { input, authority } = fixtures();
    expect(evaluateDomainProductQualificationView({ ...input, authorityManifestSha256: h('wrong') })).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining([{ code: 'AUTHORITY_MANIFEST_HASH_MISMATCH' }]) });
    expect(evaluateDomainProductQualificationView({ ...input, deliverableManifestSha256: h('wrong') })).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining([{ code: 'DELIVERABLE_MANIFEST_HASH_MISMATCH' }]) });
    expect(evaluateDomainProductQualificationView({ ...input, evaluation: { ...(input.evaluation as object), status: 'HOLD' } })).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining([{ code: 'EVALUATION_MISMATCH' }]) });
    const changedAuthority = { ...authority, authorities: authority.authorities.map(item => ({ ...item, contentSha256: h('changed-authority') })) };
    expect(evaluateDomainProductQualificationView({ ...input, authorityManifest: changedAuthority, authorityManifestSha256: hashDomainAuthorityManifest(changedAuthority) })).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining([{ code: 'AUTHORITY_MANIFEST_HASH_MISMATCH' }]) });
  });

  it('returns NOT_RUN for an explicit absent evaluation', () => {
    const { input } = fixtures();
    expect(evaluateDomainProductQualificationView({ ...input, receipt: undefined, evaluation: undefined })).toEqual({ status: 'NOT_RUN', blockers: [{ code: 'EVALUATION_NOT_RUN' }] });
    // The adapter input has a fixed key contract; an empty/loading object is
    // malformed rather than an implicit qualification result.
    expect(evaluateDomainProductQualificationView({})).toEqual({ status: 'INVALID', blockers: [{ code: 'INPUT_INVALID' }] });
  });

  it('fails closed for getters, proxies, cycles and oversized data', () => {
    const { input } = fixtures();
    const getter = { ...input, receipt: { get schema() { throw new Error('executed'); } } };
    expect(evaluateDomainProductQualificationView(getter)).toMatchObject({ status: 'INVALID', blockers: [{ code: 'INPUT_INVALID' }] });
    const proxy = new Proxy(input, { ownKeys() { throw new Error('trap'); } });
    expect(evaluateDomainProductQualificationView(proxy)).toMatchObject({ status: 'INVALID', blockers: [{ code: 'INPUT_INVALID' }] });
    const cycle: Record<string, unknown> = { ...input }; cycle.receipt = cycle;
    expect(evaluateDomainProductQualificationView(cycle)).toMatchObject({ status: 'INVALID', blockers: [{ code: 'INPUT_INVALID' }] });
    expect(evaluateDomainProductQualificationView({ ...input, projectId: 'x'.repeat(1_000_001) })).toMatchObject({ status: 'INVALID', blockers: [{ code: 'INPUT_INVALID' }] });
  });
});
