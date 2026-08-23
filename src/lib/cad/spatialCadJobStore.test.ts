import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import { createDesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from '@/lib/ai/designArtifactGraph';
import type { ExactClashJobRequest } from './coordinationSpatialModel';
import { hashCadWorkspaceEnvelope, hashCadPayload, type CadWorkspaceEnvelopeInput } from './workspaceRevisionStore';
import {
  hashExactClashExecutionReceipt,
  exactClashRetryAt,
  validateExactClashExecutionReceipt,
  validateExactClashJobRequest,
  verifyExactClashArtifactBindings,
  type ExactClashExecutionReceipt,
  type StoredSpatialCadJob,
} from './spatialCadJobStore';

const exact: ExactClashJobRequest = { schema: 'nexyfab.exact-clash-job-request.v1', coordinateSystem: 'EPSG:5186', toleranceMm: 50, documentRevision: 2, models: [1, 2].map(index => ({ id: `m${index}`, artifactId: `a${index}`, contentHash: String(index).repeat(64), shapeIdentityHash: String(index + 2).repeat(64), offsetMm: [0, 0, 0] })) };

function envelope(projectId: string, geometryHash: string, shapeIdentityHash: string): CadWorkspaceEnvelopeInput {
  const requirements = { objective: 'coordination' };
  const semantic = { schema: 'nexyfab.product-decomposition.v1' };
  const relations = { models: [] };
  const semanticHash = hashCadPayload(semantic);
  return {
    schema: 'nexyfab.cad-workspace-envelope.v1',
    workspace: createDesignWorkspaceRevision({ projectId, lineageId: 'lineage-1', domain: 'mechanical', documentHash: semanticHash }),
    requirements: { payload: requirements, contentHash: hashCadPayload(requirements) },
    semanticDocument: { schema: 'nexyfab.product-decomposition.v1', payload: semantic, contentHash: semanticHash },
    geometry: { fidelity: 'exact_brep', contentHash: geometryHash, shapeIdentityHash },
    objectRelations: { payload: relations, contentHash: hashCadPayload(relations) },
    artifactGraph: { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId, revision: 0, artifacts: [{ id: 'model', kind: 'model', revision: 0, contentHash: geometryHash, state: 'current', inputs: [], verification: { status: 'passed', verifierId: 'exact-kernel', evidenceHash: '9'.repeat(64), issues: [] }, staleBecause: [] }], dependencies: [] },
    provenance: [{ sourceId: 'import-1', kind: 'import', contentHash: '8'.repeat(64) }],
    kernelIdentity: { mode: 'wasm', kernelId: 'occt', buildSha256: '6'.repeat(64), wasmSha256: '7'.repeat(64), stubFallback: false },
  };
}

function dbWith(rows: Array<{ id: string; payload_json: string }>): DbAdapter {
  return { queryAll: vi.fn().mockResolvedValue(rows) } as unknown as DbAdapter;
}

function queuedJob(): StoredSpatialCadJob {
  return { id: 'SCJ-1', projectId: 'project-1', kind: 'EXACT_CLASH', status: 'RUNNING', execution: 'RUNNING', releaseVerification: 'NOT_RUN', request: exact, requestSha256: hashCadPayload(exact), createdBy: 'user-1', createdAt: 1000, attempts: 1, leasedBy: 'worker-1', leaseExpiresAt: 100_000, startedAt: 1100, updatedAt: 1100 };
}

function receipt(): ExactClashExecutionReceipt {
  const core: Omit<ExactClashExecutionReceipt, 'receiptSha256'> = {
    schema: 'nexyfab.exact-clash-execution-receipt.v1', jobId: 'SCJ-1', requestSha256: hashCadPayload(exact),
    workerIdentitySha256: 'a'.repeat(64), kernelIdentitySha256: 'b'.repeat(64), engine: 'OCCT',
    algorithm: 'exact_brep_common_and_distance', stubFallback: false, checkedPairs: 1,
    clashes: [{ id: 'm1:m2', modelA: 'm1', modelB: 'm2', classification: 'HARD', commonVolumeMm3: 125, minimumDistanceMm: 0 }],
    completedAt: 2000,
  };
  return { ...core, receiptSha256: hashExactClashExecutionReceipt(core) };
}

describe('exact clash job contract', () => {
  it('fails closed for retry-time overflow and attempt-cap scheduling', () => {
    expect(exactClashRetryAt(Number.MAX_SAFE_INTEGER - 10_000, 1)).toBeNull();
    expect(exactClashRetryAt(1_000, 5)).toBeNull();
  });

  it('accepts only hash-bound exact model requests', () => expect(validateExactClashJobRequest(exact)).toEqual([]));
  it('blocks missing coordinates and unbound exact identities', () => expect(validateExactClashJobRequest({ ...exact, coordinateSystem: 'CRS_NOT_CONNECTED', models: [{ ...exact.models[0], contentHash: '' }, exact.models[1]] })).toEqual(expect.arrayContaining(['coordinate_system_not_connected', 'exact_content_hash_required:m1'])));
  it('blocks one exact revision being assigned to two coordination models', () => expect(validateExactClashJobRequest({ ...exact, models: [exact.models[0]!, { ...exact.models[1]!, artifactId: exact.models[0]!.artifactId }] })).toContain('duplicate_exact_artifact:m2'));
  it('accepts only hashes read back from project-owned CAD revisions', async () => {
    const rows = exact.models.map(model => {
      const input = envelope('project-1', model.contentHash, model.shapeIdentityHash);
      return { id: model.artifactId, payload_json: JSON.stringify({ ...input, contentHash: hashCadWorkspaceEnvelope(input) }) };
    });
    await expect(verifyExactClashArtifactBindings(dbWith(rows), 'project-1', exact)).resolves.toEqual([]);
  });
  it('blocks foreign, missing, tampered and hash-mismatched artifacts', async () => {
    const first = envelope('project-1', exact.models[0]!.contentHash, exact.models[0]!.shapeIdentityHash);
    const tampered = { ...first, geometry: { ...first.geometry, contentHash: 'f'.repeat(64) } };
    await expect(verifyExactClashArtifactBindings(dbWith([
      { id: exact.models[0]!.artifactId, payload_json: JSON.stringify({ ...tampered, contentHash: hashCadWorkspaceEnvelope(first) }) },
    ]), 'project-1', exact)).resolves.toEqual(expect.arrayContaining([
      'project_exact_artifact_invalid_envelope:m1',
      'project_exact_artifact_not_found:m2',
    ]));
  });
  it('accepts a full-pair OCCT receipt while keeping release outside this receipt', () => expect(validateExactClashExecutionReceipt(queuedJob(), receipt(), 3000)).toEqual([]));
  it('rejects partial, stub or tampered exact execution receipts', () => {
    const value = receipt();
    const invalid = { ...value, checkedPairs: 0, stubFallback: true as false, receiptSha256: 'f'.repeat(64) };
    expect(validateExactClashExecutionReceipt(queuedJob(), invalid, 3000)).toEqual(expect.arrayContaining([
      'invalid_exact_clash_engine', 'exact_clash_incomplete_pair_coverage', 'exact_clash_receipt_hash_mismatch',
    ]));
  });
});
