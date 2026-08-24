// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-adapter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db-adapter')>();
  return { ...actual, getDbAdapter: () => mocks.getDb() };
});

import { advanceAiDesignComplexWorkspaceAggregate } from './aiDesignComplexWorkspaceAggregate';
import { PostgresAiDesignComplexWorkspaceStore } from './aiDesignComplexWorkspaceStore';
import { aiDesignOwnerKeySha256 } from './aiDesignPostgresAuthority';
import { issueAiDesignServerEvidenceReceipt } from './aiDesignServerEvidenceReceipt';
import { PostgresAiDesignServerRuntimeArtifacts } from './aiDesignServerRuntimeArtifacts';
import { createAiDesignWorkspaceRuntime, dispatchAiDesignWorkspaceAction } from './aiDesignWorkspaceRuntime';
import {
  createServerAiDesignWorkspaceRuntime,
  loadServerAiDesignWorkspaceRuntime,
  loadServerAiDesignWorkspaceRuntimeByOwnerHash,
  saveServerAiDesignWorkspaceRuntime,
} from './aiDesignWorkspaceRuntimeStore';
import { serverEvidenceSha256 } from './serverEvidence';

const migrationChecksum = '66a5232ed469ff60b571f7332cd0c88049411b301c40aacbe68271eb17aadd29';
const hash = (character: string) => character.repeat(64);
let db: DbAdapter;
type Row = Record<string, unknown>;
let rows: { runtimes: Map<string, Row>; complex: Map<string, Row>; artifacts: Map<string, Row> };

function scopedKey(owner: unknown, project: unknown, session: unknown): string { return `${owner}\0${project}\0${session}`; }
function adapter(): DbAdapter {
  return {
    backend: 'postgres',
    async queryOne<T>(sql: string, ...params: unknown[]) {
      if (sql.includes('nf_schema_migrations')) return { version: 2026082402, checksum: migrationChecksum } as T;
      if (sql.includes('FROM nf_ai_design_workspace_runtimes')) return rows.runtimes.get(scopedKey(params[0], params[1], params[2])) as T | undefined;
      if (sql.includes('FROM nf_ai_design_complex_workspaces')) return rows.complex.get(scopedKey(params[0], params[1], params[2])) as T | undefined;
      if (sql.includes('FROM nf_ai_design_artifacts')) {
        const row = rows.artifacts.get(String(params[0]));
        return (!params[1] || row?.artifact_kind === params[1] ? row : undefined) as T | undefined;
      }
      return undefined;
    },
    async queryAll<T>(sql: string, ...params: unknown[]) {
      if (!sql.includes('FROM nf_ai_design_artifacts')) return [];
      return [...rows.artifacts.values()].filter(row => row.project_id === params[0] && row.session_id === params[1] && row.artifact_kind === params[2]) as T[];
    },
    async execute(sql: string, ...params: unknown[]) {
      if (sql.includes('INSERT INTO nf_ai_design_workspace_runtimes')) {
        const key = scopedKey(params[0], params[1], params[2]);
        if (rows.runtimes.has(key)) throw new Error('unique');
        rows.runtimes.set(key, { owner_key_sha256: params[0], project_id: params[1], session_id: params[2], runtime_revision: params[3], state_sha256: params[4], state_json: params[5], created_at: params[6], updated_at: params[7] });
        return { changes: 1 };
      }
      if (sql.includes('UPDATE nf_ai_design_workspace_runtimes')) {
        const key = scopedKey(params[4], params[5], params[6]); const row = rows.runtimes.get(key);
        if (!row || row.runtime_revision !== params[7]) return { changes: 0 };
        Object.assign(row, { runtime_revision: params[0], state_sha256: params[1], state_json: params[2], updated_at: params[3] });
        return { changes: 1 };
      }
      if (sql.includes('INSERT INTO nf_ai_design_complex_workspaces')) {
        const key = scopedKey(params[0], params[1], params[2]);
        if (!rows.complex.has(key)) rows.complex.set(key, { owner_key_sha256: params[0], project_id: params[1], session_id: params[2], complex_revision: params[3], aggregate_digest: params[4], aggregate_json: params[5], created_at: params[6], updated_at: params[7] });
        return { changes: 1 };
      }
      if (sql.includes('UPDATE nf_ai_design_complex_workspaces')) {
        const key = scopedKey(params[4], params[5], params[6]); const row = rows.complex.get(key);
        if (!row || row.complex_revision !== params[7]) return { changes: 0 };
        Object.assign(row, { complex_revision: params[0], aggregate_digest: params[1], aggregate_json: params[2], updated_at: params[3] });
        return { changes: 1 };
      }
      if (sql.includes('INSERT INTO nf_ai_design_artifacts')) {
        const key = String(params[0]); if (rows.artifacts.has(key)) throw new Error('unique');
        rows.artifacts.set(key, { artifact_id: params[0], project_id: params[1], session_id: params[2], artifact_kind: params[3], content_sha256: params[4], value_json: params[5], byte_length: params[6], created_at: params[7] });
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    async executeRaw() {},
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) { return fn(this); },
    async close() {},
  };
}

function runtime() {
  const created = createAiDesignWorkspaceRuntime({
    projectId: 'project-1', revisionToken: 'revision-1', sessionId: 'session-1', now: '2026-08-24T00:00:00.000Z',
    inputs: [{ projectId: 'project-1', revision: 0, sourceId: 'source-1', sourceHash: hash('a'), projectContentHash: hash('b'), kind: 'text', mimeType: 'text/plain', sizeBytes: 10, authority: 'user_confirmed', provenance: { rights: 'user_owned', origin: 'test' }, fields: [{ key: 'purpose', value: 'bracket' }] }],
  });
  if (!created.ok) throw new Error(created.issues.join(','));
  return created.state;
}

beforeEach(() => {
  vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '1');
  vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082402', migrationChecksum);
  rows = { runtimes: new Map(), complex: new Map(), artifacts: new Map() };
  db = adapter();
  mocks.getDb.mockReturnValue(db);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.close();
});

describe('AI Design PostgreSQL authority stores', () => {
  it('fails closed when the immutable 2402 checksum is not configured', async () => {
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082402', '');
    const store = new PostgresAiDesignComplexWorkspaceStore(adapter());
    await expect(store.loadOrCreate({ ownerKey: 'owner-1', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 0 })).rejects.toThrow('AI_DESIGN_AUTHORITY_MIGRATION_REQUIRED');
  });

  it('persists runtime state with owner scoping, CAS, and digest verification', async () => {
    const initial = runtime();
    await createServerAiDesignWorkspaceRuntime('owner-1', initial);
    await expect(createServerAiDesignWorkspaceRuntime('owner-1', initial)).rejects.toThrow('AI_DESIGN_WORKSPACE_ALREADY_EXISTS');
    await expect(loadServerAiDesignWorkspaceRuntime('owner-2', 'project-1', 'session-1')).rejects.toThrow('AI_DESIGN_WORKSPACE_NOT_FOUND');
    const transitioned = dispatchAiDesignWorkspaceAction(initial, {
      type: 'UNDERSTANDING_CONFIRMED', actionId: 'confirm-1', expectedRevision: 0, missingInput: false,
      evidence: { id: 'evidence-1', kind: 'understanding', checkpointId: initial.checkpoint.checkpointId, revision: 0, status: 'PASS', digest: hash('b'), source: 'worker-1' },
    });
    if (!transitioned.ok) throw new Error(transitioned.error);
    await saveServerAiDesignWorkspaceRuntime('owner-1', transitioned.state, 0);
    expect((await loadServerAiDesignWorkspaceRuntime('owner-1', 'project-1', 'session-1')).runtimeRevision).toBe(1);
    expect((await loadServerAiDesignWorkspaceRuntimeByOwnerHash(
      db, aiDesignOwnerKeySha256('owner-1'), 'project-1', 'session-1',
    )).runtimeRevision).toBe(1);
    await expect(saveServerAiDesignWorkspaceRuntime('owner-1', { ...transitioned.state, runtimeRevision: 2 }, 0)).rejects.toThrow('AI_DESIGN_WORKSPACE_REVISION_CONFLICT');
    rows.runtimes.values().next().value!.state_sha256 = hash('f');
    await expect(loadServerAiDesignWorkspaceRuntime('owner-1', 'project-1', 'session-1')).rejects.toThrow('AI_DESIGN_WORKSPACE_INTEGRITY_FAILED');
  });

  it('creates and compare-and-swaps the complex aggregate', async () => {
    const store = new PostgresAiDesignComplexWorkspaceStore(db);
    const initial = await store.loadOrCreate({ ownerKey: 'owner-1', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 0, now: '2026-08-24T00:00:00.000Z' });
    const next = advanceAiDesignComplexWorkspaceAggregate(initial, {
      commandId: 'command-1', commandDigest: hash('a'), expectedComplexRevision: 0,
      runtimeRevision: 0, now: '2026-08-24T00:01:00.000Z', patch: {},
    });
    await expect(store.save('owner-1', next, 0)).resolves.toEqual(next);
    await expect(store.loadByOwnerHash({
      ownerKeySha256: aiDesignOwnerKeySha256('owner-1'), projectId: 'project-1', sessionId: 'session-1',
    })).resolves.toEqual(next);
    await expect(store.save('owner-1', { ...next, complexRevision: 2, aggregateDigest: serverEvidenceSha256({ bad: true }) }, 1)).rejects.toThrow('AI_DESIGN_COMPLEX_AGGREGATE_INVALID');
    const concurrent = advanceAiDesignComplexWorkspaceAggregate(initial, {
      commandId: 'command-2', commandDigest: hash('b'), expectedComplexRevision: 0,
      runtimeRevision: 0, now: '2026-08-24T00:02:00.000Z', patch: {},
    });
    await expect(store.save('owner-1', concurrent, 0)).rejects.toThrow('AI_DESIGN_COMPLEX_REVISION_CONFLICT');
  });

  it('stores immutable content-bound artifacts and rejects conflicting replay', async () => {
    const store = new PostgresAiDesignServerRuntimeArtifacts(db);
    const receipt = issueAiDesignServerEvidenceReceipt({
      projectId: 'project-1', sessionId: 'session-1', commandId: 'command-1', checkpointId: 'checkpoint-1',
      checkpointDigest: hash('a'), runtimeRevision: 0, generationRevision: null, stage: 'understanding',
      outcome: 'PASS', inputDigest: hash('a'), outputDigest: hash('b'), source: 'worker-1', codes: [],
    }, 'ai-design-authority-test-secret-at-least-32-bytes', new Date('2026-08-24T00:00:00.000Z'));
    await store.putImmutable(receipt);
    await store.putImmutable(structuredClone(receipt));
    await expect(store.putImmutable({ ...receipt, codes: ['changed'] })).rejects.toThrow('OVERWRITE_FORBIDDEN');
    await expect(store.getReceipt(receipt.receiptId)).resolves.toEqual(receipt);
    rows.artifacts.get(receipt.receiptId)!.value_json = '{}';
    await expect(store.getReceipt(receipt.receiptId)).resolves.toBeNull();
  });
});
