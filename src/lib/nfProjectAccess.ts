import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import type { NexyfabProject } from '@/app/api/nexyfab/projects/projects-types';

export type NfProjectRole = NonNullable<NexyfabProject['role']>;

export type NfProjectAccess = {
  row: Record<string, unknown>;
  role: NfProjectRole;
  canEdit: boolean;
  ownerUserId: string;
};

export async function ensureProjectMembersTable(): Promise<void> {
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_project_members (
      project_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_pm_user ON nf_project_members(user_id);
  `).catch(() => {});
}

export async function resolveProjectAccess(
  db: DbAdapter,
  projectId: string,
  authUserId: string,
): Promise<NfProjectAccess | null> {
  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_projects WHERE id = ?', projectId);
  if (!row) return null;
  const ownerUserId = row.user_id as string;
  if (ownerUserId === authUserId) {
    return { row, role: 'owner', canEdit: true, ownerUserId };
  }
  await ensureProjectMembersTable();
  const m = await db.queryOne<{ role: string }>(
    'SELECT role FROM nf_project_members WHERE project_id = ? AND user_id = ?',
    projectId,
    authUserId,
  );
  if (!m) return null;
  const role: NfProjectRole = m.role === 'viewer' ? 'viewer' : 'editor';
  return {
    row,
    role,
    canEdit: role === 'editor',
    ownerUserId,
  };
}
