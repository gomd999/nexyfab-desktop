import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getDbAdapter } from '@/lib/db-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Key-gated seed for a reusable E2E test account. Runs on the server with the
 * real DB adapter (SQLite or Postgres) and writes only the guaranteed columns,
 * so it works even where the full signup INSERT 500s on a missing column.
 *
 * POST { email, password, plan? } with header `x-seed-key: <DEV_SEED_KEY>`.
 * Idempotent: updates the password_hash + plan if the user already exists.
 * Disabled entirely when DEV_SEED_KEY is unset.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.DEV_SEED_KEY;
  if (!expected) return NextResponse.json({ error: 'seeding disabled' }, { status: 404 });
  if (req.headers.get('x-seed-key') !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string; plan?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const plan = body.plan ?? 'enterprise';
  if (!email || password.length < 8) {
    return NextResponse.json({ error: 'email + password (>=8) required' }, { status: 400 });
  }

  const db = getDbAdapter();

  // Schema repair: production drifted (missing migration columns/tables), which
  // 500s both signup and login when they reference nexyfab_plan / refresh tokens.
  // Bring the auth-critical bits up to date idempotently.
  const migrations: [string, string][] = [
    ['nexyfab_plan', 'ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS nexyfab_plan TEXT'],
    ['nexyflow_plan', "ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS nexyflow_plan TEXT NOT NULL DEFAULT 'free'"],
    ['stage', 'ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS stage TEXT'],
    ['failed_login_attempts', 'ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0'],
    ['locked_until', 'ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS locked_until BIGINT'],
    ['refresh_tokens', `CREATE TABLE IF NOT EXISTS nf_refresh_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL, revoked BOOLEAN NOT NULL DEFAULT FALSE, created_at BIGINT NOT NULL)`],
    ['login_history', `CREATE TABLE IF NOT EXISTS nf_login_history (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ip TEXT NOT NULL, country TEXT, user_agent TEXT,
      method TEXT NOT NULL DEFAULT 'email', success BOOLEAN NOT NULL DEFAULT TRUE,
      risk_level TEXT NOT NULL DEFAULT 'normal', risk_reason TEXT, service TEXT NOT NULL DEFAULT 'nexyfab',
      created_at BIGINT NOT NULL)`],
  ];
  const migrated: Record<string, string> = {};
  for (const [name, sql] of migrations) {
    try { await db.execute(sql); migrated[name] = 'ok'; }
    catch (e) { migrated[name] = e instanceof Error ? e.message.slice(0, 80) : 'err'; }
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = Date.now();

  const existing = await db.queryOne<{ id: string }>('SELECT id FROM nf_users WHERE email = ?', email);
  if (existing) {
    await db.execute(
      'UPDATE nf_users SET password_hash = ?, plan = ?, email_verified = TRUE, updated_at = ? WHERE id = ?',
      passwordHash, plan, now, existing.id,
    );
    return NextResponse.json({ ok: true, action: 'updated', id: existing.id, email, plan, migrated });
  }
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO nf_users (id, email, name, password_hash, plan, email_verified, project_count, created_at, services, updated_at)
     VALUES (?, ?, ?, ?, ?, TRUE, 0, ?, ?, ?)`,
    id, email, email.split('@')[0], passwordHash, plan, now, '["nexyfab"]', now,
  );
  return NextResponse.json({ ok: true, action: 'created', id, email, plan, migrated });
}
