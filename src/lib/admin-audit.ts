/**
 * admin-audit — append-only log of every admin action that mutates state.
 *
 * Why: at the first sign of trouble (rogue admin, accidental rotation,
 * billing dispute) we need to answer "who did what when from where".
 * Audit rows store sha256 hashes of value diffs, never plaintext, so the
 * log itself isn't a secrets liability.
 *
 * Usage:
 *   await recordAdminAudit(req, {
 *     adminUserId: superAdmin.userId,
 *     action: 'setting.rotate',
 *     target: 'toss.secret_key',
 *     oldValueHash, newValueHash,            // from setSetting()
 *     metadata: { scope: 'api_key' },
 *   });
 */

import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getDbAdapter } from './db-adapter';
import { getTrustedClientIp } from './client-ip';

export interface AdminAuditEntry {
  adminUserId: string;
  action: string;            // dotted path, e.g. 'setting.rotate' | 'feature_flag.toggle' | 'escrow.override'
  target?: string;           // mutated entity key/id
  oldValueHash?: string | null;
  newValueHash?: string | null;
  metadata?: Record<string, unknown>;
}

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_admin_audit (
      id              TEXT PRIMARY KEY,
      admin_user_id   TEXT NOT NULL,
      action          TEXT NOT NULL,
      target          TEXT,
      old_value_hash  TEXT,
      new_value_hash  TEXT,
      metadata        TEXT,
      ip_address      TEXT,
      user_agent      TEXT,
      created_at      BIGINT NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_admin_audit_user_time ON nf_admin_audit(admin_user_id, created_at DESC)').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_admin_audit_action_time ON nf_admin_audit(action, created_at DESC)').catch(() => {});
  tableEnsured = true;
}

export async function recordAdminAudit(
  req: NextRequest,
  entry: AdminAuditEntry,
): Promise<void> {
  const db = getDbAdapter();
  await ensureTable(db);
  const ip = (() => { try { return getTrustedClientIp(req.headers); } catch { return null; } })();
  const ua = req.headers.get('user-agent')?.slice(0, 500) ?? null;
  await db.execute(
    `INSERT INTO nf_admin_audit
       (id, admin_user_id, action, target, old_value_hash, new_value_hash,
        metadata, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `aud_${randomUUID()}`,
    entry.adminUserId, entry.action, entry.target ?? null,
    entry.oldValueHash ?? null, entry.newValueHash ?? null,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
    ip, ua, Date.now(),
  ).catch(err => console.warn('[admin-audit] write failed:', err));
}

interface AuditRow {
  id: string;
  admin_user_id: string;
  action: string;
  target: string | null;
  old_value_hash: string | null;
  new_value_hash: string | null;
  metadata: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
}

export interface AuditQuery {
  windowH?: number;       // default 168 (7d)
  action?: string;        // exact match
  target?: string;        // exact match
  adminUserId?: string;   // exact match
  limit?: number;         // default 100, max 500
}

export async function queryAdminAudit(query: AuditQuery = {}): Promise<Array<{
  id: string; adminUserId: string; action: string; target: string | null;
  oldValueHash: string | null; newValueHash: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null; userAgent: string | null;
  createdAt: number;
}>> {
  const db = getDbAdapter();
  await ensureTable(db);
  const windowH = Math.min(720, Math.max(1, query.windowH ?? 168));
  const since = Date.now() - windowH * 60 * 60 * 1000;
  const limit = Math.min(500, Math.max(10, query.limit ?? 100));
  const filters: string[] = ['created_at >= ?'];
  const params: (string | number)[] = [since];
  if (query.action) { filters.push('action = ?'); params.push(query.action); }
  if (query.target) { filters.push('target = ?'); params.push(query.target); }
  if (query.adminUserId) { filters.push('admin_user_id = ?'); params.push(query.adminUserId); }

  const rows = await db.queryAll<AuditRow>(
    `SELECT * FROM nf_admin_audit WHERE ${filters.join(' AND ')}
      ORDER BY created_at DESC LIMIT ?`,
    ...params, limit,
  ).catch((): AuditRow[] => []);

  return rows.map(r => ({
    id: r.id,
    adminUserId: r.admin_user_id,
    action: r.action,
    target: r.target,
    oldValueHash: r.old_value_hash,
    newValueHash: r.new_value_hash,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    createdAt: Number(r.created_at),
  }));
}
