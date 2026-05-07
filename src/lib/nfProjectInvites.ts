import type { DbAdapter } from '@/lib/db-adapter';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export { INVITE_TTL_MS };

export async function ensureProjectInvitesTable(db: DbAdapter): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_project_invites (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      email_norm  TEXT NOT NULL,
      role        TEXT NOT NULL,
      token       TEXT NOT NULL UNIQUE,
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      UNIQUE(project_id, email_norm)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_pinv_token ON nf_project_invites(token);
    CREATE INDEX IF NOT EXISTS idx_nf_pinv_project ON nf_project_invites(project_id);
  `).catch(() => {});
}

export function newInviteToken(): string {
  return `pinv_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function maskEmailForInvite(email: string): string {
  const [a, b] = email.split('@');
  if (!b) return '***';
  const head = a.length <= 2 ? '*' : `${a.slice(0, 2)}***`;
  return `${head}@${b}`;
}

export function inviteExpiresAt(createdAt: number): number {
  return createdAt + INVITE_TTL_MS;
}

/** 만료된 초대 행을 삭제하고 삭제된 행 수를 반환합니다. */
export async function deleteExpiredProjectInvites(db: DbAdapter): Promise<number> {
  await ensureProjectInvitesTable(db);
  const r = await db.execute('DELETE FROM nf_project_invites WHERE expires_at < ?', Date.now());
  return r.changes ?? 0;
}
