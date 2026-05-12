/**
 * Persistence for prompt-compare runs.
 *
 * Each row captures one POST to /api/nexyfab/admin/prompt-compare so admins
 * can browse the history without re-running expensive multi-provider calls.
 * Schema is minimal — provider responses go into `results_json` rather than
 * normalised columns to keep the table simple and let new fields appear
 * without migrations.
 */

import { getDbAdapter } from '@/lib/db-adapter';

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  const db = getDbAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_prompt_compare_runs (
      id           TEXT NOT NULL PRIMARY KEY,
      created_at   INTEGER NOT NULL,
      created_by   TEXT,
      prompt_id    TEXT NOT NULL,
      prompt_version TEXT,
      max_tokens   INTEGER,
      temperature  REAL,
      user_input   TEXT NOT NULL,
      results_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nf_pcr_created ON nf_prompt_compare_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_nf_pcr_prompt  ON nf_prompt_compare_runs(prompt_id);
  `).catch(() => {});
  tableEnsured = true;
}

export interface CompareRunSummary {
  id: string;
  createdAt: number;
  createdBy: string | null;
  promptId: string;
  promptVersion: string | null;
  maxTokens: number | null;
  temperature: number | null;
  userInput: string;
  /** Truncated providers list pulled out of results_json for list views. */
  providers: string[];
}

export interface CompareRunDetail extends CompareRunSummary {
  results: unknown;
}

export async function saveCompareRun(input: {
  createdBy?: string;
  promptId: string;
  promptVersion?: string;
  maxTokens?: number;
  temperature?: number;
  userInput: string;
  results: unknown;
}): Promise<string> {
  await ensureTable();
  const db = getDbAdapter();
  const id = `pcr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.execute(
    `INSERT INTO nf_prompt_compare_runs
       (id, created_at, created_by, prompt_id, prompt_version, max_tokens, temperature, user_input, results_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    Date.now(),
    input.createdBy ?? null,
    input.promptId,
    input.promptVersion ?? null,
    typeof input.maxTokens === 'number' ? input.maxTokens : null,
    typeof input.temperature === 'number' ? input.temperature : null,
    input.userInput.slice(0, 16_000),  // cap to avoid runaway DB rows
    JSON.stringify(input.results).slice(0, 256_000),
  );
  return id;
}

interface RawRow {
  id: string;
  created_at: number;
  created_by: string | null;
  prompt_id: string;
  prompt_version: string | null;
  max_tokens: number | null;
  temperature: number | null;
  user_input: string;
  results_json: string;
}

function rowToSummary(r: RawRow): CompareRunSummary {
  let providers: string[] = [];
  try {
    const parsed = JSON.parse(r.results_json) as Array<{ provider?: string }>;
    if (Array.isArray(parsed)) {
      providers = parsed.map(p => typeof p.provider === 'string' ? p.provider : '').filter(Boolean);
    }
  } catch { /* malformed row */ }
  return {
    id: r.id,
    createdAt: r.created_at,
    createdBy: r.created_by,
    promptId: r.prompt_id,
    promptVersion: r.prompt_version,
    maxTokens: r.max_tokens,
    temperature: r.temperature,
    userInput: r.user_input,
    providers,
  };
}

export interface ListCompareRunsOpts {
  limit?: number;
  promptId?: string;
  /** Filter by row.created_by (exact match). */
  createdBy?: string;
  /** Inclusive ms timestamp lower bound. */
  sinceMs?: number;
  /** Inclusive ms timestamp upper bound. */
  untilMs?: number;
}

export async function listCompareRuns(opts: ListCompareRunsOpts = {}): Promise<CompareRunSummary[]> {
  await ensureTable();
  const db = getDbAdapter();
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));

  // Build WHERE dynamically. Keeps SQL simple while supporting sparse filters.
  const wheres: string[] = [];
  const args: unknown[] = [];
  if (opts.promptId)  { wheres.push('prompt_id = ?');  args.push(opts.promptId); }
  if (opts.createdBy) { wheres.push('created_by = ?'); args.push(opts.createdBy); }
  if (typeof opts.sinceMs === 'number') { wheres.push('created_at >= ?'); args.push(opts.sinceMs); }
  if (typeof opts.untilMs === 'number') { wheres.push('created_at <= ?'); args.push(opts.untilMs); }
  const whereSql = wheres.length > 0 ? ` WHERE ${wheres.join(' AND ')}` : '';
  args.push(limit);

  const rows = await db
    .queryAll<RawRow>(
      `SELECT * FROM nf_prompt_compare_runs${whereSql} ORDER BY created_at DESC LIMIT ?`,
      ...args,
    )
    .catch((): RawRow[] => []);
  return rows.map(rowToSummary);
}

export async function getCompareRun(id: string): Promise<CompareRunDetail | null> {
  await ensureTable();
  const db = getDbAdapter();
  const row = await db
    .queryOne<RawRow>('SELECT * FROM nf_prompt_compare_runs WHERE id = ?', id)
    .catch(() => null);
  if (!row) return null;
  let results: unknown = null;
  try { results = JSON.parse(row.results_json); } catch { /* malformed */ }
  return { ...rowToSummary(row), results };
}
