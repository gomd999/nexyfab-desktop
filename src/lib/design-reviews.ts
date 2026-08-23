// Persistence for 완제품 평가 (Design Review) reports — lazy-created table via
// the shared DB adapter (Postgres in prod, sqlite fallback), mirroring the
// nf_admin_audit / nf_api_usage ensure-table pattern.

import { getDbAdapter } from './db-adapter';

export interface SavedReviewInput {
  id: string;
  userId: string;
  orgId?: string | null;
  filename: string;
  material: string;
  process: string;
  metrics: unknown;
  report: unknown;
}

export interface SavedReviewRow {
  id: string;
  filename: string;
  material: string;
  process: string;
  report: string; // JSON string
  created_at: number;
}

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_design_reviews (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      org_id      TEXT,
      filename    TEXT,
      material    TEXT,
      process     TEXT,
      metrics     TEXT,
      report      TEXT,
      created_at  BIGINT NOT NULL
    )
  `).catch(() => {});
  await db.execute('ALTER TABLE nf_design_reviews ADD COLUMN org_id TEXT').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_design_reviews_user ON nf_design_reviews(user_id, created_at DESC)').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_design_reviews_org ON nf_design_reviews(org_id, created_at DESC)').catch(() => {});
  tableEnsured = true;
}

export async function saveReview(entry: SavedReviewInput): Promise<void> {
  const db = getDbAdapter();
  await ensureTable(db);
  await db.execute(
    'INSERT INTO nf_design_reviews (id, user_id, org_id, filename, material, process, metrics, report, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    entry.id, entry.userId, entry.orgId ?? null, entry.filename, entry.material, entry.process,
    JSON.stringify(entry.metrics ?? null), JSON.stringify(entry.report ?? null), Date.now(),
  );
}

export async function listReviews(userId: string, limit = 20, orgId?: string | null): Promise<SavedReviewRow[]> {
  const db = getDbAdapter();
  await ensureTable(db);
  return db.queryAll<SavedReviewRow>(
    `SELECT id, filename, material, process, report, created_at FROM nf_design_reviews
      WHERE ${orgId ? 'org_id = ?' : 'user_id = ? AND org_id IS NULL'} ORDER BY created_at DESC LIMIT ?`,
    orgId ?? userId, limit,
  );
}

/** Delete only a review owned by the authenticated user. */
export async function deleteReview(userId: string, id: string, orgId?: string | null): Promise<number> {
  const db = getDbAdapter();
  await ensureTable(db);
  const result = await db.execute(
    `DELETE FROM nf_design_reviews WHERE id = ? AND ${orgId ? 'org_id = ?' : 'user_id = ? AND org_id IS NULL'}`,
    id, orgId ?? userId,
  );
  return result.changes;
}
