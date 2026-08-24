import 'server-only';

import { createHash } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';

export const AI_DESIGN_AUTHORITY_MIGRATION_VERSION = 2026082402 as const;

const SHA256 = /^[a-f0-9]{64}$/;
const verified = new WeakSet<object>();

export function aiDesignOwnerKeySha256(ownerKey: string): string {
  return createHash('sha256').update(ownerKey, 'utf8').digest('hex');
}

/** Read-only check. Request handlers never create or alter authority tables. */
export async function assertAiDesignPostgresAuthority(db: DbAdapter): Promise<void> {
  if (db.backend !== 'postgres') throw new Error('AI_DESIGN_POSTGRES_AUTHORITATIVE_REQUIRED');
  if (verified.has(db as object)) return;
  const migration = await db.queryOne<{ version: number; checksum?: string }>(
    'SELECT version, checksum FROM nf_schema_migrations WHERE version = ?',
    AI_DESIGN_AUTHORITY_MIGRATION_VERSION,
  ).catch(() => undefined);
  const expected = process.env.POSTGRES_MIGRATION_CHECKSUM_2026082402?.trim();
  if (!migration || Number(migration.version) !== AI_DESIGN_AUTHORITY_MIGRATION_VERSION
    || !SHA256.test(migration.checksum ?? '') || !expected || migration.checksum !== expected) {
    throw new Error(`AI_DESIGN_AUTHORITY_MIGRATION_REQUIRED:v${AI_DESIGN_AUTHORITY_MIGRATION_VERSION}`);
  }
  await db.queryOne('SELECT project_id FROM nf_ai_design_workspace_runtimes LIMIT 1');
  await db.queryOne('SELECT project_id FROM nf_ai_design_complex_workspaces LIMIT 1');
  await db.queryOne('SELECT project_id FROM nf_ai_design_artifacts LIMIT 1');
  verified.add(db as object);
}
