import type { DbAdapter } from '@/lib/db-adapter';

/**
 * Delete NexyFab-owned user data in dependency order before removing nf_users.
 *
 * Several analytics and support tables predate the account-erasure endpoint
 * and use non-cascading foreign keys. Relying on the nf_users cascade therefore
 * both returned HTTP 500 and left non-FK personal rows behind. Keep this list
 * explicit so an erasure remains reviewable and transactional.
 */
export async function deleteNexyfabAccountData(db: DbAdapter, userId: string): Promise<void> {
  // This table was historically lazy-created by the project route. Ensure it
  // exists so accounts with and without saved snapshots follow one code path.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_project_versions (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      version_num INTEGER NOT NULL,
      shape_id    TEXT,
      material_id TEXT,
      scene_data  TEXT,
      label       TEXT,
      created_at  BIGINT NOT NULL
    )
  `);

  // Project-owned rows without FK cascades must go before the project rows.
  await db.execute(
    'DELETE FROM nf_project_versions WHERE user_id = ? OR project_id IN (SELECT id FROM nf_projects WHERE user_id = ?)',
    userId,
    userId,
  );
  await db.execute(
    'DELETE FROM nf_comments WHERE project_id IN (SELECT id FROM nf_projects WHERE user_id = ?)',
    userId,
  );
  await db.execute(
    'DELETE FROM nf_collab_sessions WHERE user_id = ? OR project_id IN (SELECT id FROM nf_projects WHERE user_id = ?)',
    userId,
    userId,
  );
  await db.execute(
    'DELETE FROM nf_project_invites WHERE project_id IN (SELECT id FROM nf_projects WHERE user_id = ?)',
    userId,
  );
  await db.execute(
    'DELETE FROM nf_project_members WHERE user_id = ? OR project_id IN (SELECT id FROM nf_projects WHERE user_id = ?)',
    userId,
    userId,
  );
  await db.execute('DELETE FROM nf_projects WHERE user_id = ?', userId);

  // User-owned rows that deliberately have no FK (or no cascade).
  await db.execute('DELETE FROM nf_shares WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_orders WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_audit_log WHERE user_id = ?', userId);

  // Break DFM/RFQ links before erasing either side.
  await db.execute(
    'UPDATE nf_rfqs SET dfm_check_id = NULL WHERE dfm_check_id IN (SELECT id FROM nf_dfm_check WHERE user_id = ?)',
    userId,
  );
  await db.execute('DELETE FROM nf_rfqs WHERE user_id = ?', userId);

  // Non-cascading nf_users foreign keys found in the Postgres baseline.
  await db.execute('DELETE FROM nf_stage_event WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_funnel_event WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_dfm_check WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_sessions WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_support_tickets WHERE user_id = ?', userId);
  await db.execute('UPDATE nf_support_tickets SET assigned_to = NULL WHERE assigned_to = ?', userId);

  // Explicit cleanup is harmless where cascades also exist and documents the
  // privacy boundary for adapters/schemas that do not enforce those FKs.
  await db.execute('DELETE FROM nf_refresh_tokens WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_password_reset_tokens WHERE user_id = ?', userId);
  await db.execute('DELETE FROM nf_verification_codes WHERE user_id = ?', userId);

  const deleted = await db.execute('DELETE FROM nf_users WHERE id = ?', userId);
  if (deleted.changes !== 1) {
    throw new Error(`account erasure expected one user row, deleted ${deleted.changes}`);
  }
}
