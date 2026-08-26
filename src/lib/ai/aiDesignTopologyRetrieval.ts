import {
  decideAiDesignKnowledgeUse,
  validateAiDesignKnowledgeSource,
  type AiDesignKnowledgeSourceV1,
} from './aiDesignKnowledgeGovernance';
import { serverEvidenceSha256 } from './serverEvidence';

export const AI_DESIGN_TOPOLOGY_USE_GRANT_SCHEMA = 'nexyfab.ai-design-topology-use-grant.v1' as const;
export const AI_DESIGN_TOPOLOGY_ASSET_SCHEMA = 'nexyfab.ai-design-topology-asset.v1' as const;
export const AI_DESIGN_TOPOLOGY_RETRIEVAL_RECEIPT_SCHEMA = 'nexyfab.ai-design-topology-retrieval-receipt.v1' as const;
export const AI_DESIGN_TOPOLOGY_CANDIDATE_LINEAGE_SCHEMA = 'nexyfab.ai-design-topology-candidate-lineage.v1' as const;

export type AiDesignTopologyAllowedUse = 'topology_index' | 'pattern_retrieval' | 'derivative_concept';
const TOPOLOGY_USES: readonly AiDesignTopologyAllowedUse[] = ['topology_index', 'pattern_retrieval', 'derivative_concept'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_TAGS = 128;
const MAX_SIGNATURE_ITEMS = 512;

export interface AiDesignTopologyUseGrantV1 {
  schema: typeof AI_DESIGN_TOPOLOGY_USE_GRANT_SCHEMA;
  grantId: string;
  sourceId: string;
  sourceVersion: number;
  sourceContentHash: string;
  sourceRecordDigest: string;
  allowedUses: readonly AiDesignTopologyAllowedUse[];
  tenantId: string | null;
  projectId: string | null;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string | null;
  grantReferenceHash: string;
  rawGeometryModelAccess: false;
  grantDigest: string;
}

export interface AiDesignTopologySignatureV1 {
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  featureKinds: readonly string[];
  featureRelations: readonly string[];
  interfacePatterns: readonly string[];
  domainTags: readonly string[];
  aspectRatios: readonly number[];
  symmetry: readonly ('none' | 'mirror' | 'radial' | 'translational')[];
  units: { length: 'mm' | 'cm' | 'm' | 'in' | 'ft'; angle: 'deg' | 'rad' };
  coordinates: { frame: 'local' | 'assembly' | 'world' | 'georeferenced'; handedness: 'right' | 'left'; upAxis: 'x' | 'y' | 'z' };
}

export interface AiDesignTopologyAssetV1 {
  schema: typeof AI_DESIGN_TOPOLOGY_ASSET_SCHEMA;
  assetId: string;
  version: number;
  sourceId: string;
  sourceVersion: number;
  sourceContentHash: string;
  sourceRecordDigest: string;
  grantId: string;
  grantDigest: string;
  tenantId: string | null;
  projectId: string | null;
  signature: AiDesignTopologySignatureV1;
  privateObjectKeyHash: string;
  rawGeometryIncluded: false;
  rawVerticesIncluded: false;
  rawBrepIncluded: false;
  conceptPatternOnly: true;
  exactAuthority: false;
  createdAt: string;
  assetDigest: string;
}

export interface AiDesignTopologyRetrievalReceiptV1 {
  schema: typeof AI_DESIGN_TOPOLOGY_RETRIEVAL_RECEIPT_SCHEMA;
  receiptId: string;
  projectId: string;
  sessionId: string;
  tenantId: string | null;
  queryDigest: string;
  indexDigest: string;
  results: readonly {
    assetId: string;
    assetDigest: string;
    sourceRecordDigest: string;
    grantDigest: string;
    score: number;
    pattern: AiDesignTopologySignatureV1;
  }[];
  deniedAssetIds: readonly string[];
  createdAt: string;
  rawGeometryIncluded: false;
  conceptPatternOnly: true;
  exactAuthority: false;
  receiptDigest: string;
}

export interface AiDesignTopologyTombstoneV1 {
  assetId: string;
  assetDigest: string;
  reason: 'rights_revoked' | 'retention_expired' | 'source_deleted' | 'owner_request';
  removedBy: string;
  removedAt: string;
  tombstoneDigest: string;
}

export interface AiDesignTopologyCandidateLineageV1 {
  schema: typeof AI_DESIGN_TOPOLOGY_CANDIDATE_LINEAGE_SCHEMA;
  lineageId: string;
  projectId: string;
  sessionId: string;
  candidateArtifactId: string;
  candidateArtifactDigest: string;
  productStructureDigest: string;
  retrievalReceiptId: string;
  retrievalReceiptDigest: string;
  selectedResults: readonly { assetId: string; assetDigest: string; grantDigest: string; sourceRecordDigest: string }[];
  similarityDecision: 'ALLOW' | 'HUMAN_REVIEW' | 'BLOCK';
  createdAt: string;
  rawGeometryIncluded: false;
  conceptPatternOnly: true;
  exactAuthority: false;
  manufacturingAuthority: false;
  lineageDigest: string;
}

export interface AiDesignTopologyHoldoutCaseV1 {
  caseId: string;
  baselineQuality: number;
  retrievalQuality: number;
  baselineLeakRisk: number;
  retrievalLeakRisk: number;
  lineageDigest: string;
  externallyReviewed: boolean;
  outputDecision: 'ALLOW' | 'HUMAN_REVIEW' | 'BLOCK';
}

function timestamp(value: string | null): boolean { return value === null || Number.isFinite(Date.parse(value)); }
function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function removeDigest<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> { const copy = { ...value }; delete copy[key]; return copy; }
function validStrings(values: readonly string[], max = MAX_SIGNATURE_ITEMS): boolean { return Array.isArray(values) && values.length <= max && new Set(values).size === values.length && values.every(item => ID.test(item)); }

export function createAiDesignTopologyUseGrant(input: Omit<AiDesignTopologyUseGrantV1, 'schema' | 'sourceId' | 'sourceVersion' | 'sourceContentHash' | 'sourceRecordDigest' | 'rawGeometryModelAccess' | 'grantDigest'> & { source: AiDesignKnowledgeSourceV1 }): AiDesignTopologyUseGrantV1 {
  const sourceIssues = validateAiDesignKnowledgeSource(input.source);
  const decision = decideAiDesignKnowledgeUse(input.source, 'retrieval', { tenantId: input.tenantId ?? undefined, projectId: input.projectId ?? undefined, now: new Date(input.grantedAt) });
  if (sourceIssues.length || !decision.allowed || ['unknown', 'restricted'].includes(input.source.rights)) throw new Error(`AI_DESIGN_TOPOLOGY_SOURCE_RIGHTS_DENIED:${decision.reason}`);
  const base = {
    schema: AI_DESIGN_TOPOLOGY_USE_GRANT_SCHEMA,
    grantId: input.grantId, sourceId: input.source.sourceId, sourceVersion: input.source.version, sourceContentHash: input.source.contentHash, sourceRecordDigest: input.source.recordDigest,
    allowedUses: unique(input.allowedUses).sort(), tenantId: input.tenantId, projectId: input.projectId, grantedBy: input.grantedBy, grantedAt: input.grantedAt, expiresAt: input.expiresAt,
    grantReferenceHash: input.grantReferenceHash, rawGeometryModelAccess: false as const,
  };
  const grant = Object.freeze({ ...base, grantDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignTopologyUseGrant(grant); if (issues.length) throw new Error(`AI_DESIGN_TOPOLOGY_GRANT_INVALID:${issues.join(',')}`);
  return grant;
}

export function validateAiDesignTopologyUseGrant(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['topology_grant_not_object'];
  const grant = value as AiDesignTopologyUseGrantV1; const issues: string[] = [];
  if (grant.schema !== AI_DESIGN_TOPOLOGY_USE_GRANT_SCHEMA || !ID.test(grant.grantId ?? '') || !ID.test(grant.sourceId ?? '') || !Number.isSafeInteger(grant.sourceVersion) || grant.sourceVersion < 1 || !SHA256.test(grant.sourceContentHash ?? '') || !SHA256.test(grant.sourceRecordDigest ?? '')) issues.push('topology_grant_binding_invalid');
  if (!Array.isArray(grant.allowedUses) || grant.allowedUses.length < 1 || grant.allowedUses.some(item => !TOPOLOGY_USES.includes(item)) || !grant.allowedUses.includes('topology_index') || !grant.allowedUses.includes('pattern_retrieval')) issues.push('topology_grant_use_invalid');
  if ((grant.tenantId !== null && !ID.test(grant.tenantId)) || (grant.projectId !== null && !ID.test(grant.projectId)) || !ID.test(grant.grantedBy ?? '') || !timestamp(grant.grantedAt) || !timestamp(grant.expiresAt) || grant.expiresAt !== null && Date.parse(grant.expiresAt) <= Date.parse(grant.grantedAt)) issues.push('topology_grant_scope_invalid');
  if (!SHA256.test(grant.grantReferenceHash ?? '') || grant.rawGeometryModelAccess !== false || !SHA256.test(grant.grantDigest ?? '')) issues.push('topology_grant_authority_invalid');
  if (issues.length === 0 && grant.grantDigest !== serverEvidenceSha256(removeDigest(grant, 'grantDigest'))) issues.push('topology_grant_digest_mismatch');
  return [...new Set(issues)];
}

export function validateAiDesignTopologySignature(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['topology_signature_not_object'];
  const signature = value as AiDesignTopologySignatureV1; const issues: string[] = [];
  if (![signature.nodeCount, signature.edgeCount, signature.componentCount].every(item => Number.isSafeInteger(item) && item >= 0) || signature.edgeCount > 1_000_000 || signature.nodeCount > 1_000_000 || signature.componentCount > signature.nodeCount) issues.push('topology_signature_counts_invalid');
  if (!validStrings(signature.featureKinds) || !validStrings(signature.featureRelations) || !validStrings(signature.interfacePatterns) || !validStrings(signature.domainTags, MAX_TAGS)) issues.push('topology_signature_tags_invalid');
  if (!Array.isArray(signature.aspectRatios) || signature.aspectRatios.length > 32 || signature.aspectRatios.some(item => !Number.isFinite(item) || item <= 0 || item > 1_000)) issues.push('topology_signature_ratios_invalid');
  if (!Array.isArray(signature.symmetry) || signature.symmetry.length > 16 || signature.symmetry.some(item => !['none', 'mirror', 'radial', 'translational'].includes(item))) issues.push('topology_signature_symmetry_invalid');
  if (!signature.units || !['mm', 'cm', 'm', 'in', 'ft'].includes(signature.units.length) || !['deg', 'rad'].includes(signature.units.angle)
    || !signature.coordinates || !['local', 'assembly', 'world', 'georeferenced'].includes(signature.coordinates.frame)
    || !['right', 'left'].includes(signature.coordinates.handedness) || !['x', 'y', 'z'].includes(signature.coordinates.upAxis)) issues.push('topology_signature_frame_invalid');
  return [...new Set(issues)];
}

export function createAiDesignTopologyAsset(input: {
  assetId: string; version: number; source: AiDesignKnowledgeSourceV1; grant: AiDesignTopologyUseGrantV1;
  signature: AiDesignTopologySignatureV1; privateObjectKeyHash: string; createdAt?: string;
}): AiDesignTopologyAssetV1 {
  const grantIssues = validateAiDesignTopologyUseGrant(input.grant); if (grantIssues.length) throw new Error(`AI_DESIGN_TOPOLOGY_GRANT_INVALID:${grantIssues.join(',')}`);
  if (input.source.sourceId !== input.grant.sourceId || input.source.version !== input.grant.sourceVersion || input.source.contentHash !== input.grant.sourceContentHash || input.source.recordDigest !== input.grant.sourceRecordDigest) throw new Error('AI_DESIGN_TOPOLOGY_SOURCE_GRANT_MISMATCH');
  const signatureIssues = validateAiDesignTopologySignature(input.signature); if (signatureIssues.length) throw new Error(`AI_DESIGN_TOPOLOGY_SIGNATURE_INVALID:${signatureIssues.join(',')}`);
  const base = {
    schema: AI_DESIGN_TOPOLOGY_ASSET_SCHEMA,
    assetId: input.assetId, version: input.version, sourceId: input.source.sourceId, sourceVersion: input.source.version, sourceContentHash: input.source.contentHash, sourceRecordDigest: input.source.recordDigest,
    grantId: input.grant.grantId, grantDigest: input.grant.grantDigest, tenantId: input.grant.tenantId, projectId: input.grant.projectId,
    signature: structuredClone(input.signature), privateObjectKeyHash: input.privateObjectKeyHash,
    rawGeometryIncluded: false as const, rawVerticesIncluded: false as const, rawBrepIncluded: false as const, conceptPatternOnly: true as const, exactAuthority: false as const,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const asset = Object.freeze({ ...base, assetDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignTopologyAsset(asset); if (issues.length) throw new Error(`AI_DESIGN_TOPOLOGY_ASSET_INVALID:${issues.join(',')}`);
  return asset;
}

export function validateAiDesignTopologyAsset(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['topology_asset_not_object'];
  const asset = value as AiDesignTopologyAssetV1; const issues: string[] = [];
  if (asset.schema !== AI_DESIGN_TOPOLOGY_ASSET_SCHEMA || !ID.test(asset.assetId ?? '') || !Number.isSafeInteger(asset.version) || asset.version < 1 || !ID.test(asset.sourceId ?? '') || !Number.isSafeInteger(asset.sourceVersion) || asset.sourceVersion < 1 || !SHA256.test(asset.sourceContentHash ?? '') || !SHA256.test(asset.sourceRecordDigest ?? '') || !ID.test(asset.grantId ?? '') || !SHA256.test(asset.grantDigest ?? '')) issues.push('topology_asset_binding_invalid');
  if ((asset.tenantId !== null && !ID.test(asset.tenantId)) || (asset.projectId !== null && !ID.test(asset.projectId)) || validateAiDesignTopologySignature(asset.signature).length) issues.push('topology_asset_scope_or_signature_invalid');
  if (!SHA256.test(asset.privateObjectKeyHash ?? '') || asset.rawGeometryIncluded !== false || asset.rawVerticesIncluded !== false || asset.rawBrepIncluded !== false || asset.conceptPatternOnly !== true || asset.exactAuthority !== false || !timestamp(asset.createdAt) || !SHA256.test(asset.assetDigest ?? '')) issues.push('topology_asset_safety_invalid');
  if (issues.length === 0 && asset.assetDigest !== serverEvidenceSha256(removeDigest(asset, 'assetDigest'))) issues.push('topology_asset_digest_mismatch');
  return [...new Set(issues)];
}

function jaccard(left: readonly string[], right: readonly string[]): number { const a = new Set(left), b = new Set(right), union = new Set([...a, ...b]); if (!union.size) return 1; return [...a].filter(item => b.has(item)).length / union.size; }
function ratioSimilarity(left: readonly number[], right: readonly number[]): number { if (!left.length && !right.length) return 1; if (left.length !== right.length || !left.length) return 0; const a = [...left].sort((x, y) => x - y), b = [...right].sort((x, y) => x - y); return a.reduce((sum, value, index) => sum + Math.max(0, 1 - Math.abs(value - b[index]!) / Math.max(value, b[index]!, 1e-9)), 0) / a.length; }

export function aiDesignTopologySimilarity(left: AiDesignTopologySignatureV1, right: AiDesignTopologySignatureV1): number {
  const issues = [...validateAiDesignTopologySignature(left), ...validateAiDesignTopologySignature(right)]; if (issues.length) throw new Error('AI_DESIGN_TOPOLOGY_SIGNATURE_INVALID');
  const count = (a: number, b: number) => a === 0 && b === 0 ? 1 : Math.min(a, b) / Math.max(a, b, 1);
  const unitAndFrame = [left.units.length === right.units.length, left.units.angle === right.units.angle, left.coordinates.frame === right.coordinates.frame, left.coordinates.handedness === right.coordinates.handedness, left.coordinates.upAxis === right.coordinates.upAxis].filter(Boolean).length / 5;
  return Number((0.18 * jaccard(left.featureKinds, right.featureKinds) + 0.12 * jaccard(left.featureRelations, right.featureRelations)
    + 0.15 * jaccard(left.interfacePatterns, right.interfacePatterns) + 0.1 * jaccard(left.domainTags, right.domainTags)
    + 0.08 * jaccard(left.symmetry, right.symmetry) + 0.12 * ratioSimilarity(left.aspectRatios, right.aspectRatios)
    + 0.1 * unitAndFrame + 0.05 * count(left.nodeCount, right.nodeCount) + 0.05 * count(left.edgeCount, right.edgeCount) + 0.05 * count(left.componentCount, right.componentCount)).toFixed(6));
}

export function assessAiDesignTopologyOutputSimilarity(candidate: AiDesignTopologySignatureV1, sources: readonly AiDesignTopologyAssetV1[], policy: { reviewThreshold?: number; blockThreshold?: number } = {}) {
  const reviewThreshold = policy.reviewThreshold ?? 0.82, blockThreshold = policy.blockThreshold ?? 0.94;
  if (reviewThreshold <= 0 || blockThreshold <= reviewThreshold || blockThreshold > 1) throw new Error('AI_DESIGN_TOPOLOGY_SIMILARITY_POLICY_INVALID');
  const matches = sources.map(asset => ({ assetId: asset.assetId, score: aiDesignTopologySimilarity(candidate, asset.signature) })).sort((a, b) => b.score - a.score);
  const highest = matches[0]?.score ?? 0;
  return { status: highest >= blockThreshold ? 'BLOCK' as const : highest >= reviewThreshold ? 'HUMAN_REVIEW' as const : 'ALLOW' as const, highestScore: highest, matches };
}

export class InMemoryAiDesignTopologyIndex {
  private readonly assets = new Map<string, AiDesignTopologyAssetV1>();
  private readonly grants = new Map<string, AiDesignTopologyUseGrantV1>();
  private readonly tombstones = new Map<string, AiDesignTopologyTombstoneV1>();
  constructor(private readonly mode: 'reference' | 'commercial' = 'reference') {}
  private ensure() { if (this.mode === 'commercial') throw new Error('AI_DESIGN_TOPOLOGY_INDEX_POSTGRES_REQUIRED'); }
  append(asset: AiDesignTopologyAssetV1, grant: AiDesignTopologyUseGrantV1): { ok: true } | { ok: false; issues: readonly string[] } {
    this.ensure(); const issues = [...validateAiDesignTopologyAsset(asset), ...validateAiDesignTopologyUseGrant(grant)]; if (asset.grantId !== grant.grantId || asset.grantDigest !== grant.grantDigest) issues.push('topology_asset_grant_mismatch'); if (issues.length) return { ok: false, issues: [...new Set(issues)] };
    const key = `${asset.assetId}:v${asset.version}`; const prior = this.assets.get(key); if (prior) return prior.assetDigest === asset.assetDigest ? { ok: true } : { ok: false, issues: ['topology_asset_overwrite_forbidden'] };
    this.assets.set(key, structuredClone(asset)); this.grants.set(grant.grantId, structuredClone(grant)); return { ok: true };
  }
  tombstone(assetId: string, version: number, input: Omit<AiDesignTopologyTombstoneV1, 'assetId' | 'assetDigest' | 'tombstoneDigest'>): AiDesignTopologyTombstoneV1 {
    this.ensure(); const key = `${assetId}:v${version}`, asset = this.assets.get(key); if (!asset) throw new Error('AI_DESIGN_TOPOLOGY_ASSET_NOT_FOUND'); if (!ID.test(input.removedBy) || !timestamp(input.removedAt) || !['rights_revoked', 'retention_expired', 'source_deleted', 'owner_request'].includes(input.reason)) throw new Error('AI_DESIGN_TOPOLOGY_TOMBSTONE_INVALID');
    const base = { assetId: key, assetDigest: asset.assetDigest, ...input }; const tombstone = Object.freeze({ ...base, tombstoneDigest: serverEvidenceSha256(base) }); this.tombstones.set(key, tombstone); return tombstone;
  }
  indexDigest(): string { this.ensure(); return serverEvidenceSha256({ assets: [...this.assets.entries()].filter(([key]) => !this.tombstones.has(key)).map(([, asset]) => asset.assetDigest).sort(), tombstones: [...this.tombstones.values()].map(item => item.tombstoneDigest).sort() }); }
  retrieve(input: { receiptId: string; projectId: string; sessionId: string; tenantId: string | null; query: AiDesignTopologySignatureV1; now?: Date; maxResults?: number }): { assets: readonly AiDesignTopologyAssetV1[]; receipt: AiDesignTopologyRetrievalReceiptV1 } {
    this.ensure(); const now = input.now ?? new Date(); const queryIssues = validateAiDesignTopologySignature(input.query); if (!ID.test(input.receiptId) || !ID.test(input.projectId) || !ID.test(input.sessionId) || input.tenantId !== null && !ID.test(input.tenantId) || queryIssues.length) throw new Error('AI_DESIGN_TOPOLOGY_QUERY_INVALID');
    const denied: string[] = [], eligible: { asset: AiDesignTopologyAssetV1; score: number }[] = [];
    for (const [key, asset] of this.assets) {
      const grant = this.grants.get(asset.grantId); const scoped = (asset.tenantId === null || asset.tenantId === input.tenantId) && (asset.projectId === null || asset.projectId === input.projectId); const current = !!grant && (grant.expiresAt === null || now.getTime() < Date.parse(grant.expiresAt));
      if (this.tombstones.has(key) || !grant || !scoped || !current || !grant.allowedUses.includes('pattern_retrieval')) { denied.push(asset.assetId); continue; }
      eligible.push({ asset, score: aiDesignTopologySimilarity(input.query, asset.signature) });
    }
    const selected = eligible.sort((a, b) => b.score - a.score || a.asset.assetId.localeCompare(b.asset.assetId)).slice(0, Math.max(1, Math.min(input.maxResults ?? 8, 32)));
    const base = { schema: AI_DESIGN_TOPOLOGY_RETRIEVAL_RECEIPT_SCHEMA, receiptId: input.receiptId, projectId: input.projectId, sessionId: input.sessionId, tenantId: input.tenantId, queryDigest: serverEvidenceSha256(input.query), indexDigest: this.indexDigest(), results: selected.map(item => ({ assetId: item.asset.assetId, assetDigest: item.asset.assetDigest, sourceRecordDigest: item.asset.sourceRecordDigest, grantDigest: item.asset.grantDigest, score: item.score, pattern: structuredClone(item.asset.signature) })), deniedAssetIds: unique(denied).sort(), createdAt: now.toISOString(), rawGeometryIncluded: false as const, conceptPatternOnly: true as const, exactAuthority: false as const };
    const receipt = Object.freeze({ ...base, receiptDigest: serverEvidenceSha256(base) });
    return { assets: selected.map(item => structuredClone(item.asset)), receipt };
  }
}

export function validateAiDesignTopologyRetrievalReceipt(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['topology_receipt_not_object'];
  const receipt = value as AiDesignTopologyRetrievalReceiptV1; const issues: string[] = [];
  if (receipt.schema !== AI_DESIGN_TOPOLOGY_RETRIEVAL_RECEIPT_SCHEMA || !ID.test(receipt.receiptId ?? '') || !ID.test(receipt.projectId ?? '') || !ID.test(receipt.sessionId ?? '') || receipt.tenantId !== null && !ID.test(receipt.tenantId) || !SHA256.test(receipt.queryDigest ?? '') || !SHA256.test(receipt.indexDigest ?? '')) issues.push('topology_receipt_binding_invalid');
  if (!Array.isArray(receipt.results) || receipt.results.length > 32 || receipt.results.some(item => !ID.test(item.assetId ?? '') || !SHA256.test(item.assetDigest ?? '') || !SHA256.test(item.sourceRecordDigest ?? '') || !SHA256.test(item.grantDigest ?? '') || !Number.isFinite(item.score) || item.score < 0 || item.score > 1 || validateAiDesignTopologySignature(item.pattern).length)) issues.push('topology_receipt_result_invalid');
  if (!Array.isArray(receipt.deniedAssetIds) || receipt.deniedAssetIds.some(item => !ID.test(item)) || !timestamp(receipt.createdAt) || receipt.rawGeometryIncluded !== false || receipt.conceptPatternOnly !== true || receipt.exactAuthority !== false || !SHA256.test(receipt.receiptDigest ?? '')) issues.push('topology_receipt_safety_invalid');
  if (issues.length === 0 && receipt.receiptDigest !== serverEvidenceSha256(removeDigest(receipt, 'receiptDigest'))) issues.push('topology_receipt_digest_mismatch');
  return [...new Set(issues)];
}

function lineageMaterial(value: Omit<AiDesignTopologyCandidateLineageV1, 'lineageDigest'> | AiDesignTopologyCandidateLineageV1) {
  return removeDigest(value as AiDesignTopologyCandidateLineageV1, 'lineageDigest');
}

/** Binds generalized retrieval provenance to a candidate and ProductStructureGraph digest. */
export function createAiDesignTopologyCandidateLineage(input: {
  lineageId: string;
  candidateArtifactId: string;
  candidateArtifactDigest: string;
  productStructureDigest: string;
  retrievalReceipt: AiDesignTopologyRetrievalReceiptV1;
  selectedAssetIds: readonly string[];
  similarityDecision: AiDesignTopologyCandidateLineageV1['similarityDecision'];
  createdAt?: string;
}): AiDesignTopologyCandidateLineageV1 {
  const receiptIssues = validateAiDesignTopologyRetrievalReceipt(input.retrievalReceipt);
  if (receiptIssues.length) throw new Error(`AI_DESIGN_TOPOLOGY_RECEIPT_INVALID:${receiptIssues.join(',')}`);
  const selectedIds = unique(input.selectedAssetIds);
  const selectedResults = selectedIds.map(assetId => input.retrievalReceipt.results.find(result => result.assetId === assetId));
  if (selectedIds.length > 32 || selectedResults.some(result => !result)) throw new Error('AI_DESIGN_TOPOLOGY_LINEAGE_RESULT_MISMATCH');
  const base = {
    schema: AI_DESIGN_TOPOLOGY_CANDIDATE_LINEAGE_SCHEMA,
    lineageId: input.lineageId,
    projectId: input.retrievalReceipt.projectId,
    sessionId: input.retrievalReceipt.sessionId,
    candidateArtifactId: input.candidateArtifactId,
    candidateArtifactDigest: input.candidateArtifactDigest,
    productStructureDigest: input.productStructureDigest,
    retrievalReceiptId: input.retrievalReceipt.receiptId,
    retrievalReceiptDigest: input.retrievalReceipt.receiptDigest,
    selectedResults: selectedResults.map(result => ({ assetId: result!.assetId, assetDigest: result!.assetDigest, grantDigest: result!.grantDigest, sourceRecordDigest: result!.sourceRecordDigest })),
    similarityDecision: input.similarityDecision,
    createdAt: input.createdAt ?? new Date().toISOString(),
    rawGeometryIncluded: false as const,
    conceptPatternOnly: true as const,
    exactAuthority: false as const,
    manufacturingAuthority: false as const,
  };
  const lineage = Object.freeze({ ...base, lineageDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignTopologyCandidateLineage(lineage);
  if (issues.length) throw new Error(`AI_DESIGN_TOPOLOGY_LINEAGE_INVALID:${issues.join(',')}`);
  return lineage;
}

export function validateAiDesignTopologyCandidateLineage(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['topology_lineage_not_object'];
  const lineage = value as AiDesignTopologyCandidateLineageV1;
  const issues: string[] = [];
  if (lineage.schema !== AI_DESIGN_TOPOLOGY_CANDIDATE_LINEAGE_SCHEMA || !ID.test(lineage.lineageId ?? '') || !ID.test(lineage.projectId ?? '') || !ID.test(lineage.sessionId ?? '')
    || !ID.test(lineage.candidateArtifactId ?? '') || !ID.test(lineage.retrievalReceiptId ?? '')
    || ![lineage.candidateArtifactDigest, lineage.productStructureDigest, lineage.retrievalReceiptDigest, lineage.lineageDigest].every(value => SHA256.test(value ?? ''))) issues.push('topology_lineage_binding_invalid');
  if (!Array.isArray(lineage.selectedResults) || lineage.selectedResults.length > 32 || lineage.selectedResults.some(result => !ID.test(result.assetId ?? '') || ![result.assetDigest, result.grantDigest, result.sourceRecordDigest].every(value => SHA256.test(value ?? '')))) issues.push('topology_lineage_results_invalid');
  if (!['ALLOW', 'HUMAN_REVIEW', 'BLOCK'].includes(lineage.similarityDecision) || !timestamp(lineage.createdAt)
    || lineage.rawGeometryIncluded !== false || lineage.conceptPatternOnly !== true || lineage.exactAuthority !== false || lineage.manufacturingAuthority !== false) issues.push('topology_lineage_authority_invalid');
  if (issues.length === 0 && lineage.lineageDigest !== serverEvidenceSha256(lineageMaterial(lineage))) issues.push('topology_lineage_digest_mismatch');
  return [...new Set(issues)];
}

/** Gates retrieval rollout on externally reviewed improvement and non-increasing leak risk. */
export function assessAiDesignTopologyHoldoutCampaign(
  cases: readonly AiDesignTopologyHoldoutCaseV1[],
  policy: { minimumCases: number; minimumMeanQualityImprovement: number; maximumMeanLeakRiskIncrease: number },
) {
  if (!Number.isSafeInteger(policy.minimumCases) || policy.minimumCases < 1 || !Number.isFinite(policy.minimumMeanQualityImprovement)
    || !Number.isFinite(policy.maximumMeanLeakRiskIncrease) || policy.maximumMeanLeakRiskIncrease < 0) throw new Error('AI_DESIGN_TOPOLOGY_HOLDOUT_POLICY_INVALID');
  if (cases.some(item => !ID.test(item.caseId) || ![item.baselineQuality, item.retrievalQuality, item.baselineLeakRisk, item.retrievalLeakRisk].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    || !SHA256.test(item.lineageDigest) || !['ALLOW', 'HUMAN_REVIEW', 'BLOCK'].includes(item.outputDecision))) throw new Error('AI_DESIGN_TOPOLOGY_HOLDOUT_CASE_INVALID');
  const eligible = cases.filter(item => item.externallyReviewed && item.outputDecision === 'ALLOW');
  const mean = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const meanQualityImprovement = mean(eligible.map(item => item.retrievalQuality - item.baselineQuality));
  const meanLeakRiskIncrease = mean(eligible.map(item => item.retrievalLeakRisk - item.baselineLeakRisk));
  const defaultEnabled = eligible.length >= policy.minimumCases && meanQualityImprovement >= policy.minimumMeanQualityImprovement && meanLeakRiskIncrease <= policy.maximumMeanLeakRiskIncrease;
  return Object.freeze({
    caseCount: cases.length, eligibleCaseCount: eligible.length,
    meanQualityImprovement: Number(meanQualityImprovement.toFixed(6)), meanLeakRiskIncrease: Number(meanLeakRiskIncrease.toFixed(6)),
    defaultEnabled, status: defaultEnabled ? 'PASS' as const : 'HOLD' as const,
    campaignDigest: serverEvidenceSha256({ cases: [...cases].sort((left, right) => left.caseId.localeCompare(right.caseId)), policy }),
    rawGeometryIncluded: false as const, exactAuthority: false as const,
  });
}
