import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
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
 * Disabled entirely in production (including Railway production) and when
 * DEV_SEED_KEY is unset. Staging is explicitly allowed so a leaked key can
 * never turn this route into a production mutation primitive.
 */
const PRODUCTION_ENVIRONMENT_MARKERS = new Set(['production', 'prod', 'live']);
const NON_PRODUCTION_ENVIRONMENT_MARKERS = new Set([
  'staging', 'stage', 'preview', 'development', 'dev', 'test',
]);

/**
 * Return true unless the runtime is unambiguously a non-production target.
 *
 * Railway runs Next with NODE_ENV=production in both production and staging,
 * so the Railway/Vercel deployment marker takes precedence over NODE_ENV.
 * Conflicting or unknown deployment markers fail closed as production.
 */
function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const deploymentSignals = [
    env.RAILWAY_ENVIRONMENT_NAME,
    env.RAILWAY_ENVIRONMENT,
    env.VERCEL_ENV,
    env.NEXT_PUBLIC_VERCEL_ENV,
  ]
    .map(value => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  const uniqueSignals = [...new Set(deploymentSignals)];

  if (uniqueSignals.length > 0) {
    const hasProductionSignal = uniqueSignals.some(value => PRODUCTION_ENVIRONMENT_MARKERS.has(value));
    const hasNonProductionSignal = uniqueSignals.some(value => NON_PRODUCTION_ENVIRONMENT_MARKERS.has(value));
    const hasUnknownSignal = uniqueSignals.some(
      value => !PRODUCTION_ENVIRONMENT_MARKERS.has(value) && !NON_PRODUCTION_ENVIRONMENT_MARKERS.has(value),
    );
    // Unknown, conflicting, or explicitly production deployment markers are
    // all denied. Only a known non-production marker can open this route.
    return hasProductionSignal || hasUnknownSignal || !hasNonProductionSignal;
  }

  const nodeEnvironment = env.NODE_ENV?.trim().toLowerCase();
  // Local development/tests remain usable; an absent or unknown NODE_ENV is
  // treated as production because the route is a mutating debug primitive.
  return nodeEnvironment !== 'development' && nodeEnvironment !== 'dev' && nodeEnvironment !== 'test';
}

export async function POST(req: NextRequest) {
  const expected = process.env.DEV_SEED_KEY;
  if (isProductionRuntime() || !expected) {
    return NextResponse.json({ error: 'seeding disabled' }, { status: 404 });
  }
  if (req.headers.get('x-seed-key') !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  let body: { email?: string; password?: string; plan?: string };
  try { body = await readBoundedJson(req, 64 * 1024); }
  catch (error) {
    if (boundedJsonError(error)?.status === 413) return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    body = {};
  }
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
