import BetterSqlite from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import type { StorageAdapter } from '@/lib/storage';
import {
  abortArtifactMultipartUpload,
  completeArtifactUpload,
  createArtifactUploadSession,
  DIRECT_ARTIFACT_MULTIPART_PART_BYTES,
  ensureDirectArtifactUploadTables,
  finalizeArtifactMultipartUpload,
  listArtifactMultipartParts,
  validateArtifactUploadIntent,
} from './directArtifactUploadStore';

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

function storageFor(observed: { size: number; contentSha256: string }): StorageAdapter {
  return {
    upload: vi.fn(),
    uploadPrivate: vi.fn(),
    getSignedUrl: vi.fn(),
    delete: vi.fn(async () => undefined),
    sha256: vi.fn(async () => observed),
  };
}

async function setup() {
  const database = new BetterSqlite(':memory:');
  const db = sqliteAdapter(database);
  await ensureDirectArtifactUploadTables(db);
  const checked = validateArtifactUploadIntent({
    filename: 'assembly.step', byteLength: 4096, contentSha256: hash('a'), shapeIdentitySha256: hash('b'),
  });
  if (!checked.ok) throw new Error(checked.code);
  const session = await createArtifactUploadSession(db, {
    projectId: 'project-1', tenantId: 'org-1', userId: 'user-1',
    objectKey: 'private/artifacts/org-org-1/projects/project-1/id/assembly.step',
    intent: checked.value, now: 1_000,
  });
  return { database, db, session };
}

describe('project-scoped direct CAD artifact upload store', () => {
  it('rejects unsafe names, unsupported formats and unverified hashes', () => {
    expect(validateArtifactUploadIntent({ filename: '../part.step', byteLength: 1, contentSha256: hash('a') })).toMatchObject({ ok: false, code: 'INVALID_FILENAME' });
    expect(validateArtifactUploadIntent({ filename: 'part.exe', byteLength: 1, contentSha256: hash('a') })).toMatchObject({ ok: false, code: 'UNSUPPORTED_FORMAT' });
    expect(validateArtifactUploadIntent({ filename: 'part.step', byteLength: 1, contentSha256: 'claimed' })).toMatchObject({ ok: false, code: 'INVALID_SHA256' });
  });

  it('streams bytes, verifies SHA-256 and commits an immutable artifact', async () => {
    const { database, db, session } = await setup();
    const storage = storageFor({ size: 4096, contentSha256: hash('a') });
    const result = await completeArtifactUpload(db, storage, {
      uploadId: session.id, projectId: 'project-1', userId: 'user-1', producerBuildId: 'build-1', now: 2_000,
    });
    expect(result).toMatchObject({
      ok: true, idempotent: false,
      artifact: { projectId: 'project-1', tenantId: 'org-1', byteLength: 4096, contentSha256: hash('a'), immutabilityState: 'IMMUTABLE' },
    });
    expect(storage.sha256).toHaveBeenCalledWith(session.object_key);
    const stored = database.prepare('SELECT status, artifact_id FROM nf_artifact_upload_sessions WHERE id = ?').get(session.id) as { status: string; artifact_id: string };
    expect(stored.status).toBe('COMPLETED');
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_cad_artifacts').get()).toEqual({ count: 1 });

    const replay = await completeArtifactUpload(db, storage, {
      uploadId: session.id, projectId: 'project-1', userId: 'user-1', producerBuildId: 'build-1', now: 3_000,
    });
    expect(replay).toMatchObject({ ok: true, idempotent: true, artifact: { artifactId: stored.artifact_id } });
    expect(storage.sha256).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it('deletes a corrupt object and never creates artifact metadata', async () => {
    const { database, db, session } = await setup();
    const storage = storageFor({ size: 4096, contentSha256: hash('c') });
    const result = await completeArtifactUpload(db, storage, {
      uploadId: session.id, projectId: 'project-1', userId: 'user-1', producerBuildId: 'build-1', now: 2_000,
    });
    expect(result).toEqual({ ok: false, code: 'SHA256_MISMATCH' });
    expect(storage.delete).toHaveBeenCalledWith(session.object_key);
    expect(database.prepare('SELECT COUNT(*) AS count FROM nf_cad_artifacts').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT status, failure_code FROM nf_artifact_upload_sessions WHERE id = ?').get(session.id)).toEqual({ status: 'FAILED', failure_code: 'SHA256_MISMATCH' });
    await db.close();
  });

  it('never exposes a session across user or project boundaries', async () => {
    const { db, session } = await setup();
    const storage = storageFor({ size: 4096, contentSha256: hash('a') });
    await expect(completeArtifactUpload(db, storage, {
      uploadId: session.id, projectId: 'project-2', userId: 'user-1', producerBuildId: 'build-1', now: 2_000,
    })).resolves.toEqual({ ok: false, code: 'SESSION_NOT_FOUND' });
    await expect(completeArtifactUpload(db, storage, {
      uploadId: session.id, projectId: 'project-1', userId: 'user-2', producerBuildId: 'build-1', now: 2_000,
    })).resolves.toEqual({ ok: false, code: 'SESSION_NOT_FOUND' });
    expect(storage.sha256).not.toHaveBeenCalled();
    await db.close();
  });

  it('lists resumable parts, enforces contiguous byte coverage and assembles only a complete upload', async () => {
    const database = new BetterSqlite(':memory:');
    const db = sqliteAdapter(database);
    await ensureDirectArtifactUploadTables(db);
    const byteLength = DIRECT_ARTIFACT_MULTIPART_PART_BYTES + 1024;
    const checked = validateArtifactUploadIntent({ filename: 'building.ifc', byteLength, contentSha256: hash('d') });
    if (!checked.ok) throw new Error(checked.code);
    const session = await createArtifactUploadSession(db, {
      projectId: 'project-1', tenantId: 'org-1', userId: 'user-1',
      objectKey: 'private/artifacts/org-org-1/projects/project-1/id/building.ifc',
      intent: checked.value,
      uploadMode: 'MULTIPART', storageUploadId: 'r2-upload-1',
      partSize: DIRECT_ARTIFACT_MULTIPART_PART_BYTES, totalParts: 2,
      expiresInMs: 86_400_000, now: 1_000,
    });
    const parts = [
      { partNumber: 1, etag: 'etag-1', size: DIRECT_ARTIFACT_MULTIPART_PART_BYTES },
      { partNumber: 2, etag: 'etag-2', size: 1024 },
    ];
    const storage = {
      ...storageFor({ size: byteLength, contentSha256: hash('d') }),
      listPrivateMultipartParts: vi.fn(async () => parts),
      completePrivateMultipartUpload: vi.fn(async () => undefined),
      abortPrivateMultipartUpload: vi.fn(async () => undefined),
    } satisfies StorageAdapter;
    await expect(listArtifactMultipartParts(db, storage, {
      uploadId: session.id, projectId: 'project-1', userId: 'user-1', now: 2_000,
    })).resolves.toMatchObject({ ok: true, parts });
    await expect(finalizeArtifactMultipartUpload(db, storage, {
      uploadId: session.id, projectId: 'project-1', userId: 'user-1', now: 3_000,
    })).resolves.toMatchObject({ ok: true, parts });
    expect(storage.completePrivateMultipartUpload).toHaveBeenCalledWith(session.object_key, 'r2-upload-1', parts);
    expect(database.prepare('SELECT multipart_completed_at FROM nf_artifact_upload_sessions WHERE id = ?').get(session.id)).toEqual({ multipart_completed_at: 3000 });
    await db.close();
  });

  it('refuses incomplete multipart coverage and supports explicit abort', async () => {
    const database = new BetterSqlite(':memory:');
    const db = sqliteAdapter(database);
    await ensureDirectArtifactUploadTables(db);
    const byteLength = DIRECT_ARTIFACT_MULTIPART_PART_BYTES + 1024;
    const checked = validateArtifactUploadIntent({ filename: 'building.ifc', byteLength, contentSha256: hash('d') });
    if (!checked.ok) throw new Error(checked.code);
    const session = await createArtifactUploadSession(db, {
      projectId: 'project-1', tenantId: 'org-1', userId: 'user-1',
      objectKey: 'private/artifacts/org-org-1/projects/project-1/id/building.ifc',
      intent: checked.value,
      uploadMode: 'MULTIPART', storageUploadId: 'r2-upload-2',
      partSize: DIRECT_ARTIFACT_MULTIPART_PART_BYTES, totalParts: 2,
      expiresInMs: 86_400_000, now: 1_000,
    });
    const storage = {
      ...storageFor({ size: byteLength, contentSha256: hash('d') }),
      listPrivateMultipartParts: vi.fn(async () => [{ partNumber: 1, etag: 'etag-1', size: DIRECT_ARTIFACT_MULTIPART_PART_BYTES }]),
      completePrivateMultipartUpload: vi.fn(async () => undefined),
      abortPrivateMultipartUpload: vi.fn(async () => undefined),
    } satisfies StorageAdapter;
    await expect(finalizeArtifactMultipartUpload(db, storage, {
      uploadId: session.id, projectId: 'project-1', userId: 'user-1', now: 2_000,
    })).resolves.toEqual({ ok: false, code: 'PARTS_INCOMPLETE' });
    expect(storage.completePrivateMultipartUpload).not.toHaveBeenCalled();
    await expect(abortArtifactMultipartUpload(db, storage, {
      uploadId: session.id, projectId: 'project-1', userId: 'user-1',
    })).resolves.toEqual({ ok: true });
    expect(storage.abortPrivateMultipartUpload).toHaveBeenCalledWith(session.object_key, 'r2-upload-2');
    expect(database.prepare('SELECT status, failure_code FROM nf_artifact_upload_sessions WHERE id = ?').get(session.id)).toEqual({ status: 'FAILED', failure_code: 'CLIENT_ABORTED' });
    await db.close();
  });
});
