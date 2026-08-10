import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA } from '@/lib/ai/designArtifactGraph';
import { createDesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import {
  CAD_WORKSPACE_ENVELOPE_SCHEMA,
  hashCadPayload,
  persistCadWorkspaceRevision,
  readCadWorkspaceRevision,
  type CadWorkspaceEnvelopeInput,
} from './workspaceRevisionStore';

const hash = (char: string) => char.repeat(64);

function sqliteAdapter(database: BetterSqlite.Database): DbAdapter {
  const adapter: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return database.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: database.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { database.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) {
      database.exec('BEGIN IMMEDIATE');
      try { const result = await fn(adapter); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    async close() { database.close(); },
  };
  return adapter;
}

function envelope(): CadWorkspaceEnvelopeInput {
  const requirements = { site: 'survey-1' };
  const semantic = { storeys: [{ id: 'L1', elevationMm: 0 }] };
  const relations = [{ from: 'wall-1', to: 'L1', type: 'HOSTED_BY' }];
  const documentHash = hashCadPayload(semantic);
  return {
    schema: CAD_WORKSPACE_ENVELOPE_SCHEMA,
    workspace: createDesignWorkspaceRevision({
      projectId: 'project-sqlite', lineageId: 'lineage-sqlite', domain: 'building', documentHash,
    }),
    requirements: { payload: requirements, contentHash: hashCadPayload(requirements) },
    semanticDocument: { schema: 'nexyfab.architecture.v1', payload: semantic, contentHash: documentHash },
    geometry: { fidelity: 'exact_brep', contentHash: hash('a'), shapeIdentityHash: hash('b') },
    objectRelations: { payload: relations, contentHash: hashCadPayload(relations) },
    artifactGraph: {
      schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-sqlite', revision: 0,
      artifacts: [{
        id: 'model', kind: 'model', revision: 0, contentHash: hash('a'), state: 'current', inputs: [], staleBecause: [],
        verification: { status: 'passed', verifierId: 'exact-wasm', evidenceHash: hash('c'), issues: [] },
      }],
      dependencies: [],
    },
    provenance: [{ sourceId: 'survey-1', kind: 'import', contentHash: hash('d') }],
    kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.9', buildSha256: hash('e'), wasmSha256: hash('f'), stubFallback: false },
  };
}

describe('common CAD workspace SQLite persistence', () => {
  it('executes the formal migration and round-trips an immutable revision', async () => {
    const database = new BetterSqlite(':memory:');
    database.exec('PRAGMA foreign_keys = ON; CREATE TABLE nf_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at BIGINT NOT NULL);');
    database.exec(fs.readFileSync(path.resolve(process.cwd(), 'src/lib/db-migrations-wave-2-sqlite.sql'), 'utf8'));
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'nf_cad_workspace_%' ORDER BY name").all() as Array<{ name: string }>;
    expect(tables.map(row => row.name)).toEqual(['nf_cad_workspace_heads', 'nf_cad_workspace_revisions']);

    const db = sqliteAdapter(database);
    const written = await persistCadWorkspaceRevision(db, 'user-sqlite', 'project-sqlite', -1, envelope());
    expect(written).toMatchObject({ ok: true, envelope: { workspace: { domain: 'building', revision: 0 } } });
    expect(await readCadWorkspaceRevision(db, 'project-sqlite')).toEqual(written.ok ? written.envelope : null);
    const rows = database.prepare('SELECT COUNT(*) AS count FROM nf_cad_workspace_revisions').get() as { count: number };
    expect(rows.count).toBe(1);
    await db.close();
  });
});
