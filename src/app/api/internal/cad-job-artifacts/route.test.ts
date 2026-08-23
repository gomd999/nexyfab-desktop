import { createHash } from 'node:crypto';
import BetterSqlite from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { hashCadPayload } from '@/lib/cad/workspaceRevisionStore';
import { createCadJobAuthorizationToken } from '@/lib/jobs/cadJobAuthorization';
import {
  JOB_CONTRACT_VERSION,
  type CadJobMessage,
  type CadJobOutputArtifactIntent,
} from '@/lib/platform/contracts';

const state = vi.hoisted(() => ({
  getDb: vi.fn(),
  objects: new Map<string, Buffer>(),
}));
vi.mock('@/lib/db-adapter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db-adapter')>();
  return { ...actual, getDbAdapter: () => state.getDb() };
});
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    async uploadRaw(bytes: Buffer, key: string) {
      if (state.objects.has(key)) throw new Error('EEXIST');
      state.objects.set(key, Buffer.from(bytes));
    },
    async download(key: string) {
      const bytes = state.objects.get(key);
      if (!bytes) throw new Error('ENOENT');
      return Buffer.from(bytes);
    },
    async sha256(key: string) {
      const bytes = state.objects.get(key);
      if (!bytes) throw new Error('ENOENT');
      return { size: bytes.length, contentSha256: createHash('sha256').update(bytes).digest('hex') };
    },
    async getSignedUrl() { throw new Error('local private'); },
    async delete() {},
    async upload() { throw new Error('unused'); },
    async uploadPrivate() { throw new Error('unused'); },
  }),
}));

import { GET, POST } from './route';

const authorizationSecret = 'a'.repeat(32);
const inputBytes = Buffer.from('immutable-input-step');
const inputSha256 = createHash('sha256').update(inputBytes).digest('hex');
const message: CadJobMessage = {
  contractVersion: JOB_CONTRACT_VERSION,
  jobId: 'job-1', tenantId: 'org-1', projectId: 'project-1', kind: 'EXACT_BREP_BUILD',
  inputArtifacts: [{ artifactId: 'input-1', objectKey: 'private/input.step', contentSha256: inputSha256 }],
  requestedAt: '2026-08-13T00:00:00.000Z', requestedBy: 'user-1',
};

let database: BetterSqlite.Database;
let db: DbAdapter;
let token: string;

function adapter(source: BetterSqlite.Database): DbAdapter {
  const value: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return source.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return source.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: source.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { source.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) {
      source.exec('BEGIN IMMEDIATE');
      try { const result = await fn(value); source.exec('COMMIT'); return result; }
      catch (error) { source.exec('ROLLBACK'); throw error; }
    },
    async close() { source.close(); },
  };
  return value;
}

function post(body: Record<string, unknown>) {
  return new NextRequest('https://core.test/api/internal/cad-job-artifacts', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.stubEnv('NEXYFAB_JOB_AUTHORIZATION_SECRET', authorizationSecret);
  database = new BetterSqlite(':memory:');
  db = adapter(database);
  state.getDb.mockReturnValue(db);
  state.objects.clear();
  database.exec(`
    CREATE TABLE nf_cad_job_registry (
      job_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL,
      message_sha256 TEXT NOT NULL, message_json TEXT NOT NULL, status TEXT NOT NULL,
      requested_by TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
    );
  `);
  const messageSha256 = hashCadPayload(message);
  await db.execute(
    `INSERT INTO nf_cad_job_registry
     (job_id, tenant_id, project_id, kind, message_sha256, message_json, status, requested_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    message.jobId, message.tenantId, message.projectId, message.kind, messageSha256,
    JSON.stringify(message), 'AUTHORIZED', message.requestedBy, Date.now(), Date.now(),
  );
  // Force table creation before seeding the input artifact.
  await POST(post({ action: 'output-intent', message: { ...message, inputArtifacts: [] }, authorizationToken: 'bad', intent: {} }));
  await db.execute(
    `INSERT INTO nf_cad_artifacts
     (id, contract_version, project_id, tenant_id, object_key, media_type, format, byte_length,
      content_sha256, shape_identity_sha256, producer_build_id, kernel_identity, created_by, created_at, immutability_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'input-1', 'nexyfab.artifact.v1', 'project-1', 'org-1', 'private/input.step',
    'application/step', 'step', inputBytes.length, inputSha256, null, 'upload', 'NOT_APPLICABLE',
    'user-1', Date.now(), 'IMMUTABLE',
  );
  state.objects.set('private/input.step', inputBytes);
  token = createCadJobAuthorizationToken(message.jobId, messageSha256, authorizationSecret);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (database.open) await db.close();
});

describe('CAD job artifact capability gateway', () => {
  it('bounds request bytes before JSON parsing while preserving REQUEST_INVALID status', async () => {
    const maxBodyBytes = Math.ceil((16 * 1024 * 1024) * 4 / 3) + 128 * 1024;
    const oversized = await POST(new NextRequest('https://core.test/api/internal/cad-job-artifacts', {
      method: 'POST', headers: { 'content-length': String(maxBodyBytes + 1) }, body: '{}',
    }));
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ ok: false, code: 'REQUEST_INVALID' });
    const invalidUtf8 = await POST(new NextRequest('https://core.test/api/internal/cad-job-artifacts', { method: 'POST', body: new Uint8Array([0xff]) }));
    expect(invalidUtf8.status).toBe(413);
    await expect(invalidUtf8.json()).resolves.toEqual({ ok: false, code: 'REQUEST_INVALID' });
  });

  it('streams only the authorized immutable input and verifies its stored hash', async () => {
    const request = new NextRequest('https://core.test/api/internal/cad-job-artifacts?jobId=job-1&artifactId=input-1', {
      headers: { authorization: `Bearer ${token}` },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-sha256')).toBe(inputSha256);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(inputBytes);
  });

  it('uses inline local upload and registers output only after byte hash verification', async () => {
    const bytes = Buffer.from('exact-result');
    const contentSha256 = createHash('sha256').update(bytes).digest('hex');
    const intent: CadJobOutputArtifactIntent = {
      artifactId: 'output-1', filename: 'normalized.step', mediaType: 'application/step', format: 'step',
      byteLength: bytes.length, contentSha256, shapeIdentitySha256: 'd'.repeat(64),
      producerBuildId: 'build-1', kernelIdentity: 'c'.repeat(64),
    };
    const base = { message, authorizationToken: token, intent };
    const grantResponse = await POST(post({ action: 'output-intent', ...base }));
    const granted = await grantResponse.json() as Record<string, unknown>;
    expect(granted).toMatchObject({ ok: true, grant: { uploadMode: 'CORE_INLINE', requiredContentType: 'application/step' } });

    expect((await POST(post({ action: 'output-upload', ...base, dataBase64: bytes.toString('base64') }))).status).toBe(200);
    const committed = await POST(post({ action: 'commit-output', ...base }));
    await expect(committed.json()).resolves.toMatchObject({
      ok: true, committed: true, idempotent: false,
      artifact: { artifactId: 'output-1', contentSha256 },
    });
    const row = await db.queryOne<{ immutability_state: string; content_sha256: string; shape_identity_sha256: string }>(
      'SELECT immutability_state, content_sha256, shape_identity_sha256 FROM nf_cad_artifacts WHERE id = ?', 'output-1',
    );
    expect(row).toEqual({ immutability_state: 'IMMUTABLE', content_sha256: contentSha256, shape_identity_sha256: 'd'.repeat(64) });
  });

  it('rejects a mismatched output body and does not register an artifact', async () => {
    const expected = Buffer.from('expected');
    const intent: CadJobOutputArtifactIntent = {
      artifactId: 'output-bad', filename: 'result.json', mediaType: 'application/json', format: 'json',
      byteLength: expected.length, contentSha256: createHash('sha256').update(expected).digest('hex'),
      producerBuildId: 'build-1', kernelIdentity: 'NOT_APPLICABLE',
    };
    const response = await POST(post({
      action: 'output-upload', message, authorizationToken: token, intent,
      dataBase64: Buffer.from('tampered').toString('base64'),
    }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'OUTPUT_BYTES_MISMATCH' });
    expect(await db.queryOne('SELECT id FROM nf_cad_artifacts WHERE id = ?', 'output-bad')).toBeUndefined();
  });

  it('deduplicates identical project output bytes without trapping retries', async () => {
    const bytes = Buffer.from('same-result');
    const contentSha256 = createHash('sha256').update(bytes).digest('hex');
    await db.execute(
      `INSERT INTO nf_cad_artifacts
       (id, contract_version, project_id, tenant_id, object_key, media_type, format, byte_length,
        content_sha256, shape_identity_sha256, producer_build_id, kernel_identity, created_by, created_at, immutability_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'existing-output', 'nexyfab.artifact.v1', 'project-1', 'org-1', 'private/existing.json',
      'application/json', 'json', bytes.length, contentSha256, null, 'older-build', 'NOT_APPLICABLE',
      'user-1', Date.now(), 'IMMUTABLE',
    );
    state.objects.set('private/existing.json', bytes);
    const intent: CadJobOutputArtifactIntent = {
      artifactId: 'new-output', filename: 'result.json', mediaType: 'application/json', format: 'json',
      byteLength: bytes.length, contentSha256, producerBuildId: 'build-1', kernelIdentity: 'NOT_APPLICABLE',
    };
    const base = { message, authorizationToken: token, intent };
    await POST(post({ action: 'output-intent', ...base }));
    await POST(post({ action: 'output-upload', ...base, dataBase64: bytes.toString('base64') }));
    const first = await POST(post({ action: 'commit-output', ...base }));
    await expect(first.json()).resolves.toMatchObject({
      committed: true, idempotent: true,
      artifact: { artifactId: 'existing-output', objectKey: 'private/existing.json', contentSha256 },
    });
    const replay = await POST(post({ action: 'output-intent', ...base }));
    await expect(replay.json()).resolves.toMatchObject({
      committed: true,
      artifact: { artifactId: 'existing-output', objectKey: 'private/existing.json', contentSha256 },
    });
    expect(await db.queryOne('SELECT id FROM nf_cad_artifacts WHERE id = ?', 'new-output')).toBeUndefined();
  });
});
