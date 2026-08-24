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
} from '@/lib/cad/canonicalCadV2ConsumerDraft';
import { CANONICAL_CAD_REVISION_MIGRATION_VERSION } from '@/lib/cad/canonicalCadRevisionStore';
import { readMechanicalCurrentHead } from '@/lib/cad/mechanicalCurrentHeadReader';
import {
  MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND,
  MECHANICAL_SINGLE_PART_FEATURE_TREE_SCHEMA,
  RIGHTS_PROVENANCE_RECEIPT_SCHEMA,
} from '@/lib/cad/mechanicalSinglePartFeatureTreeExtractor';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  buildCurrentCanonicalMechanicalArtifactBundle,
  CURRENT_CANONICAL_MECHANICAL_BUNDLE_SCHEMA,
  validateCurrentCanonicalMechanicalArtifactBundle,
} from './currentCanonicalMechanicalBundle';

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
    payload: {
      kind: 'hole', childId: 'base', center: { x: 15, y: 10 },
      holeType: 'drilled', diameter: 4, depth: 6,
    },
  },
] };

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalCadConsumerDraftJson(value as never), 'utf8').digest('hex');
}

function mechanicalDocument(
  rightsBindingSha256 = hex('a'),
  rightsPayloadSha256 = rightsBindingSha256,
): CanonicalCadDocumentV2ConsumerDraft {
  const payload = {
    schema: MECHANICAL_SINGLE_PART_FEATURE_TREE_SCHEMA,
    partId: 'part-1',
    name: 'Rights-cleared test plate',
    tree,
    treeSha256: sha256(tree),
    rightsReceiptSha256: rightsPayloadSha256,
  };
  const part = sealCanonicalCadObjectV2({
    objectId: 'mechanical:part-1', namespace: 'mechanical',
    objectKind: MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND,
    objectRevision: 0, payload: payload as unknown as CanonicalCadJsonObject, transform: null,
  });
  return createCanonicalCadDocumentV2({
    projectId: 'project-1', documentId: 'document-1', domains: ['mechanical'],
    revision: { revisionId: 'revision-7', sequence: 7, contentSha256: hex('0') },
    units: { length: 'mm', angle: 'deg' },
    coordinateFrame: {
      frameId: 'world', parentFrameId: null,
      origin: [0, 0, 0], rotationDeg: [0, 0, 0],
    },
    tolerancePolicy: { linear: 0.01, angularDeg: 0.1 },
    objects: [part], relationships: [],
    sourceBindings: [{
      schema: RIGHTS_PROVENANCE_RECEIPT_SCHEMA,
      revision: 'rights-review-1', contentSha256: rightsBindingSha256,
    }],
  });
}

class CurrentHeadDb implements DbAdapter {
  readonly backend = 'sqlite' as const;
  readonly document: CanonicalCadDocumentV2ConsumerDraft;
  headMissing = false;
  corruptHeadHash = false;

  constructor(document = mechanicalDocument()) { this.document = document; }

  async queryOne<T>(sql: string): Promise<T | undefined> {
    if (sql.includes('nf_schema_migrations')) {
      return { version: CANONICAL_CAD_REVISION_MIGRATION_VERSION, checksum: hex('f') } as T;
    }
    if (sql.includes('LIMIT 1')) return undefined;
    if (sql.includes('FROM nf_cad_canonical_v2_heads')) {
      if (this.headMissing) return undefined;
      return {
        project_id: this.document.projectId,
        document_id: this.document.documentId,
        revision_id: this.document.revision.revisionId,
        sequence: this.document.revision.sequence,
        content_hash: this.corruptHeadHash ? hex('b') : this.document.revision.contentSha256,
      } as T;
    }
    if (sql.includes('FROM nf_cad_canonical_v2_revisions')) {
      if (this.corruptHeadHash) return undefined;
      return {
        id: 'revision-row-7', project_id: this.document.projectId,
        document_id: this.document.documentId,
        revision_id: this.document.revision.revisionId,
        sequence: this.document.revision.sequence,
        content_hash: this.document.revision.contentSha256,
        parent_revision_id: null, parent_sequence: null, parent_content_hash: null,
        document_json: canonicalCadConsumerDraftJson(this.document),
        command_id: null, command_sha256: null, idempotency_key: null,
        command_json: null, compensation_for_command_id: null,
        receipt_json: null, receipt_sha256: null, created_by: 'fixture', created_at: 0,
      } as T;
    }
    return undefined;
  }
  async queryAll<T>(): Promise<T[]> { return []; }
  async execute(): Promise<{ changes: number }> { throw new Error('read_only_fixture'); }
  async executeRaw(): Promise<void> { throw new Error('read_only_fixture'); }
  async transaction<T>(_fn: (db: DbAdapter) => Promise<T>): Promise<T> { throw new Error('read_only_fixture'); }
  async close(): Promise<void> {}
}

describe('current canonical mechanical artifact bundle', () => {
  it('loads the server current head and binds rights, STEP, drawing, dimensions, and BOM to one revision', async () => {
    const db = new CurrentHeadDb();
    const result = await buildCurrentCanonicalMechanicalArtifactBundle({
      db, projectId: 'project-1', documentId: 'document-1',
      now: new Date('2026-08-24T04:00:00.000Z'),
    });
    expect(result.status, result.status === 'HOLD' ? result.blockers.join(',') : '').toBe('EXACT_BUNDLE_PASS');
    if (result.status !== 'EXACT_BUNDLE_PASS') return;
    expect(result).toMatchObject({
      schema: CURRENT_CANONICAL_MECHANICAL_BUNDLE_SCHEMA,
      authority: 'SERVER_CURRENT_CANONICAL_HEAD',
      verification: 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR',
      release: 'HOLD', manufacturingRelease: 'BLOCKED',
      source: {
        projectId: 'project-1', documentId: 'document-1', partId: 'part-1',
        revision: db.document.revision,
        rightsReceiptRevision: 'rights-review-1', rightsReceiptSha256: hex('a'),
      },
    });
    const exact = result.handoff.exactSinglePart!;
    const dimensions = JSON.parse(exact.dimensions.receiptJson) as Record<string, unknown>;
    const bom = JSON.parse(exact.bom.receiptJson) as Record<string, unknown>;
    expect(dimensions.canonicalRevision).toEqual(result.handoff.source.canonicalRevision);
    expect(bom.canonicalRevision).toEqual(result.handoff.source.canonicalRevision);
    expect(result.artifacts).toMatchObject({
      stepSha256: exact.step.sha256,
      drawingSha256: exact.drawing.sha256,
      dimensionsSha256: exact.dimensions.sha256,
      bomSha256: exact.bom.sha256,
    });
    expect(result.artifactManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await validateCurrentCanonicalMechanicalArtifactBundle(result)).toEqual({ ok: true, bundle: result });
    const tamperedArtifact = structuredClone(result);
    tamperedArtifact.artifacts.stepSha256 = hex('c');
    expect(await validateCurrentCanonicalMechanicalArtifactBundle(tamperedArtifact)).toMatchObject({
      ok: false, reason: 'CURRENT_CANONICAL_MECHANICAL_BUNDLE_BINDING_INVALID',
    });
    const hidden = structuredClone(result);
    Object.defineProperty(hidden.source, 'hidden', { value: true, enumerable: false });
    expect(await validateCurrentCanonicalMechanicalArtifactBundle(hidden)).toMatchObject({
      ok: false, reason: 'CURRENT_CANONICAL_MECHANICAL_BUNDLE_SCHEMA_INVALID',
    });
  }, 60_000);

  it('fails closed for missing/corrupt current heads and rights mismatch', async () => {
    const missing = new CurrentHeadDb();
    missing.headMissing = true;
    expect(await readMechanicalCurrentHead(missing, 'project-1', 'document-1')).toMatchObject({
      ok: false, code: 'NOT_FOUND', release: 'HOLD',
    });
    const corrupt = new CurrentHeadDb();
    corrupt.corruptHeadHash = true;
    expect(await buildCurrentCanonicalMechanicalArtifactBundle({
      db: corrupt, projectId: 'project-1', documentId: 'document-1',
    })).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining(['CURRENT_HEAD_CORRUPT_SERVER_STATE']) });
    const rightsMismatch = new CurrentHeadDb(mechanicalDocument(hex('b'), hex('a')));
    expect(await buildCurrentCanonicalMechanicalArtifactBundle({
      db: rightsMismatch, projectId: 'project-1', documentId: 'document-1',
    })).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining(['RIGHTS_PROVENANCE_MISMATCH']) });
    expect(await readMechanicalCurrentHead(rightsMismatch, '../project', 'document-1')).toMatchObject({
      ok: false, code: 'INVALID_REQUEST', release: 'HOLD',
    });
  });
});
