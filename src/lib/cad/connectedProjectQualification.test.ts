import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_DOMAINS,
  DOMAIN_AUTHORITY_SCHEMA,
  hashDomainAuthorityManifest,
  type AuthorityDomain,
  type DomainAuthorityManifest,
} from './domainAuthorityManifest';
import {
  canonicalDomainDeliverableManifestHash,
  createDomainDeliverableManifest,
  DOMAIN_REQUIRED_DELIVERABLE_KINDS,
  type DomainDeliverableManifest,
  type DeliverableManifestFormat,
} from './domainDeliverableManifest';
import {
  DOMAIN_PRODUCT_AXES,
  DOMAIN_PRODUCT_RECEIPT_SCHEMA,
  hashDomainProductReceipt,
  type DomainProductReceipt,
} from './domainProductReceipt';
import { SPATIAL_DEPENDENCY_GRAPH_SCHEMA, type SpatialDependencyGraph } from './spatialDependencyGraph';
import {
  CONNECTED_PROJECT_QUALIFICATION_SCHEMA,
  evaluateConnectedProjectQualification,
  type ConnectedDomainProductBinding,
  type ConnectedProjectQualificationInput,
} from './connectedProjectQualification';

const h = (seed: string) => createHash('sha256').update(seed).digest('hex');
const projectId = 'connected-unit-fixture';
const formats: Record<AuthorityDomain, DeliverableManifestFormat[]> = {
  mechanical: ['step', 'drawing', 'bom'],
  building: ['ifc', 'drawing', 'schedule'],
  civil: ['landxml', 'drawing', 'quantity-schedule'],
  landscape: ['site-model', 'planting-plan', 'irrigation-plan'],
  interior: ['space-model', 'drawing', 'finish-schedule'],
};

function product(domain: AuthorityDomain): ConnectedDomainProductBinding {
  const revision = { id: `${domain}-r1`, sha256: h(`${domain}:revision`) };
  const modelHash = h(`${domain}:model`);
  const authorityManifest: DomainAuthorityManifest = {
    schemaVersion: DOMAIN_AUTHORITY_SCHEMA, domain, projectId, projectRevision: revision,
    sourceRevision: { id: `${domain}-source-r1`, sha256: h(`${domain}:source`) },
    authorities: [{
      id: `${domain}-authority`, kind: 'client', sourceRef: `original://${domain}/unit-fixture`,
      contentSha256: h(`${domain}:authority`), capturedAt: '2026-08-24T00:00:00Z', reviewedAt: '2026-08-24T00:00:00Z',
      status: 'APPROVED', rights: { status: 'APPROVED', receiptSha256: h(`${domain}:rights`) },
    }],
  };
  const kinds = DOMAIN_REQUIRED_DELIVERABLE_KINDS[domain];
  const deliverableManifest: DomainDeliverableManifest = createDomainDeliverableManifest({
    domain, projectRevision: revision.id, modelContentHash: modelHash, generatedAt: '2026-08-24T00:00:00.000Z',
    deliverables: kinds.map((kind, index) => ({
      id: `${domain}-${kind}`, kind, format: formats[domain][index]!, contentSha256: h(`${domain}:${kind}`),
      byteLength: 100, sourceRevision: revision.id, generatedAt: '2026-08-24T00:00:00.000Z', verificationStatus: 'verified',
    })),
  });
  const receipt: DomainProductReceipt = {
    schema: DOMAIN_PRODUCT_RECEIPT_SCHEMA, domain, productId: `${domain}-product`, projectId, projectRevision: revision,
    claimedState: 'PRODUCT_QUALIFIED', requirementsSha256: h(`${domain}:requirements`),
    authorityManifestSha256: hashDomainAuthorityManifest(authorityManifest), semanticModelSha256: h(`${domain}:semantic`),
    geometryOrModelSha256: modelHash, relationshipsSha256: h(`${domain}:relationships`),
    calculationArtifactSha256s: [h(`${domain}:calculation`)],
    deliverableManifestSha256: canonicalDomainDeliverableManifestHash(deliverableManifest), exchangeReceiptSha256: h(`${domain}:exchange`),
    validationEvidence: DOMAIN_PRODUCT_AXES[domain].map(axis => ({
      axis, status: 'PASS', caseCount: 20, accuracyBasisPoints: 10_000, coverageBasisPoints: 10_000,
      falseVerificationCount: 0, artifactSha256: h(`${domain}:${axis}`), sourceRevision: revision.id,
    })),
    campaignEvidence: [1, 2, 3].map(index => ({ campaignId: `${domain}-campaign-${index}`, status: 'PASS', repeatCount: 5, falseVerificationCount: 0, artifactSha256: h(`${domain}:campaign:${index}`), sourceRevision: revision.id })),
    independentReviews: [1, 2].map(index => ({ reviewerId: `${domain}-reviewer-${index}`, status: 'APPROVED', receiptSha256: h(`${domain}:review:${index}`), sourceRevision: revision.id })),
    pilots: [1, 2, 3].map(index => ({ pilotId: `${domain}-pilot-${index}`, status: 'PASS', receiptSha256: h(`${domain}:pilot:${index}`), sourceRevision: revision.id })),
    currentBlockers: [], issuedAt: '2026-08-24T00:00:00Z',
  };
  return { domain, receipt, authorityManifest, deliverableManifest };
}

function input(): ConnectedProjectQualificationInput {
  const domainProducts = AUTHORITY_DOMAINS.map(product);
  const dependencyGraph: SpatialDependencyGraph = {
    schema: SPATIAL_DEPENDENCY_GRAPH_SCHEMA, projectId,
    artifacts: domainProducts.map(item => ({
      artifactId: `${item.domain}-product-receipt`, domain: item.domain, kind: 'product-receipt',
      sourceRevision: item.receipt.projectRevision.id, contentSha256: hashDomainProductReceipt(item.receipt),
      status: 'CURRENT', upstreamBindings: [],
    })),
  };
  return { schema: CONNECTED_PROJECT_QUALIFICATION_SCHEMA, projectId, dependencyGraph, domainProducts };
}

describe('connected project qualification', () => {
  it('recomputes all five synthetic unit receipts and graph bindings', () => {
    const result = evaluateConnectedProjectQualification(input());
    expect(result).toMatchObject({ status: 'PASS', readyForConnectedPilot: true, blockers: [] });
    expect(Object.keys(result.domainReceiptSha256s).sort()).toEqual([...AUTHORITY_DOMAINS].sort());
    expect(result.canonicalSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('holds the connected pilot when one domain lacks real pilot evidence', () => {
    const value = input();
    value.domainProducts.find(item => item.domain === 'landscape')!.receipt.pilots = [];
    const result = evaluateConnectedProjectQualification(value);
    expect(result.status).toBe('HOLD');
    expect(result.readyForConnectedPilot).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'domain_products[3]:product_not_qualified',
      'domain_products[3]:receipt:pilot_count_below_three',
      'domain_products[3]:current_receipt_graph_binding_required',
    ]));
  });

  it('holds stale graph bindings and requires the exact domain set', () => {
    const value = input();
    value.dependencyGraph.artifacts[0]!.contentSha256 = h('stale');
    value.domainProducts.pop();
    const result = evaluateConnectedProjectQualification(value);
    expect(result.status).toBe('HOLD');
    expect(result.blockers).toEqual(expect.arrayContaining(['domain_products_exact_set_required', 'domain_missing:interior']));
  });
});
