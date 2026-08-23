/**
 * ai-history.ts — Persist + retrieve AI feature outputs (NexyFab Phase 5c).
 *
 * Stores results from the 4 NexyFab AI features so users can revisit prior
 * Cost Copilot conversations, Process Router rankings, Supplier Top-3 picks,
 * and DFM Explainer cards without re-spending tokens.
 *
 * `payload` and `context` are arbitrary JSON blobs — kept as TEXT for forward
 * compatibility (no schema migration needed when a feature's response shape
 * evolves). The discriminator is `feature`.
 */

import { getDbAdapter } from './db-adapter';

export type AIHistoryFeature =
  | 'dfm_insights'
  | 'process_router'
  | 'ai_supplier_match'
  | 'cost_copilot'
  | 'rfq_writer'
  | 'cert_filter'
  | 'rfq_responder'
  | 'quote_negotiator'
  | 'order_priority'
  | 'change_detector'
  | 'capacity_match'
  | 'quote_accuracy';

export interface AIHistoryRow {
  id: string;
  user_id: string;
  org_id: string | null;
  feature: AIHistoryFeature;
  project_id: string | null;
  title: string;
  payload: string;
  context: string | null;
  created_at: number;
}

export interface AIHistoryRecord<P = unknown, C = unknown> {
  id: string;
  feature: AIHistoryFeature;
  projectId: string | null;
  title: string;
  payload: P;
  context: C | null;
  createdAt: number;
}

/** Fire-and-forget save. Errors are logged, never thrown. */
export function recordAIHistory(args: {
  userId: string;
  orgId?: string | null;
  feature: AIHistoryFeature;
  title: string;
  payload: unknown;
  context?: unknown;
  projectId?: string;
}): void {
  try {
    const db = getDbAdapter();
    void db.execute('ALTER TABLE nf_ai_history ADD COLUMN org_id TEXT').catch(() => {}).then(() => db.execute(
      `INSERT INTO nf_ai_history (id, user_id, org_id, feature, project_id, title, payload, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      args.userId,
      args.orgId ?? null,
      args.feature,
      args.projectId ?? null,
      args.title.slice(0, 200),
      JSON.stringify(args.payload),
      args.context !== undefined ? JSON.stringify(args.context) : null,
      Date.now(),
    )).catch((err: unknown) => console.warn('[ai-history] insert failed:', err));
  } catch (err) {
    console.warn('[ai-history] recordAIHistory error:', err);
  }
}

/** List recent AI history rows for a user. */
export async function listAIHistory(opts: {
  userId: string;
  orgId?: string | null;
  feature?: AIHistoryFeature;
  projectId?: string;
  limit?: number;
}): Promise<AIHistoryRecord[]> {
  const db = getDbAdapter();
  await db.execute('ALTER TABLE nf_ai_history ADD COLUMN org_id TEXT').catch(() => {});
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));

  const clauses: string[] = [opts.orgId ? 'org_id = ?' : 'user_id = ? AND org_id IS NULL'];
  const args: unknown[] = [opts.orgId ?? opts.userId];
  if (opts.feature)   { clauses.push('feature = ?');    args.push(opts.feature); }
  if (opts.projectId) { clauses.push('project_id = ?'); args.push(opts.projectId); }

  const rows = await db.queryAll<AIHistoryRow>(
    `SELECT id, user_id, org_id, feature, project_id, title, payload, context, created_at
     FROM nf_ai_history
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ${limit}`,
    ...args,
  );

  return rows.map(row => ({
    id: row.id,
    feature: row.feature,
    projectId: row.project_id,
    title: row.title,
    payload: safeParse(row.payload),
    context: row.context ? safeParse(row.context) : null,
    createdAt: row.created_at,
  }));
}

/** Delete a single record (only if owned by the user). */
export async function deleteAIHistory(userId: string, id: string, orgId?: string | null): Promise<boolean> {
  const db = getDbAdapter();
  await db.execute('ALTER TABLE nf_ai_history ADD COLUMN org_id TEXT').catch(() => {});
  const res = await db.execute(
    `DELETE FROM nf_ai_history WHERE id = ? AND ${orgId ? 'org_id = ?' : 'user_id = ? AND org_id IS NULL'}`,
    id, orgId ?? userId,
  );
  return res.changes > 0;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
