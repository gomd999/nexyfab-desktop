import { createHash } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import { canonicalCadConsumerDraftJson, type CanonicalCadRevisionRef } from './canonicalCadV2ConsumerDraft';
import { assertCanonicalCadRevisionMigration } from './canonicalCadRevisionStore';
import { readMechanicalCurrentHead } from './mechanicalCurrentHeadReader';

export const MECHANICAL_STABLE_REFERENCE_BINDING_SCHEMA =
  'nexyfab.precision-cad.mechanical-stable-reference-binding.v1' as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FEATURE_REFERENCES = 256;
const BINDING_KEYS = [
  'schema', 'authority', 'projectId', 'documentId', 'revision', 'partId',
  'featureTreeSha256', 'rightsReceiptRevision', 'rightsReceiptSha256',
  'stableFeatures', 'exactExecution', 'release', 'manufacturingReleaseReady',
  'bindingSha256',
] as const;
const REVISION_KEYS = ['revisionId', 'sequence', 'contentSha256'] as const;
const FEATURE_KEYS = ['featureId', 'featureSha256'] as const;

type HeadCandidateRow = {
  project_id: string;
  document_id: string;
  revision_id: string;
  sequence: number;
  content_hash: string;
};

export interface MechanicalStableReferenceBinding {
  schema: typeof MECHANICAL_STABLE_REFERENCE_BINDING_SCHEMA;
  authority: 'SERVER_CURRENT_CANONICAL_HEAD';
  projectId: string;
  documentId: string;
  revision: CanonicalCadRevisionRef;
  partId: string;
  featureTreeSha256: string;
  rightsReceiptRevision: string;
  rightsReceiptSha256: string;
  stableFeatures: readonly {
    featureId: string;
    featureSha256: string;
  }[];
  exactExecution: 'NOT_RUN';
  release: 'HOLD';
  manufacturingReleaseReady: false;
  bindingSha256: string;
}

export type MechanicalStableReferenceBindingResult =
  | { ok: true; status: 'STABLE_REFERENCES_BOUND'; binding: MechanicalStableReferenceBinding }
  | {
      ok: false;
      status: 'HOLD';
      code:
        | 'INVALID_REQUEST'
        | 'MIGRATION_REQUIRED'
        | 'CURRENT_HEAD_NOT_FOUND'
        | 'CURRENT_HEAD_AMBIGUOUS'
        | 'CURRENT_HEAD_STALE'
        | 'CURRENT_HEAD_INVALID'
        | 'STABLE_FEATURE_REFERENCE_MISSING'
        | 'SERVER_READ_FAILED';
      blockers: readonly string[];
    };

export interface ResolveMechanicalStableReferenceInput {
  projectId: string;
  baseRevisionId: string;
  baseContentSha256: string;
  stableFeatureIds: readonly string[];
}

function sha256(value: unknown): string {
  return createHash('sha256')
    .update(canonicalCadConsumerDraftJson(value as never), 'utf8')
    .digest('hex');
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length
    && actual.every(key => typeof key === 'string' && keys.includes(key));
}

function validStableFeature(value: unknown): value is MechanicalStableReferenceBinding['stableFeatures'][number] {
  return exactRecord(value, FEATURE_KEYS)
    && typeof value.featureId === 'string' && SAFE_ID.test(value.featureId)
    && typeof value.featureSha256 === 'string' && SHA256.test(value.featureSha256);
}

function hold(
  code: Extract<MechanicalStableReferenceBindingResult, { ok: false }>['code'],
  ...blockers: string[]
): MechanicalStableReferenceBindingResult {
  return { ok: false, status: 'HOLD', code, blockers: [...new Set(blockers)] };
}

function bindingMaterial(
  value: Omit<MechanicalStableReferenceBinding, 'bindingSha256'> | MechanicalStableReferenceBinding,
): Omit<MechanicalStableReferenceBinding, 'bindingSha256'> {
  const { bindingSha256: _bindingSha256, ...material } = value as MechanicalStableReferenceBinding;
  void _bindingSha256;
  return material;
}

/**
 * Rebinds untrusted intent references to exactly one server-owned current head.
 * It accepts no document ID, sequence, runtime identity, or exact artifact from
 * the caller. Exact execution remains a separate step after this receipt.
 */
export async function resolveMechanicalStableReferences(
  db: DbAdapter,
  input: ResolveMechanicalStableReferenceInput,
): Promise<MechanicalStableReferenceBindingResult> {
  const uniqueFeatureIds = [...new Set(input.stableFeatureIds)].sort();
  if (!SAFE_ID.test(input.projectId) || !SAFE_ID.test(input.baseRevisionId)
    || !SHA256.test(input.baseContentSha256)
    || input.stableFeatureIds.length === 0
    || input.stableFeatureIds.length > MAX_FEATURE_REFERENCES
    || uniqueFeatureIds.length !== input.stableFeatureIds.length
    || uniqueFeatureIds.some(featureId => !SAFE_ID.test(featureId))) {
    return hold('INVALID_REQUEST', 'stable_reference_request_invalid');
  }

  try {
    await assertCanonicalCadRevisionMigration(db);
  } catch {
    return hold('MIGRATION_REQUIRED', 'canonical_cad_revision_migration_required');
  }

  let candidates: HeadCandidateRow[];
  try {
    candidates = await db.queryAll<HeadCandidateRow>(
      `SELECT project_id, document_id, revision_id, sequence, content_hash
       FROM nf_cad_canonical_v2_heads
       WHERE project_id = ? AND revision_id = ? AND content_hash = ?
       ORDER BY document_id
       LIMIT 2`,
      input.projectId,
      input.baseRevisionId,
      input.baseContentSha256,
    );
  } catch {
    return hold('SERVER_READ_FAILED', 'canonical_head_candidate_read_failed');
  }

  if (candidates.length === 0) return hold('CURRENT_HEAD_NOT_FOUND', 'stable_base_revision_not_current');
  if (candidates.length !== 1) return hold('CURRENT_HEAD_AMBIGUOUS', 'stable_base_revision_matches_multiple_documents');
  const candidate = candidates[0]!;
  if (candidate.project_id !== input.projectId || candidate.revision_id !== input.baseRevisionId
    || candidate.content_hash !== input.baseContentSha256 || !SAFE_ID.test(candidate.document_id)
    || !Number.isSafeInteger(Number(candidate.sequence)) || Number(candidate.sequence) < 0) {
    return hold('CURRENT_HEAD_INVALID', 'canonical_head_candidate_invalid');
  }

  const current = await readMechanicalCurrentHead(db, input.projectId, candidate.document_id);
  if (!current.ok) {
    const stale = current.code === 'NOT_FOUND';
    return hold(stale ? 'CURRENT_HEAD_STALE' : 'CURRENT_HEAD_INVALID', ...current.issues);
  }
  const revision = current.bound.revision;
  if (revision.revisionId !== input.baseRevisionId
    || revision.contentSha256 !== input.baseContentSha256
    || revision.sequence !== Number(candidate.sequence)) {
    return hold('CURRENT_HEAD_STALE', 'canonical_head_changed_during_rebind');
  }

  const nodes = new Map(current.bound.tree.nodes.map(node => [node.id, node]));
  const missing = uniqueFeatureIds.filter(featureId => !nodes.has(featureId));
  if (missing.length) {
    return hold('STABLE_FEATURE_REFERENCE_MISSING', ...missing.map(featureId => `feature_not_found:${featureId}`));
  }
  const stableFeatures = uniqueFeatureIds.map(featureId => ({
    featureId,
    featureSha256: sha256(nodes.get(featureId)),
  }));
  const material = {
    schema: MECHANICAL_STABLE_REFERENCE_BINDING_SCHEMA,
    authority: 'SERVER_CURRENT_CANONICAL_HEAD' as const,
    projectId: current.bound.projectId,
    documentId: current.bound.documentId,
    revision: current.bound.revision,
    partId: current.bound.partId,
    featureTreeSha256: current.bound.treeSha256,
    rightsReceiptRevision: current.bound.rightsReceiptRevision,
    rightsReceiptSha256: current.bound.rightsReceiptSha256,
    stableFeatures,
    exactExecution: 'NOT_RUN' as const,
    release: 'HOLD' as const,
    manufacturingReleaseReady: false as const,
  };
  return {
    ok: true,
    status: 'STABLE_REFERENCES_BOUND',
    binding: { ...material, bindingSha256: sha256(material) },
  };
}

export function validateMechanicalStableReferenceBinding(value: unknown): string[] {
  if (!exactRecord(value, BINDING_KEYS)) return ['stable_reference_binding_schema_invalid'];
  const binding = value as unknown as MechanicalStableReferenceBinding;
  const issues: string[] = [];
  if (binding.schema !== MECHANICAL_STABLE_REFERENCE_BINDING_SCHEMA
    || binding.authority !== 'SERVER_CURRENT_CANONICAL_HEAD'
    || !SAFE_ID.test(binding.projectId ?? '') || !SAFE_ID.test(binding.documentId ?? '')
    || !SAFE_ID.test(binding.partId ?? '') || !SAFE_ID.test(binding.rightsReceiptRevision ?? '')) {
    issues.push('stable_reference_binding_identity_invalid');
  }
  if (!exactRecord(binding.revision, REVISION_KEYS) || !SAFE_ID.test(binding.revision.revisionId ?? '')
    || !Number.isSafeInteger(binding.revision.sequence) || binding.revision.sequence < 0
    || !SHA256.test(binding.revision.contentSha256 ?? '')) issues.push('stable_reference_binding_revision_invalid');
  if (!SHA256.test(binding.featureTreeSha256 ?? '') || !SHA256.test(binding.rightsReceiptSha256 ?? '')
    || !SHA256.test(binding.bindingSha256 ?? '')) issues.push('stable_reference_binding_hash_invalid');
  if (!Array.isArray(binding.stableFeatures) || binding.stableFeatures.length === 0
    || binding.stableFeatures.length > MAX_FEATURE_REFERENCES
    || new Set(binding.stableFeatures.map(item => item.featureId)).size !== binding.stableFeatures.length
    || binding.stableFeatures.some(item => !validStableFeature(item))
    || binding.stableFeatures.some((item, index) => index > 0
      && binding.stableFeatures[index - 1]!.featureId.localeCompare(item.featureId) >= 0)) {
    issues.push('stable_reference_binding_features_invalid');
  }
  if (binding.exactExecution !== 'NOT_RUN' || binding.release !== 'HOLD'
    || binding.manufacturingReleaseReady !== false) issues.push('stable_reference_binding_authority_invalid');
  if (issues.length === 0 && binding.bindingSha256 !== sha256(bindingMaterial(binding))) {
    issues.push('stable_reference_binding_digest_mismatch');
  }
  return [...new Set(issues)];
}
