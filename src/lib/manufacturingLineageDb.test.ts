import { describe, expect, it } from 'vitest';
import type { DbAdapter } from './db-adapter';
import { resolveAuthorizedManufacturingLineage } from './manufacturingLineageDb';

const ref = { lineageId: 'l1', artifactId: 'a1', artifactSha256: 'a'.repeat(64), documentVersionId: 'v1' };
const adapter = (row: unknown): DbAdapter => {
  const db: DbAdapter = {
    backend: 'sqlite',
    queryOne: async <T>() => row as T | undefined,
    queryAll: async <T>() => [] as T[],
    execute: async () => ({ changes: 0 }),
    executeRaw: async () => {},
    transaction: async <T>(callback: (tx: DbAdapter) => Promise<T>) => callback(db),
    close: async () => {},
  };
  return db;
};

describe('authorized manufacturing lineage resolver', () => {
  it('accepts only the exact server-authorized artifact owned by the user', async () => {
    await expect(resolveAuthorizedManufacturingLineage(adapter({
      lineage_id: 'l1', user_id: 'u1', artifact_id: 'a1', artifact_sha256: 'a'.repeat(64),
      document_version_id: 'v1', release_status: 'authorized', authorized_at: 1,
      authorized_by: 'reviewer', invalidated_at: null,
    }), 'u1', ref)).resolves.toEqual({ ok: true, ref });
  });

  it('fails closed for missing, revoked, or swapped artifacts', async () => {
    await expect(resolveAuthorizedManufacturingLineage(adapter(undefined), 'u1', ref)).resolves.toMatchObject({ code: 'LINEAGE_NOT_FOUND' });
    await expect(resolveAuthorizedManufacturingLineage(adapter({
      lineage_id: 'l1', user_id: 'u1', artifact_id: 'a1', artifact_sha256: 'a'.repeat(64),
      document_version_id: 'v1', release_status: 'revoked', authorized_at: 1,
      authorized_by: 'reviewer', invalidated_at: 2,
    }), 'u1', ref)).resolves.toMatchObject({ code: 'LINEAGE_NOT_AUTHORIZED' });
    await expect(resolveAuthorizedManufacturingLineage(adapter({
      lineage_id: 'l1', user_id: 'u1', artifact_id: 'different', artifact_sha256: 'a'.repeat(64),
      document_version_id: 'v1', release_status: 'authorized', authorized_at: 1,
      authorized_by: 'reviewer', invalidated_at: null,
    }), 'u1', ref)).resolves.toMatchObject({ code: 'LINEAGE_ARTIFACT_MISMATCH' });
  });
});
