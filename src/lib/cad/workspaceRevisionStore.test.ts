import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { commitDesignWorkspaceRevision, createDesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from '@/lib/ai/designArtifactGraph';
import { DESIGN_DOMAIN_IDS } from '@/lib/ai/domainProfile';
import { getDomainProfile } from '@/lib/ai/domainProfileRegistry';
import { getDomainFormatCapabilities } from '@/lib/ai/domainFormatSupport';
import {
  CAD_WORKSPACE_ENVELOPE_SCHEMA,
  diffCadWorkspacePaths,
  hashCadPayload,
  hashCadWorkspaceEnvelope,
  listCadWorkspaceRevisions,
  persistCadWorkspaceRevision,
  readAuthoritativeWorkspaceHead,
  compareAndSwapAuthoritativeWorkspaceHead,
  validateCadWorkspaceEnvelope,
  type CadWorkspaceEnvelopeInput,
} from './workspaceRevisionStore';

const hash = (char: string) => char.repeat(64);

describe('authoritative workspace head CAS', () => {
  it('requires exact old revision/hash and never falls back to DDL', async () => {
    let current = { revision: 4, content_hash: hash('a') };
    const db = { backend: 'postgres' as const, queryOne: async () => current, queryAll: async () => [], execute: async (_sql: string, ...params: unknown[]) => { if (params[3] === 'p' && params[4] === current.revision && params[5] === current.content_hash) { current = { revision: Number(params[0]), content_hash: String(params[1]) }; return { changes: 1 }; } return { changes: 0 }; }, executeRaw: async () => { throw new Error('DDL_FORBIDDEN'); }, transaction: async <T>(fn: (db: DbAdapter) => Promise<T>) => fn(db as unknown as DbAdapter), close: async () => {} };
    const adapter = db as unknown as DbAdapter;
    await expect(readAuthoritativeWorkspaceHead(adapter, 'p')).resolves.toMatchObject({ revision: 4, contentHash: hash('a') });
    await expect(compareAndSwapAuthoritativeWorkspaceHead(adapter, { projectId: 'p', expectedRevision: 4, expectedContentHash: hash('a'), nextRevision: 5, nextContentHash: hash('b'), at: 1 })).resolves.toBe(true);
    await expect(compareAndSwapAuthoritativeWorkspaceHead(adapter, { projectId: 'p', expectedRevision: 4, expectedContentHash: hash('a'), nextRevision: 6, nextContentHash: hash('c'), at: 1 })).resolves.toBe(false);
  });
});

function graph(): DesignArtifactGraph {
  return {
    schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision: 0,
    artifacts: [{
      id: 'model', kind: 'model', revision: 0, contentHash: hash('b'), state: 'current', inputs: [],
      verification: { status: 'passed', verifierId: 'exact-kernel', evidenceHash: hash('e'), issues: [] },
      staleBecause: [],
    }],
    dependencies: [],
  };
}

function envelope(): CadWorkspaceEnvelopeInput {
  const requirements = { loadN: 500 };
  const semanticDocument = { parts: ['shaft'] };
  const objectRelations: unknown[] = [];
  return {
    schema: CAD_WORKSPACE_ENVELOPE_SCHEMA,
    workspace: createDesignWorkspaceRevision({
      projectId: 'project-1', lineageId: 'lineage-1', domain: 'mechanical', documentHash: hashCadPayload(semanticDocument),
    }),
    requirements: { contentHash: hashCadPayload(requirements), payload: requirements },
    semanticDocument: { schema: 'nexyfab.product-decomposition.v1', contentHash: hashCadPayload(semanticDocument), payload: semanticDocument },
    geometry: { fidelity: 'exact_brep', contentHash: hash('b'), shapeIdentityHash: hash('d') },
    objectRelations: { contentHash: hashCadPayload(objectRelations), payload: objectRelations },
    artifactGraph: graph(),
    provenance: [{ sourceId: 'prompt-1', kind: 'user', contentHash: hash('9') }],
    kernelIdentity: {
      mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('7'), wasmSha256: hash('8'), stubFallback: false,
    },
  };
}

function memoryDb() {
  let head: { revision: number; content_hash: string; updated_at: number } | undefined;
  const revisions: Array<{ revision: number; content_hash: string; payload_json: string }> = [];
  let writes = 0;
  const db: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]): Promise<T | undefined> {
      if (sql.includes('nf_cad_workspace_heads')) return head as T | undefined;
      if (sql.includes('nf_cad_workspace_revisions')) {
        const requested = sql.includes('AND revision = ?') ? Number(params[1]) : undefined;
        const row = requested === undefined ? revisions.at(-1) : revisions.find(item => item.revision === requested);
        return row as T | undefined;
      }
      return undefined;
    },
    async queryAll<T>(): Promise<T[]> { return []; },
    async execute(sql: string, ...params: SqlParam[]) {
      writes += 1;
      if (sql.includes('INSERT INTO nf_cad_workspace_revisions')) {
        revisions.push({ revision: Number(params[3]), content_hash: String(params[6]), payload_json: String(params[7]) });
      } else if (sql.includes('INSERT INTO nf_cad_workspace_heads')) {
        head = { revision: Number(params[1]), content_hash: String(params[2]), updated_at: Number(params[3]) };
      } else if (sql.includes('UPDATE nf_cad_workspace_heads')) {
        if (!head || head.revision !== Number(params[4])) return { changes: 0 };
        head = { revision: Number(params[0]), content_hash: String(params[1]), updated_at: Number(params[2]) };
      }
      return { changes: 1 };
    },
    async executeRaw() {},
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) { return fn(db); },
    async close() {},
  };
  return { db, get writes() { return writes; }, get revisions() { return revisions; } };
}

describe('common CAD workspace revision envelope', () => {
  it('binds requirements, semantic model, exact geometry, graph, provenance and real kernel', () => {
    const value = envelope();
    expect(validateCadWorkspaceEnvelope(value)).toEqual([]);
    expect(hashCadWorkspaceEnvelope(value)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCadWorkspaceEnvelope(structuredClone(value))).toBe(hashCadWorkspaceEnvelope(value));
  });

  it('rejects stub identity and a model/geometry hash split', () => {
    const value = envelope();
    (value.kernelIdentity as unknown as { stubFallback: boolean }).stubFallback = true;
    value.artifactGraph.artifacts[0]!.contentHash = hash('1');
    expect(validateCadWorkspaceEnvelope(value as CadWorkspaceEnvelopeInput)).toEqual(expect.arrayContaining([
      'invalid_real_kernel_identity', 'model_geometry_hash_mismatch',
    ]));
  });

  it('rejects detached payload hashes and a schema from another domain', () => {
    const value = envelope();
    value.requirements.payload = { loadN: 999 };
    value.semanticDocument.schema = 'nexyfab.architecture.v1';
    expect(validateCadWorkspaceEnvelope(value)).toEqual(expect.arrayContaining([
      'requirements_payload_hash_mismatch', 'domain_semantic_schema_mismatch',
    ]));
  });

  it('commits revision zero once and returns bounded field paths for stale writers', async () => {
    const memory = memoryDb();
    const first = await persistCadWorkspaceRevision(memory.db, 'user-1', 'project-1', -1, envelope());
    expect(first).toMatchObject({ ok: true, envelope: { workspace: { revision: 0 } } });
    const stale = envelope();
    stale.requirements.payload = { loadN: 900 };
    stale.requirements.contentHash = hashCadPayload(stale.requirements.payload);
    const conflict = await persistCadWorkspaceRevision(memory.db, 'user-1', 'project-1', -1, stale);
    expect(conflict).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 0 });
    expect(conflict.ok ? [] : conflict.code === 'REVISION_CONFLICT' ? conflict.conflictPaths : [])
      .toContain('requirements.payload.loadN');
    expect(memory.revisions).toHaveLength(1);
  });

  it('rejects a failed/non-sequential candidate without any partial write', async () => {
    const memory = memoryDb();
    const value = envelope();
    const next = commitDesignWorkspaceRevision(value.workspace, {
      baseRevision: 0, actor: 'expert', mode: 'precision_cad', documentHash: hash('2'),
      changedTargets: [{ kind: 'feature', objectId: 'shaft' }],
    });
    expect(next.committed).toBe(true);
    value.workspace = next.workspace;
    const result = await persistCadWorkspaceRevision(memory.db, 'user-1', 'project-1', -1, value);
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENVELOPE' });
    expect(memory.writes).toBe(0);
  });

  it('reports object and field paths instead of only a generic conflict', () => {
    expect(diffCadWorkspacePaths(
      { parts: [{ id: 'a', diameter: 10 }], units: 'mm' },
      { parts: [{ id: 'a', diameter: 12 }], units: 'mm' },
    )).toEqual(['parts[0].diameter']);
  });

  it('lists only intact project-owned exact revision metadata', async () => {
    const input = envelope();
    const contentHash = hashCadWorkspaceEnvelope(input);
    const valid = { id: 'artifact-1', revision: 0, domain: 'mechanical' as const, content_hash: contentHash, payload_json: JSON.stringify({ ...input, contentHash }), created_at: 1234 };
    const tampered = { ...valid, id: 'artifact-2', content_hash: hash('f') };
    const db = { queryAll: async () => [valid, tampered] } as unknown as DbAdapter;
    await expect(listCadWorkspaceRevisions(db, 'project-1', 200)).resolves.toEqual([expect.objectContaining({ artifactId: 'artifact-1', revision: 0, domain: 'mechanical', geometryContentHash: hash('b'), shapeIdentityHash: hash('d') })]);
  });

  it('rejects excessively nested payloads before a database write', async () => {
    const memory = memoryDb();
    const value = envelope();
    let nested: Record<string, unknown> = {};
    value.requirements.payload = nested;
    for (let depth = 0; depth < 70; depth += 1) {
      nested.child = {};
      nested = nested.child as Record<string, unknown>;
    }
    const result = await persistCadWorkspaceRevision(memory.db, 'user-1', 'project-1', -1, value);
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENVELOPE' });
    expect(result.ok ? [] : result.code === 'INVALID_ENVELOPE' ? result.issues : [])
      .toContain('envelope_nesting_too_deep');
    expect(memory.writes).toBe(0);
  });

  it.each(DESIGN_DOMAIN_IDS)('uses the same exact revision contract for the %s adapter without proprietary CAD', domain => {
    const value = envelope();
    value.workspace.domain = domain;
    value.semanticDocument.schema = getDomainProfile(domain).documentSchemas[0]!;
    expect(validateCadWorkspaceEnvelope(value)).toEqual([]);
    expect(getDomainProfile(domain).exportFormats).toContain('nfab');
    expect(getDomainFormatCapabilities(domain).some(capability =>
      capability.releaseClaimAllowed && !capability.externalCadRequired,
    )).toBe(true);
  });
});
