/**
 * GET /api/cron/audit-prune
 *
 * Daily retention cron for audit-style tables. Deletes rows older than
 * `AUDIT_RETENTION_DAYS` (default 90). Today only handles
 * `nf_provider_override_audit`; new audit tables can be added by extending
 * `TABLES` below.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface RetentionTarget {
  table: string;
  /** Column carrying the row's logical timestamp (ms epoch). */
  tsColumn: string;
  /** Per-table override of the global retention days. */
  retentionDays?: number;
}

const TABLES: RetentionTarget[] = [
  { table: 'nf_provider_override_audit', tsColumn: 'changed_at' },
  // Round 36: app-level audit log. 90d default is fine for ops debugging;
  // commercial / legal records (전자상거래법 5y) live in dedicated tables
  // (nf_aw_invoices, nf_aw_subscriptions) and aren't pruned here.
  { table: 'nf_audit_log', tsColumn: 'created_at' },
  // Round 36 consolidation: dedupe-only table from Round 29 budget warning
  // emails. 30d retention is enough — the ON CONFLICT path in the email
  // helper rewrites the same row, and 30+ days is dead state.
  { table: 'nf_budget_warning_sent', tsColumn: 'last_sent_at', retentionDays: 30 },
  // Round 37: funnel events. 90d default keeps cohort comparisons valid
  // (longest window the /admin/funnel UI exposes is 180d but practical
  // ad-source attribution rarely looks past 90d).
  { table: 'nf_funnel_event', tsColumn: 'created_at' },
  // Add more audit tables here as they're introduced. Keep retention modest
  // unless a regulatory rule mandates longer.
];

function defaultRetentionDays(): number {
  const v = parseInt(process.env.AUDIT_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 90;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = defaultRetentionDays();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const db = getDbAdapter();

  const results: Array<{ table: string; cutoffMs: number; deleted: number; ok: boolean; error?: string }> = [];
  for (const target of TABLES) {
    const tableCutoff = target.retentionDays
      ? Date.now() - target.retentionDays * 24 * 60 * 60 * 1000
      : cutoff;
    try {
      // Count first so the response can report what was deleted. Some adapters
      // don't surface affected-row count from execute(), so we measure ourselves.
      const before = await db.queryOne<{ c: number }>(
        `SELECT COUNT(*) as c FROM ${target.table} WHERE ${target.tsColumn} < ?`,
        tableCutoff,
      ).catch(() => null);
      const expected = before?.c ?? 0;
      if (expected > 0) {
        await db.execute(
          `DELETE FROM ${target.table} WHERE ${target.tsColumn} < ?`,
          tableCutoff,
        );
      }
      results.push({ table: target.table, cutoffMs: tableCutoff, deleted: expected, ok: true });
    } catch (e) {
      results.push({
        table: target.table,
        cutoffMs: tableCutoff,
        deleted: 0,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    defaultRetentionDays: days,
    results,
    summary: {
      tables: results.length,
      totalDeleted: results.reduce((s, r) => s + r.deleted, 0),
      failed: results.filter(r => !r.ok).length,
    },
  });
}
