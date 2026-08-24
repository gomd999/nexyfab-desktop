import { describe, expect, it } from 'vitest';
import { createAiDesignKnowledgeSource } from './aiDesignKnowledgeGovernance';
import {
  InMemoryAiDesignTopologyIndex,
  assessAiDesignTopologyOutputSimilarity,
  assessAiDesignTopologyHoldoutCampaign,
  createAiDesignTopologyAsset,
  createAiDesignTopologyCandidateLineage,
  createAiDesignTopologyUseGrant,
  validateAiDesignTopologyCandidateLineage,
  validateAiDesignTopologyRetrievalReceipt,
  type AiDesignTopologySignatureV1,
} from './aiDesignTopologyRetrieval';

const hash = (character: string) => character.repeat(64);
const signature: AiDesignTopologySignatureV1 = {
  nodeCount: 24, edgeCount: 32, componentCount: 6,
  featureKinds: ['extrude', 'hole', 'pattern'], featureRelations: ['extrude-hole', 'hole-pattern'],
  interfacePatterns: ['bolted-interface', 'service-envelope'], domainTags: ['mechanical', 'assembly'],
  aspectRatios: [1, 1.5, 3], symmetry: ['mirror'], units: { length: 'mm', angle: 'deg' },
  coordinates: { frame: 'assembly', handedness: 'right', upAxis: 'z' },
};

function source(tenantId = 'tenant-1') {
  return createAiDesignKnowledgeSource({
    sourceId: `source-${tenantId}`, version: 1, sourceKind: 'synthetic', title: 'Rights-cleared independent topology fixture', contentHash: tenantId === 'tenant-1' ? hash('a') : hash('b'), rights: 'owned',
    allowedUses: ['human_reference', 'concept_extraction', 'retrieval', 'output_derivation'], rightsReference: null, rightsReferenceHash: null,
    effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: null, tenantId, projectId: null, containsProprietaryGeometry: true, containsPersonalData: false,
    approvedBy: 'rights-owner-1', approvedAt: '2026-01-02T00:00:00.000Z',
  });
}

function grant(boundSource = source(), overrides: { grantId?: string; tenantId?: string; expiresAt?: string | null } = {}) {
  return createAiDesignTopologyUseGrant({
    source: boundSource, grantId: overrides.grantId ?? 'grant-1', allowedUses: ['topology_index', 'pattern_retrieval', 'derivative_concept'],
    tenantId: overrides.tenantId ?? boundSource.tenantId, projectId: null, grantedBy: 'rights-owner-1', grantedAt: '2026-02-01T00:00:00.000Z', expiresAt: overrides.expiresAt ?? null, grantReferenceHash: hash('c'),
  });
}

function asset(boundSource = source(), boundGrant = grant(boundSource), assetId = 'asset-1') {
  return createAiDesignTopologyAsset({ assetId, version: 1, source: boundSource, grant: boundGrant, signature, privateObjectKeyHash: hash('d'), createdAt: '2026-02-02T00:00:00.000Z' });
}

describe('rights-cleared topology retrieval', () => {
  it('indexes only an explicitly granted generalized signature and returns no raw geometry', () => {
    const boundSource = source(), boundGrant = grant(boundSource), topologyAsset = asset(boundSource, boundGrant);
    expect(topologyAsset).toMatchObject({ rawGeometryIncluded: false, rawVerticesIncluded: false, rawBrepIncluded: false, conceptPatternOnly: true, exactAuthority: false });
    const index = new InMemoryAiDesignTopologyIndex(); expect(index.append(topologyAsset, boundGrant)).toEqual({ ok: true });
    const result = index.retrieve({ receiptId: 'topology-retrieval-1', projectId: 'project-1', sessionId: 'session-1', tenantId: 'tenant-1', query: signature, now: new Date('2026-03-01T00:00:00.000Z') });
    expect(result.assets.map(item => item.assetId)).toEqual(['asset-1']);
    expect(result.receipt).toMatchObject({ rawGeometryIncluded: false, conceptPatternOnly: true, exactAuthority: false, results: [{ assetId: 'asset-1', score: 1 }] });
    expect(validateAiDesignTopologyRetrievalReceipt(result.receipt)).toEqual([]);
    const lineage = createAiDesignTopologyCandidateLineage({
      lineageId: 'lineage-1', candidateArtifactId: 'candidate-artifact-1', candidateArtifactDigest: hash('e'), productStructureDigest: hash('f'),
      retrievalReceipt: result.receipt, selectedAssetIds: ['asset-1'], similarityDecision: 'HUMAN_REVIEW', createdAt: '2026-03-01T00:01:00.000Z',
    });
    expect(lineage).toMatchObject({ selectedResults: [{ assetId: 'asset-1' }], rawGeometryIncluded: false, exactAuthority: false, manufacturingAuthority: false });
    expect(validateAiDesignTopologyCandidateLineage(lineage)).toEqual([]);
  });

  it('enforces tenant isolation, grant expiry, tombstones and deterministic index regeneration', () => {
    const index = new InMemoryAiDesignTopologyIndex(); const sourceOne = source(), grantOne = grant(sourceOne), assetOne = asset(sourceOne, grantOne);
    const sourceTwo = source('tenant-2'), grantTwo = grant(sourceTwo, { grantId: 'grant-2', tenantId: 'tenant-2', expiresAt: '2026-02-15T00:00:00.000Z' }), assetTwo = asset(sourceTwo, grantTwo, 'asset-2');
    expect(index.append(assetOne, grantOne)).toEqual({ ok: true }); expect(index.append(assetTwo, grantTwo)).toEqual({ ok: true });
    const before = index.indexDigest();
    const result = index.retrieve({ receiptId: 'retrieval-tenant-1', projectId: 'project-1', sessionId: 'session-1', tenantId: 'tenant-1', query: signature, now: new Date('2026-03-01T00:00:00.000Z') });
    expect(result.assets.map(item => item.assetId)).toEqual(['asset-1']); expect(result.receipt.deniedAssetIds).toContain('asset-2');
    index.tombstone('asset-1', 1, { reason: 'owner_request', removedBy: 'rights-owner-1', removedAt: '2026-03-02T00:00:00.000Z' });
    expect(index.indexDigest()).not.toBe(before);
    expect(index.retrieve({ receiptId: 'retrieval-after-delete', projectId: 'project-1', sessionId: 'session-1', tenantId: 'tenant-1', query: signature, now: new Date('2026-03-03T00:00:00.000Z') }).assets).toHaveLength(0);
  });

  it('blocks unknown-rights sources and flags near-copy topology for review or blocking', () => {
    const unknown = createAiDesignKnowledgeSource({ sourceId: 'unknown-source', version: 1, sourceKind: 'catalog', title: 'Unknown rights catalog', contentHash: hash('e'), rights: 'unknown', allowedUses: [], rightsReference: null, rightsReferenceHash: null, effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: null, tenantId: 'tenant-1', projectId: null, containsProprietaryGeometry: true, containsPersonalData: false, approvedBy: null, approvedAt: null });
    expect(() => grant(unknown, { grantId: 'grant-unknown' })).toThrow('AI_DESIGN_TOPOLOGY_SOURCE_RIGHTS_DENIED');
    const topologyAsset = asset();
    expect(assessAiDesignTopologyOutputSimilarity(signature, [topologyAsset])).toMatchObject({ status: 'BLOCK', highestScore: 1 });
    const distinct = { ...signature, featureKinds: ['sweep'], interfacePatterns: ['fluid-port'], domainTags: ['fluid'], aspectRatios: [10], symmetry: ['none'] as const };
    expect(assessAiDesignTopologyOutputSimilarity(distinct, [topologyAsset]).status).toBe('ALLOW');
  });

  it('keeps topology retrieval disabled until independent holdouts improve quality without leak growth', () => {
    const cases = [0, 1, 2].map(index => ({
      caseId: `topology-case-${index}`, baselineQuality: 0.55, retrievalQuality: 0.7,
      baselineLeakRisk: 0.1, retrievalLeakRisk: 0.1, lineageDigest: hash(String(index + 1)),
      externallyReviewed: true, outputDecision: index === 2 ? 'HUMAN_REVIEW' as const : 'ALLOW' as const,
    }));
    const policy = { minimumCases: 3, minimumMeanQualityImprovement: 0.1, maximumMeanLeakRiskIncrease: 0 };
    expect(assessAiDesignTopologyHoldoutCampaign(cases, policy)).toMatchObject({ status: 'HOLD', defaultEnabled: false, eligibleCaseCount: 2 });
    expect(assessAiDesignTopologyHoldoutCampaign(cases.map(item => ({ ...item, outputDecision: 'ALLOW' as const })), policy)).toMatchObject({ status: 'PASS', defaultEnabled: true, eligibleCaseCount: 3 });
  });
});
