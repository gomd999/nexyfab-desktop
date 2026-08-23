import BetterSqlite from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { hashCadPayload } from '@/lib/cad/workspaceRevisionStore';
import { JOB_CONTRACT_VERSION, type CadJobMessage, type CadJobReceipt } from '@/lib/platform/contracts';

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('@/lib/db-adapter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db-adapter')>();
  return { ...actual, getDbAdapter: () => mocks.getDb() };
});

import { POST } from './route';

const hash = (char: string) => char.repeat(64);
const coreSecret = 's'.repeat(32);
let database: BetterSqlite.Database;
let db: DbAdapter;

function sqliteAdapter(source: BetterSqlite.Database): DbAdapter {
  const adapter: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return source.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return source.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: source.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { source.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) {
      source.exec('BEGIN IMMEDIATE');
      try { const result = await fn(adapter); source.exec('COMMIT'); return result; }
      catch (error) { source.exec('ROLLBACK'); throw error; }
    },
    async close() { source.close(); },
  };
  return adapter;
}

const message: CadJobMessage = {
  contractVersion: JOB_CONTRACT_VERSION,
  jobId: 'job-1', tenantId: 'org-1', projectId: 'project-1', kind: 'EXACT_CLASH',
  inputArtifacts: [{ artifactId: 'input-1', objectKey: 'private/input.step', contentSha256: hash('a') }],
  requestedAt: '2026-08-13T00:00:00.000Z', requestedBy: 'user-1',
};

function request(body: Record<string, unknown>, authorization = coreSecret) {
  return new NextRequest('https://nexyfab.com/api/internal/cad-job-orchestrator', {
    method: 'POST',
    headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function authorize(target = message) {
  const response = await POST(request({ action: 'authorize', message: target }));
  return { response, body: await response.json() as Record<string, unknown> };
}

beforeEach(() => {
  vi.stubEnv('NEXYFAB_JOB_ORCHESTRATOR_CORE_SECRET', coreSecret);
  vi.stubEnv('NEXYFAB_JOB_AUTHORIZATION_SECRET', 'a'.repeat(32));
  vi.stubEnv('NEXYFAB_CAD_WORKER_IDENTITIES', JSON.stringify({ worker: hash('b') }));
  vi.stubEnv('NEXYFAB_CAD_KERNEL_IDENTITIES', hash('c'));
  database = new BetterSqlite(':memory:');
  database.exec(`
    CREATE TABLE nf_projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, org_id TEXT);
    CREATE TABLE nf_project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(project_id, user_id));
    INSERT INTO nf_projects (id, user_id, org_id) VALUES ('project-1', 'user-1', 'org-1');
  `);
  db = sqliteAdapter(database);
  mocks.getDb.mockReturnValue(db);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (database.open) await db.close();
});

async function seedArtifact(id: string, objectKey: string, contentSha256: string) {
  await POST(request({ action: 'authorize', message }));
  await db.execute(
    `INSERT INTO nf_cad_artifacts
     (id, contract_version, project_id, tenant_id, object_key, media_type, format, byte_length,
      content_sha256, shape_identity_sha256, producer_build_id, kernel_identity, created_by, created_at, immutability_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, 'nexyfab.artifact.v1', 'project-1', 'org-1', objectKey, 'application/step', 'step', 100,
    contentSha256, null, 'build-1', 'NOT_APPLICABLE', 'user-1', Date.now(), 'IMMUTABLE',
  );
}

describe('Core API CAD job authorization and receipt authority', () => {
  it('rejects declared overflow and invalid UTF-8 after core authorization but before storage', async () => {
    const oversized = await POST(new NextRequest('https://nexyfab.com/api/internal/cad-job-orchestrator', {
      method: 'POST', headers: { authorization: `Bearer ${coreSecret}`, 'content-length': String(512 * 1024 + 1) }, body: '{}',
    }));
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ ok: false, code: 'BODY_TOO_LARGE' });

    const invalidUtf8 = await POST(new NextRequest('https://nexyfab.com/api/internal/cad-job-orchestrator', {
      method: 'POST', headers: { authorization: `Bearer ${coreSecret}` }, body: new Uint8Array([0xff]),
    }));
    expect(invalidUtf8.status).toBe(400);
    await expect(invalidUtf8.json()).resolves.toEqual({ ok: false, code: 'INVALID_JSON' });
  });

  it('fails closed when an input artifact is not an immutable project artifact', async () => {
    const { response, body } = await authorize();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ authorized: false, issues: ['input_artifact_not_found:input-1'] });
  });

  it('authorizes a project-owned artifact without claiming execution', async () => {
    await seedArtifact('input-1', 'private/input.step', hash('a'));
    const { response, body } = await authorize();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ authorized: true, execution: 'NOT_RUN', releaseVerification: 'NOT_RUN' });
    expect(typeof body.authorizationToken).toBe('string');
  });

  it('accepts a hash-valid trusted receipt only after output artifact registration', async () => {
    await seedArtifact('input-1', 'private/input.step', hash('a'));
    await seedArtifact('output-1', 'private/output.step', hash('d'));
    const { body: authorized } = await authorize();
    const receiptCore = {
      contractVersion: JOB_CONTRACT_VERSION,
      jobId: 'job-1', workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'),
      inputArtifacts: message.inputArtifacts,
      outputArtifacts: [{ artifactId: 'output-1', objectKey: 'private/output.step', contentSha256: hash('d') }],
      execution: 'PASS' as const,
      startedAt: '2026-08-13T00:01:00.000Z', completedAt: '2026-08-13T00:02:00.000Z', failureReasons: [],
    };
    const receipt: CadJobReceipt = { ...receiptCore, receiptSha256: hashCadPayload(receiptCore) };
    const response = await POST(request({
      action: 'complete', message, receipt, authorizationToken: authorized.authorizationToken,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true, execution: 'PASS', releaseVerification: 'NOT_RUN', idempotent: false,
    });
    const replay = await POST(request({ action: 'complete', message, receipt, authorizationToken: authorized.authorizationToken }));
    await expect(replay.json()).resolves.toMatchObject({ accepted: true, idempotent: true });
  });

  it('rejects receipt tampering and untrusted worker identity', async () => {
    await seedArtifact('input-1', 'private/input.step', hash('a'));
    await seedArtifact('output-1', 'private/output.step', hash('d'));
    const { body: authorized } = await authorize();
    const receipt: CadJobReceipt = {
      contractVersion: JOB_CONTRACT_VERSION,
      jobId: 'job-1', workerIdentitySha256: hash('f'), kernelIdentitySha256: hash('c'),
      inputArtifacts: message.inputArtifacts,
      outputArtifacts: [{ artifactId: 'output-1', objectKey: 'private/output.step', contentSha256: hash('d') }],
      execution: 'PASS', startedAt: '2026-08-13T00:01:00.000Z', completedAt: '2026-08-13T00:02:00.000Z',
      receiptSha256: hash('e'), failureReasons: [],
    };
    const response = await POST(request({ action: 'complete', message, receipt, authorizationToken: authorized.authorizationToken }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: false, issues: expect.arrayContaining(['worker_identity_not_trusted', 'receipt_sha256_mismatch']) });
  });
});
