import BetterSqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from './designArtifactGraph';
import { hashArchitectureInteriorArtifactBundle, type ArchitectureInteriorArtifactBundle } from './architectureInteriorArtifactTransaction';
import { hashArchitectureInteriorEvidenceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureInteriorQuantityPayload } from './architectureInteriorQuantityArtifact';
import { ensureArchitectureInteriorArtifactBundleTables, persistArchitectureInteriorArtifactBundle, readLatestArchitectureInteriorArtifactBundle } from './architectureInteriorArtifactBundleStore';

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

function bundle(payloadNote = 'one'): ArchitectureInteriorArtifactBundle {
  const source = { projectId: 'project-bundle', revision: 2, contentHash: '1'.repeat(64), architectureDocumentId: 'architecture-2', interiorDocumentId: 'interior-2', architectureDocumentHash: '2'.repeat(64), interiorDocumentHash: '3'.repeat(64) };
  const model = { id: 'model:architecture:2', kind: 'model' as const, revision: 2, contentHash: '4'.repeat(64), state: 'current' as const, inputs: [], verification: { status: 'passed' as const, verifierId: 'model', evidenceHash: '5'.repeat(64), issues: [] as string[] }, staleBecause: [] };
  const payload = { schema: 'nexyfab.architecture-interior-quantity.v1', note: payloadNote, binding: { ...source, workspaceContentHash: source.contentHash } } as unknown as ArchitectureInteriorQuantityPayload;
  const payloadHash = hashArchitectureInteriorEvidenceV2(payload);
  const artifact = { id: 'quantity:architecture-interior:2', kind: 'quantity' as const, revision: 2, contentHash: payloadHash, state: 'current' as const, inputs: [{ artifactId: model.id, revision: model.revision, contentHash: model.contentHash }], verification: { status: 'passed' as const, verifierId: 'quantity', evidenceHash: '7'.repeat(64), issues: [] as string[] }, staleBecause: [] };
  const artifactGraph = { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: source.projectId, revision: source.revision, artifacts: [model, artifact], dependencies: [{ id: 'dep-1', sourceId: model.id, targetId: artifact.id, policy: 'invalidate' as const }] };
  const withoutHash = { schema: 'nexyfab.architecture-interior-artifact-transaction.v1' as const, source, artifactGraph, artifacts: [{ kind: 'quantity' as const, artifact, contentHash: artifact.contentHash, payload }], bundleHash: '' };
  return { ...withoutHash, bundleHash: hashArchitectureInteriorArtifactBundle(withoutHash) };
}

describe('architecture/interior artifact bundle persistence', () => {
  it('persists an immutable source-bound bundle and reads it by tenant/project head', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:')); await ensureArchitectureInteriorArtifactBundleTables(db);
    const owner = { tenantId: 'tenant-a', userId: 'user-a' };
    const candidate = bundle(); const saved = await persistArchitectureInteriorArtifactBundle(db, owner, 'project-bundle', null, candidate, { now: 100 });
    expect(saved).toMatchObject({ ok: true, revisionId: expect.any(String), bundle: { source: { revision: 2, contentHash: '1'.repeat(64) } } });
    const read = await readLatestArchitectureInteriorArtifactBundle(db, { tenantId: owner.tenantId }, 'project-bundle');
    expect(read).toMatchObject({ ok: true, bundle: { bundleHash: (saved as { bundle: ArchitectureInteriorArtifactBundle }).bundle.bundleHash } });
    expect(await readLatestArchitectureInteriorArtifactBundle(db, { tenantId: 'tenant-b' }, 'project-bundle')).toEqual({ ok: false, code: 'NOT_FOUND' });
    await db.close();
  });

  it('uses CAS for head replacement and does not partially insert a duplicate', async () => {
    const database = new BetterSqlite(':memory:'); const db = sqliteAdapter(database); await ensureArchitectureInteriorArtifactBundleTables(db);
    const owner = { tenantId: 'tenant-a', userId: 'user-a' }; const first = bundle();
    expect((await persistArchitectureInteriorArtifactBundle(db, owner, 'project-bundle', null, first)).ok).toBe(true);
    const next = bundle('two');
    expect((await persistArchitectureInteriorArtifactBundle(db, owner, 'project-bundle', '0'.repeat(64), next))).toMatchObject({ ok: false, code: 'BUNDLE_REVISION_CONFLICT' });
    const afterConflict = await db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM nf_architecture_interior_artifact_bundle_revisions'); expect(Number(afterConflict[0]?.count)).toBe(1);
    expect((await persistArchitectureInteriorArtifactBundle(db, owner, 'project-bundle', first.bundleHash, next)).ok).toBe(true);
    expect((await persistArchitectureInteriorArtifactBundle(db, owner, 'project-bundle', next.bundleHash, next))).toMatchObject({ ok: false, code: 'BUNDLE_ALREADY_EXISTS' });
    const rows = await db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM nf_architecture_interior_artifact_bundle_revisions'); expect(Number(rows[0]?.count)).toBe(2);
    await db.close();
  });

  it('fails closed on corrupt payload or tampered bundle metadata', async () => {
    const database = new BetterSqlite(':memory:'); const db = sqliteAdapter(database); await ensureArchitectureInteriorArtifactBundleTables(db);
    const owner = { tenantId: 'tenant-a', userId: 'user-a' }; const saved = await persistArchitectureInteriorArtifactBundle(db, owner, 'project-bundle', null, bundle()); expect(saved.ok).toBe(true);
    database.prepare('UPDATE nf_architecture_interior_artifact_bundle_heads SET source_revision = ?').run(99);
    expect(await readLatestArchitectureInteriorArtifactBundle(db, { tenantId: owner.tenantId }, 'project-bundle')).toEqual({ ok: false, code: 'CORRUPT_STORED_ROW' });
    database.prepare('UPDATE nf_architecture_interior_artifact_bundle_heads SET source_revision = ?').run(2);
    database.prepare('UPDATE nf_architecture_interior_artifact_bundle_revisions SET payload_json = ?').run('{}');
    expect(await readLatestArchitectureInteriorArtifactBundle(db, { tenantId: owner.tenantId }, 'project-bundle')).toEqual({ ok: false, code: 'CORRUPT_STORED_ROW' });
    const tampered = bundle(); tampered.source.contentHash = '8'.repeat(64);
    expect(await persistArchitectureInteriorArtifactBundle(db, owner, 'project-other', null, tampered)).toMatchObject({ ok: false, code: 'INVALID_BUNDLE' });
    await db.close();
  });

  it('rejects payload, artifact-input, and artifact-verification tampering', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:')); await ensureArchitectureInteriorArtifactBundleTables(db);
    const owner = { tenantId: 'tenant-a', userId: 'user-a' };
    const payloadTampered = bundle(); (payloadTampered.artifacts[0]!.payload as unknown as Record<string, unknown>).note = 'tampered';
    expect(await persistArchitectureInteriorArtifactBundle(db, owner, 'project-payload-tampered', null, payloadTampered)).toMatchObject({ ok: false, code: 'INVALID_BUNDLE' });
    const inputTampered = bundle(); inputTampered.artifacts[0]!.artifact.inputs = [];
    expect(await persistArchitectureInteriorArtifactBundle(db, owner, 'project-input-tampered', null, inputTampered)).toMatchObject({ ok: false, code: 'INVALID_BUNDLE' });
    const verificationTampered = bundle(); verificationTampered.artifacts[0]!.artifact.verification.verifierId = 'tampered';
    expect(await persistArchitectureInteriorArtifactBundle(db, owner, 'project-verification-tampered', null, verificationTampered)).toMatchObject({ ok: false, code: 'INVALID_BUNDLE' });
    await db.close();
  });

  it('bounds cyclic, deeply nested, and non-finite bundle JSON before persistence', async () => {
    const db = sqliteAdapter(new BetterSqlite(':memory:')); await ensureArchitectureInteriorArtifactBundleTables(db);
    const owner = { tenantId: 'tenant-a', userId: 'user-a' };
    const cyclic = bundle(); const cycle: Record<string, unknown> = {}; cycle.self = cycle; (cyclic.artifacts[0]!.payload as Record<string, unknown>).cycle = cycle;
    expect(await persistArchitectureInteriorArtifactBundle(db, owner, 'project-cycle', null, cyclic)).toMatchObject({ ok: false, code: 'INVALID_BUNDLE' });
    const deep = bundle(); let current: Record<string, unknown> = {}; (deep.artifacts[0]!.payload as Record<string, unknown>).deep = current; for (let i = 0; i < 70; i++) { const next: Record<string, unknown> = {}; current.next = next; current = next; }
    deep.bundleHash = '9'.repeat(64);
    expect(await persistArchitectureInteriorArtifactBundle(db, owner, 'project-deep', null, deep)).toMatchObject({ ok: false, code: 'INVALID_BUNDLE' });
    const nonFinite = bundle(); (nonFinite.artifacts[0]!.payload as Record<string, unknown>).value = Number.NaN; nonFinite.bundleHash = 'a'.repeat(64);
    expect(await persistArchitectureInteriorArtifactBundle(db, owner, 'project-number', null, nonFinite)).toMatchObject({ ok: false, code: 'INVALID_BUNDLE' });
    await db.close();
  });
});
