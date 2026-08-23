import { describe, expect, it } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import { createGenerationRun, recordGenerationStage } from './generationRunState';
import { buildCommercialGenerationRunBinding } from './commercialGenerationRunBinding';
import { createDbCommercialGenerationStateStore } from './commercialGenerationStateStore';
import { serverEvidenceSha256 } from './serverEvidence';

function db(): DbAdapter {
  const rows = new Map<string, Record<string, unknown>>(), revisions = new Map<string, Record<string, unknown>>();
  const adapter: DbAdapter = {
    backend: 'postgres',
    async queryOne<T>(sql: string, ...params: unknown[]) {
      if (sql.includes('nf_schema_migrations')) return { version: 2026082208, checksum: 'a'.repeat(64) } as T;
      if (sql.includes('COUNT(*)') && sql.includes('nf_commercial_generation_revisions')) { const prefix = `${params[0]}:${params[1]}:${params[2]}:`; const values = [...revisions.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value); const sizes = values.map(value => Buffer.byteLength(String(value.state_json), 'utf8')); return { row_count: values.length, total_bytes: sizes.reduce((sum, size) => sum + size, 0), max_bytes: sizes.length ? Math.max(...sizes) : 0 } as T; }
      if (sql.includes('FROM nf_commercial_generation_runs r')) { const row = rows.get(String(params[2])); return row ? { ...row, ...revisions.get(`${params[0]}:${params[1]}:${params[2]}:${row.head_revision}`) } as T : undefined; }
      if (sql.includes('FROM nf_commercial_generation_runs')) return rows.get(String(params[2])) as T | undefined;
      return undefined;
    },
    async queryAll<T>(_sql: string, ...params: unknown[]) { const prefix = `${params[0]}:${params[1]}:${params[2]}:`; return [...revisions.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => ({ ...value })).sort((left, right) => Number(left.revision) - Number(right.revision)) as T[]; },
    async execute(sql: string, ...params: unknown[]) {
      if (sql.includes('INSERT INTO nf_commercial_generation_runs')) rows.set(String(params[2]), { tenant_id: params[0], project_id: params[1], run_id: params[2], workspace_id: params[3], workspace_revision: params[4], head_revision: params[5], head_sha256: params[6], state_sha256: params[7] });
      if (sql.includes('INSERT INTO nf_commercial_generation_revisions')) revisions.set(`${params[0]}:${params[1]}:${params[2]}:${params[3]}`, { revision: params[3], state_json: params[7], state_sha256: params[6], generation_program_sha256: params[8], previous_revision: params[4], previous_sha256: params[5] });
      if (sql.includes('UPDATE nf_commercial_generation_runs')) { const row = rows.get(String(params[6])); if (!row || row.head_revision !== params[8] || row.head_sha256 !== params[9] || row.state_sha256 !== params[10]) return { changes: 0 }; Object.assign(row, { head_revision: params[0], head_sha256: params[1], state_sha256: params[2] }); }
      return { changes: 1 };
    },
    async executeRaw() {}, async transaction(fn) { return fn(this); }, async close() {},
  };
  return adapter;
}

const hashes = { programSha256: 'a'.repeat(64), workspaceHeadSha256: 'b'.repeat(64), previousHeadSha256: 'c'.repeat(64), previousStateSha256: '0'.repeat(64) };
describe('commercial generation durable state', () => {
  it('creates and rejects stale CAS', async () => {
    const store = createDbCommercialGenerationStateStore(db()), state = createGenerationRun('run-1');
    const binding = buildCommercialGenerationRunBinding({ tenantId: 'tenant-1', projectId: 'project-1', workspaceId: 'workspace-1', workspaceRevision: 7, runId: state.runId, revision: state.revision, previousRevision: -1, ...hashes, programSha256: '0'.repeat(64), previousHeadSha256: '0'.repeat(64), workspaceHeadSha256: hashes.workspaceHeadSha256, stateSha256: serverEvidenceSha256(state) });
    expect(await store.create(binding, state)).toEqual({ ok: true });
    const next = recordGenerationStage(state, { stage: 'intent', input: 'intent', status: 'passed' });
    const nextBinding = { ...binding, revision: next.revision, previousRevision: state.revision, previousHeadSha256: hashes.workspaceHeadSha256, previousStateSha256: serverEvidenceSha256(state), stateSha256: serverEvidenceSha256(next) };
    expect(await store.save(nextBinding, next, state.revision)).toEqual({ ok: true });
    expect(await store.save(nextBinding, next, state.revision)).toMatchObject({ ok: false, code: 'COMMERCIAL_GENERATION_REVISION_CONFLICT' });
  });
  it('rejects synthetic state hashes before DB mutation', async () => {
    const store = createDbCommercialGenerationStateStore(db()), state = createGenerationRun('run-tamper');
    const binding = buildCommercialGenerationRunBinding({ tenantId: 'tenant-1', projectId: 'project-1', workspaceId: 'workspace-1', workspaceRevision: 7, runId: state.runId, revision: state.revision, previousRevision: -1, ...hashes, programSha256: '0'.repeat(64), previousHeadSha256: '0'.repeat(64), workspaceHeadSha256: hashes.workspaceHeadSha256, stateSha256: 'd'.repeat(64) });
    expect(await store.create(binding, state)).toMatchObject({ ok: false, code: 'COMMERCIAL_GENERATION_BINDING_INVALID' });
  });
  it('allows a numeric revision jump while preserving the exact prior state SHA link', async () => {
    const store = createDbCommercialGenerationStateStore(db()), state = createGenerationRun('run-jump');
    const binding = buildCommercialGenerationRunBinding({ tenantId: 'tenant-1', projectId: 'project-1', workspaceId: 'workspace-1', workspaceRevision: 7, runId: state.runId, revision: 0, previousRevision: -1, programSha256: '0'.repeat(64), workspaceHeadSha256: hashes.workspaceHeadSha256, previousHeadSha256: '0'.repeat(64), previousStateSha256: '0'.repeat(64), stateSha256: serverEvidenceSha256(state) });
    expect(await store.create(binding, state)).toEqual({ ok: true });
    const jump = { ...recordGenerationStage(state, { stage: 'intent', input: 'intent', status: 'passed' }), revision: 5 };
    const jumpBinding = { ...binding, revision: 5, previousRevision: 0, previousHeadSha256: hashes.workspaceHeadSha256, previousStateSha256: serverEvidenceSha256(state), stateSha256: serverEvidenceSha256(jump) };
    expect(await store.save(jumpBinding, jump, 0)).toEqual({ ok: true });
    expect(await store.audit('tenant-1', 'project-1', 'run-jump')).toMatchObject({ ok: true, headRevision: 5, rowCount: 2 });
    const stale = { ...jump, revision: 7 }; const staleBinding = { ...jumpBinding, revision: 7, previousRevision: 0, stateSha256: serverEvidenceSha256(stale) };
    expect(await store.save(staleBinding, stale, 0)).toMatchObject({ ok: false, code: 'COMMERCIAL_GENERATION_REVISION_CONFLICT' });
  });
});
