// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  canonicalCadConsumerDraftJson,
  createCanonicalCadDocumentV2,
  sealCanonicalCadObjectV2,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadJsonObject,
} from './canonicalCadV2ConsumerDraft';
import { CANONICAL_CAD_REVISION_MIGRATION_VERSION } from './canonicalCadRevisionStore';
import {
  MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND,
  MECHANICAL_SINGLE_PART_FEATURE_TREE_SCHEMA,
  RIGHTS_PROVENANCE_RECEIPT_SCHEMA,
} from './mechanicalSinglePartFeatureTreeExtractor';
import type { FeatureTree } from './featureTree';
import {
  resolveMechanicalStableReferences,
  validateMechanicalStableReferenceBinding,
} from './mechanicalStableReferenceBinding';

const hex = (character: string) => character.repeat(64);
const tree: FeatureTree = { nodes: [
  {
    id: 'base', name: 'Base', dependencies: [],
    payload: {
      kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }],
      depth: 10, direction: 'one_sided', mode: 'add',
    },
  },
  {
    id: 'hole', name: 'Hole', dependencies: ['base'],
    payload: { kind: 'hole', childId: 'base', center: { x: 15, y: 10 }, holeType: 'drilled', diameter: 4, depth: 6 },
  },
] };

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalCadConsumerDraftJson(value as never), 'utf8').digest('hex');
}

function document(documentId = 'document-1'): CanonicalCadDocumentV2ConsumerDraft {
  const payload = {
    schema: MECHANICAL_SINGLE_PART_FEATURE_TREE_SCHEMA,
    partId: 'part-1', name: 'Rights-cleared test plate', tree,
    treeSha256: sha256(tree), rightsReceiptSha256: hex('a'),
  };
  const part = sealCanonicalCadObjectV2({
    objectId: 'mechanical:part-1', namespace: 'mechanical',
    objectKind: MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND,
    objectRevision: 0, payload: payload as unknown as CanonicalCadJsonObject, transform: null,
  });
  return createCanonicalCadDocumentV2({
    projectId: 'project-1', documentId, domains: ['mechanical'],
    revision: { revisionId: 'revision-7', sequence: 7, contentSha256: hex('0') },
    units: { length: 'mm', angle: 'deg' },
    coordinateFrame: { frameId: 'world', parentFrameId: null, origin: [0, 0, 0], rotationDeg: [0, 0, 0] },
    tolerancePolicy: { linear: 0.01, angularDeg: 0.1 },
    objects: [part], relationships: [],
    sourceBindings: [{ schema: RIGHTS_PROVENANCE_RECEIPT_SCHEMA, revision: 'rights-review-1', contentSha256: hex('a') }],
  });
}

class BindingDb implements DbAdapter {
  readonly backend = 'postgres' as const;
  documents = [document()];
  ambiguousCandidates = false;
  staleAfterLookup = false;
  migrationPresent = true;

  async queryOne<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    if (sql.includes('nf_schema_migrations')) {
      return (this.migrationPresent ? { version: CANONICAL_CAD_REVISION_MIGRATION_VERSION, checksum: hex('f') } : undefined) as T | undefined;
    }
    if (sql.includes('LIMIT 1')) return undefined;
    if (sql.includes('FROM nf_cad_canonical_v2_heads')) {
      const value = this.documents.find(item => item.projectId === params[0] && item.documentId === params[1]);
      if (!value) return undefined;
      return {
        project_id: value.projectId, document_id: value.documentId,
        revision_id: value.revision.revisionId,
        sequence: value.revision.sequence + (this.staleAfterLookup ? 1 : 0),
        content_hash: value.revision.contentSha256,
      } as T;
    }
    if (sql.includes('FROM nf_cad_canonical_v2_revisions')) {
      const value = this.documents.find(item => item.projectId === params[0] && item.documentId === params[1]);
      if (!value || this.staleAfterLookup) return undefined;
      return {
        id: `row:${value.documentId}`, project_id: value.projectId, document_id: value.documentId,
        revision_id: value.revision.revisionId, sequence: value.revision.sequence,
        content_hash: value.revision.contentSha256, parent_revision_id: null,
        parent_sequence: null, parent_content_hash: null,
        document_json: canonicalCadConsumerDraftJson(value), command_id: null,
        command_sha256: null, idempotency_key: null, command_json: null,
        compensation_for_command_id: null, receipt_json: null, receipt_sha256: null,
        created_by: 'fixture', created_at: 0,
      } as T;
    }
    return undefined;
  }

  async queryAll<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    if (!sql.includes('FROM nf_cad_canonical_v2_heads')) return [];
    const matches = this.documents
      .filter(item => item.projectId === params[0]
        && item.revision.revisionId === params[1]
        && item.revision.contentSha256 === params[2])
      .slice(0, 2)
      .map(item => ({
        project_id: item.projectId, document_id: item.documentId,
        revision_id: item.revision.revisionId, sequence: item.revision.sequence,
        content_hash: item.revision.contentSha256,
      }));
    if (this.ambiguousCandidates && matches[0]) {
      matches.push({ ...matches[0], document_id: 'document-conflict' });
    }
    return matches as T[];
  }

  async execute(): Promise<{ changes: number }> { throw new Error('read_only'); }
  async executeRaw(): Promise<void> { throw new Error('read_only'); }
  async transaction<T>(): Promise<T> { throw new Error('read_only'); }
  async close(): Promise<void> {}
}

function input(source = document()) {
  return {
    projectId: source.projectId,
    baseRevisionId: source.revision.revisionId,
    baseContentSha256: source.revision.contentSha256,
    stableFeatureIds: ['hole', 'base'],
  };
}

describe('mechanical stable reference binding', () => {
  it('rebinds revision/hash/features to exactly one server current head', async () => {
    const db = new BindingDb();
    const result = await resolveMechanicalStableReferences(db, input(db.documents[0]));
    expect(result).toMatchObject({
      ok: true, status: 'STABLE_REFERENCES_BOUND',
      binding: {
        authority: 'SERVER_CURRENT_CANONICAL_HEAD', documentId: 'document-1',
        revision: db.documents[0]!.revision, exactExecution: 'NOT_RUN',
        release: 'HOLD', manufacturingReleaseReady: false,
        stableFeatures: [{ featureId: 'base' }, { featureId: 'hole' }],
      },
    });
    if (result.ok) {
      expect(result.binding.bindingSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(validateMechanicalStableReferenceBinding(result.binding)).toEqual([]);
      expect(validateMechanicalStableReferenceBinding({ ...result.binding, documentId: 'changed' }))
        .toContain('stable_reference_binding_digest_mismatch');
      expect(validateMechanicalStableReferenceBinding({ ...result.binding, exactPass: true }))
        .toEqual(['stable_reference_binding_schema_invalid']);
      expect(validateMechanicalStableReferenceBinding({
        ...result.binding,
        stableFeatures: [...result.binding.stableFeatures].reverse(),
      })).toContain('stable_reference_binding_features_invalid');
    }
  });

  it('holds ambiguous, stale, unknown, and unmigrated inputs without selecting a document', async () => {
    const ambiguous = new BindingDb();
    ambiguous.ambiguousCandidates = true;
    await expect(resolveMechanicalStableReferences(ambiguous, input(ambiguous.documents[0])))
      .resolves.toMatchObject({ ok: false, code: 'CURRENT_HEAD_AMBIGUOUS' });

    const stale = new BindingDb();
    stale.staleAfterLookup = true;
    await expect(resolveMechanicalStableReferences(stale, input(stale.documents[0])))
      .resolves.toMatchObject({ ok: false, code: 'CURRENT_HEAD_INVALID' });

    const missing = new BindingDb();
    await expect(resolveMechanicalStableReferences(missing, { ...input(missing.documents[0]), stableFeatureIds: ['unknown'] }))
      .resolves.toMatchObject({ ok: false, code: 'STABLE_FEATURE_REFERENCE_MISSING' });

    const unmigrated = new BindingDb();
    unmigrated.migrationPresent = false;
    await expect(resolveMechanicalStableReferences(unmigrated, input(unmigrated.documents[0])))
      .resolves.toMatchObject({ ok: false, code: 'MIGRATION_REQUIRED' });
  });
});
