// Email suppression list — addresses that hard-bounced or filed a spam complaint
// must never be emailed again, or AWS SES throttles/suspends the account and the
// sending domain's reputation tanks. Populated by the SES→SNS webhook
// (/api/nexyfab/ses-notifications) and checked before every send.
//
// Note: SES also keeps its own ACCOUNT-LEVEL suppression list (auto-adds hard
// bounces + complaints), so this is a second, visible layer we fully control.

import { getDbAdapter } from './db-adapter';

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_email_suppression (
      email       TEXT PRIMARY KEY,
      reason      TEXT NOT NULL,
      detail      TEXT,
      created_at  BIGINT NOT NULL
    )
  `).catch(() => {});
  tableEnsured = true;
}

const norm = (e: string) => e.trim().toLowerCase();

/** True if this address is on the suppression list (hard bounce / complaint). */
export async function isSuppressed(email: string): Promise<boolean> {
  if (!email) return false;
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    const row = await db.queryOne<{ email: string }>(
      'SELECT email FROM nf_email_suppression WHERE email = ?', norm(email),
    );
    return !!row;
  } catch {
    return false; // never block sending on a suppression-store error
  }
}

/** Add an address to the suppression list. Idempotent (PK conflict is ignored). */
export async function suppressEmail(email: string, reason: 'bounce' | 'complaint' | 'manual', detail?: string): Promise<void> {
  if (!email) return;
  const db = getDbAdapter();
  await ensureTable(db);
  await db.execute(
    'INSERT INTO nf_email_suppression (email, reason, detail, created_at) VALUES (?, ?, ?, ?)',
    norm(email), reason, detail ?? null, Date.now(),
  ).catch(() => {}); // already suppressed → PK conflict → fine
}

/** Remove an address (e.g. user re-confirmed a corrected address). */
export async function unsuppressEmail(email: string): Promise<void> {
  if (!email) return;
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    await db.execute('DELETE FROM nf_email_suppression WHERE email = ?', norm(email));
  } catch { /* ignore */ }
}
