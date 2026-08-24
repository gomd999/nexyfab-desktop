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
import type { FeatureTree } from '@/lib/cad/featureTree';
import { readMechanicalCurrentHeadV2 } from '@/lib/cad/mechanicalCurrentHeadV2Reader';
import {
  EDGE_REFS_ONLY_SENTINEL,
  MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND,
  MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA,
  RIGHTS_PROVENANCE_RECEIPT_SCHEMA,
} from '@/lib/cad/mechanicalSinglePartFeatureTreeV2Extractor';
import {
  buildCurrentCanonicalMechanicalArtifactBundleV2,
  CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA,
  validateCurrentCanonicalMechanicalArtifactBundleV2,
} from './currentCanonicalMechanicalBundleV2';

const hex = (character: string) => character.repeat(64);
const sha256 = (value: unknown): string => createHash('sha256')
  .update(canonicalCadConsumerDraftJson(value as never), 'utf8')
  .digest('hex');

const base = {
  kind: 'extrude' as const,
  loop: [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 20 },
    { x: 0, y: 20 },
  ],
  depth: 10,
  direction: 'one_sided' as const,
  mode: 'add' as const,
};

function featureTree(kind: 'fillet' | 'chamfer' = 'fillet'): FeatureTree {
  const treatment = kind === 'fillet'
    ? {
        kind,
        childId: 'base',
        childExtrude: base,
        radius: 1,
        edgeSelection: EDGE_REFS_ONLY_SENTINEL,
        edgeRefs: ['e.vert.0', 'e.vert.1'],
      }
    : {
        kind,
        childId: 'base',
        childExtrude: base,
        distance: 1,
        edgeSelection: EDGE_REFS_ONLY_SENTINEL,
        edgeRefs: ['e.vert.0', 'e.vert.1'],
      };
  return {
    nodes: [
      { id: 'base', name: 'Base', dependencies: [], payload: base },
      { id: 'treatment', name: 'Treatment', dependencies: ['base'], payload: treatment },
      {
        id: 'hole',
        name: 'Hole',
        dependencies: ['treatment'],
        payload: {
          kind: 'hole',
          childId: 'treatment',
          center: { x: 15, y: 10 },
          holeType: 'drilled',
          diameter: 4,
          depth: 6,
        },
      },
    ],
  };
}

function mechanicalDocument(kind: 'fillet' | 'chamfer' = 'fillet'):
CanonicalCadDocumentV2ConsumerDraft {
  const tree = featureTree(kind);
  const rights = hex('b');
  const object = sealCanonicalCadObjectV2({
    objectId: 'mechanical:part-1',
    namespace: 'mechanical',
    objectKind: MECHANICAL_SINGLE_PART_FEATURE_TREE_OBJECT_KIND,
    objectRevision: 0,
    payload: {
      schema: MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA,
      partId: 'part-1',
      name: `V2 ${kind} plate`,
      tree,
      treeSha256: sha256(tree),
      rightsReceiptSha256: rights,
    } as unknown as CanonicalCadJsonObject,
    transform: null,
  });
  return createCanonicalCadDocumentV2({
    projectId: 'project-1',
    documentId: 'document-1',
    domains: ['mechanical'],
    revision: { revisionId: 'revision-8', sequence: 8, contentSha256: hex('0') },
    units: { length: 'mm', angle: 'deg' },
    coordinateFrame: {
      frameId: 'world', parentFrameId: null,
      origin: [0, 0, 0], rotationDeg: [0, 0, 0],
    },
    tolerancePolicy: { linear: 0.01, angularDeg: 0.1 },
    objects: [object],
    relationships: [],
    sourceBindings: [{
      schema: RIGHTS_PROVENANCE_RECEIPT_SCHEMA,
      revision: 'rights-8',
      contentSha256: rights,
    }],
  });
}

class CurrentHeadV2Db implements DbAdapter {
  readonly backend = 'sqlite' as const;
  headMissing = false;

  constructor(readonly document = mechanicalDocument()) {}

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
        content_hash: this.document.revision.contentSha256,
      } as T;
    }
    if (sql.includes('FROM nf_cad_canonical_v2_revisions')) {
      return {
        id: 'revision-row-8',
        project_id: this.document.projectId,
        document_id: this.document.documentId,
        revision_id: this.document.revision.revisionId,
        sequence: this.document.revision.sequence,
        content_hash: this.document.revision.contentSha256,
        parent_revision_id: null,
        parent_sequence: null,
        parent_content_hash: null,
        document_json: canonicalCadConsumerDraftJson(this.document),
        command_id: null,
        command_sha256: null,
        idempotency_key: null,
        command_json: null,
        compensation_for_command_id: null,
        receipt_json: null,
        receipt_sha256: null,
        created_by: 'fixture',
        created_at: 0,
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

describe('current canonical mechanical artifact bundle v2', () => {
  it('binds one current revision through stable-edge treatment, hole, STEP, HLR, dimensions, and BOM', async () => {
    const db = new CurrentHeadV2Db();
    const result = await buildCurrentCanonicalMechanicalArtifactBundleV2({
      db,
      projectId: 'project-1',
      documentId: 'document-1',
      now: new Date('2026-08-24T08:00:00.000Z'),
    });
    expect(result.status, result.status === 'HOLD' ? result.blockers.join(',') : '').toBe('EXACT_BUNDLE_V2_PASS');
    if (result.status !== 'EXACT_BUNDLE_V2_PASS') return;

    expect(result).toMatchObject({
      schema: CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA,
      authority: 'SERVER_CURRENT_CANONICAL_HEAD',
      verification: 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR',
      release: 'HOLD',
      manufacturingRelease: 'BLOCKED',
      source: {
        revision: db.document.revision,
        featureTreeSchema: MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA,
        treatmentKind: 'fillet',
        rightsReceiptRevision: 'rights-8',
      },
    });
    expect(result.handoff.exactSinglePart).toMatchObject({
      verification: { valid: true, solidCount: 1, freeBoundaryEdgeCount: 0, nonManifoldEdgeCount: 0 },
      claimBoundary: { manufacturingRelease: 'BLOCKED', gdt: 'NOT_RUN', pmi: 'NOT_RUN' },
    });
    expect(await validateCurrentCanonicalMechanicalArtifactBundleV2(result)).toEqual({ ok: true, bundle: result });

    const treeTamper = structuredClone(result);
    treeTamper.handoff.assembly.featureTrees['part-1']!.nodes[2]!.name = 'Tampered';
    expect(await validateCurrentCanonicalMechanicalArtifactBundleV2(treeTamper)).toMatchObject({ ok: false });

    const edgeAuthorityTamper = structuredClone(result);
    edgeAuthorityTamper.source.stableEdgeRefsSha256 = hex('c');
    expect(await validateCurrentCanonicalMechanicalArtifactBundleV2(edgeAuthorityTamper)).toMatchObject({
      ok: false,
      reason: 'CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_HASH_MISMATCH',
    });
  }, 60_000);

  it('accepts the version-isolated chamfer current head but rejects missing heads and v1-shaped data', async () => {
    const chamfer = await readMechanicalCurrentHeadV2(
      new CurrentHeadV2Db(mechanicalDocument('chamfer')),
      'project-1',
      'document-1',
    );
    expect(chamfer).toMatchObject({
      ok: true,
      verification: 'STRUCTURAL_ONLY',
      release: 'HOLD',
      bound: { treatmentKind: 'chamfer' },
    });

    const missing = new CurrentHeadV2Db();
    missing.headMissing = true;
    expect(await readMechanicalCurrentHeadV2(missing, 'project-1', 'document-1')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
      release: 'HOLD',
    });
    expect(await readMechanicalCurrentHeadV2(missing, '../project', 'document-1')).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      release: 'HOLD',
    });
  });
});
