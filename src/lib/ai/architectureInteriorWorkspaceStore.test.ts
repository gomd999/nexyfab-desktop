import BetterSqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import {
  hashArchitectureInteriorEvidenceV2,
  hashArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
} from './architectureInteriorWorkspace';
import {
  ARCHITECTURE_INTERIOR_WORKSPACE_MAX_BYTES,
  ensureArchitectureInteriorWorkspaceTables,
  persistArchitectureInteriorWorkspace,
  readArchitectureInteriorWorkspace,
} from './architectureInteriorWorkspaceStore';
import {
  appendArchitectureInteriorHistoryEventInTransaction,
  ensureArchitectureInteriorHistoryTables,
  readArchitectureInteriorHistory,
} from './architectureInteriorHistoryStore';

function sqliteAdapter(database: BetterSqlite.Database): DbAdapter {
  const adapter: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: database.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { database.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) { database.exec('BEGIN IMMEDIATE'); try { const result = await fn(adapter); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; } },
    async close() { database.close(); },
  };
  return adapter;
}

function workspace(revision = 0): ArchitectureInteriorWorkspaceV2 {
  const architecture = {
    schema: 'nexyfab.architecture.v1' as const,
    revision,
    storeys: [{ id: 'storey-1', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
    walls: [
      { id: 'wall-1', kind: 'line' as const, storeyId: 'storey-1', startMm: [0, 0] as [number, number], endMm: [1000, 0] as [number, number], thicknessMm: 100, heightMm: 3000 },
      { id: 'wall-2', kind: 'line' as const, storeyId: 'storey-1', startMm: [1000, 0] as [number, number], endMm: [1000, 1000] as [number, number], thicknessMm: 100, heightMm: 3000 },
      { id: 'wall-3', kind: 'line' as const, storeyId: 'storey-1', startMm: [1000, 1000] as [number, number], endMm: [0, 0] as [number, number], thicknessMm: 100, heightMm: 3000 },
    ],
    slabs: [{ id: 'slab-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [1000, 0], [1000, 1000]] as [number, number][], thicknessMm: 200 }],
    ceilings: [{ id: 'ceiling-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [1000, 0], [1000, 1000]] as [number, number][], elevationMm: 2800 }],
    spaces: [{ id: 'space-1', storeyId: 'storey-1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [1000, 0], [1000, 1000]] as [number, number][], wallIds: ['wall-1', 'wall-2', 'wall-3'], slabId: 'slab-1', ceilingId: 'ceiling-1' }],
    openings: [],
  };
  const interior = { schema: 'nexyfab.interior.v1' as const, revision, architectureDocumentId: 'architecture-1', lights: [], furniture: [], finishes: [] };
  const evidence = { revision, source: 'test' };
  const graph = { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-store', revision, artifacts: [], dependencies: [] } as ArchitectureInteriorWorkspaceV2['artifactGraph'];
  const draft = {
    schema: 'nexyfab.architecture-interior-workspace.v2' as const,
    projectId: 'project-store',
    workspace: { projectId: 'project-store', revision, contentHash: '', track: 'ai_design' as const, maturity: 'concept' as const },
    contentHash: '',
    units: { sourceUnit: 'mm' as const, geometryUnit: 'mm' as const, analysisUnit: 'SI' as const },
    coordinates: [
      { id: 'project-frame', kind: 'project' as const, originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] },
      { id: 'site-frame', kind: 'site' as const, parentId: 'project-frame', originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] },
      { id: 'building-frame', kind: 'building' as const, parentId: 'site-frame', originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] },
      { id: 'storey-frame', kind: 'storey' as const, parentId: 'building-frame', storeyId: 'storey-1', originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] },
      ...['storey-1', 'wall-1', 'wall-2', 'wall-3', 'slab-1', 'ceiling-1', 'space-1'].map(objectId => ({ id: `object-${objectId}`, kind: 'object' as const, parentId: 'storey-frame', objectId, documentId: 'architecture-1', originMm: [0, 0, 0] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] })),
    ],
    architecture: { documentId: 'architecture-1', document: architecture, geometry: { representation: 'bim' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'test', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'semantic.v2', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-a', kind: 'user' as const, contentHash: 'a'.repeat(64) }] },
    interior: { documentId: 'interior-1', document: interior, geometry: { representation: 'procedural' as const, units: 'mm' as const, fidelity: 'conceptual' as const, verification: { status: 'not_run' as const, verifierId: 'test', issues: [] }, contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, semantic: { schema: 'semantic.v2', contentHash: hashArchitectureInteriorEvidenceV2(evidence), payload: evidence }, provenance: [{ sourceId: 'source-i', kind: 'user' as const, contentHash: 'b'.repeat(64) }] },
    artifactGraph: graph,
  } as ArchitectureInteriorWorkspaceV2;
  const contentHash = hashArchitectureInteriorWorkspaceV2(draft);
  return { ...draft, contentHash, workspace: { ...draft.workspace, contentHash } };
}

describe('architecture/interior workspace persistence', () => {
  it('persists the initial and next immutable revisions, and rejects a stale CAS', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:'));
    await ensureArchitectureInteriorWorkspaceTables(db);
    const owner = { tenantId: 'tenant-a', userId: 'user-a' };
    const first = await persistArchitectureInteriorWorkspace(db, owner, 'project-store', -1, workspace(0), { now: 100 });
    expect(first).toMatchObject({ ok: true, revisionId: expect.any(String) });
    const second = await persistArchitectureInteriorWorkspace(db, owner, 'project-store', 0, workspace(1), { now: 200 });
    expect(second).toMatchObject({ ok: true, workspace: { workspace: { revision: 1 } } });
    const stale = await persistArchitectureInteriorWorkspace(db, owner, 'project-store', 0, workspace(1), { now: 300 });
    expect(stale).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 1 });
    expect(await readArchitectureInteriorWorkspace(db, { tenantId: owner.tenantId }, 'project-store')).toMatchObject({ ok: true, workspace: { workspace: { revision: 1 } } });
    const rows = await db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM nf_architecture_interior_workspace_revisions');
    expect(Number(rows[0]?.count)).toBe(2);
    await db.close();
  });

  it('fails closed on a tampered row and rejects oversized or sensitive payloads', async () => {
    const database = new BetterSqlite(':memory:');
    const db = sqliteAdapter(database);
    await ensureArchitectureInteriorWorkspaceTables(db);
    const owner = { tenantId: 'tenant-a', userId: 'user-a' };
    const first = await persistArchitectureInteriorWorkspace(db, owner, 'project-store', -1, workspace(0));
    expect(first.ok).toBe(true);
    database.prepare('UPDATE nf_architecture_interior_workspace_revisions SET payload_json = ?').run('{}');
    expect(await readArchitectureInteriorWorkspace(db, { tenantId: owner.tenantId }, 'project-store')).toEqual({ ok: false, code: 'CORRUPT_STORED_ROW' });
    const tooLarge = workspace(0);
    tooLarge.architecture.semantic.payload = { note: 'x'.repeat(ARCHITECTURE_INTERIOR_WORKSPACE_MAX_BYTES) };
    expect((await persistArchitectureInteriorWorkspace(db, owner, 'project-other', -1, tooLarge))).toMatchObject({ ok: false, code: 'INVALID_WORKSPACE' });
    expect((await persistArchitectureInteriorWorkspace(db, owner, 'project-other', -1, { ...workspace(0), architecture: { ...workspace(0).architecture, semantic: { ...workspace(0).architecture.semantic, payload: { apiKey: 'not-stored' } } } }))).toMatchObject({ ok: false, code: 'INVALID_WORKSPACE' });
    await db.close();
  });

  it('rejects cyclic and non-finite caller payloads without throwing', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:'));
    await ensureArchitectureInteriorWorkspaceTables(db);
    const owner = { tenantId: 'tenant-a', userId: 'user-a' };
    const cyclic = workspace(0);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    cyclic.architecture.semantic.payload = cycle;
    const cyclicResult = await persistArchitectureInteriorWorkspace(db, owner, 'project-cycle', -1, cyclic);
    expect(cyclicResult).toEqual({ ok: false, code: 'INVALID_WORKSPACE', issues: ['workspace_json_cycle'] });

    const nonFinite = workspace(0);
    nonFinite.architecture.document.storeys[0]!.heightMm = Number.POSITIVE_INFINITY;
    const nonFiniteResult = await persistArchitectureInteriorWorkspace(db, owner, 'project-non-finite', -1, nonFinite);
    expect(nonFiniteResult).toEqual({ ok: false, code: 'INVALID_WORKSPACE', issues: ['workspace_non_finite_number'] });
    await db.close();
  });

  it('atomically rolls back a real workspace CAS when the compact history append fails', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:'));
    await ensureArchitectureInteriorWorkspaceTables(db);
    await ensureArchitectureInteriorHistoryTables(db);
    const owner = { tenantId: 'tenant-a', userId: 'user-a' };
    const first = await persistArchitectureInteriorWorkspace(db, owner, 'project-store', -1, workspace(0), { now: 100 });
    expect(first.ok).toBe(true);

    await expect(db.transaction(async tx => {
      const saved = await persistArchitectureInteriorWorkspace(db, owner, 'project-store', 0, workspace(1), {
        baseContentHash: workspace(0).contentHash,
        now: 200,
        transactionalAdapter: tx,
      });
      expect(saved.ok).toBe(true);
      await appendArchitectureInteriorHistoryEventInTransaction(tx, { tenantId: owner.tenantId, projectId: 'project-store' }, {
        operation: 'undo',
        lineageId: 'lineage-1',
        actorUserId: owner.userId,
        commandId: 'invalid-without-source-sequence',
        sourceRevision: 0,
        sourceContentHash: workspace(0).contentHash,
        targetRevision: 1,
        targetContentHash: workspace(1).contentHash,
      });
    })).rejects.toThrow('history_input_invalid');

    expect(await readArchitectureInteriorWorkspace(db, { tenantId: owner.tenantId }, 'project-store')).toMatchObject({ ok: true, workspace: { workspace: { revision: 0 } } });
    expect((await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM nf_architecture_interior_workspace_revisions'))?.count).toBe(1);
    expect((await readArchitectureInteriorHistory(db, { tenantId: owner.tenantId, projectId: 'project-store' })).events).toHaveLength(0);
    await db.close();
  });
});
