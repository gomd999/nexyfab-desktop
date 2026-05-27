// Portfolio view tracking — counts how many times a partner's public
// portfolio page or marketplace card has been opened by customers. Used
// by /api/partner/hub-summary and surfaced on /partner/hub.
//
// Schema is created lazily (CREATE TABLE IF NOT EXISTS) so deployments
// don't depend on a migration step. Indexed by partner_email + viewed_at
// so the 7-day window query stays cheap.

import { getDbAdapter } from './db-adapter';

let ensured: Promise<void> | null = null;

export async function ensurePortfolioViewTable(): Promise<void> {
  if (ensured) return ensured;
  const db = getDbAdapter();
  ensured = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS nf_partner_portfolio_views (
        id TEXT PRIMARY KEY,
        partner_email TEXT NOT NULL,
        viewer_user_id TEXT,
        viewer_ip_hash TEXT,
        source TEXT,
        viewed_at INTEGER NOT NULL
      )
    `).catch(() => { /* schema race — table already exists */ });
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_pp_views_partner_time
         ON nf_partner_portfolio_views (partner_email, viewed_at)`,
    ).catch(() => { /* ignore */ });
  })();
  return ensured;
}

export interface RecordViewInput {
  partnerEmail: string;
  viewerUserId?: string | null;
  viewerIpHash?: string | null;
  source?: 'marketplace' | 'partner-page' | 'rfq-match' | string;
}

export async function recordPortfolioView(input: RecordViewInput): Promise<void> {
  await ensurePortfolioViewTable();
  const db = getDbAdapter();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.execute(
    `INSERT INTO nf_partner_portfolio_views
       (id, partner_email, viewer_user_id, viewer_ip_hash, source, viewed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.partnerEmail.toLowerCase().trim(),
    input.viewerUserId ?? null,
    input.viewerIpHash ?? null,
    input.source ?? null,
    Date.now(),
  ).catch(() => { /* non-fatal: views are best-effort */ });
}

export async function countViewsInLastDays(
  partnerEmail: string,
  days: number,
): Promise<number> {
  await ensurePortfolioViewTable();
  const db = getDbAdapter();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const row = await db.queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM nf_partner_portfolio_views
       WHERE partner_email = ? AND viewed_at >= ?`,
    partnerEmail.toLowerCase().trim(),
    since,
  ).catch(() => null);
  return row?.n ?? 0;
}
