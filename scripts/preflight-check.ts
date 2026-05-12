#!/usr/bin/env tsx
/**
 * Pre-launch preflight — verifies that the deployed env + DB are in the
 * state expected by recent code changes.
 *
 * Usage (local dev): `npx tsx scripts/preflight-check.ts`
 * Usage (Railway):   add `node-tsx scripts/preflight-check.ts` to release cmd
 *                    or run via `railway run npx tsx scripts/preflight-check.ts`
 *
 * Exits non-zero if anything critical is missing — wire into CI to block
 * deploys that would fail at runtime.
 */
import path from 'path';
import fs from 'fs';

const ROOT = path.join(__dirname, '..');

// Load parent .env per the project's env policy.
function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const raw of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(path.resolve(ROOT, '../..', '.env'));
loadEnvFile(path.join(ROOT, '.env.local'));

const REQUIRED_ENV: Array<{ key: string; reason: string; critical: boolean }> = [
  { key: 'DATABASE_URL',         reason: 'Postgres connection',         critical: true },
  { key: 'CRON_SECRET',          reason: 'Cron auth (8 jobs)',          critical: true },
  { key: 'NEXYFAB_ADMIN_EMAIL',  reason: 'Operator notifications',      critical: true },
  { key: 'NEXT_PUBLIC_AUTH_URL', reason: 'Auth server endpoint',        critical: true },
  { key: 'TOSS_SECRET_KEY',      reason: 'Server-side payment confirm', critical: true },
  { key: 'NEXT_PUBLIC_TOSS_CLIENT_KEY', reason: 'Browser SDK',          critical: true },
  { key: 'TOSS_WEBHOOK_SECRET',  reason: 'Webhook signature verify',    critical: true },
  { key: 'SMTP_HOST',            reason: 'Email send',                  critical: true },
  { key: 'SMTP_USER',            reason: 'Email auth',                  critical: true },
  { key: 'SMTP_PASS',            reason: 'Email auth',                  critical: true },
  { key: 'JWT_SECRET',           reason: 'Legacy HS256 fallback',       critical: false },
  { key: 'NEXT_PUBLIC_NEXYSYS_URL', reason: 'Cross-product links',      critical: false },
];

const REQUIRED_MIGRATIONS = [
  { version: 77, name: 'concierge_status' },
  { version: 78, name: 'partner_invites' },
  { version: 79, name: 'agreement_consents' },
  { version: 80, name: 'escrow_transactions' },
  { version: 81, name: 'pro_grace_until' },
  { version: 82, name: 'payment_attempts' },
  { version: 83, name: 'orders_quote_id' },
];

interface Result { ok: boolean; failures: string[]; warnings: string[] }

async function checkEnv(): Promise<Result> {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const { key, reason, critical } of REQUIRED_ENV) {
    const v = process.env[key];
    if (!v || v.trim() === '') {
      const msg = `${key} (${reason})`;
      if (critical) failures.push(msg); else warnings.push(msg);
    }
  }
  // Spot-check obvious dev values that leaked to prod.
  if (process.env.NEXT_PUBLIC_AUTH_URL?.includes('localhost')) {
    failures.push('NEXT_PUBLIC_AUTH_URL points to localhost — production deploy will break');
  }
  if (process.env.TOSS_SECRET_KEY?.startsWith('test_')) {
    warnings.push('TOSS_SECRET_KEY is a TEST key — fine for staging, swap to live before launch');
  }
  return { ok: failures.length === 0, failures, warnings };
}

async function checkMigrations(): Promise<Result> {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (!process.env.DATABASE_URL) {
    return { ok: false, failures: ['DATABASE_URL missing — cannot verify migrations'], warnings: [] };
  }
  try {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ version: number; name: string }>(
        'SELECT version, name FROM nf_schema_migrations ORDER BY version',
      );
      const applied = new Set(rows.map(r => r.version));
      for (const m of REQUIRED_MIGRATIONS) {
        if (!applied.has(m.version)) failures.push(`v${m.version} (${m.name}) not applied`);
      }
      // Also spot-check critical columns that lazy-init paths depend on.
      const critColumns: Array<[string, string]> = [
        ['nf_users', 'pro_grace_until'],
        ['nf_orders', 'quote_id'],
        ['nf_orders', 'payment_status'],
        ['nf_orders', 'toss_order_id'],
      ];
      for (const [table, col] of critColumns) {
        const r = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = $1 AND column_name = $2
           ) as exists`,
          [table, col],
        );
        if (!r.rows[0].exists) failures.push(`${table}.${col} column missing`);
      }
    } finally {
      await client.end();
    }
  } catch (e) {
    failures.push(`DB connect failed: ${(e as Error).message}`);
  }
  return { ok: failures.length === 0, failures, warnings };
}

async function main() {
  console.log('[preflight] env check…');
  const env = await checkEnv();
  console.log('[preflight] migration check…');
  const mig = await checkMigrations();

  const allFailures = [...env.failures.map(f => `ENV: ${f}`), ...mig.failures.map(f => `DB: ${f}`)];
  const allWarnings = [...env.warnings.map(w => `ENV: ${w}`), ...mig.warnings.map(w => `DB: ${w}`)];

  if (allFailures.length === 0) {
    console.log('\n✓ All preflight checks passed.');
  } else {
    console.error(`\n✗ ${allFailures.length} blocker(s):`);
    for (const f of allFailures) console.error(`  - ${f}`);
  }
  if (allWarnings.length > 0) {
    console.warn(`\n⚠ ${allWarnings.length} warning(s):`);
    for (const w of allWarnings) console.warn(`  - ${w}`);
  }
  process.exit(allFailures.length === 0 ? 0 : 1);
}

void main();
