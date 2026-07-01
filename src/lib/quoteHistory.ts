// Real-quote history → the flywheel that calibrates the parametric cost model.
// Empty today (no real quotes yet): getCalibrationFactor returns 1, so the
// estimate falls back to the pure parametric baseline. As real quotes are
// recorded, the factor = median(actual / estimated) per (process, material,
// region) bucket nudges estimates toward reality.

import { getDbAdapter } from './db-adapter';

let ensured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_quote_history (
      id             TEXT PRIMARY KEY,
      user_id        TEXT,
      process        TEXT NOT NULL,
      material       TEXT,
      region         TEXT,
      quantity       BIGINT,
      estimated_krw  BIGINT,
      actual_krw     BIGINT NOT NULL,
      features       TEXT,
      created_at     BIGINT NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_nf_quote_hist_bucket ON nf_quote_history (process, material, region)').catch(() => {});
  ensured = true;
}

export interface QuoteRecord {
  id: string;
  userId?: string | null;
  process: string;
  material?: string | null;
  region?: string | null;
  quantity?: number | null;
  estimatedKrw?: number | null;
  actualKrw: number;         // real per-part quote (KRW)
  features?: unknown;
}

/** Record a real quote so future estimates in this bucket get calibrated. */
export async function recordQuote(q: QuoteRecord): Promise<void> {
  const db = getDbAdapter();
  await ensureTable(db);
  await db.execute(
    `INSERT INTO nf_quote_history (id, user_id, process, material, region, quantity, estimated_krw, actual_krw, features, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    q.id, q.userId ?? null, q.process, q.material ?? null, q.region ?? null,
    q.quantity ?? null, q.estimatedKrw ?? null, q.actualKrw,
    q.features != null ? JSON.stringify(q.features) : null, Date.now(),
  ).catch(() => {});
}

export interface QuoteRow {
  id: string; process: string; material: string | null; region: string | null;
  quantity: number | null; estimated_krw: number | null; actual_krw: number; created_at: number;
}

/** Recent recorded real quotes (newest first) — for the admin calibration view. */
export async function listQuotes(limit = 50): Promise<QuoteRow[]> {
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    const rows = await db.queryAll<QuoteRow>(
      'SELECT id, process, material, region, quantity, estimated_krw, actual_krw, created_at FROM nf_quote_history ORDER BY created_at DESC LIMIT ?',
      limit,
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

/**
 * Calibration factor for a bucket = median(actual / estimated) over recorded
 * quotes. Returns 1 when there is not enough data (min 3), so the estimate stays
 * on the pure parametric baseline until real quotes accumulate.
 */
export async function getCalibrationFactor(process: string, material: string, region: string): Promise<number> {
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    const rows = await db.queryAll<{ estimated_krw: number | null; actual_krw: number }>(
      `SELECT estimated_krw, actual_krw FROM nf_quote_history
       WHERE process = ? AND material = ? AND region = ? AND estimated_krw IS NOT NULL AND estimated_krw > 0`,
      process, material, region,
    );
    const ratios = (rows ?? [])
      .map(r => (r.estimated_krw ? Number(r.actual_krw) / Number(r.estimated_krw) : NaN))
      .filter(x => Number.isFinite(x) && x > 0)
      .sort((a, b) => a - b);
    if (ratios.length < 3) return 1;
    const mid = Math.floor(ratios.length / 2);
    const median = ratios.length % 2 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
    // Clamp so a few odd quotes can't wildly swing the estimate.
    return Math.min(3, Math.max(0.33, median));
  } catch {
    return 1;
  }
}
